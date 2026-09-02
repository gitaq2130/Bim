"""도면(DXF) 좌표계 ↔ 모델(IFC 월드) 좌표계 변환과 그리드선 자동 정합. 담당: sync-2d3d.

정합 파라미터(DrawingAlignment)는 사용자 입력 또는 그리드 자동 정합에서만 온다 — 코드 상수 금지(CLAUDE.md §3-6).

좌표 관계(정의):
    drawing_m = R(rotation_deg) · model_xy + origin        (drawing_m = 도면 원본 단위 좌표 × scale)
  즉 origin = 모델 원점이 도면 위에 놓이는 위치(m), rotation_deg = 모델 X축이 도면에서 반시계로 돌아간 각도.
  역방향(도면 → 모델):
    model_xy = R(-rotation_deg) · (scale · p_drawing − origin)
  이는 CoordinateSystem(origin' = −R(−θ)·origin, rotation' = −θ, scale) 에 CoordinateTransform.from_system 을
  적용한 것과 같다(from_system: model = R·s·p + origin'). to_coordinate_system()이 그 변환을 만든다.
"""
from __future__ import annotations

import logging
import math
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field
from scipy.spatial import cKDTree

from packages.core.models import BimObjectDraft, CoordinateSystem, CoordinateTransform, DrawingEntityDraft

from .config import SyncConfig, load_sync_config
from .rules import match_any

log = logging.getLogger(__name__)

AlignmentSource = Literal["user_input", "grid_auto_align"]
_UNIT_NAMES = {1.0: "m", 0.001: "mm", 0.01: "cm", 0.0254: "in", 0.3048: "ft"}
_LINE_DXFTYPES = ("LINE", "LWPOLYLINE", "POLYLINE", "XLINE", "RAY")


def _rot2(deg: float) -> np.ndarray:
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s], [s, c]])


