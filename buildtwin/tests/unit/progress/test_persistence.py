"""services.progress.persistence 저장 헬퍼 직접 테스트: ensure_model/save_objects 의 file_id 계약."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from packages.core.models.identity import BimObjectDraft
from packages.core.models.orm import FileRow, ModelRow
from services.progress import persistence as db


def _add_file(session, project_id: str, file_id: str) -> FileRow:
    row = FileRow(file_id=file_id, project_id=project_id, kind="model", filename="model.ifc",
                  uri=f"mem://{file_id}", sha256="0" * 64, size=1234)
    session.add(row)
    session.flush()
    return row


def test_save_objects_requires_caller_supplied_file_id(session):
    """라운드4 리뷰 지적: ensure_model 은 더 이상 자리표시(placeholder) FileRow 를 스스로 만들지 않는다
    (프로덕션 호출자가 없는 테스트 전용 헬퍼였고, 자리표시 행이 GET /files 에 유령 파일로 노출되는
    문제가 있었다). 대신 호출자가 실제 FileRow.file_id 를 넘겨야 한다.
    """
    db.ensure_project(session, "P-NEWMODEL")
    _add_file(session, "P-NEWMODEL", "FILE-NEW")

    rows = db.save_objects(session, "P-NEWMODEL", "M-NEW",
                           [BimObjectDraft(global_id="OBJ-NEW-1", ifc_type="IfcColumn", level="1F")],
                           file_id="FILE-NEW")
    session.commit()

    assert rows[0].global_id == "OBJ-NEW-1" and rows[0].state == "PLANNED"

    model = session.get(ModelRow, "M-NEW")
    assert model is not None and model.project_id == "P-NEWMODEL" and model.file_id == "FILE-NEW"


def test_save_objects_rejects_unknown_file_id(session):
    """존재하지 않는 file_id 를 넘기면 자리표시를 만들어 눈감아주지 않고 FK 위반으로 즉시 실패한다
    (SQLite 도 PRAGMA foreign_keys=ON 으로 이를 강제한다 — packages/core/db.py)."""
    db.ensure_project(session, "P-NOFILE")

    with pytest.raises(IntegrityError):
        db.save_objects(session, "P-NOFILE", "M-NOFILE",
                        [BimObjectDraft(global_id="OBJ-NOFILE-1", ifc_type="IfcColumn", level="1F")],
                        file_id="FILE-DOES-NOT-EXIST")


def test_ensure_model_is_idempotent_and_keeps_original_file(session):
    """이미 ModelRow 가 있으면 새로 넘긴 file_id 는 무시하고 기존 행을 그대로 쓴다."""
    db.ensure_project(session, "P-NEWMODEL2")
    _add_file(session, "P-NEWMODEL2", "FILE-A")
    _add_file(session, "P-NEWMODEL2", "FILE-B")

    first = db.ensure_model(session, "P-NEWMODEL2", "M-NEW2", "FILE-A")
    again = db.ensure_model(session, "P-NEWMODEL2", "M-NEW2", "FILE-B")

    assert first.file_id == again.file_id == "FILE-A"
