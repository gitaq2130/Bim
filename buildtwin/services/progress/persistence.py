"""ORM 저장/조회 헬퍼. Schedule/Activity/Relation/Mapping ↔ 행, 객체 상태·검토요청·자재 조회."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from packages.core.models.coordinate import BBox3D
from packages.core.models.document import ActivityDocumentMapping, Document, DocumentApprovalStatus, DocumentType
from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObject, BimObjectDraft
from packages.core.models.mapping import ActivityObjectMapping
from packages.core.models.orm import (
    ActivityDocumentMappingRow,
    ActivityObjectMappingRow,
    ActivityRelationRow,
    ActivityRow,
    BimObjectRow,
    DailyReportRow,
    DocumentRow,
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


def ensure_model(session: Session, project_id: str, model_id: str, file_id: str) -> ModelRow:
    """model_id 가 아직 없으면 새 ModelRow 를 만든다.

    ModelRow.file_id 는 files.file_id 를 참조하는 non-nullable FK 다. 이전에는 이 함수가 실제
    업로드 파일이 없으면 `kind="model_placeholder"` 자리표시 FileRow 를 스스로 만들어 채웠지만,
    라운드4 리뷰 지적: (a) `save_objects`/`ensure_model` 은 현재 프로덕션 호출자가 없는 테스트 전용
    헬퍼라 "프로덕션 버그"로 부르는 건 과장이었고, (b) 그 자리표시 FileRow 가 그대로
    `GET /projects/{id}/files` 목록에 노출되어 사용자에게 업로드한 적 없는 0바이트 IFC 파일이
    보이고 `/content` 는 404 가 나는 유령 파일 문제를 낳았다.

    프로덕션 호출자가 없는 지금이 비용 없이 바로잡을 시점이므로, 파일을 대신 지어내는 대신
    호출자가 실제 FileRow.file_id 를 넘기도록 필수 인자로 승격했다(자리표시 생성 로직은 제거).
    존재하지 않는 file_id 를 넘기면 FK 위반으로 즉시 실패한다(SQLite 도 PRAGMA foreign_keys=ON
    으로 이를 강제한다 — packages/core/db.py).
    """
    row = session.get(ModelRow, model_id)
    if row is None:
        ensure_project(session, project_id)
        row = ModelRow(model_id=model_id, project_id=project_id, file_id=file_id, coordinate_system={})
        session.add(row)
        session.flush()
    return row


def save_objects(session: Session, project_id: str, model_id: str, drafts: list[BimObjectDraft],
                 file_id: str) -> list[BimObjectRow]:
    """ingest 초안을 bim_objects 에 저장(상태는 PLANNED 로 초기화, 기존 행은 속성만 갱신).

    ADR 0005: 키는 (project_id, global_id) — 같은 global_id 라도 다른 프로젝트면 별개 행이다.
    file_id 는 model_id 가 처음 등장할 때 ensure_model 이 ModelRow 를 만드는 데 쓰는 실제
    FileRow.file_id 다(자리표시 대신 호출자가 실제 업로드 파일을 지정 — ensure_model 참고).
    """
    ensure_model(session, project_id, model_id, file_id)
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
        # ADR 0008: schedule_id 는 프로젝트 안에서만 유일하다고 보지 않는다 — 교체 대상도 project_id 로 좁힌다.
        for old_rel in session.scalars(select(ActivityRelationRow).where(
                ActivityRelationRow.project_id == schedule.project_id,
                ActivityRelationRow.schedule_id == schedule.schedule_id)):
            session.delete(old_rel)
        for old_act in session.scalars(select(ActivityRow).where(
                ActivityRow.project_id == schedule.project_id,
                ActivityRow.schedule_id == schedule.schedule_id)):
            session.delete(old_act)
        session.flush()
    for a in schedule.activities:
        # ADR 0008 §Context 1: 전역 PK 였을 때 이 조회가 남의 프로젝트 Activity 를 찾아 지우고 가져갔다.
        existing = session.get(ActivityRow, (schedule.project_id, a.activity_id))
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
        # ADR 0008 규칙 1: 관계의 project_id 는 Schedule 에서 유도한다(predecessors_of 의 필터 축).
        session.add(ActivityRelationRow(project_id=schedule.project_id, schedule_id=schedule.schedule_id,
                                        predecessor_id=r.predecessor_id, successor_id=r.successor_id,
                                        type=r.type, lag_days=r.lag_days))
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
    # ADR 0008 규칙 2: schedule_id 로 이미 사실상 프로젝트 범위지만, Activity·관계 조회에는 언제나
    # project_id 를 함께 건다(ScheduleRow 에서 유도 — 규칙 1).
    acts = session.scalars(select(ActivityRow).where(ActivityRow.project_id == row.project_id,
                                                     ActivityRow.schedule_id == schedule_id)
                           .order_by(ActivityRow.activity_id))
    rels = session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.project_id == row.project_id,
                                                             ActivityRelationRow.schedule_id == schedule_id)
                           .order_by(ActivityRelationRow.id))
    return Schedule(schedule_id=schedule_id, project_id=row.project_id, activities=[activity_row_to_model(a) for a in acts],
                    relations=[relation_row_to_model(r) for r in rels], source_format=row.source_format,  # type: ignore[arg-type]
                    warnings=list(row.warnings or []))


def load_activity(session: Session, project_id: str, activity_id: str) -> ActivityRow | None:
    """ADR 0008 규칙 2: `project_id` 는 **필수 위치 인자**다.

    옵션(`| None`·기본값)으로 두면 시그니처가 생략을 허용해버려 규칙이 실제로 강제되지 않는다
    (`open_reviews` 가 라운드4 에 겪은 것과 같다). `activity_id` 는 공정표 파일에 적혀 오는 코드라
    프로젝트가 다르면 반드시 겹친다.
    """
    return session.get(ActivityRow, (project_id, activity_id))


def load_activities(session: Session, project_id: str) -> list[ActivityRow]:
    return list(session.scalars(select(ActivityRow).where(ActivityRow.project_id == project_id).order_by(ActivityRow.activity_id)))


def load_relations(session: Session, project_id: str) -> list[ActivityRelationRow]:
    """ADR 0008: 관계가 `project_id` 를 직접 들게 됐으므로 Schedule 경유 서브쿼리 대신 그 컬럼으로 거른다
    (값은 `save_schedule` 이 Schedule 에서 유도해 채운다 — 규칙 1). 결과 집합은 이전과 같다."""
    return list(session.scalars(select(ActivityRelationRow).where(ActivityRelationRow.project_id == project_id)
                                .order_by(ActivityRelationRow.id)))


def predecessors_of(session: Session, project_id: str, activity_id: str) -> list[ActivityRelationRow]:
    """ADR 0008 규칙 3 / 계획 0002 §1-b — **이 사이클에서 유일하게 스키마가 잡아주지 않는 자리다.**

    `successor_id` 만으로 조회하면 다른 프로젝트의 같은 `activity_id`(`A100` 같은 코드는 무관한 두 현장도
    겹친다) 관계를 선행공정으로 끌어온다. 복합 PK 는 `session.get()` 경로만 터뜨려 주므로 이 `select()`
    경로는 조용히 틀린다 — `project_id` 를 필수 위치 인자로 받고 필터를 반드시 함께 건다.
    """
    return list(session.scalars(select(ActivityRelationRow).where(
        ActivityRelationRow.project_id == project_id,
        ActivityRelationRow.successor_id == activity_id)))


# ------------------------------------------------------------------ mappings
def save_mappings(session: Session, project_id: str, mappings: list[ActivityObjectMapping]) -> int:
    """ADR 0008 §2-a: `project_id` 는 필수 위치 인자이고 **검증에** 쓴다.

    규칙 1(부모에서 유도)은 그대로다 — 매핑 행의 `project_id` 는 여전히 Activity 의 프로젝트다. 다만
    그 Activity 를 `(project_id, activity_id)` 로 찾으므로, 호출자가 임의 `project_id` 를 주입해 남의
    프로젝트에 매핑을 만들려 하면 Activity 가 없어 `LookupError` 로 멈춘다. 전역 PK 였을 때는 이
    upsert 가 첫 프로젝트의 행을 찾아 `project_id` 를 덮어써 매핑 27건을 통째로 옮겨갔다(ADR 0008 §Context 1).
    """
    verified: set[str] = set()
    count = 0
    for m in mappings:
        if m.activity_id not in verified:
            if load_activity(session, project_id, m.activity_id) is None:
                raise LookupError(f"activity not found: {m.activity_id} in project {project_id}")
            verified.add(m.activity_id)
        row = session.get(ActivityObjectMappingRow, (project_id, m.activity_id, m.global_id))
        if row is None:
            row = ActivityObjectMappingRow(project_id=project_id, activity_id=m.activity_id, global_id=m.global_id,
                                           confidence=m.confidence, evidence=m.evidence.model_dump(mode="json"),
                                           needs_review=m.needs_review)
            session.add(row)
        else:
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


# ------------------------------------------------------------------ documents (ADR 0007)
def document_row_to_model(row: DocumentRow) -> Document:
    return Document(
        project_id=row.project_id, doc_id=row.doc_id, doc_type=DocumentType(row.doc_type), sender=row.sender,
        sender_normalized=row.sender_normalized, discipline_raw=row.discipline_raw,
        discipline_normalized=row.discipline_normalized, seq_raw=row.seq_raw, seq_normalized=row.seq_normalized,
        doc_number=row.doc_number, title=row.title, title_normalized=row.title_normalized, issued_on=row.issued_on,
        result_raw=row.result_raw, approval_status=DocumentApprovalStatus(row.approval_status),
        approval_confidence=row.approval_confidence, approval_evidence=Evidence(**row.approval_evidence),
        completed_on=row.completed_on, file_id=row.file_id, sheet_name=row.sheet_name, source_row=row.source_row,
        needs_review=row.needs_review, is_orphaned=row.is_orphaned,
    )


def load_document(session: Session, project_id: str, doc_id: str) -> DocumentRow | None:
    """ADR 0007 §2-3: doc_id 단독 조회 금지 — (project_id, doc_id) 복합키로만 조회한다."""
    return session.get(DocumentRow, (project_id, doc_id))


def documents_by_ids(session: Session, project_id: str, doc_ids: list[str]) -> dict[str, DocumentRow]:
    if not doc_ids:
        return {}
    rows = session.scalars(select(DocumentRow).where(DocumentRow.project_id == project_id,
                                                       DocumentRow.doc_id.in_(doc_ids)))
    return {r.doc_id: r for r in rows}


def load_documents(session: Session, project_id: str, doc_type: str | None = None,
                   include_orphaned: bool = True) -> list[DocumentRow]:
    stmt = select(DocumentRow).where(DocumentRow.project_id == project_id)
    if doc_type is not None:
        stmt = stmt.where(DocumentRow.doc_type == doc_type)
    if not include_orphaned:
        stmt = stmt.where(DocumentRow.is_orphaned.is_(False))
    return list(session.scalars(stmt.order_by(DocumentRow.doc_id)))


def document_mappings_for_activity(session: Session, project_id: str, activity_id: str) -> list[ActivityDocumentMappingRow]:
    return document_mappings_for_activities(session, project_id, [activity_id])


def document_mappings_for_activities(session: Session, project_id: str,
                                     activity_ids: list[str]) -> list[ActivityDocumentMappingRow]:
    """ADR 0005 규칙 2 와 같은 패턴: project_id 를 항상 함께 건다."""
    if not activity_ids:
        return []
    return list(session.scalars(select(ActivityDocumentMappingRow).where(
        ActivityDocumentMappingRow.project_id == project_id,
        ActivityDocumentMappingRow.activity_id.in_(activity_ids))))


def document_mappings_for_project(session: Session, project_id: str) -> list[ActivityDocumentMappingRow]:
    """프로젝트 전체의 문서 매핑(Activity 필터 없음). 과제 2: 매핑 후보가 0건인 문서 집계용."""
    return list(session.scalars(select(ActivityDocumentMappingRow).where(
        ActivityDocumentMappingRow.project_id == project_id)))


def save_document_mapping(session: Session, project_id: str, mapping: ActivityDocumentMapping) -> ActivityDocumentMappingRow:
    """ADR 0008 §2-a: `save_mappings` 와 같은 계약 — `project_id` 는 필수 위치 인자이고 검증에 쓴다.

    행의 `project_id` 는 여전히 Activity 의 프로젝트다(규칙 1). 그 Activity 를 `(project_id, activity_id)` 로
    찾으므로 남의 프로젝트에 문서 매핑을 만들 수 없다.
    """
    if load_activity(session, project_id, mapping.activity_id) is None:
        raise LookupError(f"activity not found: {mapping.activity_id} in project {project_id}")
    row = session.get(ActivityDocumentMappingRow, (project_id, mapping.activity_id, mapping.doc_id))
    if row is None:
        row = ActivityDocumentMappingRow(
            project_id=project_id, activity_id=mapping.activity_id, doc_id=mapping.doc_id,
            confidence=mapping.confidence, evidence=mapping.evidence.model_dump(mode="json"),
            needs_review=mapping.needs_review, reviewed_by=mapping.reviewed_by,
        )
        session.add(row)
    else:
        row.confidence, row.evidence = mapping.confidence, mapping.evidence.model_dump(mode="json")
        row.needs_review, row.reviewed_by = mapping.needs_review, mapping.reviewed_by
    return row


def save_document_mappings(session: Session, project_id: str, mappings: list[ActivityDocumentMapping]) -> int:
    count = 0
    for m in mappings:
        save_document_mapping(session, project_id, m)
        count += 1
    session.flush()
    return count


def document_mapping_row_to_model(row: ActivityDocumentMappingRow) -> ActivityDocumentMapping:
    return ActivityDocumentMapping(activity_id=row.activity_id, doc_id=row.doc_id, confidence=row.confidence,
                                   evidence=Evidence(**row.evidence), needs_review=row.needs_review,
                                   reviewed_by=row.reviewed_by)


# ------------------------------------------------------------------ reviews
def open_reviews(session: Session, project_id: str, global_ids: list[str] | None = None,
                 kind: str | None = None) -> list[ReviewRequestRow]:
    """ADR 0005 규칙 2: project_id 는 필수 인자다(단독 global_id 조회 금지 — 라운드4 리뷰 지적 사유).

    project_id 를 옵션으로 두면 시그니처가 생략을 허용해버려 규칙이 실제로 강제되지 않는다(지난
    프로젝트 간 교차 조회 버그의 원인). load_mappings/mapped_global_ids 와 동일하게 필수 위치 인자로 승격.
    """
    stmt = select(ReviewRequestRow).where(ReviewRequestRow.status == "open", ReviewRequestRow.project_id == project_id)
    if global_ids is not None:
        if not global_ids:
            return []
        stmt = stmt.where(ReviewRequestRow.global_id.in_(global_ids))
    if kind is not None:
        stmt = stmt.where(ReviewRequestRow.kind == kind)
    return list(session.scalars(stmt))


def has_open_verification_review(session: Session, project_id: str, global_id: str) -> bool:
    return bool(open_reviews(session, project_id, [global_id], kind="verification"))


def open_document_mapping_review(session: Session, project_id: str, activity_id: str,
                                 doc_id: str) -> ReviewRequestRow | None:
    """열린 `kind="document_mapping"` 검토요청 중 이 (activity_id, doc_id) 매핑을 가리키는 것 하나
    (ADR 0007 §4 규칙 6 — 중복 생성 금지의 조회 축). `doc_id`는 `conflicting_sources`에 담는다 —
    `drawing_id`/`entity_handle`은 절대 쓰지 않는다(services/sync/review_queue.resolve_mapping_review가
    그 키를 다른 구조로 기대하므로, ADR 0007 §4 규칙 6)."""
    stmt = select(ReviewRequestRow).where(
        ReviewRequestRow.status == "open", ReviewRequestRow.project_id == project_id,
        ReviewRequestRow.kind == "document_mapping", ReviewRequestRow.activity_id == activity_id,
    )
    for row in session.scalars(stmt):
        if (row.conflicting_sources or {}).get("doc_id") == doc_id:
            return row
    return None


def find_document_mapping_review(session: Session, project_id: str, activity_id: str,
                                 doc_id: str) -> ReviewRequestRow | None:
    """`open_document_mapping_review`와 같은 조회지만 **상태 무관**이다(과제 1, 9차 리뷰 후속).

    확정된 매핑의 검토요청은 이미 `approved`로 닫혀 있다 — 재계산이 그 확정을 더 이상 뒷받침하지
    못하게 되면(`document_mapper._reopen_reviews_for_invalidated_confirmations`) `approved` 상태인 이
    행을 다시 찾아 `open`으로 되돌려야 하므로, `status == "open"` 필터를 걸지 않는 버전이 필요하다."""
    stmt = select(ReviewRequestRow).where(
        ReviewRequestRow.project_id == project_id,
        ReviewRequestRow.kind == "document_mapping", ReviewRequestRow.activity_id == activity_id,
    )
    for row in session.scalars(stmt):
        if (row.conflicting_sources or {}).get("doc_id") == doc_id:
            return row
    return None


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
