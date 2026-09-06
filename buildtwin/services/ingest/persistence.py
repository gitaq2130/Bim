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
from typing import Any, Final, TypedDict

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.models import BimObjectDraft, Document, DrawingEntityDraft, IngestResult
from packages.core.models.orm import BimObjectRow, DocumentRow, DrawingEntityRow, DrawingRow, ModelRow
from packages.core.models.review import (
    IDENTITY_DRIFT_CAUSE_ROW_ABSORBED,
    IDENTITY_DRIFT_CAUSE_ROW_MOVED,
    IDENTITY_DRIFT_CAUSE_ROW_REPLACED,
)
from packages.core.models.state import ObjectState
from services.progress import persistence as progress_db
from services.progress.config_loader import load_config
from services.progress.document_mapper import IdentityDriftReport, LostDecision, is_rejected_mapping
from services.progress.importers.document_register import DocumentRegisterImportResult, RegisterWarning

_DOCUMENT_REGISTER_CONFIG_FILENAME = "document_register.yaml"

# ADR 0009 §5-2 탐지 경고 code. 메시지 원문은 config/document_register.yaml `import_warnings` 에 있고
# 여기서는 키만 쓴다(`document_possibly_renamed` 와 같은 관례 — 한국어 리터럴을 코드에 두지 않는다).
_IDENTITY_DRIFT_WARNING_CODE = "DOCUMENT_IDENTITY_DRIFT"
_IDENTITY_COLLISION_WARNING_CODE = "DOCUMENT_IDENTITY_COLLISION"
_DECISION_CONFIRMED: Final = "confirmed"
_DECISION_REJECTED: Final = "rejected"
# 사람의 판단이 오염된 **경위**. `IdentityDriftReport.lost_decisions` 항목의 `cause` 값이며, 소비자
# (`services/progress/document_mapper._identity_drift_review_title`)가 CM 에게 보일 문구를 이 값으로 가른다.
# **값의 정본은 `packages/core/models/review.IDENTITY_DRIFT_CAUSES` 하나뿐이고**(ADR 0009 §Deferred 5,
# 계획 0005 §과제 2), 아래 `_CAUSE_ROW_*` 는 그 정본의 **별칭**이다 — 생산자인 이 모듈도 값을 다시 적지
# 않는다. 이 파일이 기대는 **부재**는 **주석 밖에서 경위 값을 문자열로 적는 코드 줄이 이 파일에 하나도
# 없다**는 것이고(기대 히트 0), 실행으로 확인하는 명령은 아래다 — 주석은 옛 이름과 개명 근거를 의도적으로
# 인용하므로 `^[^#]*` 로 주석 줄을 뺀다.
#     grep -nE '^[^#]*= *"row_' services/ingest/persistence.py
# 세 값이 필요한 이유는 셋의 "지금 그 판단이 무엇을 가리키고 있는가"가 서로 다르기 때문이다 —
# 문구가 사실과 다르면 그 자체가 결함이므로(이 저장소가 세 번 겪었다) 추측으로 합치지 않는다.
#
# **이름을 바꿨다(ADR 0009 개정 2 §5-2 (마)).** 옛 이름 셋은 전부 사실과 어긋났다: `orphaned` 는 시트명
# 변경 경로에서 `is_orphaned=False` 인 행에 붙었고(실측 P3 — `moved=8` 인데 고아 0건), `merge_*` 두 개는
# 새 조건이 잡는 주된 경로에 **병합이 없다**(실측 R1·P9·P11: `merged=0`). 이름이 경위를 거짓으로 말하면
# 그것을 읽는 문구도 거짓이 된다(CLAUDE.md §6-4 규칙 2).
_CAUSE_ROW_MOVED = IDENTITY_DRIFT_CAUSE_ROW_MOVED        # 대장 행은 그대로인데 우리 식별 규칙이 그 행을 다른 doc_id 로 옮겼다
_CAUSE_ROW_REPLACED = IDENTITY_DRIFT_CAUSE_ROW_REPLACED  # 이 doc_id 가 담고 있는 **대장 행 자체**가 바뀌었다(행도 판단도 살아 있다)
_CAUSE_ROW_ABSORBED = IDENTITY_DRIFT_CAUSE_ROW_ABSORBED  # 판단이 가리키던 대장 행이 **다른 doc_id 아래로** 갔다
# 행-정체(`_row_identity`)를 이루는 대장 **원문** 필드. `lost_decisions[].changed_fields` 가 이 이름을 쓴다.
_ROW_IDENTITY_FIELDS = ("sender", "doc_number", "seq_raw", "title")


