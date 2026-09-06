"""sync 단위 테스트 공용 픽스처.

PRAGMA foreign_keys=ON(packages/core/db.py) 하에서는 자식 행을 넣기 전에 부모 행이 실제로
커밋/플러시되어 있어야 한다. 이 프로젝트의 ORM(packages/core/models/orm.py)은 relationship()
없이 순수 FK 컬럼만 쓰므로, 여러 개의 새 부모+자식 행을 한 flush 에 함께 넣으면 SQLAlchemy가
테이블 간 삽입 순서를 보장하지 않는다(부모보다 자식이 먼저 나가 FK 위반이 될 수 있다) — 그래서
아래 make_* 헬퍼들은 각 행을 만들 때마다 즉시 flush 한다.

체인: ProjectRow -> FileRow -> DrawingRow (2D)
     ProjectRow -> FileRow -> ModelRow -> BimObjectRow (3D)
"""
from __future__ import annotations

import pytest

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models.orm import BimObjectRow, DrawingRow, FileRow, ModelRow, ProjectRow

DRAWING_ID = "d1"
PROJECT_ID = "p1"
FILE_ID = "f1"


def make_project(s, project_id: str, name: str | None = None) -> ProjectRow:
    row = s.get(ProjectRow, project_id)
    if row is None:
        row = ProjectRow(project_id=project_id, name=name or project_id)
        s.add(row)
        s.flush()
    return row


def make_file(s, file_id: str, project_id: str, kind: str = "dxf") -> FileRow:
    row = s.get(FileRow, file_id)
    if row is None:
        make_project(s, project_id)
        row = FileRow(file_id=file_id, project_id=project_id, kind=kind, filename=f"{file_id}.{kind}",
                     uri=f"mem://{file_id}", sha256="0", size=1)
        s.add(row)
        s.flush()
    return row


def make_drawing(s, drawing_id: str, project_id: str, file_id: str, level: str = "1F") -> DrawingRow:
    """ProjectRow -> FileRow -> DrawingRow. file_id 가 없으면 함께 만든다."""
    row = s.get(DrawingRow, drawing_id)
    if row is None:
        make_file(s, file_id, project_id)
        row = DrawingRow(drawing_id=drawing_id, project_id=project_id, file_id=file_id, level=level,
                         coordinate_system={"source": "dxf_local"})
        s.add(row)
        s.flush()
    return row


def make_model(s, model_id: str, project_id: str, file_id: str | None = None) -> ModelRow:
    """ProjectRow -> FileRow -> ModelRow. file_id 가 없으면 함께 만든다."""
    row = s.get(ModelRow, model_id)
    if row is None:
        file_id = file_id or f"file-{model_id}"
        make_file(s, file_id, project_id, kind="ifc")
        row = ModelRow(model_id=model_id, project_id=project_id, file_id=file_id, coordinate_system={})
        s.add(row)
        s.flush()
    return row


def make_bim_object(s, project_id: str, global_id: str, model_id: str = "m1", ifc_type: str = "IfcColumn",
                    **extra) -> BimObjectRow:
    """모자란 부모(ModelRow -> FileRow -> ProjectRow)를 채운 뒤 BimObjectRow 를 만든다."""
    make_model(s, model_id, project_id)
    row = BimObjectRow(project_id=project_id, global_id=global_id, model_id=model_id, ifc_type=ifc_type, **extra)
    s.add(row)
    s.flush()
    return row


@pytest.fixture
def session():
    """in-memory sqlite + 기본 Project(p1)/File(f1, dxf)/Drawing(d1) 체인을 미리 만든다."""
    reset_engine()
    init_db("sqlite://")
    s = new_session()
    make_drawing(s, DRAWING_ID, PROJECT_ID, FILE_ID)
    s.commit()
    try:
        yield s
    finally:
        s.close()
        reset_engine()
