"""ingest 결과 저장 — 재업로드·orphan 규칙의 소유자(CLAUDE.md §3 규칙 11, ADR 0001 §1, ADR 0005, ADR 0007 §2-2). 담당: bim-ingest.

- 같은 GlobalId = 같은 객체: 속성·기하만 갱신하고 state·이력은 절대 건드리지 않는다. model_version 증가.
- 사라진 GlobalId: is_orphaned=True 로 표시만 한다(삭제 금지). 다시 나타나면 is_orphaned=False 로 복귀.
- 새 GlobalId: state=PLANNED 로 삽입(ingest 는 상태를 만들지 않는다 — 초기값만).
- DXF: 같은 (project_id, file_id) 재업로드는 같은 DrawingRow 를 재사용하고 엔티티를 교체한다. 사용자 정합(alignment)은 유지.
- ADR 0005: `bim_objects` PK 는 (project_id, global_id)다. 위 재업로드·orphan 판단은 프로젝트 범위 안에서만 이루어진다 —
  같은 GlobalId 가 다른 프로젝트에도 있을 수 있고, 그것은 충돌이 아니라 정상 사용이다(같은 IFC를 여러 프로젝트에 올리는 경우).
- 문서관리대장(ADR 0007 §2-2): 같은 (project_id, doc_id) = 같은 문서 — 대장이 정본이므로 값을 전부 덮어쓴다.
  이번 업로드에 존재한 doc_type 에 대해서만 판단해 사라진 문서를 is_orphaned=True 로 표시한다(삭제 금지, 다른
  doc_type 문서는 건드리지 않는다). 다시 나타나면 is_orphaned=False 로 복귀. title 미세 수정으로 doc_id 가
  바뀌면 새 행을 만들고 `document_possibly_renamed` 경고만 남긴다(자동 병합 금지 — 사람이 판단한다).
- 식별 드리프트(ADR 0009 §5-2): 대장 원문은 그대로인데 우리 쪽 식별 규칙(config `sender_aliases`·
  `sheet_doc_types`·`column_aliases`, 또는 config 밖의 워크북 시트명)이 바뀌어 `doc_id` 가 이동한 것을
  탐지한다. 재업로드 규칙(위 두 줄)을 이미 소유하는 자리가 "무엇이 사라지고 무엇이 새로 생겼는가"를
  아는 유일한 자리이므로 판정이 여기 있다. 결과는 `PersistedDocumentImport.identity_drift` 로 나가고,
  그것을 CM 검토 큐로 올리는 일은 소비자(`services/progress/document_mapper.open_identity_drift_review`,
  이 타입의 소유자)와 api 가 한다. `title_identity`·`identity_fingerprint` 두 컬럼도 여기서 채운다 —
  전자는 `doc_id` 의 재료(행 단위), 후자는 그 `doc_id` 를 만든 규칙의 지문(적재 단위)이다.
api 계층은 이 함수들을 호출만 한다.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.models import BimObjectDraft, Document, DrawingEntityDraft, IngestResult
from packages.core.models.orm import BimObjectRow, DocumentRow, DrawingEntityRow, DrawingRow, ModelRow
from packages.core.models.state import ObjectState
from services.progress import persistence as progress_db
from services.progress.config_loader import load_config
from services.progress.document_mapper import IdentityDriftReport, is_rejected_mapping
from services.progress.importers.document_register import DocumentRegisterImportResult, RegisterWarning

_DOCUMENT_REGISTER_CONFIG_FILENAME = "document_register.yaml"

# ADR 0009 §5-2 탐지 경고 code. 메시지 원문은 config/document_register.yaml `import_warnings` 에 있고
# 여기서는 키만 쓴다(`document_possibly_renamed` 와 같은 관례 — 한국어 리터럴을 코드에 두지 않는다).
_IDENTITY_DRIFT_WARNING_CODE = "DOCUMENT_IDENTITY_DRIFT"
_IDENTITY_COLLISION_WARNING_CODE = "DOCUMENT_IDENTITY_COLLISION"
_DECISION_CONFIRMED = "confirmed"
_DECISION_REJECTED = "rejected"
# 사람의 판단이 오염된 **경위**. `IdentityDriftReport.lost_decisions` 항목의 `cause` 값이며, 소비자
# (`services/progress/document_mapper._identity_drift_review_title`)가 CM 에게 보일 문구를 이 값으로 가른다.
# 세 값이 필요한 이유는 셋의 "지금 그 판단이 무엇을 가리키고 있는가"가 서로 다르기 때문이다 —
# 문구가 사실과 다르면 그 자체가 결함이므로(이 저장소가 세 번 겪었다) 추측으로 합치지 않는다.
_CAUSE_ORPHANED = "orphaned"                 # 판단이 가리키던 행이 고아가 됐다(doc_id 가 새 값으로 이동)
_CAUSE_MERGE_OVERWRITTEN = "merge_overwritten"   # 행은 살아 있는데 **내용이 다른 대장 행으로 바뀌었다**(병합)
_CAUSE_MERGE_ABSORBED = "merge_absorbed"     # 판단이 가리키던 행이 **다른 doc_id 로 흡수돼** 사라졌다(병합)
_DRIFT_PAIRS_IN_MESSAGE = 5   # 경고 문자열에 나열할 이동 쌍의 최대 수(나머지는 identity_drift.moved 에 전부 있다)


class PersistedModel(BaseModel):
    """persist_ingest_result 요약(api 가 job.result 에 그대로 넣을 수 있는 JSON 호환 값)."""
    model_id: str
    version: int
    object_count: int
    created: int
    updated: int
    orphaned: int
    orphaned_global_ids: list[str] = Field(default_factory=list)
    duplicate_global_ids: list[str] = Field(default_factory=list)   # 파서를 거치지 않은 결과에서 방어적으로 suffix 한 것


def _new_model_id() -> str:
    return f"m-{uuid.uuid4().hex[:12]}"


def _new_drawing_id() -> str:
    return f"d-{uuid.uuid4().hex[:12]}"


def latest_model(session: Session, project_id: str) -> ModelRow | None:
    return session.scalars(select(ModelRow).where(ModelRow.project_id == project_id).order_by(ModelRow.version.desc())).first()


def project_objects(session: Session, project_id: str, include_orphaned: bool = True) -> list[BimObjectRow]:
    stmt = select(BimObjectRow).where(BimObjectRow.project_id == project_id)
    if not include_orphaned:
        stmt = stmt.where(BimObjectRow.is_orphaned.is_(False))
    return list(session.scalars(stmt.order_by(BimObjectRow.global_id)))


def dedupe_global_ids(drafts: list[BimObjectDraft]) -> tuple[list[BimObjectDraft], list[str]]:
    """한 파일 안의 GlobalId 충돌은 파서가 `<gid>#n` 으로 처리한다. 여기서는 방어적으로 한 번 더 보장한다."""
    seen: dict[str, int] = {}
    out: list[BimObjectDraft] = []
    duplicates: list[str] = []
    for d in drafts:
        gid = d.global_id
        if gid in seen:
            seen[gid] += 1
            suffixed = f"{gid}#{seen[gid]}"
            duplicates.append(suffixed)
            d = d.model_copy(update={"global_id": suffixed})
        else:
            seen[gid] = 0
        out.append(d)
    return out, duplicates


def _apply_draft(row: BimObjectRow, d: BimObjectDraft, model_id: str, version: int) -> None:
    """기하·속성만 갱신. state 는 여기서 절대 쓰지 않는다."""
    row.model_id, row.model_version, row.ifc_type, row.is_orphaned = model_id, version, d.ifc_type, False
    row.name, row.level, row.level_elevation, row.zone = d.name, d.level, d.level_elevation, d.zone
    row.bbox = d.bbox.model_dump(mode="json") if d.bbox is not None else None
    row.mesh_ref, row.psets, row.material, row.quantity, row.express_id = d.mesh_ref, dict(d.psets), d.material, dict(d.quantity), d.express_id


def persist_ingest_result(session: Session, project_id: str, file_id: str, result: IngestResult,
                          model_id: str | None = None) -> PersistedModel:
    """IFC(또는 RVT→IFC) IngestResult → ModelRow + BimObjectRow. 재업로드 규칙은 모듈 docstring 참조.

    새 ModelRow 를 항상 만든다(version = 프로젝트 최신 + 1, 없으면 1). model_id 를 주면 그 id 로 만든다.
    """
    prev = latest_model(session, project_id)
    version = (prev.version + 1) if prev is not None else 1
    model = ModelRow(model_id=model_id or _new_model_id(), project_id=project_id, file_id=file_id, version=version,
                     coordinate_system=result.coordinate_system.model_dump(mode="json"), levels=list(result.levels),
                     mesh_uri=result.mesh_uri, stats=dict(result.stats))
    session.add(model)
    session.flush()

    drafts, duplicates = dedupe_global_ids(list(result.objects))
    existing = {r.global_id: r for r in project_objects(session, project_id, include_orphaned=True)}
    created = updated = 0
    seen: set[str] = set()
    for d in drafts:
        seen.add(d.global_id)
        row = existing.get(d.global_id)
        if row is None:
            # ADR 0005 규칙 4·5: 같은 GlobalId 가 다른 프로젝트에 있어도 충돌이 아니다.
            # bim_objects PK 는 (project_id, global_id) 이므로 이 프로젝트 안에서만 신규/기존을 가른다.
            row = BimObjectRow(global_id=d.global_id, project_id=project_id, model_id=model.model_id,
                               state=ObjectState.PLANNED.value)   # 초기값. 이후 전이는 progress-engine 상태기계만
            session.add(row)
            existing[d.global_id] = row
            created += 1
        else:
            updated += 1   # state·이력 유지, 속성·기하만 갱신
        _apply_draft(row, d, model.model_id, version)

    orphaned = sorted(gid for gid, row in existing.items() if gid not in seen and not row.is_orphaned)
    for gid in orphaned:
        existing[gid].is_orphaned = True
    session.flush()
    return PersistedModel(model_id=model.model_id, version=version, object_count=len(drafts), created=created,
                          updated=updated, orphaned=len(orphaned), orphaned_global_ids=orphaned,
                          duplicate_global_ids=duplicates)


def _entity_row(drawing_id: str, e: DrawingEntityDraft) -> DrawingEntityRow:
    return DrawingEntityRow(
        drawing_id=drawing_id, handle=e.handle, layer=e.layer, dxftype=e.dxftype,
        points=[list(p) for p in e.points], bbox=e.bbox.model_dump(mode="json") if e.bbox else None,
        block_name=e.block_name, insert_point=list(e.insert_point) if e.insert_point else None,
        rotation_deg=e.rotation_deg, scale=list(e.scale) if e.scale else None, text=e.text, radius=e.radius,
        attrs=dict(e.attrs),
    )


def find_drawing(session: Session, project_id: str, file_id: str) -> DrawingRow | None:
    return session.scalars(select(DrawingRow).where(DrawingRow.project_id == project_id, DrawingRow.file_id == file_id)).first()


def persist_drawing(session: Session, project_id: str, file_id: str, result: IngestResult, level: str | None,
                    drawing_id: str | None = None) -> str:
    """DXF/DWG IngestResult → DrawingRow + DrawingEntityRow. 반환: drawing_id.

    같은 drawing_id(명시) 또는 같은 (project_id, file_id) 가 이미 있으면 그 DrawingRow 를 재사용하고 엔티티를 전부 교체한다.
    사용자가 입력한 정합(alignment)·svg_uri 는 유지한다. 엔티티↔객체 매핑 재구축은 sync-2d3d 가 담당한다.
    """
    drawing: DrawingRow | None = session.get(DrawingRow, drawing_id) if drawing_id else None
    if drawing is None:
        drawing = find_drawing(session, project_id, file_id)
    if drawing is None:
        drawing = DrawingRow(drawing_id=drawing_id or _new_drawing_id(), project_id=project_id, file_id=file_id, level=level,
                             coordinate_system=result.coordinate_system.model_dump(mode="json"), stats=dict(result.stats))
        session.add(drawing)
    else:
        if drawing.project_id != project_id:
            raise ValueError(f"drawing {drawing.drawing_id} belongs to project {drawing.project_id}, not {project_id}")
        drawing.file_id, drawing.level, drawing.stats = file_id, level, dict(result.stats)
        if not drawing.alignment:   # 정합이 있으면 coordinate_system 은 정합된 좌표계이므로 덮어쓰지 않는다
            drawing.coordinate_system = result.coordinate_system.model_dump(mode="json")
        session.execute(delete(DrawingEntityRow).where(DrawingEntityRow.drawing_id == drawing.drawing_id))
    session.flush()
    session.add_all(_entity_row(drawing.drawing_id, e) for e in result.entities)
    session.flush()
    return drawing.drawing_id


# ─────────────────────────────────────────────────────────────────────────────
# 문서관리대장 (ADR 0007 §2-2) — 파서(services/progress/importers/document_register.py)는 순수 함수라
# DB를 모른다. is_orphaned 판정과 document_possibly_renamed 경고는 기존 DB 대조가 필요하므로 여기가 그 호출자다.
# ─────────────────────────────────────────────────────────────────────────────
class PersistedDocumentImport(BaseModel):
    """persist_document_register_import 요약(api 가 job.result 에, warnings 는 JobRow.warnings 에 그대로 넣을 수 있는 값)."""
    project_id: str
    file_id: str
    document_count: int
    created: int
    updated: int
    orphaned: int
    unorphaned: int
    orphaned_doc_ids: list[str] = Field(default_factory=list)
    unorphaned_doc_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)   # 파서 경고 + document_possibly_renamed + 식별 드리프트 2종
    # ADR 0009 §5-2. 관측된 것이 있을 때만(moved 또는 merged 가 비어 있지 않을 때만) 채운다 — api 가
    # `is not None` 으로 검토요청 생성 여부를 가르므로(계획 0003 §3-f), 아무 일도 없었는데 빈 보고서를
    # 돌려주면 매 적재가 드리프트로 보고된다. 타입은 소비자(services/progress/document_mapper)가 소유한다.
    identity_drift: IdentityDriftReport | None = None


def project_documents(session: Session, project_id: str) -> dict[str, DocumentRow]:
    stmt = select(DocumentRow).where(DocumentRow.project_id == project_id)
    return {r.doc_id: r for r in session.scalars(stmt)}


def _apply_document(row: DocumentRow, d: Document, imported_at: datetime, identity_fingerprint: str) -> None:
    """대장 값으로 전부 덮어쓴다 — 대장이 정본이다(ADR 0007 §2-2 규칙 1). state 개념이 없으므로
    (문서 승인 상태는 ObjectState 와 무관, ADR 0007 §3-1) 재업로드 규칙 1의 "이력 유지"는 여기서 다룰
    것이 없다 — 그대로 최신 대장 값으로 교체하면 된다.

    `identity_fingerprint` 는 **적재 단위** 값이라 `Document`(행 단위 모델)에 실려 오지 않는다
    (ADR 0009 §5-2, `DocumentRegisterImportResult.identity_fingerprint`). `imported_at` 과 같은 방식으로
    호출자가 넘겨 행마다 복제한다 — 별도 테이블을 만들지 않기 위한 선택이다."""
    row.doc_type = d.doc_type.value
    row.sender, row.sender_normalized = d.sender, d.sender_normalized
    row.discipline_raw, row.discipline_normalized = d.discipline_raw, d.discipline_normalized
    row.seq_raw, row.seq_normalized = d.seq_raw, d.seq_normalized
    row.doc_number = d.doc_number
    # 대조용(config `title_matching.normalize`)과 식별용(코드 동결 `identity_title`)을 **둘 다** 저장한다.
    # ADR 0009 §1 이전에는 title_normalized 하나가 두 역할을 겸했고, 그래서 매칭 튜닝 한 줄이 doc_id 를
    # 움직였다. `title_identity` 는 `Document` 모델 검증기가 title 에서 파생한 값이며 doc_id 의 재료다 —
    # 이 컬럼이 NULL 로 남으면 "옛 스킴으로 쓰인 행"이라는 신호와 구분되지 않는다(orm.py 컬럼 주석).
    row.title, row.title_normalized, row.title_identity = d.title, d.title_normalized, d.title_identity
    row.issued_on, row.completed_on = d.issued_on, d.completed_on
    row.result_raw = d.result_raw
    row.approval_status = d.approval_status.value
    row.approval_confidence = d.approval_confidence
    row.approval_evidence = d.approval_evidence.model_dump(mode="json")
    row.file_id, row.sheet_name, row.source_row = d.file_id, d.sheet_name, d.source_row
    row.needs_review = d.needs_review
    # ADR 0007 §2-2 규칙 2 의 뒷면: 고아 표시는 "이번 업로드에 없는 문서"에 붙으므로, 다시 나타난 문서는
    # 표시를 거둔다. 대장에서 실수로 지웠다 되살리는 일이 실제로 있다. (§2-2 에 규칙 5 는 없다 — 참조 정정)
    row.is_orphaned = False
    row.imported_at = imported_at
    row.identity_fingerprint = identity_fingerprint


def _doc_number_compatible(previous: str | None, current: str | None) -> bool:
    """이동 쌍 후보를 좁히는 보조 판별. 문서번호는 `doc_id` 재료가 **아니므로**(ADR 0007 §2-1: 신뢰할 수
    없는 필드는 정체성에 넣지 않는다) 식별 규칙이 바뀌어도 값이 변하지 않는다 — 즉 진짜 드리프트에서는
    두 값이 언제나 같다. 반대로 "제목이 우연히 같은 서로 다른 문서"(부분 업로드에서 다른 시트의 동명
    문서)는 대개 문서번호가 다르다. 한쪽이 비어 있으면(대장에 문서번호 열이 없는 현장이 있다) 판별에
    쓸 수 없으므로 통과시킨다 — 제목 원문 일치라는 주 조건은 그대로 걸린다."""
    return previous is None or current is None or previous == current


def _pair_identity_moves(previous_rows: dict[str, DocumentRow], seen_doc_ids: set[str],
                         created_documents: list[Document]) -> list[dict[str, str]]:
    """ADR 0009 §5-2 — "대장 원문은 그대로인데 `doc_id` 가 이동한" 쌍을 찾는다.

    **왜 `rename_index` 를 쓰지 않는가**(계획 0003 §3-e 1 은 그것을 쓰라고 적었다). `rename_index` 의
    키는 `(doc_type, sender_normalized, seq_normalized)` 이고 `doc_id` 는 그 셋에 `title_identity` 를
    더한 해시다. 그래서 "키가 같고 제목 원문도 같다"는 곧 "재료 넷이 모두 같다" = **같은 `doc_id`** 이고,
    그 문서는 애초에 신규 행이 아니다 — 계획의 그 분기는 발화할 수 없다. 실측으로 확인했다:
    `sender_aliases` 표준명을 바꿔 재업로드하면 7건이 고아가 되고 제목 원문이 같은 7건이 새로 생기는데,
    `sender_normalized` 가 함께 바뀌어 키가 어긋나므로 `document_possibly_renamed` 는 **한 건도** 뜨지
    않는다. `rename_index` 에 기대면 정확히 이 사고(ADR 0009 §2 의 재현 사례)를 놓친다.

    그래서 ADR 본문의 규칙("고아 ↔ 신규 쌍의 `title` 원문이 같다")을 그대로 구현한다. 다만 후보를
    `is_orphaned` 로 좁히지 않고 **이번 적재에 나타나지 않은 기존 행 전부**로 잡는다: 워크북 시트명을
    바꾸면(`TFA` → `자료제출`) `doc_type` 이 함께 바뀌어 ADR 0007 §2-2 규칙 2 의 doc_type 범위 제한
    때문에 옛 행이 **고아가 되지도 않는다**(실측: 고아 0건, 문서 10건이 18행이 되고 CM 확정은 대장이 더
    이상 만들지 않는 행에 남는다). 고아만 보면 이 경로 전체가 조용히 지나간다.

    지문 비교는 **판정에 쓰지 않는다** — 시트명 변경은 config 를 한 글자도 바꾸지 않아 지문이 그대로다
    (config/document_register.yaml 의 `DOCUMENT_IDENTITY_DRIFT` 주석과 같은 실측). 지문은 "무엇이
    바뀌어서"를 답하는 보고 값이지 "일어났는가"를 답하는 조건이 아니다."""
    absent_by_title: dict[str, list[DocumentRow]] = {}
    for doc_id, row in sorted(previous_rows.items()):
        if doc_id not in seen_doc_ids:
            absent_by_title.setdefault(row.title, []).append(row)

    moved: list[dict[str, str]] = []
    for d in created_documents:   # 대장 행 순서 = 결정적
        candidates = absent_by_title.get(d.title)
        if not candidates:
            continue
        for i, previous_row in enumerate(candidates):
            if _doc_number_compatible(previous_row.doc_number, d.doc_number):
                candidates.pop(i)   # 한 행은 한 번만 짝지어진다(1:1)
                moved.append({"previous_doc_id": previous_row.doc_id, "new_doc_id": d.doc_id, "title": d.title})
                break
    return moved


