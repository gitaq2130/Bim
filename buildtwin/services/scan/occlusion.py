"""가림(occlusion) 추정. 스캐너 위치에서 객체 bbox의 스캐너 쪽 면으로 레이를 쏘아, 다른 객체 bbox(슬랩 테스트) 또는
점군 밀집 구역(KD-tree)에 막히는 비율을 구한다.

담당: reality-capture. 임계값은 cfg에서만 읽는다. 아래 상수는 계산 예산(레이 개수)이지 판정 임계값이 아니다.

두 가지 비율을 낸다:
- `los_blocked_ratio` : 순수 기하 — 레이가 목표 표면에 닿기 전에 무언가에 막힌 비율
- `occlusion_ratio`   : 판정용 — 막혔고 *실제로 관측된 점도 없는* 표면 비율. 스캔에 그 표면의 점이 있으면(다중 스테이션 등)
                        기하적으로 가려 보여도 '확인불가'가 아니므로 관측된 셀은 제외한다.
객체 자신이 있을 수 있는 창(bbox + search_margin) 안의 점은 차폐물로 세지 않는다(위치불일치 객체가 스스로를 가리는 것 방지).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
from scipy.spatial import cKDTree

from packages.core.models.coordinate import BBox3D

from .config import ScanConfig
from .geometry import bbox_arrays, ray_aabb_interval, sample_faces

DEFAULT_MAX_RAYS = 400          # 객체당 레이 상한(계산 예산). 면 격자를 균등 추출한다.


@dataclass(frozen=True)
class OcclusionResult:
    occlusion_ratio: float          # 막힘 ∧ 미관측 비율 (판정에 사용)
    los_blocked_ratio: float        # 막힘 비율(기하)
    unobserved_ratio: float         # 미관측 표면 비율
    ray_count: int
    blocked_by_bbox: int
    blocked_by_points: int


def _subsample(n: int, k: int) -> np.ndarray:
    if n <= k:
        return np.arange(n)
    return np.unique(np.linspace(0, n - 1, k).astype(int))


def compute_occlusion(bbox: BBox3D, scanner_pos: Sequence[float] | np.ndarray, all_points_model: np.ndarray | None,
                      other_bboxes: Sequence[BBox3D], cfg: ScanConfig, *, tree: cKDTree | None = None,
                      max_rays: int = DEFAULT_MAX_RAYS) -> OcclusionResult:
    v = cfg.verdict
    scanner = np.asarray(scanner_pos, dtype=float).reshape(3)
    bmin, bmax = bbox_arrays(bbox)
    samples, _, _ = sample_faces(bmin, bmax, v.mismatch_offset, facing_from=scanner)
    if len(samples) == 0:                       # 스캐너가 bbox 안에 있거나 면이 없음 → 판단 불가 → 가림 0
        return OcclusionResult(0.0, 0.0, 0.0, 0, 0, 0)
    samples = samples[_subsample(len(samples), max_rays)]
    n = len(samples)
    if tree is None and all_points_model is not None and len(all_points_model) > 0:
        tree = cKDTree(np.asarray(all_points_model, dtype=float))

    vec = samples - scanner
    length = np.linalg.norm(vec, axis=1)
    length[length == 0] = np.finfo(float).eps
    dirs = vec / length[:, None]
    origins = np.tile(scanner, (n, 1))

    # 목표 창(자기 자신이 있을 수 있는 영역) 진입 거리 — 그 앞까지만 차폐 검사
    wmin, wmax = bmin - v.search_margin, bmax + v.search_margin
    t_in, _ = ray_aabb_interval(origins, dirs, wmin, wmax)
    t_end = np.clip(t_in, 0.0, length)          # 거리 단위(dirs 가 단위벡터)

    # 1) 다른 객체 bbox 슬랩 테스트
    blocked_bbox = np.zeros(n, dtype=bool)
    for ob in other_bboxes:
        omin, omax = bbox_arrays(ob)
        te, tx = ray_aabb_interval(origins, dirs, omin, omax)
        blocked_bbox |= (te <= tx) & (tx > 0) & (te > 0) & (te < t_end)

    # 2) 점군 밀집 구역: 레이를 따라 bbox_margin 간격으로 표본을 두고 그 반경 안에 점이 있으면 막힘
    blocked_pts = np.zeros(n, dtype=bool)
    if tree is not None:
        step = v.bbox_margin
        max_k = int(np.floor(t_end.max() / step)) if step > 0 else 0
        if max_k >= 1:
            ks = (np.arange(1, max_k + 1) * step)                       # (K,)
            valid = ks[None, :] < t_end[:, None]                          # (n,K)
            if valid.any():
                probe = origins[:, None, :] + dirs[:, None, :] * ks[None, :, None]   # (n,K,3)
                flat = probe[valid]
                d, _ = tree.query(flat, k=1, distance_upper_bound=step)
                hit = np.zeros(valid.shape, dtype=bool)
                hit[valid] = np.isfinite(d)
                blocked_pts = hit.any(axis=1)

    blocked = blocked_bbox | blocked_pts
    if tree is not None:
        d_obs, _ = tree.query(samples, k=1, distance_upper_bound=v.mismatch_offset)
        unobserved = ~np.isfinite(d_obs)
    else:
        unobserved = np.ones(n, dtype=bool)
    return OcclusionResult(
        occlusion_ratio=float(np.mean(blocked & unobserved)),
        los_blocked_ratio=float(np.mean(blocked)),
        unobserved_ratio=float(np.mean(unobserved)),
        ray_count=int(n),
        blocked_by_bbox=int(blocked_bbox.sum()),
        blocked_by_points=int(blocked_pts.sum()),
    )


def occlusion_ratio(bbox: BBox3D, scanner_pos: Sequence[float] | np.ndarray, all_points_model: np.ndarray | None,
                    other_bboxes: Sequence[BBox3D], cfg: ScanConfig, *, tree: cKDTree | None = None,
                    max_rays: int = DEFAULT_MAX_RAYS) -> float:
    """판정용 가림 비율(막힘 ∧ 미관측). 세부값이 필요하면 compute_occlusion."""
    return compute_occlusion(bbox, scanner_pos, all_points_model, other_bboxes, cfg, tree=tree, max_rays=max_rays).occlusion_ratio


__all__ = ["DEFAULT_MAX_RAYS", "OcclusionResult", "compute_occlusion", "occlusion_ratio"]
