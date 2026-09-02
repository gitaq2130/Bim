"""엔드포인트별 오케스트레이션: 서비스 함수 호출 + 응답 조립. 판정·전이·매핑 생명주기·검토요청 생성/종료는 모두 services/* 소유.

- 역할→actor: services.progress.state_machine.actor_for_role (client/admin → RoleNotAllowedError → 403)
- 전이 부수효과(검측 ReviewRequest 생성/종료): ObjectStateMachine.transition_with_effects
- 매핑 확정·검토요청 해소: services.sync.review_queue.confirm_mapping_row / resolve_mapping_review
  (conflicting_sources 파싱은 sync 소유 — api 는 dict 키를 모른다)
- 전문가 검토 로그(record_expert_review)는 사람의 판단이 들어가는 엔드포인트에서 API 가 기록한다.
"""
from __future__ import annotations

import logging
import uuid
from collections import Counter, defaultdict
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from sqlalchemy.orm import Session

from packages.core.models.coordinate import CoordinateSystem
from packages.core.models.evidence import Evidence
from packages.core.models.identity import IFC_TYPE_GROUP, BimObjectDraft
from packages.core.models.knowledge import Rule
from packages.core.models.mapping import EntityObjectMapping
from packages.core.models.orm import BimObjectRow, DailyReportRow, DrawingRow, JobRow, ModelRow, ReviewRequestRow
from packages.core.models.progress import DailyReport
from packages.core.models.state import Actor, InvalidTransitionError, ObjectState
from services.knowledge import RuleEngine, load_rules, persist_verdicts, record_expert_review
from services.progress import persistence as db
from services.progress.readiness import compute_readiness
from services.progress.scheduler import compute_startable
from services.progress.state_machine import (
    ObjectStateMachine,
    RoleNotAllowedError,
    TransitionBlockedByReviewError,
    actor_for_role,
)
from services.progress.verification import build_logic_context
from services.sync.persistence import row_to_mapping
from services.sync.plan_section import plan_section_from_objects
from services.sync.review_queue import confirm_mapping_row, resolve_mapping_review

from . import jobs, queries
from .deps import CurrentUser
from .errors import Conflict, Forbidden, NotFound
from .schemas.activities import StartableActivityView, StateDistributionRow, WeeklySummary
from .schemas.drawings import AlignmentRequest, PlanSectionPolyline, PlanSectionView
from .schemas.objects import (
    BimObjectView,
    EntityRef,
    LinkedRefs,
    NextAction,
    ObjectDetail,
    ObjectStateView,
    TransitionRequest,
    TransitionResponse,
)
from .schemas.reports import DailyReportCreate, DailyReportResponse
from .schemas.rules import RuleEvaluateResponse

log = logging.getLogger(__name__)

# 화면 라벨(한국어). kind 값은 state_machine.next_actions 가 준 것을 그대로 쓴다(glossary 집합).
NEXT_ACTION_LABELS: dict[str, str] = {
    "confirm": "확정(CM 승인)", "request_inspection": "검측 요청", "report_progress": "진행 신고",
    "reject_inspection": "검측 반려(재작업)", "accept_rework": "재작업 인정", "order_rework": "재시공 지시",
    "revoke_confirmation": "확정 취소", "flag_mismatch": "불일치 판정", "inspect": "검측",
    "resolve_review": "검토요청 처리", "align_scan": "스캔 정합 입력",
}
CONFIRM_ROLE = "cm"   # ADR 0001 §4-1: 확정·검측 승인·검토요청 처리는 cm 만


# ------------------------------------------------------------------ objects
def object_view(row: BimObjectRow, has_open_review: bool = False) -> BimObjectView:
    m = db.object_row_to_model(row)
    return BimObjectView(**m.model_dump(), group=IFC_TYPE_GROUP.get(row.ifc_type, "other"), has_open_review=has_open_review)


def _initial_evidence(row: BimObjectRow) -> Evidence:
    return Evidence(source_type="ingest", source_id=row.model_id, file_uri=row.mesh_ref, method="model_ingest",
                    note="initial PLANNED state from model ingest (no transitions yet)",
                    extra={"model_version": row.model_version})


