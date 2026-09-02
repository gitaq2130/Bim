"""bim-ingest 완료 조건: sample.dxf 레이어별 카운트·단위 스케일·좌표계 source."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import ezdxf
import pytest

from packages.core.models import IngestResult
from services.ingest.dxf_parser import parse_dxf

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SAMPLE_DXF = FIXTURES / "sample.dxf"
EXPECTED = json.loads((FIXTURES / "sample.dxf.expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def result() -> IngestResult:
    return parse_dxf(SAMPLE_DXF)


def test_status_ok(result: IngestResult) -> None:
    assert result.status == "ok"
    assert result.source_kind == "dxf"
    assert result.objects == []


def test_entity_counts_by_layer(result: IngestResult) -> None:
    counted = Counter(e.layer for e in result.entities)
    assert dict(counted) == EXPECTED["entity_counts_by_layer"]
    for layer, n in EXPECTED["entity_counts_by_layer"].items():
        assert result.stats[f"layer:{layer}"] == n
    assert result.stats["entities_total"] == sum(EXPECTED["entity_counts_by_layer"].values())


def test_unit_scale_is_mm(result: IngestResult) -> None:
    cs = result.coordinate_system
    assert cs.source == "dxf_local"
    assert cs.scale == EXPECTED["unit_to_m"] == 0.001
    assert cs.unit == "mm"
    assert cs.extent is not None
    assert cs.extent.min[0] < cs.extent.max[0] and cs.extent.min[1] < cs.extent.max[1]
    # 원점·회전은 도면에서 알 수 없으므로 항등이어야 한다(하드코딩 금지) — 정합은 sync-2d3d/사용자 입력이 담당
    assert cs.origin == (0.0, 0.0, 0.0) and cs.rotation_deg == 0.0


def test_every_entity_has_handle_points_bbox(result: IngestResult) -> None:
    handles = [e.handle for e in result.entities]
    assert len(handles) == len(set(handles))
    for e in result.entities:
        assert e.points, e.handle
        assert e.bbox is not None, e.handle
        assert all(isinstance(v, float) for p in e.points for v in p)


def test_block_insert(result: IngestResult) -> None:
    ins = next(e for e in result.entities if e.dxftype == "INSERT")
    assert ins.handle == EXPECTED["block_insert_handle"]
    assert ins.block_name == "COL_SYM"
    assert ins.layer == "A-COL"
    assert ins.insert_point is not None and ins.rotation_deg == 0.0 and ins.scale == (1.0, 1.0)
    # 블록(반지름 200 원) 실제 범위가 bbox에 반영돼야 한다
    assert ins.bbox.max[0] - ins.bbox.min[0] == pytest.approx(400.0, abs=1e-6)


def test_text_entity(result: IngestResult) -> None:
    txt = next(e for e in result.entities if e.dxftype == "TEXT")
    assert txt.text == "1F PLAN" and txt.layer == "A-TEXT"
    assert txt.attrs["height"] == pytest.approx(300.0)


def test_lwpolyline_closed_rect(result: IngestResult) -> None:
    rects = [e for e in result.entities if e.dxftype == "LWPOLYLINE" and e.layer == "A-COL"]
    assert len(rects) == 6
    for r in rects:
        assert len(r.points) == 4 and r.attrs["closed"] is True


def test_other_entity_types_and_unknown_units(tmp_path: Path) -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 0  # unitless → 경고
    msp = doc.modelspace()
    msp.add_circle((10, 10), 5, dxfattribs={"layer": "L1"})
    msp.add_arc((0, 0), 4, 0, 90, dxfattribs={"layer": "L1"})
    msp.add_mtext("hello\\Pworld", dxfattribs={"layer": "L2"}).set_location((1, 2))
    msp.add_spline(fit_points=[(0, 0), (1, 1), (2, 0)], dxfattribs={"layer": "L2"})
    pl = msp.add_polyline2d([(0, 0), (3, 0), (3, 3)], dxfattribs={"layer": "L3"})
    pl.close(True)
    hatch = msp.add_hatch(color=2, dxfattribs={"layer": "L3"})
    hatch.paths.add_polyline_path([(0, 0), (2, 0), (2, 2), (0, 2)], is_closed=True)
    msp.add_point((5, 5), dxfattribs={"layer": "L4"})   # 미지원 → skipped
    path = tmp_path / "misc.dxf"
    doc.saveas(str(path))

    res = parse_dxf(path)
    assert res.status == "ok"
    types = Counter(e.dxftype for e in res.entities)
    assert types == {"CIRCLE": 1, "ARC": 1, "MTEXT": 1, "SPLINE": 1, "POLYLINE": 1, "HATCH": 1}
    circle = next(e for e in res.entities if e.dxftype == "CIRCLE")
    assert circle.radius == 5 and circle.bbox.min == (5.0, 5.0) and circle.bbox.max == (15.0, 15.0)
    arc = next(e for e in res.entities if e.dxftype == "ARC")
    assert arc.bbox.max[0] == pytest.approx(4.0, abs=1e-3) and arc.bbox.max[1] == pytest.approx(4.0, abs=1e-3)
    mtext = next(e for e in res.entities if e.dxftype == "MTEXT")
    assert mtext.text == "hello\nworld"
    hatch_e = next(e for e in res.entities if e.dxftype == "HATCH")
    assert len(hatch_e.points) == 4 and hatch_e.attrs["path_count"] == 1
    assert res.stats["skipped:POINT"] == 1
    assert any(w.code == "DXF_UNSUPPORTED_ENTITIES" for w in res.warnings)
    assert res.coordinate_system.scale == 1.0 and res.coordinate_system.unit == "unknown"
    assert any(w.code == "DXF_UNIT_UNKNOWN" for w in res.warnings)
    assert res.coordinate_system.source == "dxf_local"


def test_missing_file_returns_failed(tmp_path: Path) -> None:
    res = parse_dxf(tmp_path / "nope.dxf")
    assert res.status == "failed" and res.warnings[0].code == "DXF_OPEN_FAILED"
    assert res.coordinate_system.source == "dxf_local"
