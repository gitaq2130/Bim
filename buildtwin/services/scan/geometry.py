"""AABB(bbox) 기하 유틸: 표면 샘플링, 표면 거리, 포함 판정, 레이-AABB 교차. verdict·occlusion·registration이 공유한다.

담당: reality-capture. 여기에는 판정 임계값이 없다(순수 기하).
"""
from __future__ import annotations

import numpy as np

from packages.core.models.coordinate import BBox3D

_AXES = (0, 1, 2)


def bbox_arrays(bbox: BBox3D) -> tuple[np.ndarray, np.ndarray]:
    return np.asarray(bbox.min, dtype=float), np.asarray(bbox.max, dtype=float)


def bbox_surface_area(bbox: BBox3D) -> float:
    sx, sy, sz = (max(0.0, v) for v in bbox.size)
    return 2.0 * (sx * sy + sy * sz + sz * sx)


def points_inside(points: np.ndarray, bmin: np.ndarray, bmax: np.ndarray) -> np.ndarray:
    """(N,3) → bool mask: bmin ≤ p ≤ bmax (경계 포함)."""
    return np.all((points >= bmin) & (points <= bmax), axis=1)


def distance_to_surface(points: np.ndarray, bmin: np.ndarray, bmax: np.ndarray) -> np.ndarray:
    """각 점에서 AABB 표면까지의 거리. 내부 점은 가장 가까운 면까지, 외부 점은 박스까지의 유클리드 거리."""
    pts = np.asarray(points, dtype=float)
    outside = np.maximum(np.maximum(bmin - pts, pts - bmax), 0.0)
    d_out = np.linalg.norm(outside, axis=1)
    inside_gap = np.minimum(pts - bmin, bmax - pts)
    d_in = np.min(inside_gap, axis=1)
    return np.where(d_out > 0, d_out, np.maximum(d_in, 0.0))


def sample_faces(bmin: np.ndarray, bmax: np.ndarray, spacing: float,
                 facing_from: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """AABB 6면을 격자(간격 spacing)로 샘플. facing_from(스캐너 위치)이 주어지면 그쪽을 향하는 면만.

    반환: (samples (M,3), normals (M,3), face_area_per_sample (M,)) — 셀 면적으로 가중 집계할 수 있다.
    """
    size = bmax - bmin
    out_p: list[np.ndarray] = []
    out_n: list[np.ndarray] = []
    out_a: list[np.ndarray] = []
    for ax in _AXES:
        u, v = [i for i in _AXES if i != ax]
        nu = max(1, int(np.ceil(size[u] / spacing))) if size[u] > 0 else 1
        nv = max(1, int(np.ceil(size[v] / spacing))) if size[v] > 0 else 1
        cu = bmin[u] + (np.arange(nu) + 0.5) * (size[u] / nu)
        cv = bmin[v] + (np.arange(nv) + 0.5) * (size[v] / nv)
        gu, gv = np.meshgrid(cu, cv, indexing="ij")
        cell_area = (size[u] / nu) * (size[v] / nv)
        for val, sign in ((bmin[ax], -1.0), (bmax[ax], 1.0)):
            normal = np.zeros(3)
            normal[ax] = sign
            if facing_from is not None:
                # 면의 법선 방향에 스캐너가 있어야 그 면이 보인다
                if sign * (facing_from[ax] - val) <= 0:
                    continue
            p = np.zeros((gu.size, 3))
            p[:, ax] = val
            p[:, u] = gu.ravel()
            p[:, v] = gv.ravel()
            out_p.append(p)
            out_n.append(np.tile(normal, (len(p), 1)))
            out_a.append(np.full(len(p), cell_area))
    if not out_p:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0)
    return np.vstack(out_p), np.vstack(out_n), np.concatenate(out_a)


def ray_aabb_interval(origins: np.ndarray, dirs: np.ndarray, bmin: np.ndarray, bmax: np.ndarray
                      ) -> tuple[np.ndarray, np.ndarray]:
    """슬랩 테스트. origin + t*dir 가 AABB에 들어가는 [t_entry, t_exit]. 교차 없으면 t_entry > t_exit."""
    with np.errstate(divide="ignore", invalid="ignore"):
        inv = 1.0 / dirs
        t0 = (bmin - origins) * inv
        t1 = (bmax - origins) * inv
    # dir==0 인 축: origin 이 슬랩 안이면 (-inf, +inf), 밖이면 교차 없음
    zero = dirs == 0
    inside_slab = (origins >= bmin) & (origins <= bmax)
    t0 = np.where(zero, np.where(inside_slab, -np.inf, np.inf), t0)
    t1 = np.where(zero, np.where(inside_slab, np.inf, -np.inf), t1)
    tmin = np.minimum(t0, t1)
    tmax = np.maximum(t0, t1)
    return tmin.max(axis=1), tmax.min(axis=1)


__all__ = ["bbox_arrays", "bbox_surface_area", "distance_to_surface", "points_inside", "ray_aabb_interval", "sample_faces"]