def object_detail(session: Session, global_id: str, role: str) -> ObjectDetail:
    row = session.get(BimObjectRow, global_id)
    if row is None:
        raise NotFound(f"object not found: {global_id}")
    sm = ObjectStateMachine()
    history = list(reversed(sm.history(session, global_id)))
    open_reviews = db.open_reviews(session, [global_id])
    latest = history[0] if history else None
    if latest is not None:
        confidence = latest.confidence if latest.confidence is not None else (1.0 if latest.actor != Actor.SYSTEM else None)
        current = ObjectStateView(state=ObjectState(row.state), since=latest.occurred_at, actor=latest.actor,
                                  actor_id=latest.actor_id, confidence=confidence, evidence=latest.evidence)
    else:
        current = ObjectStateView(state=ObjectState(row.state), since=None, actor=Actor.SYSTEM, actor_id=None,
                                  confidence=1.0, evidence=_initial_evidence(row))
    current.has_open_review = bool(open_reviews)
    current.open_review_ids = [r.review_request_id for r in open_reviews]
    actions = [NextAction(kind=a["kind"], label=NEXT_ACTION_LABELS.get(a["kind"], a["kind"]),
                          allowed_roles=list(a["allowed_roles"]), to_state=a.get("to_state"), actor=a.get("actor"),
                          review_request_id=a.get("review_request_id"), review_kind=a.get("review_kind"), rule_id=a.get("rule_id"))
               for a in sm.next_actions(session, global_id, role)]
    mappings = queries.entity_mappings_for_object(session, global_id)
    linked = LinkedRefs(
        entity_handles=[m.entity_handle for m in mappings],
        entity_refs=[EntityRef(drawing_id=m.drawing_id, handle=m.entity_handle, confidence=m.confidence,
                               needs_review=m.needs_review, reviewed_by=m.reviewed_by) for m in mappings],
        drawing_id=mappings[0].drawing_id if mappings else None,
        activity_ids=db.activity_ids_for_object(session, global_id),
        material_ids=queries.material_ids_for_object(session, global_id),
        latest_scan_verdict=queries.latest_scan_verdict(session, global_id),
    )
    return ObjectDetail(basic=object_view(row, bool(open_reviews)), current_state=current, history=history,
                        next_actions=actions, linked=linked)


def _evidence_from_request(req: TransitionRequest, user: CurrentUser, actor: Actor) -> Evidence:
    """UI 전이 근거. source_type 은 user_input(기본) 또는 cm_action 을 받고, 없으면 역할로 채운다(ADR 0001 §5)."""
    data = req.evidence.model_dump() if req.evidence else {}
    data["source_type"] = data.get("source_type") or ("cm_action" if actor == Actor.CM else "user_input")
    data["source_id"] = data.get("source_id") or user.user_id
    if req.note:
        data["note"] = req.note if not data.get("note") else f"{data['note']} | {req.note}"
    extra = dict(data.get("extra") or {})
    extra.setdefault("via", "api")
    extra.setdefault("role", user.role)
    extra.setdefault("user_id", user.user_id)
    data["extra"] = extra
    return Evidence.model_validate(data)


