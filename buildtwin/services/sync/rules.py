"""레이어명·블록명 → IfcType 규칙(rules/layer_mapping.yaml, 파일 소유: knowledge). 담당: sync-2d3d.

패턴은 fnmatch, 대소문자 무시. 점수 규약:
  - 매치하는 규칙의 ifc_types에 대상 타입이 있으면 그 weight(여러 개면 최대)
  - 매치하는 규칙이 하나도 없으면 0.0
  - 매치는 하지만 전부 다른 타입을 가리키면 감점(mismatch_penalty, 기본 -0.5)
"""
from __future__ import annotations

from fnmatch import fnmatchcase
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from packages.core.settings import ROOT, settings

RULES_FILENAME = "layer_mapping.yaml"
DEFAULT_MISMATCH_PENALTY = -0.5   # config/sync.yaml의 rule_mismatch_penalty가 우선한다


class LayerRule(BaseModel):
    pattern: str
    ifc_types: list[str]
    weight: float = Field(ge=0.0, le=1.0, default=1.0)


class LayerMappingRules(BaseModel):
    layers: list[LayerRule] = Field(default_factory=list)
    blocks: list[LayerRule] = Field(default_factory=list)
    grid_layers: list[str] = Field(default_factory=list)

    def is_grid_layer(self, layer: str) -> bool:
        return match_any(layer, self.grid_layers)


class RuleMatch(BaseModel):
    """엔티티 하나에 대한 규칙 평가 결과(evidence용)."""
    score: float
    rule_id: str | None = None          # "layer:A-COL*" / "block:COL*"
    matched_types: list[str] = Field(default_factory=list)   # 매치된 규칙들이 가리키는 타입 전체


def match_any(name: str | None, patterns: list[str]) -> bool:
    if not name:
        return False
    upper = name.upper()
    return any(fnmatchcase(upper, p.upper()) for p in patterns)


def rules_path(path: str | Path | None = None) -> Path:
    if path is not None:
        return Path(path)
    p = Path(settings.rules_dir) / RULES_FILENAME
    return p if p.exists() else ROOT / "rules" / RULES_FILENAME


@lru_cache(maxsize=8)
def _load(path_str: str) -> LayerMappingRules:
    with open(path_str, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return LayerMappingRules.model_validate(data)


def load_layer_rules(path: str | Path | None = None) -> LayerMappingRules:
    return _load(str(rules_path(path).resolve()))


def matching_rules(layer: str | None, block_name: str | None,
                   rules: LayerMappingRules | None = None) -> list[tuple[str, LayerRule]]:
    """(kind, rule) 목록. kind ∈ {layer, block}."""
    rules = rules or load_layer_rules()
    out: list[tuple[str, LayerRule]] = []
    if layer:
        out += [("layer", r) for r in rules.layers if fnmatchcase(layer.upper(), r.pattern.upper())]
    if block_name:
        out += [("block", r) for r in rules.blocks if fnmatchcase(block_name.upper(), r.pattern.upper())]
    return out


def layer_rule_match(layer: str | None, block_name: str | None, ifc_type: str,
                     rules: LayerMappingRules | None = None,
                     mismatch_penalty: float = DEFAULT_MISMATCH_PENALTY) -> RuleMatch:
    matched = matching_rules(layer, block_name, rules)
    if not matched:
        return RuleMatch(score=0.0)
    types: list[str] = []
    best: tuple[float, str] | None = None
    for kind, r in matched:
        types += [t for t in r.ifc_types if t not in types]
        if ifc_type in r.ifc_types and (best is None or r.weight > best[0]):
            best = (r.weight, f"{kind}:{r.pattern}")
    if best is not None:
        return RuleMatch(score=best[0], rule_id=best[1], matched_types=types)
    kind, r = matched[0]
    return RuleMatch(score=mismatch_penalty, rule_id=f"{kind}:{r.pattern}", matched_types=types)


def layer_rule_score(layer: str | None, block_name: str | None, ifc_type: str,
                     rules: LayerMappingRules | None = None,
                     mismatch_penalty: float = DEFAULT_MISMATCH_PENALTY) -> float:
    return layer_rule_match(layer, block_name, ifc_type, rules, mismatch_penalty).score
