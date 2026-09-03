"""SQLAlchemy ORM. JSON 컬럼으로 bbox/psets/evidence 저장(SQLite·PostgreSQL 공용). PostGIS 공간 인덱스는 Deferred(ADR)."""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, ForeignKeyConstraint, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)   # contractor | cm | client | admin
    name: Mapped[str | None] = mapped_column(String, nullable=True)


class ProjectRow(Base):
    __tablename__ = "projects"
    project_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ProjectMemberRow(Base):
    """ADR 0006: 프로젝트 접근권은 이 행의 존재로 정의된다. 역할도 여기서 나온다(전역 역할 아님)."""

    __tablename__ = "project_members"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), primary_key=True)
    role: Mapped[str] = mapped_column(String)          # contractor | cm | client (admin은 멤버십 없이 조회)
    added_by: Mapped[str | None] = mapped_column(String, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FileRow(Base):
    __tablename__ = "files"
    file_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    kind: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    uri: Mapped[str] = mapped_column(String)
    sha256: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class JobRow(Base):
    __tablename__ = "jobs"
    job_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    kind: Mapped[str] = mapped_column(String)          # ingest | scan_upload | schedule | mapping | verdict (glossary Job kind)
    status: Mapped[str] = mapped_column(String, default="queued")  # queued | running | done | failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    result_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ModelRow(Base):
    __tablename__ = "models"
    model_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    file_id: Mapped[str] = mapped_column(ForeignKey("files.file_id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    coordinate_system: Mapped[dict] = mapped_column(JSON)
    levels: Mapped[list] = mapped_column(JSON, default=list)
    mesh_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)


class BimObjectRow(Base):
    __tablename__ = "bim_objects"
    # ADR 0005: 키의 범위는 프로젝트다. 같은 IFC를 여러 프로젝트에 올릴 수 있다.
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"), primary_key=True, index=True)
    global_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("models.model_id"), index=True)
    model_version: Mapped[int] = mapped_column(Integer, default=1)
    ifc_type: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    level: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    level_elevation: Mapped[float | None] = mapped_column(Float, nullable=True)
    zone: Mapped[str | None] = mapped_column(String, nullable=True)
    bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    mesh_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    psets: Mapped[dict] = mapped_column(JSON, default=dict)
    material: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[dict] = mapped_column(JSON, default=dict)
    express_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state: Mapped[str] = mapped_column(String, default="PLANNED", index=True)
    is_orphaned: Mapped[bool] = mapped_column(Boolean, default=False)


class DrawingRow(Base):
    __tablename__ = "drawings"
    drawing_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    file_id: Mapped[str] = mapped_column(ForeignKey("files.file_id"))
    level: Mapped[str | None] = mapped_column(String, nullable=True)
    coordinate_system: Mapped[dict] = mapped_column(JSON)
    alignment: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # CoordinateTransform → model
    svg_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)


class DrawingEntityRow(Base):
    __tablename__ = "drawing_entities"
    drawing_id: Mapped[str] = mapped_column(ForeignKey("drawings.drawing_id"), primary_key=True)
    handle: Mapped[str] = mapped_column(String, primary_key=True)
    layer: Mapped[str] = mapped_column(String, index=True)
    dxftype: Mapped[str] = mapped_column(String)
    points: Mapped[list] = mapped_column(JSON, default=list)
    bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    block_name: Mapped[str | None] = mapped_column(String, nullable=True)
    insert_point: Mapped[list | None] = mapped_column(JSON, nullable=True)
    rotation_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    scale: Mapped[list | None] = mapped_column(JSON, nullable=True)
    text: Mapped[str | None] = mapped_column(String, nullable=True)
    radius: Mapped[float | None] = mapped_column(Float, nullable=True)
    attrs: Mapped[dict] = mapped_column(JSON, default=dict)


