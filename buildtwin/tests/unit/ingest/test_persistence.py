"""persist_ingest_result / persist_drawing — ADR 0001 §1 재업로드 규칙, ADR 0005 프로젝트 범위 키(sqlite in-memory)."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models import BimObjectDraft, IngestResult
from packages.core.models.orm import Base, BimObjectRow, DrawingEntityRow, DrawingRow, FileRow, ModelRow, ProjectRow
from packages.core.models.state import ObjectState
from services.ingest import persist_drawing, persist_ingest_result
from services.ingest.dxf_parser import parse_dxf
from services.ingest.ifc_parser import parse_ifc
from services.ingest.persistence import PersistedModel

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT = "p-test"


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as s:
        s.add(ProjectRow(project_id=PROJECT, name="test"))
        s.add(ProjectRow(project_id="p-other", name="other"))
        for fid in ("f-ifc-1", "f-ifc-2", "f-dxf-1", "f-dxf-2", "f-other"):
            s.add(FileRow(file_id=fid, project_id="p-other" if fid == "f-other" else PROJECT, kind=fid.split("-")[1],
                          filename=f"{fid}.bin", uri=f"local://{fid}", sha256="0" * 64, size=1))
        s.flush()
        yield s


@pytest.fixture(scope="module")
def ifc_result(tmp_path_factory: pytest.TempPathFactory) -> IngestResult:
    return parse_ifc(FIXTURES / "sample.ifc", out_dir=tmp_path_factory.mktemp("ifc"))


@pytest.fixture(scope="module")
def dxf_result() -> IngestResult:
    return parse_dxf(FIXTURES / "sample.dxf")


def _objects(session: Session) -> dict[str, BimObjectRow]:
    return {r.global_id: r for r in session.scalars(select(BimObjectRow).where(BimObjectRow.project_id == PROJECT))}


def test_first_upload_creates_model_and_planned_objects(session: Session, ifc_result: IngestResult) -> None:
    summary = persist_ingest_result(session, PROJECT, "f-ifc-1", ifc_result)
    assert isinstance(summary, PersistedModel)
    assert summary.version == 1 and summary.created == len(ifc_result.objects) and summary.updated == 0
    assert summary.orphaned == 0 and summary.orphaned_global_ids == [] and summary.duplicate_global_ids == []
    model = session.get(ModelRow, summary.model_id)
    assert model is not None and model.file_id == "f-ifc-1" and model.levels == ifc_result.levels
    assert model.coordinate_system["source"] == "ifc_local" and model.mesh_uri == ifc_result.mesh_uri
    rows = _objects(session)
    assert len(rows) == len(ifc_result.objects)
    assert all(r.state == ObjectState.PLANNED.value and not r.is_orphaned and r.model_version == 1 for r in rows.values())
    first = ifc_result.objects[0]
    assert rows[first.global_id].bbox == first.bbox.model_dump(mode="json")
    assert rows[first.global_id].psets == first.psets and rows[first.global_id].level == first.level


def test_reupload_keeps_state_bumps_version_flags_orphan(session: Session, ifc_result: IngestResult) -> None:
    first = persist_ingest_result(session, PROJECT, "f-ifc-1", ifc_result)
    rows = _objects(session)
    confirmed_gid = ifc_result.objects[0].global_id
    dropped_gid = ifc_result.objects[1].global_id
    # CM 승인 상태를 흉내 낸다(전이 자체는 progress-engine 상태기계 담당; 여기서는 유지 여부만 검증)
    rows[confirmed_gid].state = ObjectState.CONFIRMED.value
    rows[ifc_result.objects[2].global_id].state = ObjectState.IN_PROGRESS.value
    session.flush()

    moved = ifc_result.objects[0].model_copy(update={
        "name": "renamed", "bbox": ifc_result.objects[0].bbox.expanded(0.5), "psets": {"Pset_New": {"A": 1}},
    })
    new_draft = BimObjectDraft(global_id="NEWOBJECT0000000000000", ifc_type="IfcColumn", name="C-new", level="1F")
    second_result = ifc_result.model_copy(update={
        "objects": [moved] + [o for o in ifc_result.objects[2:]] + [new_draft],   # objects[1] 사라짐
        "mesh_uri": "/tmp/v2.mesh.json",
    })
    second = persist_ingest_result(session, PROJECT, "f-ifc-2", second_result)

    assert second.model_id != first.model_id and second.version == 2
    assert second.created == 1 and second.updated == len(ifc_result.objects) - 1
    assert second.orphaned == 1 and second.orphaned_global_ids == [dropped_gid]
    rows = _objects(session)
    assert len(rows) == len(ifc_result.objects) + 1          # 삭제 없음
    kept = rows[confirmed_gid]
    assert kept.state == ObjectState.CONFIRMED.value          # 상태 유지
    assert kept.model_version == 2 and kept.model_id == second.model_id and not kept.is_orphaned
    assert kept.name == "renamed" and kept.psets == {"Pset_New": {"A": 1}} and kept.bbox == moved.bbox.model_dump(mode="json")
    assert rows[ifc_result.objects[2].global_id].state == ObjectState.IN_PROGRESS.value
    orphan = rows[dropped_gid]
    assert orphan.is_orphaned is True and orphan.model_version == 1 and orphan.state == ObjectState.PLANNED.value
    assert rows["NEWOBJECT0000000000000"].state == ObjectState.PLANNED.value and rows["NEWOBJECT0000000000000"].model_version == 2
    model2 = session.get(ModelRow, second.model_id)
    assert model2 is not None and model2.version == 2 and model2.mesh_uri == "/tmp/v2.mesh.json" and model2.file_id == "f-ifc-2"

    # 세 번째 업로드에 사라졌던 객체가 다시 나타나면 orphan 해제, 상태는 여전히 유지
    third = persist_ingest_result(session, PROJECT, "f-ifc-1", ifc_result)
    assert third.version == 3 and third.orphaned == 1 and third.orphaned_global_ids == ["NEWOBJECT0000000000000"]
    rows = _objects(session)
    assert rows[dropped_gid].is_orphaned is False and rows[confirmed_gid].state == ObjectState.CONFIRMED.value


def test_explicit_model_id_and_duplicate_global_ids(session: Session, ifc_result: IngestResult) -> None:
    dup = ifc_result.objects[0].model_copy(update={"name": "dup"})
    res = ifc_result.model_copy(update={"objects": [ifc_result.objects[0], dup]})
    summary = persist_ingest_result(session, PROJECT, "f-ifc-1", res, model_id="m-explicit")
    assert summary.model_id == "m-explicit" and summary.object_count == 2 and summary.created == 2
    assert summary.duplicate_global_ids == [f"{dup.global_id}#1"]
    assert session.get(BimObjectRow, (PROJECT, f"{dup.global_id}#1")) is not None


def test_same_global_id_in_other_project_is_not_a_conflict(session: Session, ifc_result: IngestResult) -> None:
    """ADR 0005 규칙 4·5: 같은 GlobalId 가 다른 프로젝트에 이미 있어도 충돌이 아니다. 재업로드 규칙도 프로젝트 범위 안에서만 적용된다."""
    other_summary = persist_ingest_result(session, "p-other", "f-other", ifc_result)
    assert other_summary.created == len(ifc_result.objects) and other_summary.orphaned == 0

    summary = persist_ingest_result(session, PROJECT, "f-ifc-1", ifc_result)
    assert summary.created == len(ifc_result.objects) and summary.orphaned == 0

    # p-other 의 객체 상태를 바꿔도 PROJECT 쪽 같은 GlobalId 객체는 영향받지 않는다(격리)
    other_rows = {r.global_id: r for r in session.scalars(select(BimObjectRow).where(BimObjectRow.project_id == "p-other"))}
    gid = ifc_result.objects[0].global_id
    other_rows[gid].state = ObjectState.CONFIRMED.value
    other_rows[gid].is_orphaned = True
    session.flush()

    project_rows = _objects(session)
    assert project_rows[gid].state == ObjectState.PLANNED.value
    assert project_rows[gid].is_orphaned is False


def test_persist_drawing_and_replace_on_reupload(session: Session, dxf_result: IngestResult) -> None:
    drawing_id = persist_drawing(session, PROJECT, "f-dxf-1", dxf_result, level="1F")
    drawing = session.get(DrawingRow, drawing_id)
    assert drawing is not None and drawing.level == "1F" and drawing.coordinate_system["scale"] == 0.001
    entities = list(session.scalars(select(DrawingEntityRow).where(DrawingEntityRow.drawing_id == drawing_id)))
    assert len(entities) == len(dxf_result.entities)
    ins = next(e for e in entities if e.dxftype == "INSERT")
    assert ins.block_name == "COL_SYM" and ins.insert_point is not None and ins.scale == [1.0, 1.0]

    # 사용자 정합이 있으면 coordinate_system 은 보존
    drawing.alignment = {"alignment": {"source": "user_input"}}
    drawing.coordinate_system = {"source": "user_input", "scale": 0.001, "origin": [100.0, 50.0, 0.0]}
    session.flush()
    fewer = dxf_result.model_copy(update={"entities": dxf_result.entities[:5]})
    again = persist_drawing(session, PROJECT, "f-dxf-1", fewer, level="2F")
    assert again == drawing_id
    entities = list(session.scalars(select(DrawingEntityRow).where(DrawingEntityRow.drawing_id == drawing_id)))
    assert {e.handle for e in entities} == {e.handle for e in dxf_result.entities[:5]}
    drawing = session.get(DrawingRow, drawing_id)
    assert drawing.level == "2F" and drawing.coordinate_system["source"] == "user_input" and drawing.alignment

    other = persist_drawing(session, PROJECT, "f-dxf-2", dxf_result, level=None)
    assert other != drawing_id
    assert session.scalars(select(DrawingRow).where(DrawingRow.project_id == PROJECT)).all().__len__() == 2

    explicit = persist_drawing(session, PROJECT, "f-dxf-2", dxf_result, level="1F", drawing_id=other)
    assert explicit == other
    with pytest.raises(ValueError):
        persist_drawing(session, "p-other", "f-other", dxf_result, level=None, drawing_id=other)


def test_same_ifc_uploaded_to_two_projects_is_the_whole_point_of_adr_0005(ifc_result: IngestResult) -> None:
    """ADR 0005 회귀 테스트: 같은 파싱 결과를 서로 다른 project_id 두 번 적재해도 둘 다 성공하고,
    각 프로젝트가 자기만의 완전한 객체 집합을 가지며, 한쪽 상태 변경이 다른 쪽에 전혀 새지 않는다.
    `packages.core.db`의 실제 엔진/세션 팩토리(reset_engine + init_db("sqlite://") + new_session)를 그대로 써서
    (project_id, global_id) 복합 키가 실제 배포 경로에서도 프로젝트를 격리함을 검증한다.
    """
    reset_engine()
    try:
        init_db("sqlite://")
        session = new_session()
        try:
            session.add(ProjectRow(project_id="p-alpha", name="alpha"))
            session.add(ProjectRow(project_id="p-beta", name="beta"))
            session.add(FileRow(file_id="f-alpha", project_id="p-alpha", kind="ifc", filename="a.ifc",
                                uri="local://f-alpha", sha256="0" * 64, size=1))
            session.add(FileRow(file_id="f-beta", project_id="p-beta", kind="ifc", filename="b.ifc",
                                uri="local://f-beta", sha256="0" * 64, size=1))
            session.flush()

            alpha = persist_ingest_result(session, "p-alpha", "f-alpha", ifc_result)
            beta = persist_ingest_result(session, "p-beta", "f-beta", ifc_result)

            # 둘 다 성공하고, 신규 생성 개수는 동일(서로가 서로를 "기존 객체"로 착각하지 않는다)
            assert alpha.created == len(ifc_result.objects) and alpha.orphaned == 0
            assert beta.created == len(ifc_result.objects) and beta.orphaned == 0

            def rows_of(project_id: str) -> dict[str, BimObjectRow]:
                return {r.global_id: r for r in session.scalars(
                    select(BimObjectRow).where(BimObjectRow.project_id == project_id))}

            alpha_rows = rows_of("p-alpha")
            beta_rows = rows_of("p-beta")
            assert len(alpha_rows) == len(ifc_result.objects)
            assert len(beta_rows) == len(ifc_result.objects)
            assert set(alpha_rows) == set(beta_rows) == {o.global_id for o in ifc_result.objects}

            # 한 프로젝트의 객체 상태·orphan 변경이 다른 프로젝트에 새지 않는다
            gid = ifc_result.objects[0].global_id
            alpha_rows[gid].state = ObjectState.CONFIRMED.value
            alpha_rows[gid].is_orphaned = True
            session.flush()

            assert rows_of("p-alpha")[gid].state == ObjectState.CONFIRMED.value
            assert rows_of("p-alpha")[gid].is_orphaned is True
            assert rows_of("p-beta")[gid].state == ObjectState.PLANNED.value
            assert rows_of("p-beta")[gid].is_orphaned is False

            # 재업로드 규칙(상태 유지·버전 증가·orphan 표시)도 프로젝트 범위 안에서만 작동한다
            dropped_gid = ifc_result.objects[1].global_id
            trimmed = ifc_result.model_copy(update={"objects": [o for o in ifc_result.objects if o.global_id != dropped_gid]})
            alpha2 = persist_ingest_result(session, "p-alpha", "f-alpha", trimmed)
            assert alpha2.orphaned == 1 and alpha2.orphaned_global_ids == [dropped_gid]
            assert rows_of("p-alpha")[dropped_gid].is_orphaned is True
            # p-beta 는 재업로드하지 않았으므로 그대로 온전하고 orphan 도 없다
            beta_rows_after = rows_of("p-beta")
            assert len(beta_rows_after) == len(ifc_result.objects)
            assert beta_rows_after[dropped_gid].is_orphaned is False
        finally:
            session.close()
    finally:
        reset_engine()
