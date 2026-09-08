"""Primavera P6 XER importer.

%T <table> / %F <fields> / %R <row> 형식. TASK(task_id, task_code, task_name, wbs_id, target_start_date,
target_end_date, target_drtn_hr_cnt, phys_complete_pct)와 TASKPRED(task_id=후행, pred_task_id, pred_type PR_FS…,
lag_hr_cnt)를 읽는다. PROJWBS 가 있으면 wbs_id → wbs_short_name 을 WBS 코드로 쓴다. activity_id = task_code.
"""
from __future__ import annotations

from pathlib import Path

from packages.core.models.progress import Activity, ActivityRelation, Schedule

from ._common import drop_dangling_relations, infer_discipline, infer_level, infer_zone, parse_date, parse_float

WORK_HOURS_PER_DAY = 8.0     # 단위 환산(P6 기본 달력). 가중치·임계값 아님
PRED_TYPE_MAP = {"PR_FS": "FS", "PR_SS": "SS", "PR_FF": "FF", "PR_SF": "SF"}


def parse_xer_tables(path: Path) -> dict[str, list[dict[str, str]]]:
    tables: dict[str, list[dict[str, str]]] = {}
    current: str | None = None
    fields: list[str] = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n")
            if not line:
                continue
            parts = line.split("\t")
            tag = parts[0]
            if tag == "%T":
                current = parts[1].strip() if len(parts) > 1 else None
                fields = []
                if current:
                    tables.setdefault(current, [])
            elif tag == "%F":
                fields = [f.strip() for f in parts[1:]]
            elif tag == "%R" and current:
                values = parts[1:]
                row = {fields[i]: (values[i] if i < len(values) else "") for i in range(len(fields))}
                tables[current].append(row)
            elif tag == "%E":
                break
    return tables


def import_p6_xer(path: str | Path, project_id: str, schedule_id: str | None = None) -> Schedule:
    path = Path(path)
    warnings: list[str] = []
    tables = parse_xer_tables(path)
    task_rows = tables.get("TASK", [])
    if not task_rows:
        warnings.append("TASK table missing or empty")
    wbs_names = {r.get("wbs_id", ""): (r.get("wbs_short_name") or r.get("wbs_name") or "") for r in tables.get("PROJWBS", [])}

    activities: list[Activity] = []
    task_id_to_code: dict[str, str] = {}
    for row in task_rows:
        task_id = row.get("task_id", "").strip()
        code = row.get("task_code", "").strip() or (f"T{task_id}" if task_id else "")
        if not code:
            warnings.append("TASK row without task_id/task_code skipped")
            continue
        task_id_to_code[task_id] = code
        name = row.get("task_name", "").strip() or code
        wbs_id = row.get("wbs_id", "").strip()
        wbs = wbs_names.get(wbs_id) or wbs_id or None
        hours = parse_float(row.get("target_drtn_hr_cnt"))
        activities.append(Activity(
            activity_id=code, name=name, wbs_code=wbs,
            discipline=infer_discipline(name, wbs), level=infer_level(name, wbs), zone=infer_zone(name),
            planned_start=parse_date(row.get("target_start_date")), planned_finish=parse_date(row.get("target_end_date")),
            duration_days=(hours / WORK_HOURS_PER_DAY) if hours is not None else None,
            percent_complete=parse_float(row.get("phys_complete_pct"), 0.0) or 0.0,
            source_ref=f"{path.name}#task_id={task_id}",
        ))

    relations: list[ActivityRelation] = []
    for row in tables.get("TASKPRED", []):
        succ = task_id_to_code.get(row.get("task_id", "").strip())
        pred = task_id_to_code.get(row.get("pred_task_id", "").strip())
        if not succ or not pred:
            warnings.append(f"TASKPRED {row.get('task_pred_id')} references unknown task; dropped")
            continue
        rel_type = PRED_TYPE_MAP.get(row.get("pred_type", "").strip().upper())
        if rel_type is None:
            warnings.append(f"TASKPRED {row.get('task_pred_id')}: unknown pred_type {row.get('pred_type')!r}; using FS")
            rel_type = "FS"
        lag_hours = parse_float(row.get("lag_hr_cnt"), 0.0) or 0.0
        relations.append(ActivityRelation(predecessor_id=pred, successor_id=succ, type=rel_type,   # type: ignore[arg-type]
                                          lag_days=lag_hours / WORK_HOURS_PER_DAY))
    relations = drop_dangling_relations(relations, {a.activity_id for a in activities}, warnings)
    return Schedule(schedule_id=schedule_id or f"{project_id}:{path.stem}", project_id=project_id,
                    activities=activities, relations=relations, source_format="p6_xer", warnings=warnings)
