"""confidence < 0.7 매핑의 사용자 확인 큐(ReviewRequest kind="mapping")와 확정 처리. 담당: sync-2d3d.

확정은 사람(user_id)만 한다 — 자동 확정 경로 없음.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models import EntityObjectMapping, Evidence, ReviewRequest
from packages.core.models.orm import EntityObjectMappingRow, ReviewRequestRow

from .config import SyncConfig, load_sync_config
from .persistence import open_mapping_reviews, row_to_mapping, save_mappings

ReviewDecision = Literal["approved", "rejected"]
MANUAL_MAPPING_METHOD = "manual_mapping"


def review_request_for(mapping: EntityObjectMapping, project_id: str) -> ReviewRequest:
    return ReviewRequest(
        project_id=project_id, kind="mapping", global_id=mapping.global_id, rule_id=mapping.evidence.rule_id,
        title=f"2D↔3D 매핑 확인: 엔티티 {mapping.entity_handle} → 객체 {mapping.global_id} (confidence {mapping.confidence:.2f})",
        conflicting_sources={
            "drawing_id": mapping.drawing_id, "entity_handle": mapping.entity_handle,
            "candidate_global_id": mapping.global_id, "confidence": mapping.confidence,
            "iou": mapping.evidence.extra.get("iou"), "rule_score": mapping.evidence.extra.get("rule_score"),
        },
        confidence=mapping.confidence, evidence=mapping.evidence,
    )


def mappings_needing_review(mappings: list[EntityObjectMapping], project_id: str,
                            cfg: SyncConfig | None = None) -> list[ReviewRequest]:
    """needs_review=True(또는 confidence < review_threshold)이고 아직 확인되지 않은 매핑 → ReviewRequest 목록."""
    cfg = cfg or load_sync_config()
    return [review_request_for(m, project_id) for m in mappings
            if m.reviewed_by is None and (m.needs_review or m.confidence < cfg.review_threshold)]


def confirm_mapping(mapping: EntityObjectMapping, user_id: str, global_id: str | None = None) -> EntityObjectMapping:
    """사용자 확정. reviewed_by 기록, needs_review 해제, confidence 는 그대로(근거 보존). global_id 로 다른 객체를 지정할 수 있다."""
    if not user_id or not user_id.strip():
        raise ValueError("confirm_mapping requires a user_id")
    data = mapping.model_dump()
    data.update({"reviewed_by": user_id, "needs_review": False})
    if global_id is not None and global_id != mapping.global_id:
        data["global_id"] = global_id
        ev = mapping.evidence.model_copy(update={"extra": {**mapping.evidence.extra, "auto_global_id": mapping.global_id,
                                                          "reassigned_by": user_id}})
        data["evidence"] = ev.model_dump()
    return EntityObjectMapping.model_validate(data)


def _require_user(user_id: str) -> str:
    if not user_id or not user_id.strip():
        raise ValueError("a human user_id is required (system may not resolve review requests)")
    return user_id


def resolve_mapping_reviews(session: Session, drawing_id: str, entity_handle: str, decision: ReviewDecision,
                            user_id: str, note: str | None = None) -> list[str]:
    """사람(user_id)이 해당 엔티티의 open mapping 검토요청을 approved/rejected 로 닫는다. 닫힌 review_request_id 목록."""
    _require_user(user_id)
    if decision not in ("approved", "rejected"):
        raise ValueError(f"decision must be approved|rejected, got {decision!r}")
    closed: list[str] = []
    now = datetime.now(UTC)
    for row in open_mapping_reviews(session, drawing_id, entity_handle):
        row.status, row.resolved_by, row.resolved_at, row.resolution_note = decision, user_id, now, note
        closed.append(row.review_request_id)
    session.flush()
    return closed


def confirm_mapping_row(session: Session, drawing_id: str, entity_handle: str, global_id: str, user_id: str,
                        note: str | None = None) -> EntityObjectMapping:
    """사용자 확정(행 단위). 기존 매핑이 있으면 confirm_mapping(재지정 가능), 없으면 수동 매핑(confidence 1.0,
    evidence source_type=user_input). 저장 후 그 엔티티의 open 검토요청을 approved 로 닫는다(사람 액션)."""
    _require_user(user_id)
    row = session.scalars(select(EntityObjectMappingRow).where(
        EntityObjectMappingRow.drawing_id == drawing_id, EntityObjectMappingRow.entity_handle == entity_handle)).first()
    if row is not None:
        new = confirm_mapping(row_to_mapping(row), user_id, global_id)
        if note:
            new = new.model_copy(update={"evidence": new.evidence.model_copy(update={"note": note})})
    else:
        new = EntityObjectMapping(
            drawing_id=drawing_id, entity_handle=entity_handle, global_id=global_id, confidence=1.0,
            evidence=Evidence(source_type="user_input", source_id=user_id, method=MANUAL_MAPPING_METHOD, note=note,
                              extra={"iou": None, "rule_score": None, "transform_source": None}),
            needs_review=False, reviewed_by=user_id)
    save_mappings(session, [new], replace=True)
    resolve_mapping_reviews(session, drawing_id, entity_handle, "approved", user_id, note)
    return new


class MappingReviewResolution(BaseModel):
    """mapping ReviewRequest 처리 결과. api 는 conflicting_sources 의 키 이름을 몰라도 된다."""
    review_request_ids: list[str]
    mapping: EntityObjectMapping | None = None   # rejected 이거나 candidate_global_id 가 없으면 None
    drawing_id: str
    entity_handle: str


def resolve_mapping_review(session: Session, row: ReviewRequestRow, decision: ReviewDecision, user_id: str,
                           note: str | None = None) -> MappingReviewResolution:
    """kind=mapping 인 ReviewRequestRow 하나를 처리한다. `conflicting_sources`(drawing_id/entity_handle/
    candidate_global_id) 파싱은 여기서만 한다 — 그 구조를 만드는 곳(review_request_for)과 같은 모듈.

    - approved: 그 엔티티의 open mapping 검토요청을 닫고, candidate_global_id 가 있으면 `confirm_mapping_row` 로 확정한다.
    - rejected: 그 엔티티의 open mapping 검토요청만 닫는다(매핑은 쓰지 않음).

    row 가 mapping 검토요청이 아니거나 `conflicting_sources` 에 drawing_id/entity_handle 이 없으면 ValueError.
    """
    if row.kind != "mapping":
        raise ValueError(f"resolve_mapping_review requires a kind='mapping' row, got kind={row.kind!r}")
    cs = row.conflicting_sources or {}
    drawing_id, entity_handle = cs.get("drawing_id"), cs.get("entity_handle")
    if not drawing_id or not entity_handle:
        raise ValueError(f"malformed mapping review conflicting_sources (missing drawing_id/entity_handle): {cs!r}")
    drawing_id, entity_handle = str(drawing_id), str(entity_handle)

    mapping: EntityObjectMapping | None = None
    if decision == "approved":
        review_ids = resolve_mapping_reviews(session, drawing_id, entity_handle, "approved", user_id, note)
        candidate = cs.get("candidate_global_id")
        if candidate:
            mapping = confirm_mapping_row(session, drawing_id, entity_handle, str(candidate), user_id, note)
    elif decision == "rejected":
        review_ids = resolve_mapping_reviews(session, drawing_id, entity_handle, "rejected", user_id, note)
    else:
        raise ValueError(f"decision must be approved|rejected, got {decision!r}")
    return MappingReviewResolution(review_request_ids=review_ids, mapping=mapping, drawing_id=drawing_id,
                                   entity_handle=entity_handle)
