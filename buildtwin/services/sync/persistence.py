"""매핑·정합 저장/조회와 매핑 생명주기 — EntityObjectMappingRow, DrawingRow.alignment, ReviewRequestRow(kind=mapping). 담당: sync-2d3d.

매핑 생명주기(CLAUDE.md §3-11)는 여기(rebuild_mappings)가 소유한다. API 는 호출만 한다.
시스템은 검토요청을 해소(approved/rejected)하지 않는다 — 대체된 요청은 on_hold + resolution_note "superseded_by=…" 만(ADR 0001 §6).
"""
from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.models import EntityObjectMapping, Evidence, ReviewRequest
from packages.core.models.orm import DrawingRow, EntityObjectMappingRow, ReviewRequestRow

from .transform import DrawingAlignment, alignment_to_transform

ALIGNMENT_KEY = "alignment"
TRANSFORM_KEY = "transform"
SUPERSEDED_BY_REALIGNMENT = "realignment"


class RebuildResult(BaseModel):
    saved: int                          # 새로 저장한 매핑 수
    kept_confirmed: int                 # reviewed_by 가 있어 유지한 기존 매핑 수
    review_requests_created: int        # 새로 만든 ReviewRequest(kind=mapping) 수
    review_requests_superseded: int     # on_hold 로 대체 표시한 이전 open 검토요청 수
    review_request_ids: list[str] = []
    superseded_ids: list[str] = []


def mapping_to_row(m: EntityObjectMapping, project_id: str) -> EntityObjectMappingRow:
    """ADR 0005: project_id 는 매핑 계약(Pydantic)에 없다 — 호출자가 도면에서 유도해 넘긴다."""
    return EntityObjectMappingRow(drawing_id=m.drawing_id, entity_handle=m.entity_handle, global_id=m.global_id,
                                  project_id=project_id, confidence=m.confidence,
                                  evidence=m.evidence.model_dump(mode="json"),
                                  needs_review=m.needs_review, reviewed_by=m.reviewed_by)


def row_to_mapping(r: EntityObjectMappingRow) -> EntityObjectMapping:
    return EntityObjectMapping(drawing_id=r.drawing_id, entity_handle=r.entity_handle, global_id=r.global_id,
                               confidence=r.confidence, evidence=Evidence.model_validate(r.evidence),
                               needs_review=r.needs_review, reviewed_by=r.reviewed_by)


def _project_id_of_drawing(session: Session, drawing_id: str) -> str:
    row = session.get(DrawingRow, drawing_id)
    if row is None:
        raise LookupError(f"drawing not found: {drawing_id}")
    return row.project_id


def save_mappings(session: Session, mappings: list[EntityObjectMapping], replace: bool = True,
                  project_id: str | None = None) -> int:
    """매핑 저장. replace=True 면 같은 (drawing_id, handle)의 기존 행을 지우고 넣는다(사용자 확정 행 포함 — 호출자가 판단).

    ADR 0005: project_id 는 매핑 계약에 없으므로 도면에서 유도한다. 호출자가 이미 알고 있으면(rebuild_mappings 등)
    project_id 를 넘겨 DrawingRow 재조회를 피할 수 있다 — 그 값이 mappings 의 drawing_id 전부에 적용된다.
    호출자가 넘기지 않으면 mapping.drawing_id 별로 DrawingRow 를 조회해 유도한다(여러 도면이 섞여도 안전)."""
    if not mappings:
        return 0
    if replace:
        for m in mappings:
            session.execute(delete(EntityObjectMappingRow).where(
                EntityObjectMappingRow.drawing_id == m.drawing_id,
                EntityObjectMappingRow.entity_handle == m.entity_handle))
    if project_id is not None:
        rows = [mapping_to_row(m, project_id) for m in mappings]
    else:
        cache: dict[str, str] = {}
        rows = []
        for m in mappings:
            pid = cache.setdefault(m.drawing_id, _project_id_of_drawing(session, m.drawing_id))
            rows.append(mapping_to_row(m, pid))
    session.add_all(rows)
    session.flush()
    return len(rows)


def load_mappings(session: Session, drawing_id: str, needs_review: bool | None = None,
                  project_id: str | None = None) -> list[EntityObjectMapping]:
    """project_id 는 방어적 필터(선택) — drawing_id 가 이미 하나의 프로젝트로 범위를 정하므로 보통 불필요하지만,
    호출자가 알고 있으면 넘겨 다른 프로젝트로 잘못 조회하는 것을 조기에 막는다."""
    stmt = select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing_id)
    if needs_review is not None:
        stmt = stmt.where(EntityObjectMappingRow.needs_review == needs_review)
    if project_id is not None:
        stmt = stmt.where(EntityObjectMappingRow.project_id == project_id)
    return [row_to_mapping(r) for r in session.scalars(stmt).all()]


