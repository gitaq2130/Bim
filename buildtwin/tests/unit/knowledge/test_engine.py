from __future__ import annotations

from datetime import date

from sqlalchemy import select

from packages.core.models.knowledge import RiskLevel, Rule, RuleScope, RuleThen, RuleVerdict
from packages.core.models.orm import RuleVerdictRow
from services.knowledge import RuleEngine, persist_verdicts


def _rule(id_: str, when: str, level: str = "HIGH", reliability: float = 0.85, **scope) -> Rule:
    return Rule(
        id=id_, source="expert", reliability=reliability, scope=RuleScope(**scope), when=when,
        then=RuleThen(risk_level=RiskLevel(level), action="act", required_evidence=["survey_report"]),
    )


def test_mismatch_scan_verdict_confidence_and_evidence(mismatch_scan, column_object):
    engine = RuleEngine()  # rules/risk/*.yaml
    verdicts = engine.evaluate({"scan": mismatch_scan, "object": column_object}, scope={"discipline": "structure", "object_types": ["IfcColumn"]})
    by_id = {v.rule_id: v for v in verdicts}
    assert "RULE-STR-001" in by_id
    v = by_id["RULE-STR-001"]
    assert isinstance(v, RuleVerdict)
    assert v.risk_level is RiskLevel.HIGH
    assert v.global_id == mismatch_scan.global_id
    assert v.confidence == round(0.85 * 0.8, 6)     # reliability × scan.confidence
    assert v.required_evidence == ["survey_report", "structural_review"]
    ev = v.evidence
    assert ev.source_type == "rule" and ev.source_id == "RULE-STR-001" and ev.rule_id == "RULE-STR-001"
    assert ev.method == "rule_engine"
    assert ev.extra["matched_inputs"] == ["scan"]
    assert ev.extra["input_sources"] == [
        {"input": "scan", "source_type": "scan", "source_id": "scan-001", "file_uri": "s3://buildtwin/scans/scan-001.e57"}
    ]
    # 50mm 초과 → STR-002(25~50mm)는 맞지 않는다
    assert "RULE-STR-002" not in by_id
    # 기계·전기 규칙은 scope로 걸러진다
    assert not any(r.startswith(("RULE-MEC", "RULE-ELE")) for r in by_id)


def test_no_scan_gives_confidence_from_reliability_only(activity):
    engine = RuleEngine(rules=[_rule("R1", "readiness.score < 0.5 and logic.days_until_planned_start <= 7", "MEDIUM", 0.8)])
    ctx = {"activity": activity, "readiness": {"activity_id": "A-1010", "score": 0.4}, "today": date(2026, 9, 1)}
    (v,) = engine.evaluate(ctx)
    assert v.confidence == 0.8
    assert v.activity_id == "A-1010"
    assert v.global_id is None
    # 착수일이 멀면 미충족
    assert engine.evaluate({**ctx, "today": date(2026, 8, 1)}) == []


def test_repo_rules_schedule_and_critical(activity, mismatch_scan):
    engine = RuleEngine()
    ctx = {"activity": activity, "readiness": {"score": 0.3, "confidence": 0.9}, "today": date(2026, 9, 1)}
    ids = {v.rule_id for v in engine.evaluate(ctx)}
    assert "RULE-SCH-001" in ids
    ctx2 = {
        "scan": mismatch_scan.model_copy(update={"state": "NOT_BUILT"}),
        "report": {"claimed_state": "completed"},
        "object": {"ifc_type": "IfcColumn"},
    }
    crit = [v for v in engine.evaluate(ctx2, scope={"discipline": "structure"}) if v.rule_id == "RULE-STR-003"]
    assert len(crit) == 1 and crit[0].risk_level is RiskLevel.CRITICAL
    ctx3 = {"scan": mismatch_scan.model_copy(update={"state": "UNVERIFIABLE"}), "logic": {"consecutive_unverifiable": 2}}
    assert any(v.rule_id == "RULE-SCH-002" and v.risk_level is RiskLevel.LOW for v in engine.evaluate(ctx3))


def test_scope_filtering():
    rules = [
        _rule("STR", "scan.state == 'MISMATCH'", discipline="structure", object_types=["IfcColumn"]),
        _rule("MEP", "scan.state == 'MISMATCH'", discipline="mechanical", object_types=["IfcDuctSegment"]),
        _rule("ANY", "scan.state == 'MISMATCH'"),
    ]
    engine = RuleEngine(rules=rules)
    ctx = {"scan": {"state": "MISMATCH", "confidence": 1.0}}
    assert {v.rule_id for v in engine.evaluate(ctx)} == {"STR", "MEP", "ANY"}
    assert {v.rule_id for v in engine.evaluate(ctx, scope={"discipline": "structure"})} == {"STR", "ANY"}
    assert {v.rule_id for v in engine.evaluate(ctx, scope={"object_types": ["IfcDuctSegment"]})} == {"MEP", "ANY"}
    assert {v.rule_id for v in engine.evaluate(ctx, scope={"discipline": "mechanical", "object_types": ["IfcColumn"]})} == {"ANY"}


def test_missing_values_do_not_match():
    engine = RuleEngine(rules=[_rule("R", "logic.ratio < 0.5"), _rule("S", "scan.state == 'MISMATCH'")])
    assert engine.evaluate({}) == []
    assert engine.evaluate({"logic": {"ratio": None}, "scan": None}) == []


def test_persist_verdicts(db_session, mismatch_scan, column_object):
    engine = RuleEngine()
    verdicts = engine.evaluate({"scan": mismatch_scan, "object": column_object}, scope={"discipline": "structure"})
    rows = persist_verdicts(db_session, "proj-1", verdicts)
    db_session.commit()
    assert len(rows) == len(verdicts) >= 1
    stored = db_session.execute(select(RuleVerdictRow).where(RuleVerdictRow.project_id == "proj-1")).scalars().all()
    assert {r.rule_id for r in stored} == {v.rule_id for v in verdicts}
    r = next(r for r in stored if r.rule_id == "RULE-STR-001")
    assert r.risk_level == "HIGH" and r.confidence == round(0.85 * 0.8, 6)
    assert r.evidence["rule_id"] == "RULE-STR-001" and r.evidence["extra"]["matched_inputs"] == ["scan"]
