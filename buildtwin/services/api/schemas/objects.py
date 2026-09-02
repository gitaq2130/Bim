from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from packages.core.models.coordinate import BBox3D
from packages.core.models.evidence import Evidence, EvidenceSourceType
from packages.core.models.scan import ScanVerdict
from packages.core.models.state import Actor, ObjectState, StateTransition, UserRole


class BimObjectView(BaseModel):
    global_id: str
    ifc_type: str
    group: str
    name: str | None = None
    level: str | None = None
    level_elevation: float | None = None
    zone: str | None = None
    bbox: BBox3D | None = None
    mesh_ref: str | None = None
    psets: dict[str, dict[str, Any]] = Field(default_factory=dict)
    material: str | None = None
    quantity: dict[str, float] = Field(default_factory=dict)
    express_id: int | None = None
    project_id: str
    model_id: str
    model_version: int
    state: ObjectState
    is_orphaned: bool = False
    has_open_review: bool = False


class ObjectList(BaseModel):
    items: list[BimObjectView]
    total: int
    page: int
    page_size: int


class ObjectStateView(BaseModel):
    state: ObjectState
    since: datetime | None = None
    actor: Actor | None = None
    actor_id: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence: Evidence | None = None
    has_open_review: bool = False
    open_review_ids: list[str] = Field(default_factory=list)


class NextAction(BaseModel):
    kind: str
    label: str
    allowed_roles: list[UserRole]
    to_state: ObjectState | None = None
    actor: Actor | None = None
    review_request_id: str | None = None
    review_kind: str | None = None
    rule_id: str | None = None


class EntityRef(BaseModel):
    drawing_id: str
    handle: str
    confidence: float
    needs_review: bool
    reviewed_by: str | None = None


class LinkedRefs(BaseModel):
    entity_handles: list[str] = Field(default_factory=list)
    entity_refs: list[EntityRef] = Field(default_factory=list)
    drawing_id: str | None = None
    activity_ids: list[str] = Field(default_factory=list)
    material_ids: list[str] = Field(default_factory=list)
    latest_scan_verdict: ScanVerdict | None = None


class ObjectDetail(BaseModel):
    basic: BimObjectView
    current_state: ObjectStateView
    history: list[StateTransition]       # 최신순
    next_actions: list[NextAction]
    linked: LinkedRefs


class EvidenceIn(BaseModel):
    """전이 요청의 근거. source_type/source_id 를 생략하면 역할·사용자로 채운다."""
    source_type: EvidenceSourceType | None = None
    source_id: str | None = None
    file_uri: str | None = None
    bbox: BBox3D | None = None
    rule_id: str | None = None
    method: str | None = None
    note: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class TransitionRequest(BaseModel):
    to_state: ObjectState
    evidence: EvidenceIn | None = None
    note: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    review_request_id: str | None = None


class TransitionResponse(StateTransition):
    """전이 기록 + 상태기계 부수효과(검측 ReviewRequest 생성/종료 id)."""
    created_review_ids: list[str] = Field(default_factory=list)
    closed_review_ids: list[str] = Field(default_factory=list)


class LevelView(BaseModel):
    name: str
    elevation: float | None = None
    object_count: int = 0
