"""progress-engine 단위 테스트 공용 픽스처: 인메모리 SQLite + 샘플 객체/공정표."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models.identity import BimObjectDraft
from services.progress import persistence as db
from services.progress.activity_mapper import map_activities_to_objects
from services.progress.importers import import_schedule

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT_ID = "P-TEST"
MODEL_ID = "M-TEST"
CATEGORY_TO_IFC = {"columns": "IfcColumn", "beams": "IfcBeam", "slabs": "IfcSlab", "walls": "IfcWall", "ducts": "IfcDuctSegment"}


@pytest.fixture
def session():
    reset_engine()
    init_db("sqlite:///:memory:")
    s = new_session()
    try:
        yield s
    finally:
        s.close()
        reset_engine()


@pytest.fixture(scope="session")
def schedule_expected() -> dict:
    return json.loads((FIXTURES / "schedule.expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def sample_objects() -> list[BimObjectDraft]:
    data = json.loads((FIXTURES / "sample.ifc.expected.json").read_text(encoding="utf-8"))
    drafts: list[BimObjectDraft] = []
    for category, items in data["objects"].items():
        for o in items:
            drafts.append(BimObjectDraft(global_id=o["global_id"], ifc_type=CATEGORY_TO_IFC[category], name=o.get("name"),
                                         level=o.get("level"), quantity={"volume": 1.0}))
    return drafts


@pytest.fixture
def seeded(session, sample_objects, schedule_expected) -> dict:
    """프로젝트 + 객체(PLANNED) + CSV 공정표 + Activity↔객체 매핑 저장."""
    db.ensure_project(session, PROJECT_ID)
    db.save_objects(session, PROJECT_ID, MODEL_ID, sample_objects)
    schedule = import_schedule(FIXTURES / "schedule.csv", PROJECT_ID)
    db.save_schedule(session, schedule)
    mappings = map_activities_to_objects(schedule, sample_objects)
    db.save_mappings(session, mappings)
    session.commit()
    return {"schedule": schedule, "mappings": mappings, "expected": schedule_expected["activity_object_mapping"],
            "project_id": PROJECT_ID, "model_id": MODEL_ID}