class _DriftDetail(TypedDict):
    """판정이 `doc_id` 마다 알아낸 것 — `LostDecision` 에서 매핑 쪽 세 필드(`activity_id`/`doc_id`/
    `decision`)를 뺀 나머지다. 별도 타입으로 두는 이유는 mypy 가 **판정 자리에서** 필드 이름·타입을
    검증하게 하기 위해서다(오타는 `LostDecision` 이 런타임에도 튕겨 적재 job 을 실패시킨다)."""

    cause: str
    new_doc_id: str | None
    changed_fields: list[str]
    approval_flipped: bool
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
    # ADR 0009 §5-2. 관측된 것이 있을 때만(`moved`·`merged`·`lost_decisions` 중 하나라도 비어 있지 않을
    # 때만) 채운다 — api 가 `is not None` 으로 검토요청 생성 여부를 가르므로(계획 0003 §3-f), 아무 일도
    # 없었는데 빈 보고서를 돌려주면 매 적재가 드리프트로 보고된다. 반대로 `lost_decisions` 를 게이트에서
    # 빼면 (나)·(다)가 잡은 사건이 `moved=0, merged=0` 인 적재에서 통째로 삼켜진다(개정 2, 실측).
    # 타입은 소비자(services/progress/document_mapper)가 소유한다.
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


def _row_identity(row: DocumentRow) -> tuple[Any, ...]:
    """이 `doc_id` 가 대장의 **어느 행**을 담고 있는가 — 전부 대장 **원문**(ADR 0009 §5-2 (나) 표).

    `doc_id` 재료 넷(`doc_type`/`sender_normalized`/`seq_normalized`/`title_identity`)은 **일부러 넣지
    않는다** — 같은 `doc_id` 안에서는 정의상 언제나 같아서 아무것도 구별하지 못한다. `sheet_name`/
    `source_row` 도 넣지 않는다: 대장 앞에 행이 하나 끼면 전부 밀리는데 그것은 행이 바뀐 것이 아니다."""
    return tuple(getattr(row, name) for name in _ROW_IDENTITY_FIELDS)


def _row_content(row: DocumentRow) -> tuple[Any, ...]:
    """그 행이 지금 **무엇이라고 말하는가**(ADR 0009 §5-2 (나) 표).

    `approval_status` 가 여기 있는 것이 핵심이다 — 그 값이 `drawing_approval` 논리곱(ADR 0007 §5-1)의
    입력이므로, 이 값이 뒤집히면 CM 이 "반려된 도면"이라고 확인해 차단해 둔 작업이 착수 가능해진다.

    **행-정체와 갈라 둔 이유(개정 2).** 개정 1 의 `_register_row_signature` 는 이 여섯을 한 덩어리로 썼고,
    그래서 "담긴 행이 바뀌었다"와 "대장이 같은 행의 처리결과를 정상 갱신했다"를 구별하지 못해 조건
    ①(충돌 묶음)에 기대야 했다. 그 한정어가 이 사이클 세 번째 blocker 의 원인이다(ADR 0009 §5-5)."""
    return (row.result_raw, row.approval_status)


def _changed_identity_fields(previous: tuple[Any, ...], current: tuple[Any, ...]) -> list[str]:
    """달라진 행-정체 필드 이름. `lost_decisions[].changed_fields` 로 실려 CM 문구가 **아는 것만** 말하게
    한다(ADR 0009 §5-2 (바) P6·P7 — 대장측 오타 정정을 오탐인 채로 두되 "다른 문서로 바뀌었다"고 단정하지
    않는다)."""
    return [name for name, before, after in zip(_ROW_IDENTITY_FIELDS, previous, current) if before != after]