def normalize_deg(deg: float) -> float:
    """(-180, 180] 로 정규화."""
    d = (deg + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


class DrawingAlignment(BaseModel):
    """도면 → 모델 정합 파라미터. 값은 사용자 입력(user_input) 또는 그리드 자동 정합(grid_auto_align)에서 온다."""
    origin: tuple[float, float]                 # 모델 원점의 도면 좌표(m)
    rotation_deg: float                          # 모델 X축이 도면에서 회전한 각도(반시계 +)
    scale: float = Field(gt=0.0)                 # 도면 1단위 → m
    source: AlignmentSource
    rmse: float | None = None                    # 자동 정합 잔차(m)
    n_correspondences: int | None = None
    notes: str | None = None

    def to_coordinate_system(self) -> CoordinateSystem:
        """도면 좌표계 정의 — CoordinateTransform.from_system 으로 곧바로 도면→모델 변환이 된다."""
        t = -(_rot2(-self.rotation_deg) @ np.asarray(self.origin, dtype=float))
        return CoordinateSystem(
            source=self.source, origin=(float(t[0]), float(t[1]), 0.0), rotation_deg=-self.rotation_deg,
            scale=self.scale, unit=_UNIT_NAMES.get(self.scale, "drawing_unit"), notes=self.notes,
        )

    def drawing_to_model(self, pts: np.ndarray) -> np.ndarray:
        """(N,2) 도면 원본 단위 → (N,2) 모델(m)."""
        p = np.asarray(pts, dtype=float).reshape(-1, 2)
        return (_rot2(-self.rotation_deg) @ (self.scale * p - np.asarray(self.origin)).T).T

    def model_to_drawing(self, pts: np.ndarray) -> np.ndarray:
        """(N,2) 모델(m) → (N,2) 도면 원본 단위."""
        p = np.asarray(pts, dtype=float).reshape(-1, 2)
        return ((_rot2(self.rotation_deg) @ p.T).T + np.asarray(self.origin)) / self.scale


def alignment_to_transform(alignment: DrawingAlignment) -> CoordinateTransform:
    """DrawingAlignment → CoordinateTransform(도면 원본 단위 → 모델 m)."""
    tr = CoordinateTransform.from_system(alignment.to_coordinate_system())
    return tr.model_copy(update={"rmse": alignment.rmse, "method": alignment.source, "to_source": "ifc_local"})


def alignment_from_similarity(rotation_deg: float, translation: np.ndarray, scale: float, source: AlignmentSource,
                              rmse: float | None = None, n_correspondences: int | None = None,
                              notes: str | None = None) -> DrawingAlignment:
    """도면→모델 유사변환(model = R(φ)·s·p + t)에서 DrawingAlignment(origin, rotation) 복원."""
    phi = float(rotation_deg)
    origin = -(_rot2(-phi) @ np.asarray(translation, dtype=float))
    return DrawingAlignment(origin=(float(origin[0]), float(origin[1])), rotation_deg=normalize_deg(-phi), scale=scale,
                            source=source, rmse=rmse, n_correspondences=n_correspondences, notes=notes)


def transform_points_2d(transform: CoordinateTransform, pts: list[tuple[float, float]] | np.ndarray) -> np.ndarray:
    arr = np.asarray(pts, dtype=float).reshape(-1, 2)
    if len(arr) == 0:
        return arr
    return transform.apply(arr)[:, :2]


# ---------------------------------------------------------------- 그리드선 추출
class GridAlignResult(BaseModel):
    alignment: DrawingAlignment | None = None
    reason: str | None = None
    n_grid_lines: int = 0
    n_intersections: int = 0
    n_inliers: int = 0
    rmse: float | None = None
    ambiguous: bool = False


def select_grid_lines(entities: list[DrawingEntityDraft], grid_layers: list[str]) -> list[np.ndarray]:
    """그리드 레이어의 2점 선형 엔티티 → [(2,2) 배열]. 도면 원본 단위."""
    lines: list[np.ndarray] = []
    for e in entities:
        if not match_any(e.layer, grid_layers) or e.dxftype not in _LINE_DXFTYPES:
            continue
        if len(e.points) != 2:
            continue
        seg = np.asarray(e.points, dtype=float)
        if np.linalg.norm(seg[1] - seg[0]) <= 0.0:
            continue
        lines.append(seg)
    return lines


def _direction_deg(seg: np.ndarray) -> float:
    d = seg[1] - seg[0]
    return math.degrees(math.atan2(d[1], d[0])) % 180.0


def _angle_diff_180(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def cluster_line_directions(lines: list[np.ndarray], tol_deg: float) -> list[list[int]]:
    """방향(mod 180°)이 tol 안에 있는 선들을 묶는다. 큰 군집부터 반환."""
    clusters: list[tuple[float, list[int]]] = []   # (대표각, 인덱스)
    for i, seg in enumerate(lines):
        a = _direction_deg(seg)
        for k, (rep, idx) in enumerate(clusters):
            if _angle_diff_180(a, rep) <= tol_deg:
                idx.append(i)
                # 대표각은 배각 벡터 평균으로 갱신(0/180 경계 안전)
                angs = [_direction_deg(lines[j]) for j in idx]
                vx = sum(math.cos(math.radians(2 * x)) for x in angs)
                vy = sum(math.sin(math.radians(2 * x)) for x in angs)
                clusters[k] = (math.degrees(math.atan2(vy, vx)) / 2.0 % 180.0, idx)
                break
        else:
            clusters.append((a, [i]))
    clusters.sort(key=lambda c: -len(c[1]))
    return [idx for _, idx in clusters]


def line_intersection(a: np.ndarray, b: np.ndarray) -> np.ndarray | None:
    """두 무한직선(각각 (2,2) 세그먼트로 정의)의 교점. 평행이면 None."""
    p, r = a[0], a[1] - a[0]
    q, s = b[0], b[1] - b[0]
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12 * (np.linalg.norm(r) * np.linalg.norm(s) + 1e-300):
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
    return p + t * r


def grid_intersections(lines: list[np.ndarray], cfg: SyncConfig) -> tuple[np.ndarray, str | None]:
    """두 직교 방향군의 교점(도면 단위). 실패 시 (빈 배열, 사유)."""
    if len(lines) < 2:
        return np.zeros((0, 2)), "fewer than 2 grid lines"
    clusters = cluster_line_directions(lines, cfg.grid_angle_tolerance_deg)
    if len(clusters) < 2:
        return np.zeros((0, 2)), "grid lines form a single direction family"
    fam_a, fam_b = clusters[0], clusters[1]
    rep_a = _direction_deg(lines[fam_a[0]])
    rep_b = _direction_deg(lines[fam_b[0]])
    if abs(_angle_diff_180(rep_a, rep_b) - 90.0) > cfg.grid_orthogonality_tolerance_deg:
        return np.zeros((0, 2)), "two largest direction families are not orthogonal"
    pts = [line_intersection(lines[i], lines[j]) for i in fam_a for j in fam_b]
    arr = np.array([p for p in pts if p is not None], dtype=float).reshape(-1, 2)
    return arr, None


# ---------------------------------------------------------------- 유사변환 추정
def kabsch_2d(P: np.ndarray, Q: np.ndarray, fixed_scale: float | None = None) -> tuple[float, np.ndarray, float, float]:
    """P(도면, 단위 임의) → Q(모델) 최소자승 유사변환. fixed_scale이 있으면 회전+이동만(Kabsch), 없으면 Umeyama.
    반환: (rotation_deg, translation(2,), scale, rmse). model ≈ R·s·p + t."""
    P = np.asarray(P, dtype=float).reshape(-1, 2)
    Q = np.asarray(Q, dtype=float).reshape(-1, 2)
    pc, qc = P.mean(axis=0), Q.mean(axis=0)
    P0, Q0 = P - pc, Q - qc
    H = P0.T @ Q0
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1.0, d if d != 0 else 1.0])
    R = Vt.T @ D @ U.T
    if fixed_scale is None:
        var_p = (P0 ** 2).sum()
        s = float((S * np.diag(D)).sum() / var_p) if var_p > 0 else 1.0
    else:
        s = float(fixed_scale)
    t = qc - s * (R @ pc)
    res = Q - (s * (R @ P.T).T + t)
    rmse = float(np.sqrt((res ** 2).sum(axis=1).mean())) if len(P) else 0.0
    return math.degrees(math.atan2(R[1, 0], R[0, 0])), t, s, rmse


