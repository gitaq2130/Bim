"""좌표계 변환·그리드 자동 정합 테스트."""
from __future__ import annotations

import numpy as np
import pytest

from services.sync.config import load_sync_config
from services.sync.rules import load_layer_rules
from services.sync.transform import (
    DrawingAlignment,
    alignment_from_similarity,
    alignment_to_transform,
    auto_align_by_grid,
    auto_align_by_grid_detailed,
    grid_from_ifc_objects,
    kabsch_2d,
)

from tests.helpers.sync_fixtures import load_dxf_entities, load_ifc_objects, load_json, true_alignment


@pytest.fixture(scope="module")
def dxf():
    return load_dxf_entities()


@pytest.fixture(scope="module")
def objects():
    return load_ifc_objects()


def test_alignment_transform_maps_drawing_onto_model(dxf):
    """진짜 정합값으로 A-COL 폴리라인 3A(기둥 C1-11)의 중심이 모델 원점(0,0)에 온다."""
    entities, _ = dxf
    tr = alignment_to_transform(true_alignment())
    e = next(x for x in entities if x.handle == "3A")
    pts = tr.apply(np.array(e.points))[:, :2]
    assert np.allclose(pts.mean(axis=0), (0.0, 0.0), atol=1e-6)
    assert np.allclose(np.ptp(pts, axis=0), (0.6, 0.6), atol=1e-6)
    # 역변환 왕복
    back = tr.inverse().apply(pts)[:, :2]
    assert np.allclose(back, np.array(e.points), atol=1e-6)
    assert tr.from_source == "user_input" and tr.to_source == "ifc_local"


def test_alignment_roundtrip_similarity():
    a = DrawingAlignment(origin=(12.5, -3.0), rotation_deg=37.0, scale=0.01, source="user_input")
    m = a.to_coordinate_system()
    tr = alignment_to_transform(a)
    p = np.array([[100.0, 200.0], [-50.0, 10.0]])
    assert np.allclose(tr.apply(p)[:, :2], a.drawing_to_model(p))
    assert np.allclose(a.model_to_drawing(a.drawing_to_model(p)), p)
    A = np.asarray(tr.matrix)
    b = alignment_from_similarity(np.degrees(np.arctan2(A[1, 0], A[0, 0])), A[:2, 3], m.scale, "user_input")
    assert b.rotation_deg == pytest.approx(37.0) and b.origin == pytest.approx((12.5, -3.0))


def test_kabsch_recovers_known_similarity():
    rng = np.random.default_rng(1)
    P = rng.uniform(-10, 10, (8, 2))
    t = np.array([3.0, -2.0])
    from services.sync.transform import _rot2
    Q = 0.5 * (_rot2(-25.0) @ P.T).T + t
    r, tt, s, rmse = kabsch_2d(P, Q, fixed_scale=0.5)
    assert r == pytest.approx(-25.0, abs=1e-9) and np.allclose(tt, t) and rmse < 1e-9
    r2, _, s2, _ = kabsch_2d(P, Q)
    assert r2 == pytest.approx(-25.0, abs=1e-9) and s2 == pytest.approx(0.5)


def test_auto_align_by_grid_recovers_fixture_alignment(dxf):
    entities, unit_scale = dxf
    exp = load_json("sample.dxf.expected.json")["alignment"]
    ifc = load_json("sample.ifc.expected.json")
    res = auto_align_by_grid_detailed(entities, ifc["grid_x"], ifc["grid_y"], load_layer_rules().grid_layers, unit_scale)
    assert res.alignment is not None, res.reason
    a = res.alignment
    print(f"\nauto_align: rotation={a.rotation_deg:.4f} origin={a.origin} rmse={a.rmse:.5f} inliers={res.n_inliers}/{res.n_intersections}")
    assert res.n_intersections == 6 and res.n_inliers == 6
    assert a.source == "grid_auto_align" and a.scale == unit_scale
    assert abs(a.rotation_deg - exp["rotation_deg"]) <= 0.5
    assert np.hypot(a.origin[0] - exp["origin_m"][0], a.origin[1] - exp["origin_m"][1]) <= 0.05
    assert a.rmse is not None and a.rmse < 0.01
    # 대칭 그리드(3x2)라 180° 모호성이 있음을 결과가 알린다
    assert res.ambiguous is True and "symmetric" in (a.notes or "")


def test_auto_align_without_unit_scale_estimates_scale(dxf):
    entities, unit_scale = dxf
    ifc = load_json("sample.ifc.expected.json")
    a = auto_align_by_grid(entities, ifc["grid_x"], ifc["grid_y"], load_layer_rules().grid_layers, None)
    assert a is not None
    assert a.scale == pytest.approx(unit_scale, rel=1e-3)
    assert abs(a.rotation_deg - 15.0) <= 0.5


def test_auto_align_returns_none_when_too_few_intersections(dxf):
    entities, unit_scale = dxf
    grid_layers = load_layer_rules().grid_layers
    only_vertical = [e for e in entities if e.handle in ("35", "36", "37")]   # 한 방향군만
    res = auto_align_by_grid_detailed(only_vertical, [0, 6, 12], [0, 8], grid_layers, unit_scale)
    assert res.alignment is None and res.reason
    two_lines = [e for e in entities if e.handle in ("35", "38")]             # 교점 1개
    res = auto_align_by_grid_detailed(two_lines, [0, 6, 12], [0, 8], grid_layers, unit_scale)
    assert res.alignment is None and "intersections" in res.reason
    assert auto_align_by_grid([], [0, 6], [0, 8], grid_layers, unit_scale) is None


def test_grid_from_ifc_objects_matches_expected_grid(objects):
    ifc = load_json("sample.ifc.expected.json")
    gx, gy = grid_from_ifc_objects(objects, load_sync_config())
    assert np.allclose(gx, ifc["grid_x"], atol=1e-6)
    assert np.allclose(gy, ifc["grid_y"], atol=1e-6)


def test_auto_align_with_column_grid_fallback(dxf, objects):
    entities, unit_scale = dxf
    gx, gy = grid_from_ifc_objects(objects)
    a = auto_align_by_grid(entities, gx, gy, load_layer_rules().grid_layers, unit_scale)
    assert a is not None and abs(a.rotation_deg - 15.0) <= 0.5
