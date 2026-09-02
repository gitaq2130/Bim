from __future__ import annotations

from services.sync.rules import layer_rule_match, layer_rule_score, load_layer_rules


def test_layer_rule_scores():
    rules = load_layer_rules()
    assert layer_rule_score("A-COL", None, "IfcColumn", rules) == 1.0
    assert layer_rule_score("a-col-01", None, "IfcColumn", rules) == 1.0          # 대소문자 무시
    assert layer_rule_score("MY-COLUMN-X", None, "IfcColumn", rules) == 0.8
    assert layer_rule_score("A-WALL", None, "IfcWallStandardCase", rules) == 1.0
    assert layer_rule_score("A-COL", None, "IfcBeam", rules) == -0.5              # 규칙은 있으나 다른 타입
    assert layer_rule_score("A-COL", None, "IfcBeam", rules, mismatch_penalty=-0.2) == -0.2
    assert layer_rule_score("Z-UNKNOWN", None, "IfcColumn", rules) == 0.0         # 규칙 없음
    assert layer_rule_score("Z-UNKNOWN", "COL_SYM", "IfcColumn", rules) == 0.9   # 블록 규칙
    assert layer_rule_score("A-COL", "COL_SYM", "IfcColumn", rules) == 1.0       # 최대 weight
    m = layer_rule_match("S-BEAM", None, "IfcBeam", rules)
    assert m.rule_id == "layer:S-BEAM*" and "IfcBeam" in m.matched_types
    assert rules.is_grid_layer("GRID") and rules.is_grid_layer("s-grid-1") and not rules.is_grid_layer("A-COL")
