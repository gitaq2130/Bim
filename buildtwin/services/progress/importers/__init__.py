"""공정표 importer 진입점: import_schedule(path, project_id, fmt=None) -> Schedule."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from packages.core.models.progress import Schedule

from .csv_importer import import_csv
from .msproject_xml import import_msproject_xml
from .p6_xer import import_p6_xer

ScheduleFormat = Literal["csv", "msproject_xml", "p6_xer"]
_EXT_TO_FORMAT: dict[str, ScheduleFormat] = {".csv": "csv", ".xml": "msproject_xml", ".xer": "p6_xer"}
_FORMAT_ALIASES = {"xml": "msproject_xml", "msproject": "msproject_xml", "xer": "p6_xer", "p6": "p6_xer"}


def detect_format(path: str | Path) -> ScheduleFormat:
    ext = Path(path).suffix.lower()
    if ext not in _EXT_TO_FORMAT:
        raise ValueError(f"unsupported schedule file extension: {ext!r} (csv/xml/xer)")
    return _EXT_TO_FORMAT[ext]


def import_schedule(path: str | Path, project_id: str, fmt: str | None = None, schedule_id: str | None = None) -> Schedule:
    resolved = _FORMAT_ALIASES.get(fmt.lower(), fmt.lower()) if fmt else detect_format(path)
    if resolved == "csv":
        return import_csv(path, project_id, schedule_id)
    if resolved == "msproject_xml":
        return import_msproject_xml(path, project_id, schedule_id)
    if resolved == "p6_xer":
        return import_p6_xer(path, project_id, schedule_id)
    raise ValueError(f"unsupported schedule format: {fmt!r}")


__all__ = ["ScheduleFormat", "detect_format", "import_csv", "import_msproject_xml", "import_p6_xer", "import_schedule"]
