"""importer 공용: 공종/층/구역 추론, 선후행 문자열 파싱, 날짜 파싱."""
from __future__ import annotations

import re
from datetime import date, datetime
from functools import lru_cache
from typing import Any

from packages.core.models.progress import ActivityRelation, RelationType

from ..config_loader import load_activity_mapping_config

VALID_RELATION_TYPES: tuple[str, ...] = ("FS", "SS", "FF", "SF")


@lru_cache(maxsize=1)
def _compiled_rules() -> dict[str, Any]:
    cfg = load_activity_mapping_config()
    return {
        "discipline": {
            disc: [re.compile(p, re.IGNORECASE) for p in pats]
            for disc, pats in (cfg.get("discipline_keywords") or {}).items()
        },
        "level": [(re.compile(r["pattern"], re.IGNORECASE), r["template"]) for r in cfg.get("level_patterns") or []],
        "zone": [(re.compile(r["pattern"], re.IGNORECASE), r["template"]) for r in cfg.get("zone_patterns") or []],
    }


def clear_rule_cache() -> None:
    """테스트에서 config_dir 을 바꾼 뒤 호출."""
    _compiled_rules.cache_clear()


def _apply_patterns(text: str | None, rules: list[tuple[re.Pattern[str], str]]) -> str | None:
    if not text:
        return None
    for pattern, template in rules:
        m = pattern.search(text)
        if m:
            groups = m.groups()
            return template.format(*groups) if groups else template
    return None


def normalize_level(text: str | None) -> str | None:
    """'지하1층' → 'B1', '1층'/'1F' → '1F', '옥상' → 'RF'. 패턴이 없으면 공백 제거·대문자 원문."""
    if text is None:
        return None
    text = str(text).strip()
    if not text:
        return None
    found = _apply_patterns(text, _compiled_rules()["level"])
    return found or text.upper().replace(" ", "")


def infer_level(*texts: str | None) -> str | None:
    """작업명·WBS 등 여러 텍스트에서 층을 추론한다(첫 일치)."""
    for text in texts:
        found = _apply_patterns(text, _compiled_rules()["level"])
        if found:
            return found
    return None


def infer_zone(*texts: str | None) -> str | None:
    for text in texts:
        found = _apply_patterns(text, _compiled_rules()["zone"])
        if found:
            return found
    return None


def infer_discipline(*texts: str | None) -> str | None:
    """키워드 일치 수가 가장 많은 공종. 동률이면 config 선언 순서."""
    scores: dict[str, int] = {}
    for disc, patterns in _compiled_rules()["discipline"].items():
        hits = 0
        for text in texts:
            if not text:
                continue
            hits += sum(1 for p in patterns if p.search(text))
        if hits:
            scores[disc] = hits
    if not scores:
        return None
    return max(scores, key=lambda d: scores[d])


def normalize_discipline(value: str | None, *fallback_texts: str | None) -> str | None:
    value = (value or "").strip().lower()
    return value or infer_discipline(*fallback_texts)


def parse_predecessors(text: str | None, successor_id: str, warnings: list[str]) -> list[ActivityRelation]:
    """'A100:FS:0;A110:SS:2' 또는 'A100' (FS, lag 0). 구분자 ';' 또는 ','."""
    relations: list[ActivityRelation] = []
    if not text or not str(text).strip():
        return relations
    for chunk in re.split(r"[;,]", str(text)):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(":")]
        pred_id = parts[0]
        rel_type = (parts[1].upper() if len(parts) > 1 and parts[1] else "FS")
        lag = 0.0
        if len(parts) > 2 and parts[2]:
            try:
                lag = float(parts[2])
            except ValueError:
                warnings.append(f"{successor_id}: invalid lag {parts[2]!r} for predecessor {pred_id}, using 0")
        if rel_type not in VALID_RELATION_TYPES:
            warnings.append(f"{successor_id}: unknown relation type {rel_type!r} for predecessor {pred_id}, using FS")
            rel_type = "FS"
        relations.append(ActivityRelation(predecessor_id=pred_id, successor_id=successor_id,
                                          type=_as_relation_type(rel_type), lag_days=lag))
    return relations


def _as_relation_type(value: str) -> RelationType:
    return value  # type: ignore[return-value]


def parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_float(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def drop_dangling_relations(relations: list[ActivityRelation], activity_ids: set[str], warnings: list[str]) -> list[ActivityRelation]:
    kept: list[ActivityRelation] = []
    for rel in relations:
        if rel.predecessor_id not in activity_ids or rel.successor_id not in activity_ids:
            warnings.append(f"relation {rel.predecessor_id}->{rel.successor_id} references unknown activity; dropped")
            continue
        kept.append(rel)
    return kept
