from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from packages.core.models.knowledge import RiskLevel, Rule
from services.knowledge import load_rules
from services.knowledge.loader import RuleLoadError

ROOT = Path(__file__).resolve().parents[3]
RULES_DIR = ROOT / "rules"


def test_load_rules_from_repo():
    rules = load_rules(RULES_DIR)
    assert len(rules) >= 8
    ids = [r.id for r in rules]
    assert len(ids) == len(set(ids))
    for r in rules:
        assert isinstance(r, Rule)
        assert r.id.startswith("RULE-")
        assert 0.0 <= r.reliability <= 1.0
        assert isinstance(r.then.risk_level, RiskLevel)
        assert r.then.action
        assert r.source in ("expert", "case", "standard")
    assert any(r.then.risk_level is RiskLevel.CRITICAL for r in rules)
    assert any(r.source == "case" for r in rules)


def test_default_dir_matches_settings():
    assert {r.id for r in load_rules()} == {r.id for r in load_rules(RULES_DIR)}


def _write(dir_: Path, name: str, rules: list[dict]) -> None:
    (dir_ / "risk").mkdir(parents=True, exist_ok=True)
    (dir_ / "risk" / name).write_text(yaml.safe_dump(rules, allow_unicode=True), encoding="utf-8")


def _rule(id_: str, when: str = "scan.state == 'MISMATCH'") -> dict:
    return {
        "id": id_, "version": 1, "source": "expert", "reliability": 0.5,
        "when": when, "then": {"risk_level": "LOW", "action": "확인"},
    }


def test_duplicate_id_raises(tmp_path: Path):
    _write(tmp_path, "a.yaml", [_rule("RULE-X-001")])
    _write(tmp_path, "b.yaml", [_rule("RULE-X-001")])
    with pytest.raises(RuleLoadError, match="duplicate"):
        load_rules(tmp_path)


def test_unsafe_when_raises(tmp_path: Path):
    _write(tmp_path, "a.yaml", [_rule("RULE-X-002", when="__import__('os').system('rm -rf /')")])
    with pytest.raises(RuleLoadError, match="unsafe"):
        load_rules(tmp_path)


def test_schema_error_raises(tmp_path: Path):
    bad = _rule("RULE-X-003")
    bad["then"]["risk_level"] = "EXTREME"
    _write(tmp_path, "a.yaml", [bad])
    with pytest.raises(RuleLoadError):
        load_rules(tmp_path)