def transition_object(session: Session, global_id: str, req: TransitionRequest, user: CurrentUser) -> TransitionResponse:
    try:
        actor = actor_for_role(user.role)
    except RoleNotAllowedError as exc:
        raise Forbidden(str(exc))
    if req.to_state == ObjectState.CONFIRMED and user.role != CONFIRM_ROLE:
        raise Forbidden("CONFIRMED requires role cm")
    row = session.get(BimObjectRow, global_id)
    if row is None:
        raise NotFound(f"object not found: {global_id}")
    from_state = ObjectState(row.state)
    evidence = _evidence_from_request(req, user, actor)
    sm = ObjectStateMachine()
    try:
        result = sm.transition_with_effects(session, global_id, req.to_state, actor, evidence, actor_id=user.user_id,
                                            confidence=req.confidence, review_request_id=req.review_request_id)
    except (InvalidTransitionError, TransitionBlockedByReviewError) as exc:
        session.rollback()
        raise Conflict(str(exc))
    t = result.transition
    if t.to_state == ObjectState.CONFIRMED:
        last_system = next((h for h in reversed(sm.history(session, global_id)) if h.actor == Actor.SYSTEM), None)
        scan_verdict = queries.latest_scan_verdict(session, global_id)
        record_expert_review(
            session, "object_state", global_id,
            proposal={"state": from_state.value, "system_state": last_system.to_state.value if last_system else None,
                      "system_confidence": last_system.confidence if last_system else None,
                      "scan_verdict": scan_verdict.model_dump(mode="json") if scan_verdict else None},
            final={"state": t.to_state.value, "transition_id": str(t.transition_id), "evidence": evidence.model_dump(mode="json")},
            reviewer=user.user_id,
        )
    session.commit()
    return TransitionResponse(**t.model_dump(), created_review_ids=list(result.created_review_ids),
                              closed_review_ids=list(result.closed_review_ids))


# ------------------------------------------------------------------ daily reports
def submit_daily_report(session: Session, project_id: str, payload: DailyReportCreate, user: CurrentUser,
                        photo_uris: list[str] | None = None) -> DailyReportResponse:
    items = [it.model_copy(update={"photo_uris": list(it.photo_uris) + list(photo_uris)}) if photo_uris else it
             for it in payload.items]
    report = DailyReport(report_id=f"dr-{uuid.uuid4().hex[:12]}", project_id=project_id, report_date=payload.report_date,
                         reporter_id=user.user_id, crew_count=payload.crew_count, equipment=dict(payload.equipment),
                         items=items, note=payload.note)
    outcome = ObjectStateMachine().apply_daily_report(session, report)
    session.commit()
    row = session.get(DailyReportRow, report.report_id)
    assert row is not None
    return DailyReportResponse(report_id=row.report_id, project_id=row.project_id, report_date=row.report_date,
                               reporter_id=row.reporter_id, crew_count=row.crew_count, equipment=row.equipment or {},
                               items=list(row.items or []), note=row.note, submitted_at=row.submitted_at,
                               transitions=outcome.transitions, review_requests=outcome.review_requests,
                               inspection_review_ids=list(outcome.inspection_review_ids), skipped=outcome.skipped)


# ------------------------------------------------------------------ mappings / drawings
def confirm_entity_mapping(session: Session, drawing_id: str, handle: str, global_id: str, user: CurrentUser,
                           note: str | None = None) -> EntityObjectMapping:
    if session.get(DrawingRow, drawing_id) is None:
        raise NotFound(f"drawing not found: {drawing_id}")
    if session.get(BimObjectRow, global_id) is None:
        raise NotFound(f"object not found: {global_id}")
    prev_row = queries.entity_mapping(session, drawing_id, handle)
    proposal: dict[str, Any] = (row_to_mapping(prev_row).model_dump(mode="json") if prev_row is not None
                                else {"drawing_id": drawing_id, "entity_handle": handle, "global_id": None, "confidence": None})
    new = confirm_mapping_row(session, drawing_id, handle, global_id, user.user_id, note)
    record_expert_review(session, "entity_object_mapping", f"{drawing_id}:{handle}", proposal, new.model_dump(mode="json"),
                         user.user_id)
    session.commit()
    return new


