"""ingest 단위 테스트 공용 픽스처.

PRAGMA foreign_keys=ON(packages/core/db.py) 하에서는 자식 행을 넣기 전에 부모 행이 실제로
커밋/플러시되어 있어야 한다. 이 프로젝트의 ORM(packages/core/models/orm.py)은 relationship()
없이 순수 FK 컬럼만 쓰므로, 여러 개의 새 부모 행(예: ProjectRow 여러 개 + FileRow 여러 개)을
한 flush 에 함께 넣으면 SQLAlchemy가 테이블 간 삽입 순서를 보장하지 않는다 — 그래서 아래 make_*
헬퍼들은 각 행을 만들 때마다 즉시 flush 한다.
"""
from __future__ import annotations

from packages.core.models.orm import FileRow, ProjectRow


def make_project(s, project_id: str, name: str | None = None) -> ProjectRow:
    row = s.get(ProjectRow, project_id)
    if row is None:
        row = ProjectRow(project_id=project_id, name=name or project_id)
        s.add(row)
        s.flush()
    return row


def make_file(s, file_id: str, project_id: str, kind: str = "ifc") -> FileRow:
    row = s.get(FileRow, file_id)
    if row is None:
        make_project(s, project_id)
        row = FileRow(file_id=file_id, project_id=project_id, kind=kind, filename=f"{file_id}.bin",
                     uri=f"local://{file_id}", sha256="0" * 64, size=1)
        s.add(row)
        s.flush()
    return row