def _replaced_doc_ids(previous_identities: dict[str, tuple[Any, ...]],
                      previous_contents: dict[str, tuple[Any, ...]],
                      current_rows: dict[str, DocumentRow], seen_doc_ids: set[str],
                      absorbed_into: dict[str, str]) -> dict[str, list[str]]:
    """ADR 0009 §5-2 (나) — 이 `doc_id` 가 **담고 있는 대장 행이 바뀌었다**.

    행도 `reviewed_by` 도 살아 있고 고아 표시조차 없다. 사라지는 것은 판단이 아니라 판단의 **대상**이고,
    §3 이 스스로 최악이라 적은 "미승인 도면 위에서 착수 가능"이 이 경로다.

    **`_collision_groups` 를 조건으로 쓰지 않는다(개정 2).** 개정 1 은 "한 적재 안에서 두 행이 같은
    `doc_id` 로 수렴"을 전제로 걸었는데, 운영에서 흔한 다른 경로가 있다 — 사명 변경 주에 별칭표를
    통합하면서 **옛 법인명 행이 대장에서 빠지는** 것이다. 두 행이 한 적재에 함께 있지 않으니 충돌 묶음이
    만들어지지 않고, 그래서 승인 상태가 뒤집혀 `drawing_approval` 0.0 → 1.0 이 되는데도 경고 0건·검토요청
    0건으로 지나갔다(실측 R1). 충돌 묶음은 이 사실이 생기는 **한 가지 경로**일 뿐이다.

    **발화는 둘의 합집합이다.**

    - **(나-i) 행-정체가 달라졌다.** 충돌 묶음 소속을 묻지 않는다.
    - **(나-ii) 이 `doc_id` 가 이번 적재에서 다른 `doc_id` 를 흡수했고**(= `absorbed_into` 의 **값**에
      있다) **행-내용이 달라졌다.** (나-i)만으로 갈아치우면 개정 1 이 **잡던** 경로를 잃는다 — 문서번호
      열이 없는 현장에서 **행-정체까지 똑같은** 두 행이 시트 둘에 나뉘어 있고 `sheet_doc_types` 변경으로
      하나가 되면 (나-i)는 침묵한다(실측 P13, `drawing_approval` 0.0 → 1.0). 역방향 확인이 잡은 구멍이다.

    (나-ii)의 좌변으로 "이번 적재에서 새로 충돌 묶음에 들어왔는가"를 쓰려면 지난 적재의 충돌 여부를
    알아야 해서 컬럼이 필요한데, **흡수 관측이 이미 같은 사실을 준다**(다른 `doc_id` 를 흡수했다 = 이번에
    새로 뭉쳐졌다). 충돌이 상시화된 대장에서는 사라지는 옛 `doc_id` 가 없어 흡수가 잡히지 않으므로
    "묶음 안의 정상 처리결과 갱신"이 오탐이 되지 않는다(실측 P4 — 개정 1 의 오탐 1건이 음성이 된다).

    반환: `doc_id` → 달라진 행-정체 필드 목록((나-ii)로만 걸렸으면 `[]`)."""
    absorbers = set(absorbed_into.values())
    replaced: dict[str, list[str]] = {}
    for doc_id in sorted(seen_doc_ids & set(previous_identities)):   # 이번 적재 전후로 살아 있는 doc_id
        row = current_rows.get(doc_id)
        if row is None:
            continue
        changed = _changed_identity_fields(previous_identities[doc_id], _row_identity(row))
        if changed:
            replaced[doc_id] = changed
        elif doc_id in absorbers and previous_contents[doc_id] != _row_content(row):
            replaced[doc_id] = []
    return replaced


