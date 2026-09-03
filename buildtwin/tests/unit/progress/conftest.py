"""progress-engine 단위 테스트 공용 픽스처: 인메모리 SQLite + 샘플 객체/공정표(로더는 tests/helpers/progress_fixtures)."""
from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models.identity import BimObjectDraft
from packages.core.models.orm import FileRow, ModelRow, ScanRow
from services.progress import persistence as db
from services.progress.activity_mapper import map_activities_to_objects
from services.progress.importers import import_schedule
from tests.helpers.progress_fixtures import CATEGORY_TO_IFC, load_sample_objects, load_schedule_expected

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT_ID = "P-TEST"
MODEL_ID = "M-TEST"
__all__ = ["CATEGORY_TO_IFC", "FIXTURES", "PROJECT_ID", "MODEL_ID", "ensure_model_chain", "ensure_scan_chain"]


def ensure_model_chain(session, project_id: str, model_id: str, file_id: str | None = None) -> ModelRow:
    """ProjectRow -> FileRow -> ModelRow 부모 체인을 픽스처에서 미리 만든다.

    services.progress.persistence.ensure_model()(db.save_objects() 가 내부에서 호출)은
    ModelRow.file_id 에 f"{model_id}:file" 이라는 아직 존재하지 않는 FileRow 를 그대로 채워
    넣는다 — FK 강제 하에서는 위반이지만, 지금까지 이 함수를 부르는 프로덕션 호출자가 없어
    드러나지 않았을 뿐이다(services/progress/persistence.py:43-50, 자세한 내용은 conftest 하단
    주석과 최종 보고 참고). 여기서는 프로덕션 코드를 고치지 않고, ModelRow 를 미리 만들어 두어
    ensure_model() 이 "이미 있음"으로 보고 자기 삽입을 건너뛰게 한다.
    """
    db.ensure_project(session, project_id)
    row = session.get(ModelRow, model_id)
    if row is not None:
        return row
    file_id = file_id or f"FILE-{model_id}"
    if session.get(FileRow, file_id) is None:
        session.add(FileRow(file_id=file_id, project_id=project_id, kind="model", filename=f"{model_id}.ifc",
                            uri=f"mem://{file_id}", sha256="0" * 64, size=0))
        session.flush()
    row = ModelRow(model_id=model_id, project_id=project_id, file_id=file_id, coordinate_system={})
    session.add(row)
    session.flush()
    return row


def ensure_scan_chain(session, project_id: str, scan_id: str, file_id: str | None = None) -> ScanRow:
    """ProjectRow -> FileRow -> ScanRow 부모 체인을 픽스처에서 미리 만든다(ScanVerdictRow 가 scan_id 로 참조)."""
    db.ensure_project(session, project_id)
    row = session.get(ScanRow, scan_id)
    if row is not None:
        return row
    file_id = file_id or f"FILE-{scan_id}"
    if session.get(FileRow, file_id) is None:
        session.add(FileRow(file_id=file_id, project_id=project_id, kind="scan", filename=f"{scan_id}.e57",
                            uri=f"mem://{file_id}", sha256="0" * 64, size=0))
        session.flush()
    row = ScanRow(scan_id=scan_id, project_id=project_id, file_id=file_id)
    session.add(row)
    session.flush()
    return row


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
    ensure_model_chain(session, PROJECT_ID, MODEL_ID)
    db.save_objects(session, PROJECT_ID, MODEL_ID, sample_objects)
    schedule = import_schedule(FIXTURES / "schedule.csv", PROJECT_ID)
    db.save_schedule(session, schedule)
    mappings = map_activities_to_objects(schedule, sample_objects)
    db.save_mappings(session, mappings)
    session.commit()
    return {"schedule": schedule, "mappings": mappings, "expected": schedule_expected["activity_object_mapping"],
            "project_id": PROJECT_ID, "model_id": MODEL_ID}
