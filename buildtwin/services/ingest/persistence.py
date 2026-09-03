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
api 계층은 이 함수들을 호출만 한다.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.models import BimObjectDraft, Document, DrawingEntityDraft, IngestResult
from packages.core.models.orm import BimObjectRow, DocumentRow, DrawingEntityRow, DrawingRow, ModelRow
from packages.core.models.state import ObjectState
from services.progress.config_loader import load_config
from services.progress.importers.document_register import DocumentRegisterImportResult, RegisterWarning

_DOCUMENT_REGISTER_CONFIG_FILENAME = "document_register.yaml"


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
    warnings: list[str] = Field(default_factory=list)   # 파서 경고 + document_possibly_renamed


def project_documents(session: Session, project_id: str) -> dict[str, DocumentRow]:
    stmt = select(DocumentRow).where(DocumentRow.project_id == project_id)
    return {r.doc_id: r for r in session.scalars(stmt)}


def _apply_document(row: DocumentRow, d: Document, imported_at: datetime) -> None:
    """대장 값으로 전부 덮어쓴다 — 대장이 정본이다(ADR 0007 §2-2 규칙 1). state 개념이 없으므로
    (문서 승인 상태는 ObjectState 와 무관, ADR 0007 §3-1) 재업로드 규칙 1의 "이력 유지"는 여기서 다룰
    것이 없다 — 그대로 최신 대장 값으로 교체하면 된다."""
    row.doc_type = d.doc_type.value
    row.sender, row.sender_normalized = d.sender, d.sender_normalized
    row.discipline_raw, row.discipline_normalized = d.discipline_raw, d.discipline_normalized
    row.seq_raw, row.seq_normalized = d.seq_raw, d.seq_normalized
    row.doc_number = d.doc_number
    row.title, row.title_normalized = d.title, d.title_normalized
    row.issued_on, row.completed_on = d.issued_on, d.completed_on
    row.result_raw = d.result_raw
    row.approval_status = d.approval_status.value
    row.approval_confidence = d.approval_confidence
    row.approval_evidence = d.approval_evidence.model_dump(mode="json")
    row.file_id, row.sheet_name, row.source_row = d.file_id, d.sheet_name, d.source_row
    row.needs_review = d.needs_review
    row.is_orphaned = False   # 규칙 5: 이번 대장에 나타난 문서는(신규든 기존이든) 고아가 아니다
    row.imported_at = imported_at


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
    """
    for d in import_result.documents:
        if d.project_id != project_id or d.file_id != file_id:
            raise ValueError(
                f"document {d.doc_id} scoped to (project_id={d.project_id!r}, file_id={d.file_id!r}), "
                f"not (project_id={project_id!r}, file_id={file_id!r})"
            )

    cfg = load_config(_DOCUMENT_REGISTER_CONFIG_FILENAME)
    renamed_message = str(cfg["import_warnings"]["document_possibly_renamed"])

    existing = project_documents(session, project_id)          # 프로젝트의 기존 문서 전체(모든 doc_type)
    was_orphaned = {doc_id: existing_row.is_orphaned for doc_id, existing_row in existing.items()}
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

    for d in import_result.documents:
        seen_doc_ids.add(d.doc_id)
        row = existing.get(d.doc_id)
        if row is None:
            key = (d.doc_type.value, d.sender_normalized, d.seq_normalized)
            for previous_id in rename_index.get(key, []):
                if previous_id == d.doc_id:
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
            created += 1
        else:
            updated += 1
            if was_orphaned.get(d.doc_id):
                unorphaned += 1
                unorphaned_ids.append(d.doc_id)
        _apply_document(row, d, now)

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
    orphaned_ids.sort()
    unorphaned_ids.sort()
    return PersistedDocumentImport(
        project_id=project_id, file_id=file_id, document_count=len(import_result.documents),
        created=created, updated=updated, orphaned=len(orphaned_ids), unorphaned=unorphaned,
        orphaned_doc_ids=orphaned_ids, unorphaned_doc_ids=unorphaned_ids, warnings=warnings,
    )