def _absorbed_doc_ids(previous_identities: dict[str, tuple[Any, ...]],
                      current_identities: dict[str, tuple[Any, ...]], was_orphaned: dict[str, bool],
                      seen_doc_ids: set[str], claimed: set[str]) -> dict[str, str]:
    """ADR 0009 §5-2 (다) — 담고 있던 행이 **다른 `doc_id` 아래로 갔다**. 위 함수의 대칭 짝이다.

    이번 적재에 나타나지 않은 기존 행 중, 그 행이 담고 있던 **행-정체가 이번 적재의 다른 `doc_id` 아래에
    그대로 살아 있는** 것. 사명 변경 주에 옛 법인명 행이 사라지면 그 판단은 **고아만 되고** 아무 경고도
    없이 지나갔다(실측 P11).

    **"충돌 묶음 구성원과 제목이 같고 문서번호가 호환된다"를 쓰지 않는다(개정 2).** 개정 1 의 그 조건은
    두 군데서 틀렸다. ① 충돌 묶음을 요구해 위 경로를 놓쳤다. ② 문서번호가 한쪽이라도 비면 통과시키므로
    (대장에 문서번호 열이 없는 현장을 위한 완화) **문서번호 열이 없는 현장에서는 "제목만 같으면 통과"로
    퇴화**해 진짜 삭제를 흡수로 오보고했다(실측 P5). 행-정체 **전체 일치**를 요구하면 둘이 함께 사라진다 —
    진짜로 지워진 행의 행-정체는 이번 적재 어디에도 없기 때문이다.

    기존 가드 둘은 유지한다: (가)가 이미 짝지은 행(`claimed`) 제외, 이미 고아였던 행 제외 — 한 행은 한
    경위에만 속하고, 사건이 일어난 적재에서 한 번만 발화한다.

    반환: 사라진 옛 `doc_id` → 지금 그 행을 담고 있는 `doc_id`((나-ii)와 `new_doc_id` 가 이 값을 쓴다)."""
    holders: dict[tuple[Any, ...], str] = {}
    for doc_id in sorted(current_identities):
        holders.setdefault(current_identities[doc_id], doc_id)   # 같은 행-정체가 여럿이면 사전순 첫 번째(결정적)
    absorbed: dict[str, str] = {}
    for doc_id in sorted(previous_identities):
        if doc_id in seen_doc_ids or doc_id in claimed or was_orphaned.get(doc_id, False):
            continue
        holder = holders.get(previous_identities[doc_id])
        if holder is not None and holder != doc_id:
            absorbed[doc_id] = holder
    return absorbed