def realign_drawing(session: Session, drawing: DrawingRow, req: AlignmentRequest, user: CurrentUser) -> dict[str, Any]:
    job = JobRow(job_id=f"j-{uuid.uuid4().hex[:12]}", project_id=drawing.project_id, kind="mapping", status="running",
                 progress=0.1, file_id=drawing.file_id, result_ref=drawing.drawing_id)
    session.add(job)
    session.flush()
    previous_alignment = (drawing.alignment or {}).get("alignment")
    entities = jobs.drawing_entities(session, drawing.drawing_id)
    res = jobs.build_and_persist_mappings(session, job.job_id, drawing, entities, req.model_dump(mode="json"))
    job.status = "done" if res["status"] == "done" else "failed"
    job.progress, job.result, job.error = 1.0, res, (None if res["status"] == "done" else str(res.get("reason")))
    job.warnings = [{"code": "MAPPING_WARNING", "message": str(w), "context": {}} for w in res.get("warnings") or []]
    job.updated_at = datetime.now(UTC)
    record_expert_review(session, "drawing_alignment", drawing.drawing_id, proposal={"alignment": previous_alignment},
                         final={"alignment": req.model_dump(mode="json")}, reviewer=user.user_id)
    session.commit()
    return {"job_id": job.job_id, "drawing_id": drawing.drawing_id, **res}


def plan_section(session: Session, model: ModelRow, level: str | None, offset: float | None) -> PlanSectionView:
    objects: list[BimObjectDraft] = list(queries.as_models(queries.model_objects(session, model.model_id)))
    res = plan_section_from_objects(objects, level, offset)
    if res["elevation"] is None:
        raise NotFound(f"no objects with geometry for level {level!r} in model {model.model_id}")
    return PlanSectionView(level=res["level"], elevation=res["elevation"], offset=res["cut_elevation"] - res["elevation"],
                           cut_elevation=res["cut_elevation"], coordinate_system=CoordinateSystem.model_validate(model.coordinate_system),
                           polylines=[PlanSectionPolyline(global_id=p["global_id"], ifc_type=p.get("ifc_type"), points=p["points"],
                                                          closed=True) for p in res["polylines"]])


# ------------------------------------------------------------------ review requests
def resolve_review(session: Session, review_request_id: str, decision: str, note: str | None, user: CurrentUser) -> ReviewRequestRow:
    """cm 의 검토요청 처리. inspection → 상태기계 전이가 요청을 닫고, mapping → sync 가 닫는다. 그 외(verification/on_hold)는 상태만 갱신."""
    if user.role != CONFIRM_ROLE:
        raise Forbidden("review request resolution requires role cm")
    row = session.get(ReviewRequestRow, review_request_id)
    if row is None:
        raise NotFound(f"review request not found: {review_request_id}")
    if row.status != "open":
        raise Conflict(f"review request already {row.status}")
    before = db.review_row_to_model(row).model_dump(mode="json")
    evidence = Evidence(source_type="cm_action", source_id=user.user_id, method="review_resolution", note=note,
                        extra={"review_request_id": review_request_id, "review_kind": row.kind, "decision": decision,
                               "rule_id": row.rule_id})
    sm = ObjectStateMachine()
    if row.kind == "inspection" and row.global_id and decision in ("approved", "rejected"):
        target = ObjectState.CONFIRMED if decision == "approved" else ObjectState.IN_PROGRESS
        try:
            sm.transition_with_effects(session, row.global_id, target, Actor.CM, evidence, actor_id=user.user_id,
                                       review_request_id=review_request_id)   # 상태기계가 inspection 요청을 닫는다
        except InvalidTransitionError as exc:
            if decision == "approved":
                session.rollback()
                raise Conflict(f"cannot confirm object on approval: {exc}")
            log.info("inspection rejected but no rework transition: %s", exc)
    elif row.kind == "mapping" and decision in ("approved", "rejected"):
        resolve_mapping_review(session, row, decision, user.user_id, note)  # type: ignore[arg-type]
    session.refresh(row)
    if row.status == "open":   # verification / on_hold / 위에서 닫히지 않은 경우: 사람의 결정을 그대로 기록
        row.status, row.resolution_note, row.resolved_by, row.resolved_at = decision, note, user.user_id, datetime.now(UTC)
    elif note and not row.resolution_note:
        row.resolution_note = note
    session.flush()
    after = db.review_row_to_model(row).model_dump(mode="json")
    record_expert_review(session, "review_request", review_request_id, before, after, user.user_id)
    session.commit()
    session.refresh(row)
    return row