def _inliers(D: np.ndarray, M: np.ndarray, tree: cKDTree, rot_deg: float, t: np.ndarray, s: float,
             tol: float) -> tuple[np.ndarray, np.ndarray, float]:
    """D를 변환해 M의 최근접점과 짝짓기. (drawing idx, model idx, rmse) — 모델점 중복 배정은 가까운 쪽만 남긴다."""
    X = s * (_rot2(rot_deg) @ D.T).T + t
    dist, idx = tree.query(X)
    order = np.argsort(dist)
    used: set[int] = set()
    di: list[int] = []
    mi: list[int] = []
    for k in order:
        if dist[k] > tol:
            break
        if idx[k] in used:
            continue
        used.add(int(idx[k]))
        di.append(int(k))
        mi.append(int(idx[k]))
    if not di:
        return np.zeros(0, dtype=int), np.zeros(0, dtype=int), math.inf
    rmse = float(np.sqrt((dist[di] ** 2).mean()))
    return np.array(di), np.array(mi), rmse


def solve_grid_correspondence(D: np.ndarray, M: np.ndarray, unit_scale: float | None, tol: float,
                              cfg: SyncConfig, seed: int = 0) -> tuple[float, np.ndarray, float, float, int, bool] | None:
    """대응 미지의 점집합 D(도면 단위) ↔ M(모델 m)을 2점 쌍 가설(RANSAC)로 정렬한 뒤 Kabsch/Umeyama로 정제.
    반환: (rotation_deg, t, scale, rmse, n_inliers, ambiguous). 그리드가 대칭이면 여러 해가 동률이므로 |회전| 최소를 택한다."""
    n, m = len(D), len(M)
    if n < 2 or m < 2:
        return None
    rng = np.random.default_rng(seed)
    tree = cKDTree(M)
    d_pairs = [(i, j) for i in range(n) for j in range(n) if i != j]
    if len(d_pairs) > cfg.grid_max_hypothesis_pairs:
        d_pairs = [d_pairs[k] for k in rng.choice(len(d_pairs), cfg.grid_max_hypothesis_pairs, replace=False)]
    m_pairs = np.array([(k, l) for k in range(m) for l in range(m) if k != l], dtype=int)
    m_vec = M[m_pairs[:, 1]] - M[m_pairs[:, 0]]
    m_len = np.linalg.norm(m_vec, axis=1)
    m_order = np.argsort(m_len)
    m_len_sorted = m_len[m_order]

    best: list[tuple[int, float, float, np.ndarray, float]] = []   # (inliers, rmse, rot, t, s)
    best_inliers = 0
    for i, j in d_pairs:
        dv = D[j] - D[i]
        dl = float(np.linalg.norm(dv))
        if dl <= 0.0:
            continue
        if unit_scale is not None:
            lo = np.searchsorted(m_len_sorted, dl * unit_scale - tol, side="left")
            hi = np.searchsorted(m_len_sorted, dl * unit_scale + tol, side="right")
            cand = m_order[lo:hi]
        else:
            cand = m_order
        ang_d = math.atan2(dv[1], dv[0])
        for c in cand:
            k, l = m_pairs[c]
            s = unit_scale if unit_scale is not None else float(m_len[c] / dl)
            rot = math.degrees(math.atan2(m_vec[c][1], m_vec[c][0]) - ang_d)
            t = M[k] - s * (_rot2(rot) @ D[i])
            di, mi, rmse = _inliers(D, M, tree, rot, t, s, tol)
            if len(di) < 2 or len(di) < best_inliers:
                continue
            if len(di) > best_inliers:
                best_inliers, best = len(di), []
            best.append((len(di), rmse, normalize_deg(rot), t, s))
    if not best:
        return None

    # 동률 가설들을 정제한 뒤 rmse → |회전| 순으로 고른다(대칭 그리드의 180° 모호성 처리)
    refined: dict[tuple[int, int, int], tuple[float, np.ndarray, float, float, int]] = {}
    for _, _, rot, t, s in best:
        di, mi, _ = _inliers(D, M, tree, rot, t, s, tol)
        r2, t2, s2, _ = kabsch_2d(D[di], M[mi], fixed_scale=unit_scale if unit_scale is not None else None)
        di2, mi2, rmse2 = _inliers(D, M, tree, r2, t2, s2, tol)
        if len(di2) < 2:
            continue
        key = (int(round(normalize_deg(r2) * 2)), int(round(t2[0] / tol)), int(round(t2[1] / tol)))
        refined.setdefault(key, (normalize_deg(r2), t2, s2, rmse2, len(di2)))
    if not refined:
        return None
    sols = sorted(refined.values(), key=lambda v: (-v[4], round(v[3] / tol, 3), abs(v[0])))
    top = sols[0]
    ties = [v for v in sols if v[4] == top[4] and abs(v[3] - top[3]) <= tol * 1e-3]
    ambiguous = len({int(round(v[0])) for v in ties}) > 1
    if ambiguous:
        top = min(ties, key=lambda v: abs(v[0]))
    return top[0], top[1], top[2], top[3], top[4], ambiguous