def _collision_groups(documents: list[Document]) -> list[list[Document]]:
    """한 적재 안에서 같은 `doc_id` 로 수렴한 대장 행 묶음(2건 이상). 대장 행 순서를 보존하므로
    **마지막 원소가 upsert 루프의 승자**다(ADR 0009 §3 (나): 뒤 행이 앞 행을 덮어쓴다)."""
    by_doc_id: dict[str, list[Document]] = {}
    for d in documents:
        by_doc_id.setdefault(d.doc_id, []).append(d)
    return [group for _, group in sorted(by_doc_id.items()) if len(group) > 1]


def _identity_collisions(groups: list[list[Document]]) -> list[dict[str, Any]]:
    """ADR 0009 §3 (나) — 한 적재 안에서 서로 다른 대장 행이 같은 `doc_id` 로 수렴한 경우.

    upsert 루프는 두 번째로 나온 같은 `doc_id` 를 "기존 행 갱신"으로 처리하므로 **마지막 행이 이긴다**
    (덮어쓰기 동작 자체는 유지한다 — 대장이 정본이다). 그 결과 `document_count` 와 실제 행 수가 어긋나고
    살아남은 행의 `approval_status` 가 도면 승인 논리곱의 입력이 되는데, 지금까지 그 차이를 보고하는
    곳이 없었다. 제목이 서로 같은 완전 중복 행도 포함한다 — 행 하나가 사라지는 사실은 같기 때문이다."""
    return [{"doc_id": group[0].doc_id, "titles": [x.title for x in group],
             "rows": [{"sheet": x.sheet_name, "row": x.source_row} for x in group]}
            for group in groups]


