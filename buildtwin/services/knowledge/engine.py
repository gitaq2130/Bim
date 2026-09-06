"""규칙 엔진 — 컨텍스트에 규칙을 적용해 `RuleVerdict[]`를 낸다. 객체 상태는 바꾸지 않는다(progress-engine 소관)."""
from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.knowledge import Rule, RuleVerdict
from packages.core.models.orm import RuleVerdictRow
from services.common.safe_expr import ExpressionEvalError, UnsafeExpressionError, evaluate, referenced_names
from services.knowledge.loader import load_rules

__all__ = ["RuleEngine", "persist_verdicts", "CONTEXT_NAMES"]

log = logging.getLogger(__name__)

# 규칙 조건식이 참조할 수 있는 최상위 이름. 컨텍스트에 없으면 None으로 채운다.
CONTEXT_NAMES: tuple[str, ...] = ("scan", "object", "activity", "readiness", "report", "logic")


def _get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, Mapping):
        return obj.get(key)
    return getattr(obj, key, None)


def _as_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v[:19]).date() if len(v) > 10 else date.fromisoformat(v)
        except ValueError:
            return None
    return None


def _normalize_context(context: Mapping[str, Any]) -> dict[str, Any]:
    """알려진 이름을 모두 채우고, `logic.days_until_planned_start`를 파생한다(없을 때만)."""
    ctx: dict[str, Any] = dict(context)
    for name in CONTEXT_NAMES:
        ctx.setdefault(name, None)

    logic = ctx.get("logic")
    if logic is None or isinstance(logic, Mapping):
        logic = dict(logic or {})
        if "days_until_planned_start" not in logic:
            start = _as_date(_get(ctx.get("activity"), "planned_start"))
            today = _as_date(ctx.get("today")) or date.today()
            if start is not None:
                logic["days_until_planned_start"] = (start - today).days
        ctx["logic"] = logic
    return ctx


def _scope_matches(rule: Rule, scope: Mapping[str, Any] | None) -> bool:
    if not scope:
        return True
    discipline = scope.get("discipline")
    if discipline and rule.scope.discipline and rule.scope.discipline != discipline:
        return False
    types = scope.get("object_types") or scope.get("ifc_type")
    if types and rule.scope.object_types:
        wanted = {types} if isinstance(types, str) else set(types)
        if not wanted & set(rule.scope.object_types):
            return False
    return True


def _input_confidence(ctx: Mapping[str, Any], names: Iterable[str]) -> float:
    """참조한 입력 중 confidence를 가진 것들의 최소값. 없으면 1.0. (scan만 참조하면 scan.confidence)"""
    conf = 1.0
    for n in names:
        c = _get(ctx.get(n), "confidence")
        if isinstance(c, (int, float)) and not isinstance(c, bool):
            conf = min(conf, max(0.0, min(1.0, float(c))))
    return conf


def _input_sources(ctx: Mapping[str, Any], names: Iterable[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in names:
        ev = _get(ctx.get(n), "evidence")
        if ev is None:
            continue
        st, sid = _get(ev, "source_type"), _get(ev, "source_id")
        if st and sid:
            entry: dict[str, Any] = {"input": n, "source_type": st, "source_id": sid}
            uri = _get(ev, "file_uri")
            if uri:
                entry["file_uri"] = uri
            out.append(entry)
    return out


class RuleEngine:
    """규칙 목록을 들고 컨텍스트를 평가한다.

    context 키: scan(ScanVerdict|dict), object(dict: global_id, ifc_type, level, state…), activity,
    readiness(ReadinessScore|dict), report(dict: claimed_state, quantity…), logic(dict), today(date, 선택).
    """

    def __init__(self, rules: list[Rule] | None = None, rules_dir: str | None = None) -> None:
        self.rules: list[Rule] = list(rules) if rules is not None else load_rules(rules_dir)
        self._names: dict[str, list[str]] = {r.id: referenced_names(r.when) for r in self.rules}

    def evaluate(self, context: Mapping[str, Any], scope: Mapping[str, Any] | None = None) -> list[RuleVerdict]:
        ctx = _normalize_context(context)
        global_id = _get(ctx.get("scan"), "global_id") or _get(ctx.get("object"), "global_id")
        activity_id = _get(ctx.get("activity"), "activity_id") or _get(ctx.get("readiness"), "activity_id")
        verdicts: list[RuleVerdict] = []
        for rule in self.rules:
            if not _scope_matches(rule, scope):
                continue
            try:
                matched = bool(evaluate(rule.when, ctx))
            except ExpressionEvalError as e:
                # 값 부재(None 비교 등)는 "미충족"으로 본다.
                log.debug("rule %s not evaluable: %s", rule.id, e)
                continue
            except UnsafeExpressionError as e:
                log.warning("rule %s skipped (unsafe expression): %s", rule.id, e)
                continue
            if not matched:
                continue
            names = self._names[rule.id]
            confidence = round(rule.reliability * _input_confidence(ctx, names), 6)
            evidence = Evidence(
                source_type="rule",
                source_id=rule.id,
                rule_id=rule.id,
                method="rule_engine",
                note=rule.description,
                extra={
                    "rule_version": rule.version,
                    "rule_source": rule.source,
                    "rule_source_ref": rule.source_ref,
                    "expression": rule.when,
                    "matched_inputs": names,
                    "input_sources": _input_sources(ctx, names),
                },
            )
            verdicts.append(
                RuleVerdict(
                    rule_id=rule.id,
                    rule_version=rule.version,
                    global_id=global_id,
                    activity_id=activity_id,
                    risk_level=rule.then.risk_level,
                    action=rule.then.action,
                    required_evidence=list(rule.then.required_evidence),
                    confidence=confidence,
                    evidence=evidence,
                )
            )
        return verdicts


def persist_verdicts(session: Session, project_id: str, verdicts: Iterable[RuleVerdict]) -> list[RuleVerdictRow]:
    """RuleVerdict → rule_verdicts 테이블. flush까지만 하고 commit은 호출자 몫."""
    rows = [
        RuleVerdictRow(
            project_id=project_id,
            rule_id=v.rule_id,
            rule_version=v.rule_version,
            global_id=v.global_id,
            activity_id=v.activity_id,
            risk_level=v.risk_level.value,
            action=v.action,
            required_evidence=list(v.required_evidence),
            confidence=v.confidence,
            evidence=v.evidence.model_dump(mode="json"),
        )
        for v in verdicts
    ]
    session.add_all(rows)
    session.flush()
    return rows
