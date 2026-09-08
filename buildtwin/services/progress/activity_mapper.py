"""Activity ↔ BIM 객체 매핑. 규칙: 층 일치(필수) + 구역 일치(가점) + 작업명 키워드/WBS 표 → IFC 타입.

confidence = 일치 규칙 가중치 합(config/activity_mapping.yaml rule_weights). evidence.method 는 주 규칙명
(wbs_rule | keyword_rule | level_zone), 일치한 규칙 전체는 evidence.extra.matched_rules 에 남긴다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObject, BimObjectDraft
from packages.core.models.mapping import ActivityObjectMapping
from packages.core.models.progress import Activity, Schedule

from .config_loader import load_activity_mapping_config, load_wbs_mapping_config
from .importers._common import infer_level, infer_zone, normalize_level


@dataclass
class _Rules:
    weights: dict[str, float]
    keyword_rules: list[tuple[re.Pattern[str], tuple[str, ...]]]
    discipline_types: dict[str, tuple[str, ...]]
    wbs_codes: dict[str, dict] = field(default_factory=dict)
    wbs_prefixes: dict[str, dict] = field(default_factory=dict)


def _load_rules() -> _Rules:
    cfg = load_activity_mapping_config()
    wbs = load_wbs_mapping_config()
    return _Rules(
        weights={k: float(v) for k, v in (cfg.get("rule_weights") or {}).items()},
        keyword_rules=[(re.compile(r["pattern"], re.IGNORECASE), tuple(r["ifc_types"])) for r in cfg.get("keyword_rules") or []],
        discipline_types={k: tuple(v) for k, v in (cfg.get("discipline_ifc_types") or {}).items()},
        wbs_codes={str(k): dict(v) for k, v in (wbs.get("codes") or {}).items()},
        wbs_prefixes={str(k): dict(v) for k, v in (wbs.get("prefixes") or {}).items()},
    )


@dataclass
class ActivityTarget:
    """Activity 하나가 겨냥하는 객체 조건."""
    activity_id: str
    level: str | None
    zone: str | None
    ifc_types: set[str]
    keyword_hit: bool
    wbs_hit: bool
    wbs_entry: dict | None


def _wbs_lookup(rules: _Rules, wbs_code: str | None) -> dict | None:
    if not wbs_code:
        return None
    code = str(wbs_code).strip()
    if code in rules.wbs_codes:
        return rules.wbs_codes[code]
    best: tuple[int, dict] | None = None
    for prefix, entry in rules.wbs_prefixes.items():
        if code == prefix or code.startswith(prefix + ".") or code.startswith(prefix):
            if best is None or len(prefix) > best[0]:
                best = (len(prefix), entry)
    return best[1] if best else None


def resolve_target(activity: Activity, rules: _Rules | None = None) -> ActivityTarget:
    rules = rules or _load_rules()
    ifc_types: set[str] = set()
    keyword_hit = False
    for pattern, types in rules.keyword_rules:
        if pattern.search(activity.name or ""):
            ifc_types.update(types)
            keyword_hit = True
    wbs_entry = _wbs_lookup(rules, activity.wbs_code)
    wbs_hit = bool(wbs_entry and wbs_entry.get("ifc_types"))
    if wbs_hit:
        assert wbs_entry is not None
        ifc_types.update(wbs_entry["ifc_types"])
    discipline = activity.discipline or (wbs_entry or {}).get("discipline")
    if not ifc_types and discipline:
        ifc_types.update(rules.discipline_types.get(str(discipline).lower(), ()))
    level = normalize_level(activity.level) or infer_level(activity.name, activity.wbs_code) \
        or normalize_level((wbs_entry or {}).get("level"))
    zone = activity.zone or infer_zone(activity.name)
    return ActivityTarget(activity.activity_id, level, zone, ifc_types, keyword_hit, wbs_hit, wbs_entry)


def map_activities_to_objects(schedule: Schedule, objects: Sequence[BimObjectDraft | BimObject]) -> list[ActivityObjectMapping]:
    rules = _load_rules()
    w = rules.weights
    mappings: list[ActivityObjectMapping] = []
    normalized_levels = {o.global_id: normalize_level(o.level) for o in objects}
    for activity in schedule.activities:
        target = resolve_target(activity, rules)
        if not target.ifc_types:
            continue   # 대상 타입을 알 수 없으면 매핑하지 않는다(모든 객체를 잡는 것보다 낫다)
        for obj in objects:
            if obj.ifc_type not in target.ifc_types:
                continue
            obj_level = normalized_levels[obj.global_id]
            if target.level is not None and obj_level != target.level:
                continue   # 층 일치는 필수
            matched: list[str] = []
            confidence = 0.0
            if target.level is not None and obj_level == target.level:
                matched.append("level_match")
                confidence += w.get("level_match", 0.0)
            if target.zone is not None and obj.zone is not None and str(obj.zone).upper() == str(target.zone).upper():
                matched.append("zone_match")
                confidence += w.get("zone_match", 0.0)
            if target.keyword_hit:
                matched.append("keyword_rule")
                confidence += w.get("keyword_rule", 0.0)
            if target.wbs_hit:
                matched.append("wbs_rule")
                confidence += w.get("wbs_rule", 0.0)
            method = "wbs_rule" if target.wbs_hit else ("keyword_rule" if target.keyword_hit else "level_zone")
            evidence = Evidence(
                source_type="schedule", source_id=schedule.schedule_id, method=method, rule_id=activity.wbs_code,
                note=f"{activity.name} -> {obj.ifc_type} @ {obj_level}",
                extra={"matched_rules": matched, "activity_level": target.level, "activity_zone": target.zone,
                       "object_level": obj.level, "object_zone": obj.zone, "ifc_types": sorted(target.ifc_types),
                       "source_ref": activity.source_ref},
            )
            mappings.append(ActivityObjectMapping(activity_id=activity.activity_id, global_id=obj.global_id,
                                                  confidence=min(1.0, confidence), evidence=evidence))
    return mappings


def mapping_accuracy(mappings: list[ActivityObjectMapping], expected: dict[str, list[str]]) -> float:
    """기대 매핑 대비 정확도 = |정확히 일치한 쌍| / |기대 ∪ 산출 쌍|."""
    got = {(m.activity_id, m.global_id) for m in mappings}
    want = {(a, g) for a, gids in expected.items() for g in gids}
    if not want and not got:
        return 1.0
    return len(got & want) / len(got | want)