def _register_row_signature(row: DocumentRow) -> tuple[str | None, ...]:
    """이 문서 행이 대장의 **어느 행**을 담고 있는가. 적재 전후로 이 값이 달라지면 같은 `doc_id` 아래에
    다른 대장 행이 들어온 것이다.

    담긴 필드는 "행을 구별하는 값"과 "사람의 판단이 딛고 선 값"이다. `doc_id` 재료 넷
    (`doc_type`/`sender_normalized`/`seq_normalized`/`title_identity`)은 **일부러 넣지 않는다** — 같은
    `doc_id` 안에서는 정의상 언제나 같아서 아무것도 구별하지 못한다. 반대로 `sheet_name`/`source_row` 도
    넣지 않는다: 대장 앞에 행이 하나 끼어들면 전부 밀리는데 그것은 내용 변화가 아니다.

    `approval_status` 가 이 묶음에 있는 것이 핵심이다. 그 값이 `drawing_approval` 논리곱(ADR 0007 §5-1)의
    입력이므로, 병합이 그 값을 뒤집으면 CM 이 "반려된 도면"이라고 확인해 차단해 둔 작업이 착수 가능해진다."""
    return (row.sender, row.doc_number, row.seq_raw, row.title, row.result_raw, row.approval_status)


def _merge_overwritten_doc_ids(groups: list[list[Document]], previous_signatures: dict[str, tuple[str | None, ...]],
                               current_rows: dict[str, DocumentRow]) -> list[str]:
    """병합이 **살아남은 행의 내용을 갈아치운** `doc_id`(ADR 0009 §3 (나)의 아직 안 잡히던 절반).

    `_pair_identity_moves` 는 "판단이 가리키던 행이 사라졌는가"만 본다. 그런데 병합에서 흔한 쪽은
    반대다 — 별칭표 통합처럼 **한쪽 표준명이 그대로인** 변경에서는 그 행의 `doc_id` 가 움직이지 않고,
    다른 행이 그 위로 붕괴해 뒤 행이 이긴다. 행은 살아 있고 고아도 아니고 `reviewed_by` 도 그대로인데
    그 문서의 `approval_status` 만 바뀐다. 즉 **판단이 사라지는 게 아니라 판단의 대상이 바뀐다.**
    ADR 0009 §3 이 스스로 최악이라고 적은 "미승인 도면 위에서 착수 가능을 띄운다"가 바로 이 경로다.

    두 조건을 모두 요구한다. ① `doc_id` 가 이번 적재의 충돌 묶음에 있다 ② 그 행의 대장 행 지문
    (`_register_row_signature`)이 적재 전후로 달라졌다. ②만으로는 안 된다 — 대장이 다음 주에 같은 문서의
    처리결과를 반려에서 승인으로 고쳐 오는 것은 **정상이고 대장이 정본이다**(ADR 0007 §1 규칙 1). ①이
    붙어야 "우리 식별 규칙이 두 행을 하나로 뭉갠 결과"로 좁혀진다.

    ②는 동시에 반복 오탐을 막는다. 충돌이 상시화된 대장(같은 두 행이 매주 올라온다)에서는 승자가 매번
    같아 지문이 변하지 않으므로, 사건이 일어난 적재에서 한 번만 발화한다."""
    return [doc_id for doc_id in (group[0].doc_id for group in groups)
            if doc_id in previous_signatures and doc_id in current_rows
            and previous_signatures[doc_id] != _register_row_signature(current_rows[doc_id])]


