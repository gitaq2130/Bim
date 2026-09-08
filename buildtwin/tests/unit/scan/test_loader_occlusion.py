"""로더(PLY/LAS/E57 선택 의존성)와 가림 레이캐스트 단위 테스트."""
from __future__ import annotations

import importlib.util

import numpy as np
import pytest

from packages.core.models.coordinate import BBox3D
from services.scan.loader import downsample, load_point_cloud
from services.scan.occlusion import compute_occlusion, occlusion_ratio


def test_load_ply_and_downsample(scan_ply, expected, cfg):
    cloud = load_point_cloud(scan_ply)
    assert cloud.points.shape == (expected["point_count"], 3) and cloud.format == "ply"
    ds = downsample(cloud.points, cfg.registration.voxel_size)
    assert 0 < len(ds) <= cloud.point_count
    assert downsample(cloud.points, 0).shape == cloud.points.shape


def test_load_las_roundtrip(tmp_path):
    import laspy

    pts = np.random.default_rng(0).uniform(0, 10, (500, 3))
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    path = tmp_path / "t.las"
    las.write(str(path))
    cloud = load_point_cloud(path)
    assert cloud.format == "las" and np.allclose(cloud.points, pts, atol=0.001)


def test_unsupported_and_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_point_cloud(tmp_path / "nope.ply")
    bad = tmp_path / "x.xyz"
    bad.write_text("0 0 0\n")
    with pytest.raises(ValueError):
        load_point_cloud(bad)


@pytest.mark.skipif(importlib.util.find_spec("pye57") is not None, reason="pye57 installed")
def test_e57_without_pye57_gives_hint(tmp_path):
    p = tmp_path / "scan.e57"
    p.write_bytes(b"ASTM-E57")
    with pytest.raises(NotImplementedError, match="pye57"):
        load_point_cloud(p)


def test_occlusion_by_other_bbox_and_by_points(cfg):
    target = BBox3D(min=(10, -0.5, 0), max=(10.5, 0.5, 3))
    scanner = (0.0, 0.0, 1.5)
    blocker = BBox3D(min=(5, -2, 0), max=(5.3, 2, 4))
    assert occlusion_ratio(target, scanner, None, [blocker], cfg) == pytest.approx(1.0)
    assert occlusion_ratio(target, scanner, None, [], cfg) == 0.0
    # 점군 벽으로 막힘
    rng = np.random.default_rng(0)
    wall = np.column_stack([np.full(20000, 5.0), rng.uniform(-2, 2, 20000), rng.uniform(0, 4, 20000)])
    r = compute_occlusion(target, scanner, wall, [], cfg)
    assert r.los_blocked_ratio > cfg.verdict.occlusion_unverifiable and r.blocked_by_points > 0
    assert r.occlusion_ratio == pytest.approx(r.los_blocked_ratio)        # 관측 점 없음 → 막힘 = 가림
    # 목표 표면에 점이 관측되면(다중 스테이션 등) 가림으로 세지 않는다
    face = np.column_stack([np.full(5000, 10.0), rng.uniform(-0.5, 0.5, 5000), rng.uniform(0, 3, 5000)])
    r2 = compute_occlusion(target, scanner, np.vstack([wall, face]), [], cfg)
    assert r2.los_blocked_ratio > cfg.verdict.occlusion_unverifiable
    assert r2.occlusion_ratio < cfg.verdict.occlusion_unverifiable
    # 목표 자신의 허용 창 안의 점은 차폐물이 아니다
    own = np.column_stack([np.full(5000, 10.0 - cfg.verdict.mismatch_offset), rng.uniform(-0.5, 0.5, 5000), rng.uniform(0, 3, 5000)])
    assert compute_occlusion(target, scanner, own, [], cfg).los_blocked_ratio == 0.0
