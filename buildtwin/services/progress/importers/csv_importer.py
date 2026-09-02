"""CSV 공정표 importer.

컬럼(헤더 이름 기준, 대소문자 무시): activity_id, name, wbs_code, discipline, level, zone,
planned_start, planned_finish, duration_days, predecessors, percent_complete, 그 외 숫자 컬럼(crew, crane …)은 resources.
predecessors: "A100:FS:0;A110:SS:2" 형식.
"""
from __future__ import annotations

import csv
from pathlib import Path

from packages.core.models.progress import Activity, ActivityRelation, Schedule

from ._common import (drop_dangling_relations, infer_level, infer_zone, normalize_discipline, normalize_level, parse_date,
                      parse_float, parse_predecessors)

KNOWN_COLUMNS = {
    "activity_id", "name", "wbs_code", "discipline", "level", "zone", "planned_start", "planned_finish",
    "duration_days", "predecessors", "percent_complete", "source_ref",
}
COLUMN_ALIASES = {
    "id": "activity_id", "task_id": "activity_id", "code": "activity_id", "task_code": "activity_id",
    "task_name": "name", "activity_name": "name", "wbs": "wbs_code", "trade": "discipline",
    "storey": "level", "floor": "level", "area": "zone", "start": "planned_start", "finish": "planned_finish",
    "duration": "duration_days", "preds": "predecessors", "predecessor": "predecessors", "pct_complete": "percent_complete",
}


def _normalize_header(name: str) -> str:
    key = name.strip().lstrip("﻿").lower().replace(" ", "_")
    return COLUMN_ALIASES.get(key, key)


def import_csv(path: str | Path, project_id: str, schedule_id: str | None = None) -> Schedule:
    path = Path(path)
    warnings: list[str] = []
    activities: list[Activity] = []
    relations: list[ActivityRelation] = []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise ValueError(f"{path}: empty CSV")
        headers = {h: _normalize_header(h) for h in reader.fieldnames}
        for line_no, raw in enumerate(reader, start=2):
            row = {headers[k]: (v or "").strip() for k, v in raw.items() if k is not None}
            activity_id = row.get("activity_id", "")
            if not activity_id:
                warnings.append(f"line {line_no}: missing activity_id; skipped")
                continue
            name = row.get("name") or activity_id
            wbs = row.get("wbs_code") or None
            level = normalize_level(row.get("level")) or infer_level(name, wbs)
            zone = (row.get("zone") or None) or infer_zone(name)
            discipline = normalize_discipline(row.get("discipline"), name, wbs)
            resources: dict[str, float] = {}
            for key, value in row.items():
                if key in KNOWN_COLUMNS:
                    continue
                num = parse_float(value)
                if num is not None:
                    resources[key] = num
            activities.append(Activity(
                activity_id=activity_id, name=name, wbs_code=wbs, discipline=discipline, level=level, zone=zone,
                planned_start=parse_date(row.get("planned_start")), planned_finish=parse_date(row.get("planned_finish")),
                duration_days=parse_float(row.get("duration_days")), resources=resources,
                percent_complete=parse_float(row.get("percent_complete"), 0.0) or 0.0,
                source_ref=row.get("source_ref") or f"{path.name}#L{line_no}",
            ))
            relations.extend(parse_predecessors(row.get("predecessors"), activity_id, warnings))
    ids = {a.activity_id for a in activities}
    relations = drop_dangling_relations(relations, ids, warnings)
    return Schedule(schedule_id=schedule_id or f"{project_id}:{path.stem}", project_id=project_id,
                    activities=activities, relations=relations, source_format="csv", warnings=warnings)
