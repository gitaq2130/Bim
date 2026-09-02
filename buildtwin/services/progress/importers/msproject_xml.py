"""MS Project XML importer.

- Tasks/Task: UID, Name, WBS, Start, Finish, Duration(PT64H0M0S), PercentComplete, Summary
- PredecessorLink: PredecessorUID, Type(1=FS, 0=FF, 2=SF, 3=SS), LinkLag(1/10 분 단위 → /4800 = 일)
- activity_id: ExtendedAttribute(FieldID 188743731 = Text1) Value 가 있으면 그것, 없으면 "T<UID>"
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from packages.core.models.progress import Activity, ActivityRelation, Schedule

from ._common import drop_dangling_relations, infer_discipline, infer_level, infer_zone, parse_date, parse_float

ACTIVITY_ID_FIELD_ID = "188743731"           # MS Project Text1 확장 필드
LINK_TYPE_MAP = {"1": "FS", "0": "FF", "2": "SF", "3": "SS"}
# 단위 환산 상수(가중치·임계값 아님): LinkLag 는 1/10 분, 1일 = 8h × 60min × 10 = 4800
LAG_UNITS_PER_DAY = 4800.0
WORK_HOURS_PER_DAY = 8.0
_DURATION_RE = re.compile(r"P(?:(?P<days>\d+)D)?T?(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(elem: ET.Element, name: str) -> str | None:
    for child in elem:
        if _local(child.tag) == name:
            return (child.text or "").strip() or None
    return None


def _children(elem: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in elem if _local(c.tag) == name]


def parse_duration_days(text: str | None) -> float | None:
    """ISO8601 duration(PT64H0M0S) → 작업일(8h 기준)."""
    if not text:
        return None
    m = _DURATION_RE.fullmatch(text.strip())
    if not m:
        return None
    days = float(m.group("days") or 0)
    hours = float(m.group("h") or 0) + float(m.group("m") or 0) / 60.0 + float(m.group("s") or 0) / 3600.0
    return days + hours / WORK_HOURS_PER_DAY


def import_msproject_xml(path: str | Path, project_id: str, schedule_id: str | None = None) -> Schedule:
    path = Path(path)
    warnings: list[str] = []
    root = ET.parse(path).getroot()
    tasks: list[ET.Element] = [t for t in root.iter() if _local(t.tag) == "Task"]
    uid_to_id: dict[str, str] = {}
    activities: list[Activity] = []
    pending_links: list[tuple[str, str, str, float]] = []   # (succ_uid, pred_uid, type, lag_days)

    for task in tasks:
        uid = _child_text(task, "UID")
        if uid is None:
            warnings.append("Task without UID skipped")
            continue
        if _child_text(task, "Summary") == "1" or uid == "0":
            warnings.append(f"Task UID={uid} is a summary/project row; skipped")
            continue
        activity_id = None
        for ext in _children(task, "ExtendedAttribute"):
            if _child_text(ext, "FieldID") == ACTIVITY_ID_FIELD_ID and _child_text(ext, "Value"):
                activity_id = _child_text(ext, "Value")
                break
        activity_id = activity_id or f"T{uid}"
        uid_to_id[uid] = activity_id
        name = _child_text(task, "Name") or activity_id
        wbs = _child_text(task, "WBS")
        activities.append(Activity(
            activity_id=activity_id, name=name, wbs_code=wbs,
            discipline=infer_discipline(name, wbs), level=infer_level(name, wbs), zone=infer_zone(name),
            planned_start=parse_date(_child_text(task, "Start")), planned_finish=parse_date(_child_text(task, "Finish")),
            duration_days=parse_duration_days(_child_text(task, "Duration")),
            percent_complete=parse_float(_child_text(task, "PercentComplete"), 0.0) or 0.0,
            source_ref=f"{path.name}#UID={uid}",
        ))
        for link in _children(task, "PredecessorLink"):
            pred_uid = _child_text(link, "PredecessorUID")
            if not pred_uid:
                warnings.append(f"Task UID={uid}: PredecessorLink without PredecessorUID; skipped")
                continue
            link_type = LINK_TYPE_MAP.get(_child_text(link, "Type") or "1")
            if link_type is None:
                warnings.append(f"Task UID={uid}: unknown link type; using FS")
                link_type = "FS"
            lag = (parse_float(_child_text(link, "LinkLag"), 0.0) or 0.0) / LAG_UNITS_PER_DAY
            pending_links.append((uid, pred_uid, link_type, lag))

    relations: list[ActivityRelation] = []
    for succ_uid, pred_uid, link_type, lag in pending_links:
        if pred_uid not in uid_to_id:
            warnings.append(f"predecessor UID={pred_uid} of UID={succ_uid} not found; dropped")
            continue
        relations.append(ActivityRelation(predecessor_id=uid_to_id[pred_uid], successor_id=uid_to_id[succ_uid],
                                          type=link_type, lag_days=lag))   # type: ignore[arg-type]
    relations = drop_dangling_relations(relations, {a.activity_id for a in activities}, warnings)
    return Schedule(schedule_id=schedule_id or f"{project_id}:{path.stem}", project_id=project_id,
                    activities=activities, relations=relations, source_format="msproject_xml", warnings=warnings)