def _grid_spacing(grid_x: list[float], grid_y: list[float]) -> float | None:
    diffs = [b - a for axis in (sorted(grid_x), sorted(grid_y)) for a, b in zip(axis, axis[1:]) if b - a > 0]
    return min(diffs) if diffs else None


def auto_align_by_grid_detailed(entities: list[DrawingEntityDraft], grid_x: list[float], grid_y: list[float],
                                grid_layers: list[str], unit_scale: float | None,
                                cfg: SyncConfig | None = None) -> GridAlignResult:
    """DXF 그리드선 교점 ↔ 모델 그리드(IfcGrid 축 또는 기둥 중심) 교점 최소자승 정합. 사유를 포함한 상세 결과."""
    cfg = cfg or load_sync_config()
    lines = select_grid_lines(entities, grid_layers)
    if not lines:
        return GridAlignResult(reason="no grid-layer line entities")
    D, why = grid_intersections(lines, cfg)
    res = GridAlignResult(n_grid_lines=len(lines), n_intersections=len(D))
    if why:
        res.reason = why
        return res
    if len(D) < cfg.grid_min_intersections:
        res.reason = f"only {len(D)} grid intersections (< {cfg.grid_min_intersections})"
        return res
    M = np.array([(gx, gy) for gx in grid_x for gy in grid_y], dtype=float).reshape(-1, 2)
    if len(M) < cfg.grid_min_intersections:
        res.reason = f"model grid has only {len(M)} intersections (< {cfg.grid_min_intersections})"
        return res
    spacing = _grid_spacing(grid_x, grid_y)
    if spacing is None:
        res.reason = "model grid spacing undefined"
        return res
    tol = cfg.grid_inlier_ratio * spacing
    sol = solve_grid_correspondence(D, M, unit_scale, tol, cfg)
    if sol is None:
        res.reason = "no consistent grid correspondence found"
        return res
    rot, t, s, rmse, n_in, ambiguous = sol
    res.n_inliers, res.rmse, res.ambiguous = n_in, rmse, ambiguous
    if n_in < cfg.grid_min_intersections:
        res.reason = f"only {n_in} inlier correspondences (< {cfg.grid_min_intersections})"
        return res
    notes = f"grid_auto_align: {n_in}/{len(D)} intersections, rmse={rmse:.4f}m"
    if ambiguous:
        notes += "; symmetric grid — smallest |rotation| chosen, confirm orientation"
    if unit_scale is None:
        notes += "; scale estimated (unit unknown)"
    res.alignment = alignment_from_similarity(rot, t, s, "grid_auto_align", rmse=rmse, n_correspondences=n_in, notes=notes)
    return res


