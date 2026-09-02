"""Work Readiness Score. 가중치·임계값·기본값은 config/readiness.yaml 에서만 읽는다.

구성요소 정의:
- predecessor_completion: 선행 Activity 중 "매핑 객체가 전부 CONFIRMED"(객체가 없으면 percent_complete 만점)인 비율.
  ESTIMATED_DONE 까지 포함한 비율은 estimated_completion 으로 따로 보고한다.
- inspection: 선행 Activity 객체 중 검측 대기(INSPECTION_REQUESTED) 또는 미결 inspection 검토요청이 없는 비율.
- material_delivery: 반입량 / 필요량(resources.material_required). 필요량이 없으면 config 기본값, 자재 기록이 전혀 없으면
  기본값 + 결측 처리(confidence 감점).
- drawing_approval: resources.drawing_approved == 1 이면 1.0, 그 외 config component_defaults.drawing_approval_unknown(결측).
- open_clashes: 이 Activity 객체 중 미결 verification 검토요청이 없는 비율.
- crew_assigned: resources.crew > 0 이면 1.0, 아니면 0.0 (키가 없으면 결측).
confidence = 1 - 결측 구성요소 비율.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityRow
from packages.core.models.progress import Blocker, ReadinessScore
from packages.core.models.state import ObjectState

from . import persistence as db
from .config_loader import load_readiness_config

PERCENT_COMPLETE_DONE = 100.0   # 퍼센트 만점(단위 정의). 임계값 아님
COMPONENT_NAMES: tuple[str, ...] = ("predecessor_completion", "inspection", "material_delivery", "drawing_approval",
                                    "open_clashes", "crew_assigned")
DONE_STATES = frozenset({ObjectState.CONFIRMED})
ESTIMATED_STATES = frozenset({ObjectState.CONFIRMED, ObjectState.ESTIMATED_DONE})


@dataclass
class ActivityProgress:
    activity_id: str
    global_ids: list[str]
    states: dict[str, ObjectState]
    percent_complete: float
    complete: bool
    estimated_complete: bool
    started: bool


def activity_progress(session: Session, project_id: str, activity_id: str, row: ActivityRow | None = None) -> ActivityProgress:
    row = row or db.load_activity(session, activity_id)
    pct = float(row.percent_complete or 0.0) if row is not None else 0.0
    gids = db.mapped_global_ids(session, project_id, activity_id)
    states = db.object_states(session, project_id, gids)
    if states:
        complete = all(s in DONE_STATES for s in states.values())
        estimated = all(s in ESTIMATED_STATES for s in states.values())
        started = pct > 0.0 or any(s != ObjectState.PLANNED for s in states.values())
    else:
        complete = estimated = pct >= PERCENT_COMPLETE_DONE
        started = pct > 0.0
    return ActivityProgress(activity_id, gids, states, pct, complete, estimated, started)


@dataclass
class ComponentResult:
    value: float
    missing: bool = False
    reason: str | None = None
    related_ids: list[str] = field(default_factory=list)
    note: str | None = None


def predecessor_completion(session: Session, project_id: str, activity_id: str) -> tuple[ComponentResult, float, list[ActivityProgress]]:
    preds = db.predecessors_of(session, activity_id)
    if not preds:
        return ComponentResult(1.0, note="no predecessors"), 1.0, []
    progress = [activity_progress(session, project_id, p.predecessor_id) for p in preds]
    done = sum(1 for p in progress if p.complete)
    estimated = sum(1 for p in progress if p.estimated_complete)
    ratio = done / len(progress)
    pending = [p.activity_id for p in progress if not p.complete]
    reason = f"{len(pending)}/{len(progress)} predecessor activities not CONFIRMED" if pending else None
    return ComponentResult(ratio, reason=reason, related_ids=pending), estimated / len(progress), progress


def inspection_component(session: Session, project_id: str, predecessor_progress: list[ActivityProgress]) -> ComponentResult:
    gids = sorted({g for p in predecessor_progress for g in p.global_ids})
    if not gids:
        return ComponentResult(1.0, note="no predecessor objects")
    states = db.object_states(session, project_id, gids)
    awaiting = {g for g, s in states.items() if s == ObjectState.INSPECTION_REQUESTED}
    awaiting.update(r.global_id for r in db.open_reviews(session, gids, kind="inspection", project_id=project_id) if r.global_id)
    value = 1.0 - len(awaiting) / len(gids)
    reason = f"{len(awaiting)} predecessor objects awaiting inspection" if awaiting else None
    return ComponentResult(value, reason=reason, related_ids=sorted(awaiting))


def material_component(session: Session, project_id: str, activity_ids: list[str], global_ids: list[str],
                       required: float | None, defaults: dict[str, float]) -> ComponentResult:
    total_in, total_out, count = db.material_totals(session, project_id, activity_ids, global_ids)
    if count == 0 and required is None:
        return ComponentResult(float(defaults["material_unknown"]), missing=True, note="no material data")
    if required is not None and required > 0:
        ratio = min(1.0, total_in / required)
        reason = f"delivered {total_in:g}/{required:g}" if ratio < 1.0 else None
        return ComponentResult(ratio, reason=reason, related_ids=list(activity_ids), note=f"in={total_in:g} out={total_out:g}")
    value = float(defaults["material_required_unknown_delivered"]) if total_in > 0 else 0.0
    reason = None if value >= 1.0 else "material recorded but nothing delivered"
    return ComponentResult(value, reason=reason, related_ids=list(activity_ids), note="required quantity unknown")


def drawing_component(resources: dict[str, float], defaults: dict[str, float]) -> ComponentResult:
    flag = resources.get("drawing_approved")
    if flag is None:
        return ComponentResult(float(defaults["drawing_approval_unknown"]), missing=True, reason="drawing approval unknown",
                               note="resources.drawing_approved absent")
    if float(flag) >= 1.0:
        return ComponentResult(1.0)
    return ComponentResult(0.0, reason="drawing not approved")


def clashes_component(session: Session, project_id: str, global_ids: list[str]) -> ComponentResult:
    if not global_ids:
        return ComponentResult(1.0, note="no mapped objects")
    reviews = db.open_reviews(session, global_ids, kind="verification", project_id=project_id)
    flagged = sorted({r.global_id for r in reviews if r.global_id})
    value = 1.0 - len(flagged) / len(global_ids)
    reason = f"{len(reviews)} open verification review(s)" if reviews else None
    return ComponentResult(value, reason=reason, related_ids=[r.review_request_id for r in reviews])


def crew_component(resources: dict[str, float]) -> ComponentResult:
    crew = resources.get("crew")
    if crew is None:
        return ComponentResult(0.0, missing=True, reason="crew not assigned (unknown)")
    return ComponentResult(1.0) if float(crew) > 0 else ComponentResult(0.0, reason="crew count is 0")


def _severity(value: float, cfg: dict[str, float]) -> str:
    if value < float(cfg["high_below"]):
        return "high"
    if value < float(cfg["medium_below"]):
        return "medium"
    return "low"


def compute_readiness(session: Session, activity_id: str, weights: dict[str, float] | None = None) -> ReadinessScore:
    """시그니처는 그대로. project_id 는 ActivityRow 에서 유도한다(ADR 0005 규칙 1)."""
    cfg = load_readiness_config()
    weights = dict(weights or cfg["weights"])
    defaults = cfg["component_defaults"]
    severity_cfg = cfg["blocker_severity"]
    row = db.load_activity(session, activity_id)
    if row is None:
        raise LookupError(f"activity not found: {activity_id}")
    project_id = row.project_id
    resources = dict(row.resources or {})
    own = activity_progress(session, project_id, activity_id, row)

    pred, estimated, pred_progress = predecessor_completion(session, project_id, activity_id)
    results: dict[str, ComponentResult] = {
        "predecessor_completion": pred,
        "inspection": inspection_component(session, project_id, pred_progress),
        "material_delivery": material_component(session, project_id, [activity_id], own.global_ids,
                                                 resources.get("material_required"), defaults),
        "drawing_approval": drawing_component(resources, defaults),
        "open_clashes": clashes_component(session, project_id, own.global_ids),
        "crew_assigned": crew_component(resources),
    }
    total_weight = sum(float(weights.get(c, 0.0)) for c in results)
    score = sum(float(weights.get(c, 0.0)) * r.value for c, r in results.items()) / total_weight if total_weight else 0.0
    blockers = [
        Blocker(component=c, reason=r.reason or f"{c} below 1.0", related_ids=r.related_ids,
                severity=_severity(r.value, severity_cfg))   # type: ignore[arg-type]
        for c, r in results.items() if r.value < 1.0
    ]
    missing = [c for c, r in results.items() if r.missing]
    evidence = Evidence(
        source_type="system_logic", source_id=activity_id, method="readiness_weighted_sum",
        note="; ".join(f"{c}: {r.note}" for c, r in results.items() if r.note) or None,
        extra={"predecessors": [p.activity_id for p in pred_progress], "mapped_objects": own.global_ids,
               "missing_components": missing, "weights_source": "override" if weights is not cfg["weights"] else "config"},
    )
    return ReadinessScore(activity_id=activity_id, score=max(0.0, min(1.0, score)),
                          components={c: r.value for c, r in results.items()}, weights=weights, blockers=blockers,
                          confidence=1.0 - len(missing) / len(results), evidence=evidence, estimated_completion=estimated)