def _merge_absorbed_doc_ids(groups: list[list[Document]], previous_rows: dict[str, DocumentRow],
                            was_orphaned: dict[str, bool], seen_doc_ids: set[str],
                            claimed: set[str]) -> dict[str, str]:
    """병합이 **삼켜 버린** 옛 `doc_id` — 위 함수의 대칭 짝.

    같은 사건의 반대편이다: 별칭 통합으로 두 행이 하나가 되면 승자 쪽 행은 살아남고(위 함수), **패자
    쪽에 해당하던 기존 행은 새 `doc_id` 를 얻지 못한 채 그냥 사라진다.** `_pair_identity_moves` 는 이
    경우를 볼 수 없다 — 그것은 "사라진 옛 행 ↔ 이번에 **새로 생긴** 행"을 짝지어야 하는데, 병합은 이미
    있던 `doc_id` 로 수렴하므로 새 행이 만들어지지 않는다(실측: created 에 그 문서가 없다).

    짝짓기는 `_pair_identity_moves` 와 같은 보수적 기준이다 — 사라진 기존 행과 충돌 묶음 구성원의
    **`title` 원문이 글자 그대로 같고** 문서번호가 어긋나지 않을 것. 여기에 "이번 적재의 충돌 묶음"이라는
    조건이 이미 붙어 있으므로, 대장에서 문서를 **진짜 지운 경우**(고아가 되지만 충돌은 없다)는 걸리지
    않는다. `was_orphaned` 로 이미 고아였던 행을 빼는 것은 같은 사건을 매 적재 다시 보고하지 않기
    위해서다 — 사건이 일어난 적재에서 한 번만 발화한다.

    반환: 삼켜진 옛 `doc_id` → 그것을 삼킨 충돌 묶음의 `doc_id`(경고 문자열이 병합 건별로 "이 병합이
    사람의 판단 몇 건을 건드렸는가"를 사실대로 적기 위해 필요하다)."""
    pool = {doc_id: row for doc_id, row in sorted(previous_rows.items())
            if doc_id not in seen_doc_ids and doc_id not in claimed and not was_orphaned.get(doc_id, False)}
    absorbed: dict[str, str] = {}
    for group in groups:
        for d in group:
            match = next((doc_id for doc_id, row in pool.items()
                          if doc_id != d.doc_id and row.title == d.title
                          and _doc_number_compatible(row.doc_number, d.doc_number)), None)
            if match is not None:
                pool.pop(match)     # 한 행은 한 번만 짝지어진다(1:1)
                absorbed[match] = d.doc_id
    return absorbed