def save_alignment(session: Session, drawing_id: str, alignment: DrawingAlignment) -> DrawingRow:
    """DrawingRow.alignment = {alignment, transform(4x4 → model)}; coordinate_system 도 정합된 좌표계로 갱신."""
    row = session.get(DrawingRow, drawing_id)
    if row is None:
        raise LookupError(f"drawing not found: {drawing_id}")
    row.alignment = {ALIGNMENT_KEY: alignment.model_dump(mode="json"),
                     TRANSFORM_KEY: alignment_to_transform(alignment).model_dump(mode="json")}
    row.coordinate_system = alignment.to_coordinate_system().model_dump(mode="json")
    session.flush()
    return row


def load_alignment(session: Session, drawing_id: str) -> DrawingAlignment | None:
    row = session.get(DrawingRow, drawing_id)
    if row is None or not row.alignment or ALIGNMENT_KEY not in row.alignment:
        return None
    return DrawingAlignment.model_validate(row.alignment[ALIGNMENT_KEY])


# ---------------------------------------------------------------- ReviewRequest(kind=mapping) rows
def review_request_to_row(r: ReviewRequest) -> ReviewRequestRow:
    return ReviewRequestRow(
        review_request_id=str(r.review_request_id), project_id=r.project_id, kind=r.kind, global_id=r.global_id,
        activity_id=r.activity_id, rule_id=r.rule_id, title=r.title, conflicting_sources=r.conflicting_sources,
        confidence=r.confidence, evidence=r.evidence.model_dump(mode="json"), assignee_role=r.assignee_role,
        status=r.status, resolution_note=r.resolution_note, resolved_by=r.resolved_by, resolved_at=r.resolved_at,
        created_at=r.created_at,
    )


def open_mapping_reviews(session: Session, drawing_id: str, entity_handle: str | None = None,
                         project_id: str | None = None) -> list[ReviewRequestRow]:
    """해당 도면(선택: 엔티티)의 open 상태 mapping 검토요청. conflicting_sources.drawing_id/entity_handle 로 식별."""
    stmt = select(ReviewRequestRow).where(ReviewRequestRow.kind == "mapping", ReviewRequestRow.status == "open")
    if project_id is not None:
        stmt = stmt.where(ReviewRequestRow.project_id == project_id)
    out = []
    for row in session.scalars(stmt):
        cs = row.conflicting_sources or {}
        if cs.get("drawing_id") != drawing_id:
            continue
        if entity_handle is not None and cs.get("entity_handle") != entity_handle:
            continue
        out.append(row)
    return out


def rebuild_mappings(session: Session, drawing_id: str, project_id: str, mappings: list[EntityObjectMapping],
                     keep_confirmed: bool = True) -> RebuildResult:
    """도면 매핑 재구성(재정합·재업로드 후).
    1. keep_confirmed 면 reviewed_by 가 있는 기존 행은 유지하고 그 handle 의 새 매핑은 버린다. 아니면 전부 교체.
    2. 나머지 기존 행 삭제, 새 매핑 저장.
    3. needs_review 매핑마다 ReviewRequest(kind=mapping) 생성.
    4. 이 도면의 이전 open mapping 검토요청은 status=on_hold, resolution_note="superseded_by=<새 요청 id | realignment>".
       resolved_by/resolved_at 은 건드리지 않는다(사람만 해소, ADR 0001 §6)."""
    from .review_queue import mappings_needing_review  # 순환 import 회피(review_queue → persistence)

    if any(m.drawing_id != drawing_id for m in mappings):
        raise ValueError("all mappings must belong to drawing_id")
    confirmed_handles: set[str] = set()
    if keep_confirmed:
        confirmed_handles = set(session.scalars(select(EntityObjectMappingRow.entity_handle).where(
            EntityObjectMappingRow.drawing_id == drawing_id, EntityObjectMappingRow.reviewed_by.is_not(None))))
        session.execute(delete(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing_id,
                                                              EntityObjectMappingRow.reviewed_by.is_(None)))
    else:
        session.execute(delete(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing_id))
    fresh = [m for m in mappings if m.entity_handle not in confirmed_handles]
    save_mappings(session, fresh, replace=False, project_id=project_id)

    previous_open = open_mapping_reviews(session, drawing_id, project_id=project_id)
    reviews = mappings_needing_review(fresh, project_id=project_id)
    new_by_handle: dict[str, str] = {}
    for r in reviews:
        session.add(review_request_to_row(r))
        new_by_handle[str(r.conflicting_sources.get("entity_handle"))] = str(r.review_request_id)
    superseded: list[str] = []
    for old in previous_open:
        handle = str((old.conflicting_sources or {}).get("entity_handle"))
        old.status = "on_hold"
        old.resolution_note = f"superseded_by={new_by_handle.get(handle, SUPERSEDED_BY_REALIGNMENT)}"
        superseded.append(old.review_request_id)
    session.flush()
    return RebuildResult(saved=len(fresh), kept_confirmed=len(confirmed_handles), review_requests_created=len(reviews),
                         review_requests_superseded=len(superseded),
                         review_request_ids=list(new_by_handle.values()), superseded_ids=superseded)
