"""progress-engine 픽스처 로더(unit·regression 공용). sample.ifc.expected.json → BimObjectDraft, schedule.expected.json."""
from __future__ import annotations

import json
from pathlib import Path

from packages.core.models.identity import BimObjectDraft

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
CATEGORY_TO_IFC = {"columns": "IfcColumn", "beams": "IfcBeam", "slabs": "IfcSlab", "walls": "IfcWall", "ducts": "IfcDuctSegment"}


def load_schedule_expected() -> dict:
    return json.loads((FIXTURES / "schedule.expected.json").read_text(encoding="utf-8"))


def load_sample_objects() -> list[BimObjectDraft]:
    data = json.loads((FIXTURES / "sample.ifc.expected.json").read_text(encoding="utf-8"))
    drafts: list[BimObjectDraft] = []
    for category, items in data["objects"].items():
        for o in items:
            drafts.append(BimObjectDraft(global_id=o["global_id"], ifc_type=CATEGORY_TO_IFC[category], name=o.get("name"),
                                         level=o.get("level"), quantity={"volume": 1.0}))
    return drafts
