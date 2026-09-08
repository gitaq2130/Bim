from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.models.knowledge import CaseRecord, RiskLevel, Rule
from services.common.safe_expr import validate
from services.knowledge import CaseStore, load_rules
from services.knowledge.cases import CaseLoadError

ROOT = Path(__file__).resolve().parents[3]


def test_cases_load_from_repo():
    store = CaseStore(ROOT / "rules" / "cases")
    cases = store.all()
    assert len(cases) >= 3
    assert {c.discipline for c in cases} >= {"structure", "mechanical", "architecture"}
    assert store.get("CASE-0002").situation.startswith("2층 천장")


def test_find():
    store = CaseStore(ROOT / "rules" / "cases")
    assert [c.case_id for c in store.find(discipline="mechanical")] == ["CASE-0002"]
    assert [c.case_id for c in store.find(keywords=["패널", "지연"])] == ["CASE-0003"]
    assert [c.case_id for c in store.find(project_type="logistics_center", keywords="기둥")] == ["CASE-0001"]
    assert store.find(discipline="civil") == []


def test_to_rule_draft_and_engine_compatible():
    store = CaseStore(ROOT / "rules" / "cases")
    case = store.get("CASE-0001")
    rule = store.to_rule_draft(case, when="scan.state == 'MISMATCH' and scan.evidence.offset_vector.norm > 0.06", risk_level="HIGH",
                               object_types=["IfcColumn"], required_evidence=["survey_report"])
    assert isinstance(rule, Rule)
    assert rule.source == "case" and rule.source_ref == "CASE-0001" and rule.id == "RULE-CASE-CASE-0001"
    assert rule.reliability == case.reliability
    assert rule.scope.discipline == "structure" and rule.scope.object_types == ["IfcColumn"]
    assert rule.then.risk_level is RiskLevel.HIGH and "재측량" in rule.then.action
    # 기본 조건식도 안전하다
    default = store.to_rule_draft(case)
    validate(default.when)
    assert "CASE-0001" in default.when


def test_add_persist_and_reload(tmp_path: Path):
    store = CaseStore(tmp_path)
    case = CaseRecord(case_id="CASE-T1", project_type="plant", discipline="structure", situation="s", direct_impact="d")
    store.add(case, persist=True)
    assert (tmp_path / "CASE-T1.yaml").exists()
    assert CaseStore(tmp_path).get("CASE-T1").project_type == "plant"
    with pytest.raises(CaseLoadError):
        store.add(case)
    with pytest.raises(CaseLoadError, match="discipline"):
        store.add(CaseRecord(case_id="CASE-T2", project_type="plant", discipline="mep", situation="s", direct_impact="d"))


def test_all_case_disciplines_allowed():
    from services.knowledge import ALLOWED_DISCIPLINES

    for c in CaseStore(ROOT / "rules" / "cases").all():
        assert c.discipline in ALLOWED_DISCIPLINES, c.case_id


def test_case_rules_reference_existing_cases():
    """rules/risk에서 source: case인 규칙의 source_ref는 사례 DB에 있어야 한다."""
    store = CaseStore(ROOT / "rules" / "cases")
    for r in load_rules(ROOT / "rules"):
        if r.source == "case":
            assert store.get(r.source_ref) is not None, r.id