class EntityObjectMappingRow(Base):
    __tablename__ = "entity_object_mappings"
    __table_args__ = (ForeignKeyConstraint(["project_id", "global_id"],
                                          ["bim_objects.project_id", "bim_objects.global_id"]),)
    drawing_id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_handle: Mapped[str] = mapped_column(String, primary_key=True)
    global_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, index=True)   # ADR 0005: 도면의 프로젝트에서 유도
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)


class ScheduleRow(Base):
    __tablename__ = "schedules"
    schedule_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_format: Mapped[str] = mapped_column(String)
    warnings: Mapped[list] = mapped_column(JSON, default=list)


class ActivityRow(Base):
    __tablename__ = "activities"
    activity_id: Mapped[str] = mapped_column(String, primary_key=True)
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.schedule_id"), index=True)
    project_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    wbs_code: Mapped[str | None] = mapped_column(String, nullable=True)
    discipline: Mapped[str | None] = mapped_column(String, nullable=True)
    level: Mapped[str | None] = mapped_column(String, nullable=True)
    zone: Mapped[str | None] = mapped_column(String, nullable=True)
    planned_start: Mapped[str | None] = mapped_column(String, nullable=True)
    planned_finish: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    resources: Mapped[dict] = mapped_column(JSON, default=dict)
    percent_complete: Mapped[float] = mapped_column(Float, default=0.0)
    source_ref: Mapped[str | None] = mapped_column(String, nullable=True)


class ActivityRelationRow(Base):
    __tablename__ = "activity_relations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[str] = mapped_column(String, index=True)
    predecessor_id: Mapped[str] = mapped_column(String)
    successor_id: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="FS")
    lag_days: Mapped[float] = mapped_column(Float, default=0.0)


class ActivityObjectMappingRow(Base):
    __tablename__ = "activity_object_mappings"
    __table_args__ = (ForeignKeyConstraint(["project_id", "global_id"],
                                          ["bim_objects.project_id", "bim_objects.global_id"]),)
    activity_id: Mapped[str] = mapped_column(String, primary_key=True)
    global_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, index=True)   # ADR 0005: Activity의 프로젝트에서 유도
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)