def _lost_decisions(session: Session, project_id: str, causes: dict[str, str]) -> list[dict[str, str]]:
    """식별 드리프트에 걸린 **사람의 판단**(확정·반려)을 경위(`cause`)와 함께 모은다.

    `causes` 는 `doc_id` → `_CAUSE_*`. 이 목록이 비면 `open_identity_drift_review` 가 아무것도 만들지
    않으므로(ADR 0009 §5-2 큐 오염 방지), **여기에 담기는 것이 곧 "CM 큐에 올릴 사건"의 정의**다.
    `cause` 를 항목마다 싣는 이유는 소비자가 CM 에게 보일 문구를 사실대로 쓰려면 "판단이 지금 무엇을
    가리키고 있는가"를 알아야 하기 때문이다 — 고아가 된 것과 살아 있는 행의 내용이 바뀐 것은 사람이
    해야 할 일이 다르다(전자는 새 `doc_id` 위에서 다시 확정, 후자는 **지금 화면에 보이는 승인 상태가
    자기가 본 그 문서의 것이 아님**을 먼저 알아야 한다).

    확정/반려의 구분은 `document_mapper.is_rejected_mapping()` 에 맡긴다 — 판정 키 문자열
    (`evidence.extra.mapping_review_decision`)을 이 모듈이 직접 읽지 않는다(ADR 0007 §4-2 규칙 6 ⑥)."""
    if not causes:
        return []
    lost = [{"activity_id": row.activity_id, "doc_id": row.doc_id,
             "decision": _DECISION_REJECTED if is_rejected_mapping(row.evidence) else _DECISION_CONFIRMED,
             "cause": causes[row.doc_id]}
            for row in progress_db.document_mappings_for_project(session, project_id)
            if row.doc_id in causes and row.reviewed_by is not None]
    lost.sort(key=lambda x: (x["activity_id"], x["doc_id"]))
    return lost


