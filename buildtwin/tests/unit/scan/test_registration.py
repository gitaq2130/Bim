"""정합: 기준점 → 알려진 변환 복원(1cm/0.5°), 기준점 없음 → needs_alignment_input, 마커 경로, rmse 초과 → registration_failed."""
from __future__ import annotations

import numpy as np
import pytest

from packages.core.models.coordinate import BBox3D
from packages.core.models.scan import AlignmentInput, ControlPoint, MarkerDefinition, MarkerObservation
from services.scan.loader import downsample, load_point_cloud
from services.scan.registration import (
    initial_transform_from_control_points,
    register,
    sample_reference_from_bboxes,
    umeyama_rigid,
)


def _rot_z_deg(m: np.ndarray) -> float:
    return float(np.degrees(np.arctan2(m[1, 0], m[0, 0])))


def test_control_points_recover_known_transform(alignment, expected):
    tf = initial_transform_from_control_points(alignment.control_points)
    assert tf.from_source == "scan_local" and tf.to_source == "ifc_local"
    assert tf.rmse is not None and tf.rmse < 0.01
    inv = tf.inverse().as_array()   # model → scan
    assert abs(_rot_z_deg(inv) - expected["scan_rotation_deg"]) < 0.5
    assert np.allclose(inv[:3, 3], expected["scan_translation"], atol=0.01)
    scan = np.array([c.scan_xyz for c in alignment.control_points])
    model = np.array([c.model_xyz for c in alignment.control_points])
    assert np.allclose(tf.apply(scan), model, atol=0.01)


def test_umeyama_is_rigid_without_scale():
    rng = np.random.default_rng(1)
    src = rng.uniform(-5, 5, (10, 3))
    t = np.radians(33.0)
    r = np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]])
    dst = (r @ (2.0 * src).T).T + [1, 2, 3]       # 스케일 2 를 넣어도 rigid 는 스케일을 흡수하지 않아야 한다
    m = umeyama_rigid(src, dst)
    assert np.isclose(np.linalg.det(m[:3, :3]), 1.0)
    assert np.allclose(m[:3, :3] @ m[:3, :3].T, np.eye(3), atol=1e-9)


def test_no_control_points_returns_needs_alignment_input(cfg):
    pts = np.random.default_rng(0).uniform(0, 1, (200, 3))
    reg = register(pts, AlignmentInput(), pts, cfg, scan_id="s")
    assert reg.status == "needs_alignment_input"
    assert reg.transform is None
    # 2점은 부족
    two = AlignmentInput(control_points=[ControlPoint(name="a", scan_xyz=(0, 0, 0), model_xyz=(0, 0, 0)),
                                         ControlPoint(name="b", scan_xyz=(1, 0, 0), model_xyz=(1, 0, 0))])
    assert register(pts, two, pts, cfg, scan_id="s").status == "needs_alignment_input"


def test_markers_joined_with_definitions(alignment):
    obs = [MarkerObservation(marker_id=f"M{i}", scan_xyz=c.scan_xyz) for i, c in enumerate(alignment.control_points)]
    defs = [MarkerDefinition(marker_id=f"M{i}", model_xyz=c.model_xyz) for i, c in enumerate(alignment.control_points)]
    al = AlignmentInput(marker_observations=obs, marker_definitions=defs + [MarkerDefinition(marker_id="unused", model_xyz=(9, 9, 9))])
    assert al.is_sufficient()
    from services.scan.registration import initial_transform_from_alignment

    tf, cps, method = initial_transform_from_alignment(al)
    assert method == "markers" and len(cps) == 4
    assert tf.rmse < 0.01


def test_register_fixture_scan_rmse_below_max(cfg, alignment, ifc_objects_1f, scan_ply, expected):
    cloud = load_point_cloud(scan_ply)
    assert cloud.point_count == expected["point_count"]
    pts = downsample(cloud.points, cfg.registration.voxel_size)
    bboxes = [BBox3D.model_validate(o["bbox"]) for o in ifc_objects_1f]
    ref, nrm = sample_reference_from_bboxes(bboxes, 1.0 / cfg.registration.reference_spacing ** 2)
    reg = register(pts, alignment, ref, cfg, scan_id="s", reference_normals=nrm)
    assert reg.status == "ok", reg.message
    assert reg.rmse is not None and reg.rmse < cfg.registration.max_rmse
    assert reg.fitness is not None and reg.fitness >= cfg.registration.min_fitness
    assert reg.method == "control_points+icp"
    assert reg.evidence is not None and reg.evidence.source_type == "scan"
    inv = reg.transform.inverse().as_array()
    assert abs(_rot_z_deg(inv) - expected["scan_rotation_deg"]) < 0.5
    assert np.allclose(inv[:3, 3], expected["scan_translation"], atol=0.01)


def test_register_fails_when_rmse_exceeds_max(cfg, alignment):
    """기준점은 맞지만 점군이 참조와 전혀 다른 위치 → rmse 가 max_rmse 를 넘어 registration_failed."""
    rng = np.random.default_rng(2)
    ref = rng.uniform(0, 5, (3000, 3))
    strict = cfg.model_copy(deep=True)
    strict.registration.max_rmse = 1e-6
    pts_scan = rng.uniform(0, 5, (3000, 3))
    reg = register(pts_scan, alignment, ref, strict, scan_id="s")
    assert reg.status == "registration_failed"
    assert reg.message and "max_rmse" in reg.message


@pytest.mark.parametrize("bad", [np.zeros((2, 3))])
def test_umeyama_requires_three_points(bad):
    with pytest.raises(ValueError):
        umeyama_rigid(bad, bad)