def auto_align_by_grid(entities: list[DrawingEntityDraft], grid_x: list[float], grid_y: list[float],
                       grid_layers: list[str], unit_scale: float | None,
                       cfg: SyncConfig | None = None) -> DrawingAlignment | None:
    """그리드 자동 정합. 실패하면 None(사유는 로그, 상세는 auto_align_by_grid_detailed)."""
    res = auto_align_by_grid_detailed(entities, grid_x, grid_y, grid_layers, unit_scale, cfg)
    if res.alignment is None:
        log.info("auto_align_by_grid failed: %s", res.reason)
    return res.alignment


# ---------------------------------------------------------------- IfcGrid 없을 때의 폴백 그리드
def _cluster_1d(values: list[float], tol: float) -> list[float]:
    if not values:
        return []
    vs = sorted(values)
    groups: list[list[float]] = [[vs[0]]]
    for v in vs[1:]:
        if v - groups[-1][-1] > tol:
            groups.append([v])
        else:
            groups[-1].append(v)
    return [float(np.mean(g)) for g in groups]


def grid_from_ifc_objects(objects: list[BimObjectDraft], cfg: SyncConfig | None = None) -> tuple[list[float], list[float]]:
    """IfcGrid가 없을 때 기둥(IfcColumn) bbox 중심의 x/y 군집으로 그리드 축 값을 만든다."""
    cfg = cfg or load_sync_config()
    cols = [o for o in objects if o.ifc_type == "IfcColumn" and o.bbox is not None]
    if not cols:
        return [], []
    widths = [min(o.bbox.size[0], o.bbox.size[1]) for o in cols if o.bbox is not None]
    tol = cfg.grid_column_cluster_ratio * float(np.median(widths))
    tol = tol if tol > 0 else float(np.finfo(float).eps)
    xs = [o.bbox.center[0] for o in cols if o.bbox is not None]
    ys = [o.bbox.center[1] for o in cols if o.bbox is not None]
    return _cluster_1d(xs, tol), _cluster_1d(ys, tol)
