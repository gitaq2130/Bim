"""Work Readiness Score. 가중치·임계값·기본값은 config/readiness.yaml 에서만 읽는다.

구성요소 정의:
- predecessor_completion: 선행 Activity 중 "매핑 객체가 전부 CONFIRMED"(객체가 없으면 percent_complete 만점)인 비율.
  ESTIMATED_DONE 까지 포함한 비율은 estimated_completion 으로 따로 보고한다.
- inspection: 선행 Activity 객체 중 검측 대기(INSPECTION_REQUESTED) 또는 미결 inspection 검토요청이 없는 비율.
- material_delivery: 반입량 / 필요량(resources.material_required). 필요량이 없으면 config 기본값, 자재 기록이 전혀 없으면
  기본값 + 결측 처리(confidence 감점).
- drawing_approval: 우선순위 사다리(ADR 0007 §5-2) — ① 확정(needs_review=False) 매핑된 필수 문서(TFA 등)가
  있으면 전부 승인일 때만 1.0(논리곱, 비율 아님), ② 없으면 resources.drawing_approved 플래그(기존 동작),
  ③ 둘 다 없으면 config component_defaults.drawing_approval_unknown(결측). document_approval.enabled=false 면
  ①을 건너뛴다.
- open_clashes: 이 Activity 객체 중 미결 verification 검토요청이 없는 비율.
- crew_assigned: resources.crew > 0 이면 1.0, 아니면 0.0 (키가 없으면 결측).
confidence = 1 - 결측 구성요소 비율.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityRow, DocumentRow
from packages.core.models.progress import Blocker, ReadinessScore
from packages.core.models.state import ObjectState

from . import persistence as db
from .config_loader import load_readiness_config
from .document_mapper import confirmed_required_documents

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
    kind: str | None = None   # Blocker.kind 로 전달되는 기계 판독 갈래(ADR 0007 §5-3)


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
    awaiting.update(r.global_id for r in db.open_reviews(session, project_id, gids, kind="inspection") if r.global_id)
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


def _drawing_component_legacy(resources: dict[str, float], defaults: dict[str, float]) -> ComponentResult:
    """순위 2·3 (ADR 0007 §5-2) — 문서 근거가 없을 때의 기존 동작. 그대로 보존한다(하위 호환의 핵심)."""
    flag = resources.get("drawing_approved")
    if flag is None:
        return ComponentResult(float(defaults["drawing_approval_unknown"]), missing=True, reason="drawing approval unknown",
                               note="resources.drawing_approved absent")
    if float(flag) >= 1.0:
        return ComponentResult(1.0)
    return ComponentResult(0.0, reason="drawing not approved")


BLOCKER_KIND_UNAPPROVED = "document_unapproved"          # 미승인 문서가 있다 → 그 문서를 쫓는다
BLOCKER_KIND_STATUS_UNKNOWN = "document_status_unknown"  # 처리결과 미기재 → 대장을 갱신한다
BLOCKER_KIND_MAPPING_PENDING = "document_mapping_pending"  # 미확정 매핑만 → 매핑을 확정한다


def _unapproved_reason(unapproved: list[DocumentRow], limit: int) -> tuple[str, str]:
    """(문구, 갈래)를 돌려준다. case① "n건의 필수 문서가 미승인: ..." / case③ UNKNOWN 전용(ADR 0007 §5-3).

    갈래를 문구와 함께 내보내는 이유: 셋은 CM 이 해야 할 행동이 다르므로(문서를 쫓는다 / 매핑을 확정한다 /
    대장을 갱신한다) 화면이 반드시 구분해야 하는데, 산문을 부분 문자열로 분류하면 문구를 다듬는 순간
    조용히 깨진다.
    """
    all_unknown = all(d.approval_status == "UNKNOWN" for d in unapproved)
    shown = unapproved[:limit]
    frags = []
    for d in shown:
        label = f"{d.doc_number or d.doc_id} «{d.title}»"
        frags.append(f"{label} 처리결과 미기재(UNKNOWN)" if all_unknown else f"{label} ({d.approval_status})")
    overflow = len(unapproved) - len(shown)
    joined = "; ".join(frags) + (f" 외 {overflow}건" if overflow > 0 else "")
    if all_unknown:
        return joined, BLOCKER_KIND_STATUS_UNKNOWN
    return f"{len(unapproved)}건의 필수 문서가 미승인: {joined}", BLOCKER_KIND_UNAPPROVED


def drawing_component(session: Session, project_id: str, activity_id: str, resources: dict[str, float],
                      defaults: dict[str, float], doc_cfg: dict[str, Any]) -> tuple[ComponentResult, dict[str, Any]]:
    """ADR 0007 §5. 값 산출은 논리곱(AND) — 필수 문서 전부 승인 -> 1.0, 하나라도 아니면 0.0. 비율은 점수가
    아니라 note/blocker 로만 보고한다. 두 번째 튜플 항목은 ReadinessScore.evidence.extra 에 병합할 값
    (예: manual_flag_overridden) — Blocker·ComponentResult 모델은 바꾸지 않는다.
    """
    extra: dict[str, Any] = {}
    if not doc_cfg.get("enabled", True):
        return _drawing_component_legacy(resources, defaults), extra   # 킬 스위치: 순위 1을 완전히 건너뛴다

    evidence = confirmed_required_documents(session, project_id, [activity_id], doc_cfg)
    limit = int(doc_cfg.get("blocker_document_limit", 5))

    if evidence.confirmed_required:   # 순위 1: 문서 근거
        approved_statuses = set(doc_cfg.get("approved_statuses", ["APPROVED"]))
        total = len(evidence.confirmed_required)
        approved = [d for d in evidence.confirmed_required if d.approval_status in approved_statuses]
        unapproved = [d for d in evidence.confirmed_required if d.approval_status not in approved_statuses]
        value = 1.0 if not unapproved else 0.0
        note = f"approved={len(approved)}/{total}; pending_mappings={evidence.pending_count}"
        reason, kind = _unapproved_reason(unapproved, limit) if unapproved else (None, None)
        if unapproved:
            flag = resources.get("drawing_approved")   # 규칙: 문서 근거가 수동 플래그를 이긴다. 충돌은 조용히 무시하지 않는다
            if flag is not None and float(flag) >= 1.0:
                extra["manual_flag_overridden"] = True
        result = ComponentResult(value, missing=evidence.pending_count > 0, reason=reason,
                                 related_ids=[d.doc_id for d in unapproved], note=note, kind=kind)
        return result, extra

    legacy = _drawing_component_legacy(resources, defaults)
    if evidence.pending_count > 0:   # 순위 1 후보는 없지만 미확정 매핑은 있다 — "아직 모른다"를 confidence 에 반영
        pending_reason = (f"문서 매핑 {evidence.pending_count}건이 CM 검토 대기 — "
                          "확정 전까지 도면 승인 근거로 쓰지 않음")
        result = ComponentResult(legacy.value, missing=True,
                                 reason=pending_reason if legacy.value < 1.0 else None,
                                 related_ids=[m.doc_id for m in db.document_mappings_for_activity(session, project_id, activity_id)
                                              if m.needs_review],
                                 note=f"approved=0/0; pending_mappings={evidence.pending_count}",
                                 kind=BLOCKER_KIND_MAPPING_PENDING if legacy.value < 1.0 else None)
        return result, extra
    return legacy, extra   # 순위 2·3: 완전히 기존 동작


def clashes_component(session: Session, project_id: str, global_ids: list[str]) -> ComponentResult:
    if not global_ids:
        return ComponentResult(1.0, note="no mapped objects")
    reviews = db.open_reviews(session, project_id, global_ids, kind="verification")
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
    drawing_result, drawing_extra = drawing_component(session, project_id, activity_id, resources, defaults,
                                                       cfg.get("document_approval", {}))
    results: dict[str, ComponentResult] = {
        "predecessor_completion": pred,
        "inspection": inspection_component(session, project_id, pred_progress),
        "material_delivery": material_component(session, project_id, [activity_id], own.global_ids,
                                                 resources.get("material_required"), defaults),
        "drawing_approval": drawing_result,
        "open_clashes": clashes_component(session, project_id, own.global_ids),
        "crew_assigned": crew_component(resources),
    }
    total_weight = sum(float(weights.get(c, 0.0)) for c in results)
    score = sum(float(weights.get(c, 0.0)) * r.value for c, r in results.items()) / total_weight if total_weight else 0.0
    blockers = [
        Blocker(component=c, reason=r.reason or f"{c} below 1.0", related_ids=r.related_ids,
                severity=_severity(r.value, severity_cfg), kind=r.kind)   # type: ignore[arg-type]
        for c, r in results.items() if r.value < 1.0
    ]
    missing = [c for c, r in results.items() if r.missing]
    evidence_extra: dict[str, Any] = {"predecessors": [p.activity_id for p in pred_progress], "mapped_objects": own.global_ids,
                                      "missing_components": missing,
                                      "weights_source": "override" if weights is not cfg["weights"] else "config"}
    evidence_extra.update(drawing_extra)   # 예: manual_flag_overridden=True — 조용히 무시하지 않는다
    evidence = Evidence(
        source_type="system_logic", source_id=activity_id, method="readiness_weighted_sum",
        note="; ".join(f"{c}: {r.note}" for c, r in results.items() if r.note) or None,
        extra=evidence_extra,
    )
    return ReadinessScore(activity_id=activity_id, score=max(0.0, min(1.0, score)),
                          components={c: r.value for c, r in results.items()}, weights=weights, blockers=blockers,
                          confidence=1.0 - len(missing) / len(results), evidence=evidence, estimated_completion=estimated)
