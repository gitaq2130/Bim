"""confidence < 0.7 매핑의 사용자 확인 큐(ReviewRequest kind="mapping")와 확정 처리. 담당: sync-2d3d.

확정은 사람(user_id)만 한다 — 자동 확정 경로 없음.
"""
from __future__ import annotations

from packages.core.models import EntityObjectMapping, ReviewRequest

from .config import SyncConfig, load_sync_config


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
