"""착수 가능 집합 — OR-Tools CP-SAT (없으면 순수 파이썬 greedy 폴백).

변수: 아직 착수하지 않은 Activity 마다 bool. 제약: FS 선행 완료(lag 경과), SS 선행 착수, Readiness ≥ 임계값,
config/resources.yaml 자원 한도. 목적: 착수 작업 수 최대화(동률이면 planned_start 빠른 순).
만회 시나리오는 Deferred(ADR 0003) — 인터페이스만 둔다.
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityRow
from packages.core.models.progress import Blocker, StartableSet
from packages.core.models.state import ObjectState

from . import persistence as db
from .config_loader import load_readiness_config, load_resources_config
from .readiness import ActivityProgress, activity_progress, compute_readiness

log = logging.getLogger(__name__)
RESOURCE_INT_SCALE = 1000   # CP-SAT 정수 계수 변환용(소수 자원량 × 1000). 가중치·임계값 아님


def _ordering_key(row: ActivityRow) -> tuple[int, str, str]:
    return (0 if row.planned_start else 1, row.planned_start or "", row.activity_id)


def _lag_elapsed(session: Session, pred: ActivityProgress, lag_days: float, now: datetime) -> bool:
    if lag_days <= 0:
        return True
    confirmed_at = db.latest_transition_to(session, pred.global_ids, ObjectState.CONFIRMED)
    if confirmed_at is None:
        return True   # 확정 시각 기록이 없으면 lag 를 판정할 수 없어 통과시킨다(evidence 에 남김)
    if confirmed_at.tzinfo is None:
        confirmed_at = confirmed_at.replace(tzinfo=UTC)
    return now >= confirmed_at + timedelta(days=lag_days)


def _solve_cpsat(candidates: list[ActivityRow], caps: dict[str, float], time_limit: float) -> tuple[list[str], str] | None:
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return None
    model = cp_model.CpModel()
    x = {a.activity_id: model.new_bool_var(a.activity_id) for a in candidates}
    for resource, cap in caps.items():
        terms = [(int(round(float((a.resources or {}).get(resource, 0.0)) * RESOURCE_INT_SCALE)), x[a.activity_id]) for a in candidates]
        if any(coef for coef, _ in terms):
            model.add(sum(coef * var for coef, var in terms) <= int(round(float(cap) * RESOURCE_INT_SCALE)))
    n = len(candidates)
    count_weight = n * n + 1   # 어떤 우선순위 합(≤ n(n+1)/2)보다 크게 → 개수 최대화가 항상 우선
    ordered = sorted(candidates, key=_ordering_key)
    priority = {a.activity_id: n - rank for rank, a in enumerate(ordered)}
    model.maximize(sum((count_weight + priority[a.activity_id]) * x[a.activity_id] for a in candidates))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return [], solver.status_name(status)
    return [a.activity_id for a in ordered if solver.value(x[a.activity_id])], solver.status_name(status)


def _solve_greedy(candidates: list[ActivityRow], caps: dict[str, float]) -> list[str]:
    used: dict[str, float] = dict.fromkeys(caps, 0.0)
    chosen: list[str] = []
    for a in sorted(candidates, key=_ordering_key):
        need = {r: float((a.resources or {}).get(r, 0.0)) for r in caps}
        if all(used[r] + need[r] <= float(caps[r]) for r in caps):
            chosen.append(a.activity_id)
            for r in caps:
                used[r] += need[r]
    return chosen


def compute_startable(session: Session, project_id: str, threshold: float | None = None, use_solver: bool = True,
                      now: datetime | None = None) -> StartableSet:
    readiness_cfg = load_readiness_config()
    resources_cfg = load_resources_config()
    threshold = float(readiness_cfg["start_threshold"]) if threshold is None else float(threshold)
    caps = {k: float(v) for k, v in (resources_cfg.get("caps") or {}).items()}
    time_limit = float(resources_cfg.get("solver_time_limit_seconds", readiness_cfg.get("solver_time_limit_seconds", 10)))
    now = now or datetime.now(UTC)

    activities = db.load_activities(session, project_id)
    relations = db.load_relations(session, project_id)
    progress = {a.activity_id: activity_progress(session, a.activity_id, a) for a in activities}
    blocked: dict[str, list[Blocker]] = {}
    readiness_scores: dict[str, float] = {}
    feasible: list[ActivityRow] = []

    for a in activities:
        own = progress[a.activity_id]
        if own.started or own.complete:
            continue
        blockers: list[Blocker] = []
        for rel in (r for r in relations if r.successor_id == a.activity_id):
            pred = progress.get(rel.predecessor_id) or activity_progress(session, rel.predecessor_id)
            if rel.type == "FS":
                if not pred.complete:
                    blockers.append(Blocker(component="predecessor", severity="high",
                                            reason=f"FS predecessor {rel.predecessor_id} not complete (objects not all CONFIRMED)",
                                            related_ids=[rel.predecessor_id]))
                elif not _lag_elapsed(session, pred, rel.lag_days or 0.0, now):
                    blockers.append(Blocker(component="predecessor", severity="medium", related_ids=[rel.predecessor_id],
                                            reason=f"FS lag of {rel.lag_days:g} day(s) after {rel.predecessor_id} not elapsed"))
            elif rel.type == "SS" and not pred.started:
                blockers.append(Blocker(component="predecessor", severity="high", related_ids=[rel.predecessor_id],
                                        reason=f"SS predecessor {rel.predecessor_id} not started"))
            # FF / SF 는 착수 시점을 제약하지 않는다
        score = compute_readiness(session, a.activity_id)
        readiness_scores[a.activity_id] = score.score
        if score.score < threshold:
            blockers.append(Blocker(component="readiness", severity="medium", related_ids=[b.component for b in score.blockers],
                                    reason=f"readiness {score.score:.2f} < threshold {threshold:.2f}"))
            blockers.extend(score.blockers)
        if blockers:
            blocked[a.activity_id] = blockers
        else:
            feasible.append(a)

    solver_status = "no_candidates"
    chosen: list[str] = []
    method = "none"
    if feasible:
        result = _solve_cpsat(feasible, caps, time_limit) if use_solver else None
        if result is None:
            chosen, solver_status, method = _solve_greedy(feasible, caps), "greedy_fallback", "greedy"
        else:
            chosen, solver_status = result
            method = "cp_sat"
        for a in feasible:
            if a.activity_id not in chosen:
                blocked[a.activity_id] = [Blocker(component="resource", severity="low", related_ids=chosen,
                                                  reason="resource cap reached by higher-priority activities "
                                                         f"(caps={caps})")]
    evidence = Evidence(source_type="system_logic", source_id=project_id, method=method,
                        extra={"threshold": threshold, "caps": caps, "readiness": readiness_scores,
                               "candidates": [a.activity_id for a in feasible], "computed_at": now.isoformat()})
    return StartableSet(project_id=project_id, startable=chosen, blocked=blocked, threshold=threshold,
                        solver_status=solver_status, evidence=evidence)


def recovery_scenarios(session: Session, project_id: str) -> list[dict]:
    """만회 시나리오 — Deferred(ADR 0003). 인터페이스만 둔다."""
    raise NotImplementedError("recovery scenarios are deferred (ADR 0003)")


def _today() -> date:
    return datetime.now(UTC).date()