def _previous_fingerprint(previous_rows: dict[str, DocumentRow], seen_doc_ids: set[str]) -> str | None:
    """계획 0003 §3-e 4 — 이번 적재에 **없는** 기존 행들의 `identity_fingerprint` 중 최빈값.

    근사임을 계획 0003 §10-2 가 이미 적어 두었다(프로젝트에 지문이 셋 이상 섞이면 부정확할 수 있다).
    ADR 0009 이전에 쓰인 행은 이 값이 NULL 이므로 세지 않는다 — 첫 적재는 자연히 None 이 된다.

    **없는 행이 하나도 없으면 기존 행 전체로 넓힌다.** 병합(collision)만 관측된 적재에서는 사라진 행이
    없어 최빈값을 낼 표본이 비는데, 그때 `None` 을 돌려주면 "첫 적재라 비교할 이전 지문이 없다"(ADR 0009
    §5-2 가 놓치는 것 1)와 구분되지 않는다. 이 값은 **판정에 쓰이지 않고 보고에만 실리므로**(판정은
    `_pair_identity_moves`) 넓혀도 오탐을 만들 수 없다."""
    def _mode(doc_ids: list[str]) -> str | None:
        counts = Counter(previous_rows[doc_id].identity_fingerprint for doc_id in doc_ids
                         if previous_rows[doc_id].identity_fingerprint)
        return counts.most_common(1)[0][0] if counts else None

    return _mode([doc_id for doc_id in previous_rows if doc_id not in seen_doc_ids]) or _mode(list(previous_rows))


