"""bim-ingest 완료 조건: sample.ifc 카운트·층·bbox·좌표계 source."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from packages.core.models import TARGET_IFC_TYPES, IngestResult
from services.ingest.ifc_parser import parse_ifc

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SAMPLE_IFC = FIXTURES / "sample.ifc"
EXPECTED = json.loads((FIXTURES / "sample.ifc.expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def result(tmp_path_factory: pytest.TempPathFactory) -> IngestResult:
    out_dir = tmp_path_factory.mktemp("ifc_out")
    return parse_ifc(SAMPLE_IFC, out_dir=out_dir)


def test_status_ok(result: IngestResult) -> None:
    assert result.status == "ok"
    assert result.source_kind == "ifc"
    assert result.entities == []


def test_counts_match_expected(result: IngestResult) -> None:
    counted = {t: sum(1 for o in result.objects if o.ifc_type == t) for t in EXPECTED["counts"]}
    assert counted == EXPECTED["counts"]
    for t, n in EXPECTED["counts"].items():
        assert result.stats[t] == n
    assert result.stats["objects_total"] == sum(EXPECTED["counts"].values())
    assert all(any(o.ifc_type == t or o.ifc_type in TARGET_IFC_TYPES for t in TARGET_IFC_TYPES) for o in result.objects)


def test_levels_match_expected(result: IngestResult) -> None:
    assert [(lv["name"], lv["elevation"]) for lv in result.levels] == [(lv["name"], lv["elevation"]) for lv in EXPECTED["levels"]]


def test_every_object_has_bbox_and_level(result: IngestResult) -> None:
    level_names = {lv["name"] for lv in EXPECTED["levels"]}
    for o in result.objects:
        assert o.bbox is not None, o.global_id
        assert o.level in level_names, o.global_id
        assert o.level_elevation is not None
        assert o.express_id is not None
        assert o.mesh_ref is not None and o.mesh_ref.endswith(f"#{o.global_id}")


def test_global_ids_unique_and_match_fixture(result: IngestResult) -> None:
    ids = [o.global_id for o in result.objects]
    assert len(ids) == len(set(ids))
    expected_ids = {item["global_id"] for group in EXPECTED["objects"].values() for item in group}
    assert set(ids) == expected_ids
    assert not any(w.code == "DUPLICATE_GLOBAL_ID" for w in result.warnings)


def test_bbox_world_coordinates_match_fixture(result: IngestResult) -> None:
    """USE_WORLD_COORDS: bbox는 픽스처의 절대 원점(origin)과 일치해야 한다.

    주의: make_fixtures.py는 edit_object_placement(절대 z=0) 후 storey에 재부착하므로 2F 객체도 월드 z=0에 있다
    (storey 상대 z=-4.0). 따라서 층(level)은 z가 아니라 공간 포함 관계(ContainedInStructure)로 결정돼야 한다.
    """
    by_id = {o.global_id: o for o in result.objects}
    elev = {lv["name"]: lv["elevation"] for lv in EXPECTED["levels"]}
    for item in EXPECTED["objects"]["columns"]:
        o = by_id[item["global_id"]]
        ox, oy, oz = item["origin"]
        sx, sy, sz = item["size"]
        assert o.bbox.min == pytest.approx((ox, oy, oz), abs=1e-6)
        assert o.bbox.max == pytest.approx((ox + sx, oy + sy, oz + sz), abs=1e-6)
        assert o.level == item["level"]
        assert o.level_elevation == pytest.approx(elev[item["level"]])
        assert o.name == item["name"]


def test_zone_and_psets(result: IngestResult) -> None:
    for o in result.objects:
        assert o.zone == "Z1"
        assert o.psets["Pset_BuildTwin"]["Zone"] == "Z1"
        assert "id" not in o.psets["Pset_BuildTwin"]


def test_quantities(result: IngestResult) -> None:
    by_id = {o.global_id: o for o in result.objects}
    col = EXPECTED["objects"]["columns"][0]
    o = by_id[col["global_id"]]
    sx, sy, sz = col["size"]
    assert o.quantity["volume"] == pytest.approx(sx * sy * sz, rel=1e-4)
    assert o.quantity["area"] == pytest.approx(sx * sy, rel=1e-6)
    assert o.quantity["length"] == pytest.approx(max(sx, sy, sz), rel=1e-6)


def test_coordinate_system_is_ifc_local_without_georef(result: IngestResult) -> None:
    cs = result.coordinate_system
    assert cs.source == "ifc_local"
    assert cs.origin == (0.0, 0.0, 0.0) and cs.rotation_deg == 0.0 and cs.scale == 1.0
    assert cs.unit == "m"
    assert cs.extent is not None
    assert cs.extent.min[0] <= 0.0 and cs.extent.max[0] >= EXPECTED["grid_x"][-1]


def test_mesh_bundle_and_obj_written(result: IngestResult) -> None:
    assert result.mesh_uri is not None
    bundle = Path(result.mesh_uri)
    assert bundle.exists() and bundle.name == "sample.mesh.json"
    data = json.loads(bundle.read_text(encoding="utf-8"))
    assert set(data) == {o.global_id for o in result.objects}
    first = data[result.objects[0].global_id]
    assert len(first["vertices"]) % 3 == 0 and len(first["faces"]) % 3 == 0
    assert max(first["faces"]) < len(first["vertices"]) // 3
    obj = bundle.with_name("sample.obj")
    assert obj.exists()
    text = obj.read_text(encoding="utf-8")
    assert text.count("\no ") == len(result.objects)
    assert f"o {result.objects[0].global_id}\n" in text


def test_missing_file_returns_failed(tmp_path: Path) -> None:
    res = parse_ifc(tmp_path / "nope.ifc", out_dir=tmp_path)
    assert res.status == "failed"
    assert res.coordinate_system.source == "ifc_local"
    assert res.warnings[0].code == "IFC_OPEN_FAILED"
