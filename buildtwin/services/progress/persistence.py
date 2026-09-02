"""ORM 저장/조회 헬퍼. Schedule/Activity/Relation/Mapping ↔ 행, 객체 상태·검토요청·자재 조회."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from packages.core.models.coordinate import BBox3D
from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObject, BimObjectDraft
from packages.core.models.mapping import ActivityObjectMapping
from packages.core.models.orm import (
    ActivityObjectMappingRow,
    ActivityRelationRow,
    ActivityRow,
    BimObjectRow,
    DailyReportRow,
    MaterialMovementRow,
    ModelRow,
    ProjectRow,
    ReviewRequestRow,
    ScanVerdictRow,
    ScheduleRow,
    StateTransitionRow,
)
from packages.core.models.progress import Activity, ActivityRelation, DailyReport, MaterialMovement, Schedule
from packages.core.models.review import ReviewRequest
from packages.core.models.state import ObjectState, StateTransition


# ------------------------------------------------------------------ project / model / objects
def ensure_project(session: Session, project_id: str, name: str | None = None) -> ProjectRow:
    row = session.get(ProjectRow, project_id)
    if row is None:
        row = ProjectRow(project_id=project_id, name=name or project_id)
        session.add(row)
        session.flush()
    return row


def ensure_model(session: Session, project_id: str, model_id: str) -> ModelRow:
    row = session.get(ModelRow, model_id)
    if row is None:
        ensure_project(session, project_id)
        row = ModelRow(model_id=model_id, project_id=project_id, file_id=f"{model_id}:file", coordinate_system={})
        session.add(row)
        session.flush()
    return row


def save_objects(session: Session, project_id: str, model_id: str, drafts: list[BimObjectDraft]) -> list[BimObjectRow]:
    """ingest 초안을 bim_objects 에 저장(상태는 PLANNED 로 초기화, 기존 행은 속성만 갱신).

    ADR 0005: 키는 (project_id, global_id) — 같은 global_id 라도 다른 프로젝트면 별개 행이다.
    """
    ensure_model(session, project_id, model_id)
    rows: list[BimObjectRow] = []
    for d in drafts:
        row = session.get(BimObjectRow, (project_id, d.global_id))
        if row is None:
            row = BimObjectRow(global_id=d.global_id, project_id=project_id, model_id=model_id, ifc_type=d.ifc_type,
                               state=ObjectState.PLANNED.value)
            session.add(row)
        row.name, row.level, row.level_elevation, row.zone = d.name, d.level, d.level_elevation, d.zone
        row.bbox = d.bbox.model_dump(mode="json") if d.bbox is not None else None
        row.mesh_ref, row.psets, row.material, row.quantity, row.express_id = d.mesh_ref, d.psets, d.material, d.quantity, d.express_id
        rows.append(row)
    session.flush()
    return rows


def load_objects(session: Session, project_id: str) -> list[BimObjectRow]:
    return list(session.scalars(select(BimObjectRow).where(BimObjectRow.project_id == project_id)))


def object_row_to_model(row: BimObjectRow) -> BimObject:
    return BimObject(
        global_id=row.global_id, ifc_type=row.ifc_type, name=row.name, level=row.level, level_elevation=row.level_elevation,
        zone=row.zone, bbox=BBox3D.model_validate(row.bbox) if row.bbox else None, mesh_ref=row.mesh_ref, psets=row.psets or {}, material=row.material,
        quantity=row.quantity or {}, express_id=row.express_id, project_id=row.project_id, model_id=row.model_id,
        model_version=row.model_version, state=ObjectState(row.state), is_orphaned=row.is_orphaned,
    )


def object_states(session: Session, project_id: str, global_ids: list[str]) -> dict[str, ObjectState]:
    """ADR 0005 규칙 2: global_id 단독 조회 금지 — project_id 로 함께 건다."""
    if not global_ids:
        return {}
    rows = session.scalars(select(BimObjectRow).where(BimObjectRow.project_id == project_id,
                                                       BimObjectRow.global_id.in_(global_ids)))
    return {r.global_id: ObjectState(r.state) for r in rows}


# ------------------------------------------------------------------ schedule
def _date_str(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value[:10]) if value else None


def save_schedule(session: Session, schedule: Schedule) -> ScheduleRow:
    """같은 schedule_id 가 있으면 Activity·관계를 교체한다(매핑은 activity_id 기준이라 유지)."""
    ensure_project(session, schedule.project_id)
    row = session.get(ScheduleRow, schedule.schedule_id)
    if row is None:
        row = ScheduleRow(schedule_id=schedule.schedule_id, project_id=schedule.project_id,
                          source_format=schedule.source_format, warnings=list(schedule.warnings))
        session.add(row)
    else:
        row.source_format, row.warnings = schedule.source_format, list(schedule.warnings)
        for old_rel in session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.schedule_id == schedule.schedule_id)):
            session.delete(old_rel)
        for old_act in session.scalars(select(ActivityRow).where(ActivityRow.schedule_id == schedule.schedule_id)):
            session.delete(old_act)
        session.flush()
    for a in schedule.activities:
        existing = session.get(ActivityRow, a.activity_id)
        if existing is not None:
            session.delete(existing)
            session.flush()
        session.add(ActivityRow(
            activity_id=a.activity_id, schedule_id=schedule.schedule_id, project_id=schedule.project_id, name=a.name,
            wbs_code=a.wbs_code, discipline=a.discipline, level=a.level, zone=a.zone,
            planned_start=_date_str(a.planned_start), planned_finish=_date_str(a.planned_finish),
            duration_days=a.duration_days, resources=dict(a.resources), percent_complete=a.percent_complete,
            source_ref=a.source_ref,
        ))
    for r in schedule.relations:
        session.add(ActivityRelationRow(schedule_id=schedule.schedule_id, predecessor_id=r.predecessor_id,
                                        successor_id=r.successor_id, type=r.type, lag_days=r.lag_days))
    session.flush()
    return row


def activity_row_to_model(row: ActivityRow) -> Activity:
    return Activity(
        activity_id=row.activity_id, name=row.name, wbs_code=row.wbs_code, discipline=row.discipline, level=row.level,
        zone=row.zone, planned_start=_parse_date(row.planned_start), planned_finish=_parse_date(row.planned_finish),
        duration_days=row.duration_days,
        resources=dict(row.resources or {}), percent_complete=row.percent_complete or 0.0, source_ref=row.source_ref,
    )


def relation_row_to_model(row: ActivityRelationRow) -> ActivityRelation:
    return ActivityRelation(predecessor_id=row.predecessor_id, successor_id=row.successor_id, type=row.type,  # type: ignore[arg-type]
                            lag_days=row.lag_days or 0.0)


def load_schedule(session: Session, schedule_id: str) -> Schedule:
    row = session.get(ScheduleRow, schedule_id)
    if row is None:
        raise LookupError(f"schedule not found: {schedule_id}")
    acts = session.scalars(select(ActivityRow).where(ActivityRow.schedule_id == schedule_id).order_by(ActivityRow.activity_id))
    rels = session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.schedule_id == schedule_id).order_by(ActivityRelationRow.id))
    return Schedule(schedule_id=schedule_id, project_id=row.project_id, activities=[activity_row_to_model(a) for a in acts],
                    relations=[relation_row_to_model(r) for r in rels], source_format=row.source_format,  # type: ignore[arg-type]
                    warnings=list(row.warnings or []))


def load_activity(session: Session, activity_id: str) -> ActivityRow | None:
    return session.get(ActivityRow, activity_id)


def load_activities(session: Session, project_id: str) -> list[ActivityRow]:
    return list(session.scalars(select(ActivityRow).where(ActivityRow.project_id == project_id).order_by(ActivityRow.activity_id)))


def load_relations(session: Session, project_id: str) -> list[ActivityRelationRow]:
    schedule_ids = select(ScheduleRow.schedule_id).where(ScheduleRow.project_id == project_id)
    return list(session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.schedule_id.in_(schedule_ids))
                                .order_by(ActivityRelationRow.id)))


def predecessors_of(session: Session, activity_id: str) -> list[ActivityRelationRow]:
    return list(session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.successor_id == activity_id)))


# ------------------------------------------------------------------ mappings
def save_mappings(session: Session, mappings: list[ActivityObjectMapping]) -> int:
    """ADR 0005 규칙 1: project_id 는 호출자가 주입하지 않고 Activity의 프로젝트에서 유도한다."""
    project_id_cache: dict[str, str] = {}
    count = 0
    for m in mappings:
        if m.activity_id not in project_id_cache:
            activity = session.get(ActivityRow, m.activity_id)
            if activity is None:
                raise LookupError(f"activity not found: {m.activity_id}")
            project_id_cache[m.activity_id] = activity.project_id
        project_id = project_id_cache[m.activity_id]
        row = session.get(ActivityObjectMappingRow, (m.activity_id, m.global_id))
        if row is None:
            row = ActivityObjectMappingRow(activity_id=m.activity_id, global_id=m.global_id, project_id=project_id,
                                           confidence=m.confidence, evidence=m.evidence.model_dump(mode="json"),
                                           needs_review=m.needs_review)
            session.add(row)
        else:
            row.project_id = project_id
            row.confidence, row.evidence, row.needs_review = m.confidence, m.evidence.model_dump(mode="json"), m.needs_review
        count += 1
    session.flush()
    return count


def load_mappings(session: Session, project_id: str, activity_id: str | None = None,
                  global_id: str | None = None) -> list[ActivityObjectMappingRow]:
    """ADR 0005 규칙 2: project_id 는 필수 인자다(단독 global_id/activity_id 조회 금지 — 라운드3 리뷰 반려 사유)."""
    stmt = select(ActivityObjectMappingRow).where(ActivityObjectMappingRow.project_id == project_id)
    if activity_id is not None:
        stmt = stmt.where(ActivityObjectMappingRow.activity_id == activity_id)
    if global_id is not None:
        stmt = stmt.where(ActivityObjectMappingRow.global_id == global_id)
    return list(session.scalars(stmt))


def mapping_row_to_model(row: ActivityObjectMappingRow) -> ActivityObjectMapping:
    return ActivityObjectMapping(activity_id=row.activity_id, global_id=row.global_id, confidence=row.confidence,
                                 evidence=Evidence(**row.evidence), needs_review=row.needs_review)


def mapped_global_ids(session: Session, project_id: str, activity_id: str) -> list[str]:
    """ADR 0005 규칙 2: project_id 없이 activity_id 만으로 조회하지 않는다(다른 프로젝트 Activity 가 같은 global_id 를
    가리키는 매핑을 잘못 끌어오는 것을 막는다 — 라운드3 리뷰 FAIL 사유)."""
    return [m.global_id for m in load_mappings(session, project_id, activity_id=activity_id)]


def activity_ids_for_object(session: Session, project_id: str, global_id: str) -> list[str]:
    """ADR 0005 규칙 2: global_id 만으로는 프로젝트 간 모호하므로 project_id 를 함께 건다."""
    return [m.activity_id for m in load_mappings(session, project_id, global_id=global_id)]


# ------------------------------------------------------------------ reviews
def open_reviews(session: Session, global_ids: list[str] | None = None, kind: str | None = None,
                 project_id: str | None = None) -> list[ReviewRequestRow]:
    stmt = select(ReviewRequestRow).where(ReviewRequestRow.status == "open")
    if global_ids is not None:
        if not global_ids:
            return []
        stmt = stmt.where(ReviewRequestRow.global_id.in_(global_ids))
    if kind is not None:
        stmt = stmt.where(ReviewRequestRow.kind == kind)
    if project_id is not None:
        stmt = stmt.where(ReviewRequestRow.project_id == project_id)
    return list(session.scalars(stmt))


def has_open_verification_review(session: Session, project_id: str, global_id: str) -> bool:
    return bool(open_reviews(session, [global_id], kind="verification", project_id=project_id))


def save_review_request(session: Session, review: ReviewRequest) -> ReviewRequestRow:
    ensure_project(session, review.project_id)
    row = ReviewRequestRow(
        review_request_id=str(review.review_request_id), project_id=review.project_id, kind=review.kind,
        global_id=review.global_id, activity_id=review.activity_id, rule_id=review.rule_id, title=review.title,
        conflicting_sources=review.conflicting_sources, confidence=review.confidence,
        evidence=review.evidence.model_dump(mode="json"), assignee_role=review.assignee_role, status=review.status,
        resolution_note=review.resolution_note, resolved_by=review.resolved_by, resolved_at=review.resolved_at,
        created_at=review.created_at,
    )
    session.add(row)
    session.flush()
    return row


def review_row_to_model(row: ReviewRequestRow) -> ReviewRequest:
    return ReviewRequest(
        review_request_id=UUID(row.review_request_id), project_id=row.project_id, kind=row.kind,  # type: ignore[arg-type]
        global_id=row.global_id, activity_id=row.activity_id, rule_id=row.rule_id, title=row.title,
        conflicting_sources=row.conflicting_sources or {}, confidence=row.confidence, evidence=Evidence(**row.evidence),
        assignee_role=row.assignee_role, status=row.status, resolution_note=row.resolution_note,  # type: ignore[arg-type]
        resolved_by=row.resolved_by, resolved_at=row.resolved_at, created_at=row.created_at,
    )


# ------------------------------------------------------------------ transitions / scans / reports / materials
def transition_row_to_model(row: StateTransitionRow) -> StateTransition:
    return StateTransition(
        transition_id=UUID(row.transition_id), global_id=row.global_id, from_state=ObjectState(row.from_state),
        to_state=ObjectState(row.to_state), actor=row.actor, actor_id=row.actor_id, confidence=row.confidence,  # type: ignore[arg-type]
        evidence=Evidence(**row.evidence), review_request_id=UUID(row.review_request_id) if row.review_request_id else None,
        occurred_at=row.occurred_at,
    )


def load_transitions(session: Session, project_id: str, global_id: str) -> list[StateTransitionRow]:
    return list(session.scalars(select(StateTransitionRow).where(StateTransitionRow.project_id == project_id,
                                                                  StateTransitionRow.global_id == global_id)
                                .order_by(StateTransitionRow.occurred_at)))


def latest_transition_to(session: Session, project_id: str, global_ids: list[str], to_state: ObjectState) -> datetime | None:
    if not global_ids:
        return None
    rows = session.scalars(select(StateTransitionRow).where(StateTransitionRow.project_id == project_id,
                                                            StateTransitionRow.global_id.in_(global_ids),
                                                            StateTransitionRow.to_state == to_state.value))
    times = [r.occurred_at for r in rows if r.occurred_at is not None]
    return max(times) if times else None


def latest_scan_verdict(session: Session, project_id: str, global_id: str) -> ScanVerdictRow | None:
    return session.scalars(select(ScanVerdictRow).where(ScanVerdictRow.project_id == project_id,
                                                         ScanVerdictRow.global_id == global_id)
                           .order_by(ScanVerdictRow.created_at.desc())).first()


def save_daily_report(session: Session, report: DailyReport) -> DailyReportRow:
    ensure_project(session, report.project_id)
    row = session.get(DailyReportRow, report.report_id)
    payload = report.model_dump(mode="json")
    if row is None:
        row = DailyReportRow(report_id=report.report_id, project_id=report.project_id)
        session.add(row)
    row.report_date, row.reporter_id, row.crew_count = payload["report_date"], report.reporter_id, report.crew_count
    row.equipment, row.items, row.note, row.submitted_at = dict(report.equipment), payload["items"], report.note, report.submitted_at
    session.flush()
    return row


def save_material_movement(session: Session, project_id: str, movement: MaterialMovement) -> MaterialMovementRow:
    row = MaterialMovementRow(project_id=project_id, material_id=movement.material_id, global_id=movement.global_id,
                              activity_id=movement.activity_id, kind=movement.kind, quantity=movement.quantity,
                              unit=movement.unit, occurred_at=movement.occurred_at)
    session.add(row)
    session.flush()
    return row


def material_totals(session: Session, project_id: str, activity_ids: list[str], global_ids: list[str]) -> tuple[float, float, int]:
    """(반입 합계, 반출 합계, 기록 수). Activity 귀속 또는 객체 귀속 이동을 모두 센다.

    ADR 0005: material_movements 는 FK 는 아니지만 project_id 필터링은 지킨다(global_id 재사용 대비).
    """
    if not activity_ids and not global_ids:
        return 0.0, 0.0, 0
    stmt = select(MaterialMovementRow).where(MaterialMovementRow.project_id == project_id)
    conds = []
    if activity_ids:
        conds.append(MaterialMovementRow.activity_id.in_(activity_ids))
    if global_ids:
        conds.append(MaterialMovementRow.global_id.in_(global_ids))
    rows = list(session.scalars(stmt.where(or_(*conds))))
    total_in = sum(r.quantity for r in rows if r.kind == "in")
    total_out = sum(r.quantity for r in rows if r.kind == "out")
    return float(total_in), float(total_out), len(rows)


def load_objects_by_ids(session: Session, project_id: str, global_ids: list[str]) -> list[BimObjectRow]:
    if not global_ids:
        return []
    return list(session.scalars(select(BimObjectRow).where(BimObjectRow.project_id == project_id,
                                                           BimObjectRow.global_id.in_(global_ids))))


def load_scan_verdicts(session: Session, project_id: str, global_id: str) -> list[ScanVerdictRow]:
    """최근 순."""
    return list(session.scalars(select(ScanVerdictRow).where(ScanVerdictRow.project_id == project_id,
                                                             ScanVerdictRow.global_id == global_id)
                                .order_by(ScanVerdictRow.created_at.desc())))