def persist_document_register_import(
    session: Session, project_id: str, file_id: str, import_result: DocumentRegisterImportResult,
) -> PersistedDocumentImport:
    """대장 파서 결과(`DocumentRegisterImportResult`) → `documents` 테이블. ADR 0007 §2-2 규칙 1·2·4·5를 구현한다.

    `file_id` 는 실재하는 `FileRow.file_id` 여야 한다. 여기서는(기존 `persist_ingest_result`/`ensure_model`
    전례와 같은 방식으로) 대신 자리표시 파일을 만들지 않는다 — 존재하지 않으면 `DocumentRow.file_id` FK 위반으로
    flush 시 즉시 실패한다(SQLite 는 PRAGMA foreign_keys=ON 으로 이를 강제한다, packages/core/db.py).

    `import_result.documents` 의 각 `Document.project_id`/`file_id` 는 파서가 호출 시점의 인자로 이미
    채워 넣은 값이다 — 여기서 받는 `project_id`/`file_id` 와 어긋나면(다른 스코프의 결과를 잘못 넘긴 것이므로)
    `persist_drawing` 의 프로젝트 불일치 가드와 같은 방식으로 즉시 `ValueError`.

    **식별 드리프트 판정(ADR 0009 §5-2)**은 세 갈래다. ① 이번 적재에 나타나지 않은 기존 행과 제목 원문이
    글자 그대로 같은 새 문서 → `identity_drift.moved` + `DOCUMENT_IDENTITY_DRIFT` 경고(`document_possibly_
    renamed` 는 내지 않는다 — 제목이 바뀌지 않았으므로 그 문구는 거짓이다). ② 한 적재 안에서 두 개 이상의
    대장 행이 같은 `doc_id` 로 수렴 → `identity_drift.merged` + `DOCUMENT_IDENTITY_COLLISION` 경고(덮어쓰기
    동작 자체는 유지한다 — 대장이 정본이라 마지막 행이 이긴다. 다만 더 이상 조용하지 않다). ③ ①·②로
    **사람의 판단이 오염된** 매핑(`reviewed_by is not None`) → `identity_drift.lost_decisions`.

    ③의 경위(`cause`)는 셋이다. `orphaned` — ①로 판단이 가리키던 행이 고아가 됐다. `merge_overwritten` —
    ②로 행은 살아 있는데 그 안의 대장 행이 다른 행으로 바뀌었다(승인 상태가 뒤집힐 수 있다).
    `merge_absorbed` — ②로 판단이 가리키던 행이 다른 `doc_id` 에 흡수돼 사라졌다. 처음에는 `orphaned`
    하나만 셌고, 그래서 **되돌릴 수 없는 쪽**(ADR 0009 §3 (나) 병합)이 CM 큐에 닿지 못했다: 병합은 판단을
    없애는 게 아니라 판단의 **대상**을 바꾸므로 이동 조건에 걸리지 않는다. 뒤의 두 경위는 모두 "이번
    적재의 충돌 묶음"을 전제로 하므로, 사람 판단이 없는 병합은 지금까지대로 경고에서 끝난다(§5-2 큐 오염 방지).

    **job 을 실패시키지 않는다**(ADR 0009 §5-2). 원인이 대장이 아니라 우리 config 이므로 거부해도 ADR 0007
    §1 규칙 1 위반은 아니지만, 새 협력사 별칭을 추가한 주에 주간 대장 업로드가 통째로 막히면 운영자는
    config 를 되돌리는 대신 탐지를 끄는 방향으로 움직인다.
    """
    for d in import_result.documents:
        if d.project_id != project_id or d.file_id != file_id:
            raise ValueError(
                f"document {d.doc_id} scoped to (project_id={d.project_id!r}, file_id={d.file_id!r}), "
                f"not (project_id={project_id!r}, file_id={file_id!r})"
            )

    cfg = load_config(_DOCUMENT_REGISTER_CONFIG_FILENAME)
    warning_messages = cfg["import_warnings"]
    renamed_message = str(warning_messages["document_possibly_renamed"])
    fingerprint = import_result.identity_fingerprint

    existing = project_documents(session, project_id)          # 프로젝트의 기존 문서 전체(모든 doc_type)
    previous_rows = dict(existing)   # 이번 적재가 손대기 **전**의 행 스냅샷 — 드리프트 판정의 좌변(§3-e)
    # 제목은 값으로 따로 떠 둔다: 아래 루프가 `_apply_document` 로 **같은 ORM 객체를 제자리에서** 덮어쓰므로,
    # 이번 적재에 나타난 행의 `row.title` 은 루프 도중 이미 새 값이 된다. rename 가드는 "이전 제목"을 봐야 한다.
    previous_titles = {doc_id: existing_row.title for doc_id, existing_row in existing.items()}
    was_orphaned = {doc_id: existing_row.is_orphaned for doc_id, existing_row in existing.items()}
    # 같은 이유로 대장 행 지문도 값으로 떠 둔다: 병합이 살아 있는 행의 **내용**을 갈아치웠는지는
    # "적재 전 이 행이 담고 있던 대장 행"과 비교해야만 알 수 있는데, 그 행은 루프 안에서 제자리 갱신된다.
    previous_signatures = {doc_id: _register_row_signature(existing_row) for doc_id, existing_row in existing.items()}
    # 규칙 4: title 이 미세 수정돼 doc_id 가 바뀌면 (doc_type, sender_normalized, seq_normalized) 로 이전 문서를 찾는다
    rename_index: dict[tuple[str, str, str | None], list[str]] = {}
    for existing_row in existing.values():
        rename_index.setdefault((existing_row.doc_type, existing_row.sender_normalized, existing_row.seq_normalized),
                                []).append(existing_row.doc_id)

    now = datetime.now(UTC)
    doc_types_in_upload = {d.doc_type.value for d in import_result.documents}
    seen_doc_ids: set[str] = set()
    created = updated = unorphaned = 0
    unorphaned_ids: list[str] = []
    warnings: list[str] = list(import_result.warning_messages)
    reported_renames: set[tuple[str, str]] = set()   # 같은 업로드 안에서 같은 (new, previous) 쌍을 중복 보고하지 않는다
    created_documents: list[Document] = []           # 이번 적재에서 새로 생긴 문서(드리프트 판정의 우변)

    # ADR 0009 §3 (나): 병합은 행이 사라지는 실패라 되돌릴 수 없다. upsert 루프가 덮어쓰기 전에 먼저 센다
    # (세는 대상은 파서 결과라 DB 갱신에 영향받지 않지만, 경고 **문자열**은 "이 병합이 사람의 판단을
    # 오염시켰는가"를 함께 실어야 하므로 판정이 끝난 뒤 아래에서 만든다).
    collision_groups = _collision_groups(list(import_result.documents))
    merged = _identity_collisions(collision_groups)

    for d in import_result.documents:
        seen_doc_ids.add(d.doc_id)
        row = existing.get(d.doc_id)
        if row is None:
            key = (d.doc_type.value, d.sender_normalized, d.seq_normalized)
            for previous_id in rename_index.get(key, []):
                if previous_id == d.doc_id:
                    continue
                if previous_titles.get(previous_id) == d.title:
                    # 계획 0003 §3-e 1: 제목 원문이 같으면 rename 이 아니다 — 경고 문구가 사실과 달라진다.
                    # (재료 넷이 모두 같으면 doc_id 도 같으므로 이 분기는 실제로는 도달할 수 없다.
                    #  그래도 두는 이유는 `identity_title`/`compute_doc_id` 가 나중에 바뀌었을 때
                    #  거짓 문구가 조용히 살아나지 않게 하기 위해서다. 탐지는 _pair_identity_moves 가 한다.)
                    continue
                pair = (d.doc_id, previous_id)
                if pair in reported_renames:
                    continue
                reported_renames.add(pair)
                warnings.append(str(RegisterWarning(
                    "document_possibly_renamed",
                    f"{renamed_message} (new_doc_id={d.doc_id}, previous_doc_id={previous_id}, "
                    f"doc_number={d.doc_number!r}, title={d.title!r})",
                    sheet=d.sheet_name, row=d.source_row,
                )))
            row = DocumentRow(project_id=project_id, doc_id=d.doc_id)
            session.add(row)
            existing[d.doc_id] = row
            rename_index.setdefault(key, []).append(d.doc_id)   # 같은 업로드 안의 후속 rename 후보로도 잡히도록
            created_documents.append(d)
            created += 1
        else:
            updated += 1
            if was_orphaned.get(d.doc_id):
                unorphaned += 1
                unorphaned_ids.append(d.doc_id)
        _apply_document(row, d, now, fingerprint)

    # 규칙 2: 이번 업로드에 존재한 doc_type 에 대해서만 판단한다. 업로드에 없던 doc_type 의 문서는 절대
    # 건드리지 않는다 — TFA 시트만 올렸다고 TFR 전체가 고아가 되면 안 된다.
    orphaned_ids: list[str] = []
    for doc_id, row in existing.items():
        if doc_id in seen_doc_ids or row.doc_type not in doc_types_in_upload:
            continue
        if not was_orphaned.get(doc_id, False):
            row.is_orphaned = True
            orphaned_ids.append(doc_id)

    session.flush()

    # ── ADR 0009 §5-2 식별 드리프트 판정 ───────────────────────────────────────
    # 고아 판정 뒤에 온다: 위 루프가 끝나야 "이번 적재에 나타난 doc_id" 집합이 확정된다.
    moved = _pair_identity_moves(previous_rows, seen_doc_ids, created_documents)
    moved_previous_ids = {m["previous_doc_id"] for m in moved}
    # 사람의 판단이 오염되는 길은 셋이고, 이동(moved)은 그중 하나일 뿐이다. 병합은 판단을 **없애지**
    # 않고 판단의 **대상**을 바꾸므로 이동 조건에 걸리지 않는다 — 그래서 지금까지 `lost_decisions` 가
    # 비었고 `open_identity_drift_review` 가 언제나 `None` 을 돌려주어, 되돌릴 수 없는 쪽(§3 (나))이
    # 정작 CM 큐에 닿지 못했다. 세 경위 모두 "충돌 묶음에 속한다"는 조건이 붙어 있어, 사람 판단이 없는
    # 병합·무변경 재업로드·매칭 튜닝·진짜 삭제·진짜 제목 수정은 여전히 요청을 만들지 않는다.
    causes: dict[str, str] = {}
    for previous_id in sorted(moved_previous_ids):
        causes.setdefault(previous_id, _CAUSE_ORPHANED)
    for doc_id in _merge_overwritten_doc_ids(collision_groups, previous_signatures, existing):
        causes.setdefault(doc_id, _CAUSE_MERGE_OVERWRITTEN)
    absorbed_into = _merge_absorbed_doc_ids(collision_groups, previous_rows, was_orphaned, seen_doc_ids,
                                            moved_previous_ids)
    for doc_id in absorbed_into:
        causes.setdefault(doc_id, _CAUSE_MERGE_ABSORBED)
    lost_decisions = _lost_decisions(session, project_id, causes)
    lost_by_doc_id = Counter(lost["doc_id"] for lost in lost_decisions)
    previous_fingerprint = _previous_fingerprint(previous_rows, seen_doc_ids)

    for collision in merged:
        last_row = collision["rows"][-1]
        # 이 병합이 삼킨 옛 행의 판단(`merge_absorbed`)까지 세려면 짝짓기 결과가 필요하므로 여기서 만든다.
        # 숫자가 0 이 아니면 이 경고와 함께 `document_identity_drift` 검토요청이 CM 큐에 올라간다.
        # 이름을 `lost_decisions` 로 두지 않는 이유: 이 값은 **이 병합 한 건**의 몫이고, 아래 DRIFT 경고와
        # 잡 요약의 `identity_drift_lost_decisions` 는 적재 전체의 합계다. 같은 이름이 두 범위를 뜻하면
        # 읽는 사람이 숫자를 잘못 더한다.
        in_merge = lost_by_doc_id[collision["doc_id"]] + sum(
            count for doc_id, count in lost_by_doc_id.items()
            if absorbed_into.get(doc_id) == collision["doc_id"])
        warnings.append(str(RegisterWarning(
            _IDENTITY_COLLISION_WARNING_CODE,
            f"{warning_messages[_IDENTITY_COLLISION_WARNING_CODE]} "
            f"(doc_id={collision['doc_id']}, row_count={len(collision['rows'])}, titles={collision['titles']!r}, "
            f"lost_decisions_in_merge={in_merge}, identity_fingerprint={fingerprint!r})",
            sheet=str(last_row["sheet"]), row=int(last_row["row"]),
        )))

    drift: IdentityDriftReport | None = None
    if moved or merged:
        drift = IdentityDriftReport(
            previous_fingerprint=previous_fingerprint, current_fingerprint=fingerprint, file_id=file_id,
            moved=moved, merged=merged, lost_decisions=lost_decisions,
        )
    if moved:
        shown = ", ".join(f"{m['previous_doc_id']}→{m['new_doc_id']} {m['title']!r}"
                          for m in moved[:_DRIFT_PAIRS_IN_MESSAGE])
        more = "" if len(moved) <= _DRIFT_PAIRS_IN_MESSAGE else f" (+{len(moved) - _DRIFT_PAIRS_IN_MESSAGE} more)"
        warnings.append(str(RegisterWarning(
            _IDENTITY_DRIFT_WARNING_CODE,
            f"{warning_messages[_IDENTITY_DRIFT_WARNING_CODE]} "
            f"(moved={len(moved)}, lost_decisions={len(lost_decisions)}, "
            f"previous_fingerprint={previous_fingerprint!r}, current_fingerprint={fingerprint!r}, "
            f"fingerprint_changed={previous_fingerprint != fingerprint}, pairs=[{shown}]{more})",
        )))

    orphaned_ids.sort()
    unorphaned_ids.sort()
    return PersistedDocumentImport(
        project_id=project_id, file_id=file_id, document_count=len(import_result.documents),
        created=created, updated=updated, orphaned=len(orphaned_ids), unorphaned=unorphaned,
        orphaned_doc_ids=orphaned_ids, unorphaned_doc_ids=unorphaned_ids, warnings=warnings,
        identity_drift=drift,
    )