class ScanRow(Base):
    __tablename__ = "scans"
    scan_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    file_id: Mapped[str] = mapped_column(ForeignKey("files.file_id"))
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    alignment_input: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    registration: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    point_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ScanVerdictRow(Base):
    __tablename__ = "scan_verdicts"
    __table_args__ = (ForeignKeyConstraint(["project_id", "global_id"],
                                          ["bim_objects.project_id", "bim_objects.global_id"]),)
    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.scan_id"), primary_key=True)
    global_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, index=True)   # ADR 0005: 스캔의 프로젝트에서 유도
    state: Mapped[str] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    diff_from_previous: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class StateTransitionRow(Base):
    __tablename__ = "state_transitions"
    __table_args__ = (ForeignKeyConstraint(["project_id", "global_id"],
                                          ["bim_objects.project_id", "bim_objects.global_id"]),)
    transition_id: Mapped[str] = mapped_column(String, primary_key=True)
    global_id: Mapped[str] = mapped_column(String, index=True)
    project_id: Mapped[str] = mapped_column(String, index=True)   # ADR 0005: 객체의 프로젝트에서 유도
    from_state: Mapped[str] = mapped_column(String)
    to_state: Mapped[str] = mapped_column(String)
    actor: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence: Mapped[dict] = mapped_column(JSON)
    review_request_id: Mapped[str | None] = mapped_column(String, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ReviewRequestRow(Base):
    __tablename__ = "review_requests"
    review_request_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"), index=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    global_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    activity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    rule_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String)
    conflicting_sources: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    assignee_role: Mapped[str] = mapped_column(String, default="cm")
    status: Mapped[str] = mapped_column(String, default="open", index=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DailyReportRow(Base):
    __tablename__ = "daily_reports"
    report_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"), index=True)
    report_date: Mapped[str] = mapped_column(String)
    reporter_id: Mapped[str] = mapped_column(String)
    crew_count: Mapped[int] = mapped_column(Integer, default=0)
    equipment: Mapped[dict] = mapped_column(JSON, default=dict)
    items: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class MaterialMovementRow(Base):
    __tablename__ = "material_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String, index=True)
    material_id: Mapped[str] = mapped_column(String)
    global_id: Mapped[str | None] = mapped_column(String, nullable=True)
    activity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String)
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ExpertReviewLogRow(Base):
    __tablename__ = "expert_review_logs"
    log_id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String, index=True)
    proposal: Mapped[dict] = mapped_column(JSON)
    final: Mapped[dict] = mapped_column(JSON)
    diff: Mapped[list] = mapped_column(JSON)
    reviewer: Mapped[str] = mapped_column(String)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RuleVerdictRow(Base):
    __tablename__ = "rule_verdicts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String, index=True)
    rule_id: Mapped[str] = mapped_column(String)
    rule_version: Mapped[int] = mapped_column(Integer)
    global_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    activity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    risk_level: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(Text)
    required_evidence: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DocumentRow(Base):
    """문서관리대장 한 행(ADR 0007 §2). 대장이 정본이므로 우리가 무결성 제약을 얹지 않는다."""

    __tablename__ = "documents"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"), primary_key=True)
    # §2-1 결정적 대리키. 산출식에 discipline 이 들어가지 않는다 — 신뢰할 수 없는 필드가
    # 문서의 정체성에 관여하면 협력사가 공종을 고쳐 적을 때 같은 문서가 다른 문서가 된다.
    doc_id: Mapped[str] = mapped_column(String, primary_key=True)
    doc_type: Mapped[str] = mapped_column(String, index=True)
    sender: Mapped[str] = mapped_column(String)
    sender_normalized: Mapped[str] = mapped_column(String)
    discipline_raw: Mapped[str | None] = mapped_column(String, nullable=True)
    discipline_normalized: Mapped[str | None] = mapped_column(String, nullable=True)
    seq_raw: Mapped[str | None] = mapped_column(String, nullable=True)
    seq_normalized: Mapped[str | None] = mapped_column(String, nullable=True)
    # 유니크 제약을 걸지 않는다(§2-1 규칙 3). 걸면 공란·중복이 실제로 발생하는 대장의 적재를
    # BuildTwin 이 거부하게 되어 "대장이 정본"(§1 규칙 1)을 정면으로 위반한다. 중복은 경고로만 보고.
    doc_number: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    title: Mapped[str] = mapped_column(Text)
    title_normalized: Mapped[str] = mapped_column(Text)
    issued_on: Mapped[str | None] = mapped_column(String, nullable=True)
    result_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_status: Mapped[str] = mapped_column(String, index=True, default="UNKNOWN")
    approval_confidence: Mapped[float] = mapped_column(Float)
    approval_evidence: Mapped[dict] = mapped_column(JSON)
    completed_on: Mapped[str | None] = mapped_column(String, nullable=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.file_id"))
    sheet_name: Mapped[str] = mapped_column(String)
    source_row: Mapped[int] = mapped_column(Integer)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    is_orphaned: Mapped[bool] = mapped_column(Boolean, default=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ActivityDocumentMappingRow(Base):
    """문서 ↔ Activity 매핑(ADR 0007 §4). ActivityObjectMappingRow 와 같은 모양이다."""

    __tablename__ = "activity_document_mappings"
    __table_args__ = (ForeignKeyConstraint(["project_id", "doc_id"],
                                          ["documents.project_id", "documents.doc_id"]),)
    activity_id: Mapped[str] = mapped_column(String, primary_key=True)
    doc_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, index=True)   # ADR 0005: Activity 의 프로젝트에서 유도
    confidence: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    # §4 규칙 5: 시스템이 만든 문서 매핑은 confidence 와 무관하게 항상 True 로 들어온다.
    # 기본값을 False 로 두면 누락 시 조용히 확정된 매핑이 되므로 True 로 둔다.
    needs_review: Mapped[bool] = mapped_column(Boolean, default=True)
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)
