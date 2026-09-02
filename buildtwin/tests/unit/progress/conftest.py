"""progress-engine 단위 테스트 공용 픽스처: 인메모리 SQLite + 샘플 객체/공정표(로더는 tests/helpers/progress_fixtures)."""
from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models.identity import BimObjectDraft
from services.progress import persistence as db
from services.progress.activity_mapper import map_activities_to_objects
from services.progress.importers import import_schedule
from tests.helpers.progress_fixtures import CATEGORY_TO_IFC, load_sample_objects, load_schedule_expected

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT_ID = "P-TEST"
MODEL_ID = "M-TEST"
__all__ = ["CATEGORY_TO_IFC", "FIXTURES", "PROJECT_ID", "MODEL_ID"]


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
    return load_schedule_expected()


@pytest.fixture(scope="session")
def sample_objects() -> list[BimObjectDraft]:
    return load_sample_objects()


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
