"""services.progress.persistence 저장 헬퍼 직접 테스트: FK 강제 하 부모 체인 자동 생성 경로."""
from __future__ import annotations

from packages.core.models.identity import BimObjectDraft
from packages.core.models.orm import FileRow, ModelRow
from services.progress import persistence as db


def test_save_objects_creates_placeholder_file_for_new_model(session):
    """회귀 방지: ensure_model() 은 처음 보는 model_id 에 대해 ModelRow.file_id=f"{model_id}:file" 를
    채워 넣지만, 그 FileRow 자체를 만들지 않아 FK 강제 하에서 IntegrityError 로 실패했었다
    (services/progress/persistence.py:ensure_model, 미리 존재하는 ModelRow 가 없는 model_id 로
    save_objects() 를 부르는 모든 경로가 깨져 있었다). 지금은 자리표시 FileRow 를 함께 만들어야 한다.
    """
    db.ensure_project(session, "P-NEWMODEL")

    rows = db.save_objects(session, "P-NEWMODEL", "M-NEW",
                           [BimObjectDraft(global_id="OBJ-NEW-1", ifc_type="IfcColumn", level="1F")])
    session.commit()

    assert rows[0].global_id == "OBJ-NEW-1" and rows[0].state == "PLANNED"

    model = session.get(ModelRow, "M-NEW")
    assert model is not None and model.project_id == "P-NEWMODEL"

    file_row = session.get(FileRow, model.file_id)
    assert file_row is not None and file_row.project_id == "P-NEWMODEL"


def test_ensure_model_is_idempotent_and_reuses_existing_file(session):
    """이미 ModelRow 가 있으면 자리표시 FileRow 를 다시 만들지 않고 기존 행을 그대로 쓴다."""
    db.ensure_project(session, "P-NEWMODEL2")

    first = db.ensure_model(session, "P-NEWMODEL2", "M-NEW2")
    again = db.ensure_model(session, "P-NEWMODEL2", "M-NEW2")

    assert first.file_id == again.file_id
    assert session.get(FileRow, first.file_id) is not None