def _lost_decisions(session: Session, project_id: str,
                    details: dict[str, _DriftDetail]) -> list[LostDecision]:
    """식별 드리프트에 걸린 **사람의 판단**(확정·반려)을 경위(`cause`)와 함께 모은다.

    `details` 는 `doc_id` → `{cause, new_doc_id, changed_fields, approval_flipped}`(ADR 0009 §5-2 (마)
    항목 계약). 이 목록이 비면 `open_identity_drift_review` 가 아무것도 만들지 않으므로(§5-2 큐 오염
    방지), **여기에 담기는 것이 곧 "CM 큐에 올릴 사건"의 정의**다.

    네 값을 항목마다 싣는 이유는 소비자가 CM 에게 보일 문구를 **아는 것만** 쓰게 하기 위해서다.
    `cause` 는 "판단이 지금 무엇을 가리키고 있는가", `new_doc_id` 는 "다시 판단할 곳이 있는가"를 값으로
    답한다(`row_replaced` 의 `None` 은 "없다"는 **사실**이지 "모른다"가 아니다). `changed_fields` 는
    "다른 문서로 바뀐 것"과 "대장이 문서번호 오타를 고친 것"을 한 줄 안에서 가르고, `approval_flipped` 는
    착수 가능 판단이 실제로 뒤집혔는지를 답한다 — 문구가 산문으로 추측하지 않도록(CLAUDE.md §6-4 규칙 2).

    확정/반려의 구분은 `document_mapper.is_rejected_mapping()` 에 맡긴다 — 판정 키 문자열
    (`evidence.extra.mapping_review_decision`)을 이 모듈이 직접 읽지 않는다(ADR 0007 §4-2 규칙 6 ⑥)."""
    if not details:
        return []
    # 필드를 하나씩 적는다(`**detail` 로 펼치지 않는다) — `LostDecision` 이 TypedDict 라 이름 하나만
    # 틀려도 mypy 가 여기서 잡고, 놓치면 pydantic 이 **런타임에 적재 job 을 실패시킨다.** 이 저장소의
    # 지배적 실패 모드가 "조용히 죽는 것"이므로 시끄럽게 죽는 쪽이 맞다(계약 정본은 document_mapper).
    lost: list[LostDecision] = []
    for row in progress_db.document_mappings_for_project(session, project_id):
        detail = details.get(row.doc_id)
        if detail is None or row.reviewed_by is None:
            continue
        lost.append({
            "activity_id": row.activity_id, "doc_id": row.doc_id,
            "decision": _DECISION_REJECTED if is_rejected_mapping(row.evidence) else _DECISION_CONFIRMED,
            "cause": detail["cause"], "new_doc_id": detail["new_doc_id"],
            "changed_fields": detail["changed_fields"], "approval_flipped": detail["approval_flipped"],
        })
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

    **식별 드리프트 판정(ADR 0009 §5-2, 개정 2)**은 세 관측이다.

    - **(가) 이동(`moved`)** — 이번 적재에 나타나지 않은 기존 행과 제목 원문이 글자 그대로 같은 새 문서
      (`_pair_identity_moves`) → `DOCUMENT_IDENTITY_DRIFT` 경고. `document_possibly_renamed` 는 내지
      않는다 — 제목이 바뀌지 않았으므로 그 문구는 거짓이다.
    - **(나) 담긴 대장 행이 바뀌었다(`_replaced_doc_ids`)** — 행-정체가 달라졌거나, 다른 `doc_id` 를
      흡수하면서 행-내용이 달라졌다.
    - **(다) 담고 있던 행이 다른 `doc_id` 아래로 갔다(`_absorbed_doc_ids`)** — 행-정체 전체 일치로 짝짓는다.

    셋에 걸린 `doc_id` 를 가리키는 매핑 중 `reviewed_by is not None` 인 것이 `lost_decisions` 이고,
    경위(`cause`)는 `row_moved`/`row_replaced`/`row_absorbed` 다(한 `doc_id` 는 한 경위에만 속한다).

    **충돌 묶음(`merged`)은 판정 조건이 아니라 보고 값이다(개정 2).** 개정 1 은 (나)·(다)에 "이번 적재의
    충돌 묶음"을 전제로 걸었고, 그 한정어가 사명 변경 주의 정상 운영(별칭표 통합 + 옛 법인명 행이 대장에서
    빠짐)을 표 밖으로 밀어냈다 — 두 행이 한 적재에 함께 있지 않으므로 묶음이 만들어지지 않는다. 실측:
    승인 상태가 뒤집혀 `drawing_approval` 0.0 → 1.0(미승인 도면 위 착수 가능)인데 경고 0건·검토요청 0건.
    묶음은 계속 관측해 `DOCUMENT_IDENTITY_COLLISION` 경고로 보고하고(덮어쓰기 동작도 유지한다 — 대장이
    정본이라 마지막 행이 이긴다), `lost_decisions_in_merge` 계산에만 쓴다.

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
    # 같은 이유로 행-정체·행-내용도 값으로 떠 둔다: 이 `doc_id` 가 담고 있던 대장 행이 바뀌었는지는
    # "적재 전 이 행이 담고 있던 값"과 비교해야만 알 수 있는데, 그 행은 루프 안에서 제자리 갱신된다.
    previous_identities = {doc_id: _row_identity(existing_row) for doc_id, existing_row in existing.items()}
    previous_contents = {doc_id: _row_content(existing_row) for doc_id, existing_row in existing.items()}
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
    # 사람의 판단이 오염되는 길은 셋이고, 이동(moved)은 그중 하나일 뿐이다. 나머지 둘은 판단을 **없애지**
    # 않고 판단의 **대상**을 바꾸거나 옮기므로 이동 조건에 걸리지 않는다. 그 둘의 조건에서 **충돌 묶음을
    # 뺐다**(개정 2, ADR 0009 §5-2 (나)·(다)) — 충돌 묶음은 그 사실이 생기는 한 가지 경로일 뿐이고,
    # 사명 변경 주(별칭표 통합 + 옛 법인명 행이 대장에서 빠짐)에는 두 행이 한 적재에 함께 있지 않다.
    # 대신 판별 재료를 행-정체 / 행-내용으로 갈랐다: 무변경 재업로드·매칭 튜닝·진짜 삭제·진짜 제목
    # 수정·대장의 정상 처리결과 갱신(상시 충돌 묶음 **안**의 것을 포함)은 여전히 요청을 만들지 않는다.
    current_identities = {doc_id: _row_identity(existing[doc_id]) for doc_id in seen_doc_ids}
    absorbed_into = _absorbed_doc_ids(previous_identities, current_identities, was_orphaned, seen_doc_ids,
                                      moved_previous_ids)
    replaced = _replaced_doc_ids(previous_identities, previous_contents, existing, seen_doc_ids, absorbed_into)
    # 한 `doc_id` 는 한 경위에만 속한다(우선순위 (가) → (나) → (다), `setdefault`).
    details: dict[str, _DriftDetail] = {}
    for previous_id in sorted(moved_previous_ids):
        new_doc_id = next(m["new_doc_id"] for m in moved if m["previous_doc_id"] == previous_id)
        details.setdefault(previous_id, {"cause": _CAUSE_ROW_MOVED, "new_doc_id": new_doc_id,
                                         "changed_fields": [], "approval_flipped": False})
    for doc_id, changed_fields in replaced.items():
        # `row_replaced` 에는 다시 판단할 곳이 **없다** — `new_doc_id=None` 은 "모른다"가 아니라 그 사실이다.
        details.setdefault(doc_id, {
            "cause": _CAUSE_ROW_REPLACED, "new_doc_id": None, "changed_fields": changed_fields,
            "approval_flipped": previous_contents[doc_id][1] != existing[doc_id].approval_status})
    for doc_id, holder in absorbed_into.items():
        details.setdefault(doc_id, {"cause": _CAUSE_ROW_ABSORBED, "new_doc_id": holder,
                                    "changed_fields": [], "approval_flipped": False})
    lost_decisions = _lost_decisions(session, project_id, details)
    lost_by_doc_id = Counter(lost["doc_id"] for lost in lost_decisions)
    previous_fingerprint = _previous_fingerprint(previous_rows, seen_doc_ids)

    for collision in merged:
        last_row = collision["rows"][-1]
        # 이 병합이 삼킨 옛 행의 판단(`row_absorbed`)까지 세려면 짝짓기 결과가 필요하므로 여기서 만든다.
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

    # 게이트는 `moved or merged or lost_decisions` 다(개정 2 — 판정만 고치고 이 줄을 두면 수정이 무효다).
    # 개정 1 의 게이트는 `if moved or merged` 였는데, (나)·(다)가 잡는 사건은 그 둘을 **모두 비운 채**
    # 일어날 수 있다(사명 변경 주가 정확히 그 모양이다: moved=0, merged=0). 그러면 판정이 옳게 발화해도
    # 보고서가 만들어지지 않아 검토요청이 게이트에서 다시 조용히 삼켜진다 — 실측으로 확인했다(새 조건 +
    # 옛 게이트 = `identity_drift=None`, 요청 0건). `lost_decisions` 는 정의상 (가)·(나)·(다)의
    # 부분집합이므로 이 항을 빼도 되는 조건은 없다.
    drift: IdentityDriftReport | None = None
    if moved or merged or lost_decisions:
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
    elif lost_decisions and not merged:
        # ADR 0009 §5-2 (사) 4행 — **경고가 한 건도 없이 검토요청만 생기는 적재를 만들지 않는다.**
        # 이동 쌍이 없으므로 `pairs` 를 적지 않는다("0건 이동했고"라고 쓰던 옛 문구가 바로 그 거짓이다).
        by_cause = Counter(str(lost["cause"]) for lost in lost_decisions)
        warnings.append(str(RegisterWarning(
            _IDENTITY_DRIFT_WARNING_CODE,
            f"{warning_messages[_IDENTITY_DRIFT_WARNING_CODE]} "
            f"(moved=0, merged=0, lost_decisions={len(lost_decisions)}, "
            f"by_cause={dict(sorted(by_cause.items()))!r}, "
            f"previous_fingerprint={previous_fingerprint!r}, current_fingerprint={fingerprint!r}, "
            f"fingerprint_changed={previous_fingerprint != fingerprint})",
        )))

    orphaned_ids.sort()
    unorphaned_ids.sort()
    return PersistedDocumentImport(
        project_id=project_id, file_id=file_id, document_count=len(import_result.documents),
        created=created, updated=updated, orphaned=len(orphaned_ids), unorphaned=unorphaned,
        orphaned_doc_ids=orphaned_ids, unorphaned_doc_ids=unorphaned_ids, warnings=warnings,
        identity_drift=drift,
    )