# ------------------------------------------------------------------ summary
def weekly_summary(session: Session, project_id: str) -> WeeklySummary:
    rows = queries.project_objects(session, project_id)
    by_level: dict[str, Counter[str]] = defaultdict(Counter)
    by_group: dict[str, Counter[str]] = defaultdict(Counter)
    dist: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for r in rows:
        level, group = r.level or "unknown", IFC_TYPE_GROUP.get(r.ifc_type, "other")
        by_level[level][r.state] += 1
        by_group[group][r.state] += 1
        dist[(level, group)][r.state] += 1
    since, now = queries.week_window()
    confirmed = queries.confirmed_since(session, [r.global_id for r in rows], since)
    open_reviews = db.open_reviews(session, project_id=project_id)
    by_kind = Counter(r.kind for r in open_reviews)
    startable_set = compute_startable(session, project_id)
    names = {a.activity_id: a.name for a in queries.project_activities(session, project_id)}
    startable: list[StartableActivityView] = []
    for aid in startable_set.startable:
        score = compute_readiness(session, aid)
        startable.append(StartableActivityView(activity_id=aid, name=names.get(aid), readiness=score.score,
                                               confidence=score.confidence, evidence=score.evidence, blockers=score.blockers))
    return WeeklySummary(
        project_id=project_id, week_start=since.date().isoformat(), week_end=now.date().isoformat(),
        state_distribution=[StateDistributionRow(level=lv, group=g, counts={ObjectState(s): n for s, n in c.items()},
                                                 total=sum(c.values())) for (lv, g), c in sorted(dist.items())],
        confirmed_this_week=confirmed, open_reviews=len(open_reviews), open_reviews_by_kind=dict(by_kind), startable=startable,
        state_counts_by_level={lv: dict(c) for lv, c in by_level.items()},
        state_counts_by_group={g: dict(c) for g, c in by_group.items()},
        open_review_requests=len(open_reviews),
        estimated_done_count=sum(1 for r in rows if r.state == ObjectState.ESTIMATED_DONE.value),
        object_total=len(rows), startable_set=startable_set,
        extra={"blocked_count": len(startable_set.blocked), "solver_status": startable_set.solver_status},
    )


# ------------------------------------------------------------------ rules
@lru_cache(maxsize=1)
def _rule_engine() -> RuleEngine:
    return RuleEngine(load_rules())


def list_rules() -> list[Rule]:
    return list(_rule_engine().rules)


def evaluate_rules(session: Session, project_id: str, global_id: str, persist: bool = True) -> RuleEvaluateResponse:
    row = session.get(BimObjectRow, global_id)
    if row is None or row.project_id != project_id:
        raise NotFound(f"object not found in project: {global_id}")
    scan = queries.latest_scan_verdict(session, global_id)
    item = queries.latest_report_item(session, project_id, global_id)
    logic = build_logic_context(session, global_id, quantity_unit=item.quantity_unit if item else None)
    activity: dict[str, Any] | None = None
    readiness = None
    if logic.get("activity_ids"):
        arow = db.load_activity(session, logic["activity_ids"][0])
        if arow is not None:
            activity = db.activity_row_to_model(arow).model_dump(mode="json")
            readiness = compute_readiness(session, arow.activity_id)
    context = {"scan": scan, "object": queries.object_summary(row), "activity": activity, "readiness": readiness,
               "report": item.model_dump(mode="json") if item else None, "logic": logic}
    engine = _rule_engine()
    verdicts = engine.evaluate(context, scope={"ifc_type": row.ifc_type})
    if persist and verdicts:
        persist_verdicts(session, project_id, verdicts)
        session.commit()
    summary = {"scan": {"state": scan.state.value, "confidence": scan.confidence, "scan_id": scan.scan_id} if scan else None,
               "object": context["object"], "report": context["report"], "activity_id": activity["activity_id"] if activity else None,
               "readiness": readiness.score if readiness else None, "logic": logic}
    return RuleEvaluateResponse(project_id=project_id, global_id=global_id, verdicts=verdicts, context=summary,
                                rules_evaluated=len(engine.rules))
