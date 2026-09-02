"""정합(registration): 기준점/마커 → Umeyama rigid 초기 변환 → Open3D point-to-plane ICP 정밀화.

담당: reality-capture. 규칙:
- 기준점 ≥3 또는 마커 ≥3 없이는 절대 시작하지 않는다(`needs_alignment_input`). ICP 단독 정합 금지.
- rmse > registration.max_rmse 또는 fitness < registration.min_fitness → `registration_failed`(판정 중단).
- 변환 값은 항상 입력(기준점)에서 계산한다. 코드 상수 변환 금지.
"""
from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from scipy.spatial import cKDTree

from packages.core.models.coordinate import BBox3D, CoordinateTransform
from packages.core.models.evidence import Evidence
from packages.core.models.scan import AlignmentInput, ControlPoint, Registration

from .config import ScanConfig
from .geometry import bbox_arrays, sample_faces

METHOD_CONTROL_POINTS = "control_points"
METHOD_MARKERS = "markers"
ICP_SUFFIX = "+icp"


# ------------------------------------------------------------------ 초기 변환 (Umeyama / Kabsch, scale 없음)
def umeyama_rigid(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """src(N,3) → dst(N,3) 를 최소자승으로 맞추는 rigid 4x4 (회전+이동, 스케일 1). SVD 기반, 반사(det<0) 보정."""
    src = np.asarray(src, dtype=float)
    dst = np.asarray(dst, dtype=float)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 3:
        raise ValueError("src/dst must both be (N,3)")
    if len(src) < 3:
        raise ValueError("rigid transform needs at least 3 correspondences")
    mu_s, mu_d = src.mean(axis=0), dst.mean(axis=0)
    h = (src - mu_s).T @ (dst - mu_d)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    s = np.diag([1.0, 1.0, d if d != 0 else 1.0])
    r = vt.T @ s @ u.T
    t = mu_d - r @ mu_s
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = t
    return m


def _cp_arrays(cps: Sequence[ControlPoint]) -> tuple[np.ndarray, np.ndarray]:
    return (np.array([c.scan_xyz for c in cps], dtype=float), np.array([c.model_xyz for c in cps], dtype=float))


def control_point_residual_rmse(cps: Sequence[ControlPoint], matrix: np.ndarray) -> float:
    scan, model = _cp_arrays(cps)
    h = np.hstack([scan, np.ones((len(scan), 1))])
    pred = (matrix @ h.T).T[:, :3]
    return float(np.sqrt(np.mean(np.sum((pred - model) ** 2, axis=1))))


def initial_transform_from_control_points(cps: Sequence[ControlPoint]) -> CoordinateTransform:
    """기준점 ≥3 → scan_local → ifc_local rigid 변환. rmse에는 기준점 잔차 RMSE를 기록."""
    if len(cps) < 3:
        raise ValueError(f"at least 3 control points are required, got {len(cps)}")
    scan, model = _cp_arrays(cps)
    m = umeyama_rigid(scan, model)
    return CoordinateTransform(matrix=m.tolist(), from_source="scan_local", to_source="ifc_local",
                               rmse=control_point_residual_rmse(cps, m), method=METHOD_CONTROL_POINTS)


def control_points_from_markers(alignment: AlignmentInput) -> list[ControlPoint]:
    """마커 관측(스캔 좌표) ⋈ 마커 정의(모델 좌표) → 기준점 목록. 정의에 없는 관측은 버린다."""
    defs = {d.marker_id: d.model_xyz for d in alignment.marker_definitions}
    return [ControlPoint(name=f"marker:{o.marker_id}", scan_xyz=o.scan_xyz, model_xyz=defs[o.marker_id])
            for o in alignment.marker_observations if o.marker_id in defs]


def initial_transform_from_alignment(alignment: AlignmentInput) -> tuple[CoordinateTransform, list[ControlPoint], str]:
    """AlignmentInput → (초기 변환, 사용한 대응점, 방법명). 기준점이 우선, 없으면 마커."""
    if len(alignment.control_points) >= 3:
        cps = list(alignment.control_points)
        method = METHOD_CONTROL_POINTS
    else:
        cps = control_points_from_markers(alignment)
        method = METHOD_MARKERS
    if len(cps) < 3:
        raise ValueError("alignment input insufficient (need ≥3 control points or ≥3 defined markers)")
    tf = initial_transform_from_control_points(cps)
    tf.method = method
    return tf, cps, method


# ------------------------------------------------------------------ BIM 참조 점군
def sample_reference_from_bboxes(bboxes: Sequence[BBox3D], density: float) -> tuple[np.ndarray, np.ndarray]:
    """객체 bbox 표면을 격자 샘플링해 ICP 참조 점군(모델 좌표)과 면 법선을 만든다. density: points/m² (간격 = 1/√density)."""
    if density <= 0:
        raise ValueError("reference density must be > 0")
    spacing = 1.0 / np.sqrt(density)
    pts: list[np.ndarray] = []
    nrm: list[np.ndarray] = []
    for b in bboxes:
        bmin, bmax = bbox_arrays(b)
        p, n, _ = sample_faces(bmin, bmax, spacing)
        pts.append(p)
        nrm.append(n)
    if not pts:
        return np.zeros((0, 3)), np.zeros((0, 3))
    return np.vstack(pts), np.vstack(nrm)


# ------------------------------------------------------------------ 정합
def _to_pcd(points: np.ndarray, normals: np.ndarray | None = None):
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.asarray(points, dtype=float))
    if normals is not None and len(normals) == len(points):
        pcd.normals = o3d.utility.Vector3dVector(np.asarray(normals, dtype=float))
    return pcd


def _fit_metrics(points_model: np.ndarray, reference_points: np.ndarray, cfg: ScanConfig) -> tuple[float, float, float]:
    """(fitness, inlier_rmse, inlier_ratio). fitness=대응(≤icp_max_distance) 비율, inlier_ratio=표면 허용치(≤surface_distance) 안 비율."""
    tree = cKDTree(reference_points)
    d, _ = tree.query(points_model, k=1, distance_upper_bound=cfg.registration.icp_max_distance)
    corr = np.isfinite(d)
    n = len(points_model)
    if n == 0 or not corr.any():
        return 0.0, float("inf"), 0.0
    fitness = float(corr.sum() / n)
    rmse = float(np.sqrt(np.mean(d[corr] ** 2)))
    inlier_ratio = float(np.sum(d[corr] <= cfg.verdict.surface_distance) / n)
    return fitness, rmse, inlier_ratio


def _apply(matrix: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return (matrix[:3, :3] @ pts.T).T + matrix[:3, 3]


def register(points: np.ndarray, alignment: AlignmentInput, reference_points: np.ndarray, cfg: ScanConfig, *,
             scan_id: str = "scan", reference_normals: np.ndarray | None = None,
             source_file: str | None = None) -> Registration:
    """스캔 점군(scan_local) → 모델 좌표(ifc_local) 정합.

    1) alignment.is_sufficient() 아니면 needs_alignment_input (ICP 단독 시작 금지)
    2) 기준점/마커 Umeyama 초기 변환
    3) Open3D point-to-plane ICP(Tukey 로버스트 커널, k=surface_distance)로 정밀화. ICP가 초기 변환보다 나빠지면 초기 변환 유지.
    4) rmse > max_rmse 또는 fitness < min_fitness → registration_failed
    """
    import open3d as o3d

    if not alignment.is_sufficient():
        return Registration(scan_id=scan_id, status="needs_alignment_input",
                            message="need ≥3 control points (scan↔model) or ≥3 detected markers with model coordinates; "
                                    "ICP-only registration is not allowed")
    points = np.asarray(points, dtype=float)
    reference_points = np.asarray(reference_points, dtype=float)
    init_tf, cps, method = initial_transform_from_alignment(alignment)
    init_m = init_tf.as_array()
    cp_rmse = init_tf.rmse or 0.0
    evidence_base = dict(source_type="scan", source_id=scan_id, file_uri=source_file,
                         coordinates=[tuple(map(float, c.model_xyz)) for c in cps])

    if len(reference_points) == 0 or len(points) == 0:
        return Registration(scan_id=scan_id, status="registration_failed", transform=None, rmse=None,
                            method=method, message="empty scan or empty BIM reference — cannot refine/validate",
                            evidence=Evidence(**evidence_base, method=method, extra={"cp_rmse": cp_rmse}))

    reg = cfg.registration
    src = _to_pcd(points)
    tgt = _to_pcd(reference_points, reference_normals)
    if not tgt.has_normals():
        tgt.estimate_normals()

    init_fitness, init_rmse, init_inlier = _fit_metrics(_apply(init_m, points), reference_points, cfg)
    kernel = o3d.pipelines.registration.TukeyLoss(k=cfg.verdict.surface_distance)
    estimation = o3d.pipelines.registration.TransformationEstimationPointToPlane(kernel)
    criteria = o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=reg.icp_max_iterations)
    result = o3d.pipelines.registration.registration_icp(src, tgt, reg.icp_max_distance, init_m, estimation, criteria)
    icp_m = np.asarray(result.transformation, dtype=float)
    icp_fitness, icp_rmse, icp_inlier = _fit_metrics(_apply(icp_m, points), reference_points, cfg)

    icp_accepted = np.isfinite(icp_rmse) and icp_rmse <= init_rmse and icp_fitness >= init_fitness * (init_rmse > 0 or 1.0) * 0 + init_fitness * 0 + 0.0 or icp_rmse <= init_rmse
    # ↑ 단순화: ICP 결과가 초기 변환의 잔차보다 나쁘지 않을 때만 채택
    icp_accepted = bool(np.isfinite(icp_rmse) and icp_rmse <= init_rmse)
    final_m, fitness, rmse, inlier = ((icp_m, icp_fitness, icp_rmse, icp_inlier) if icp_accepted
                                      else (init_m, init_fitness, init_rmse, init_inlier))
    method_full = method + ICP_SUFFIX
    extra = {
        "cp_count": len(cps), "cp_rmse": cp_rmse,
        "init_fitness": init_fitness, "init_rmse": init_rmse,
        "icp_fitness": icp_fitness, "icp_rmse": icp_rmse, "icp_accepted": icp_accepted,
        "icp_max_distance": reg.icp_max_distance, "icp_max_iterations": reg.icp_max_iterations,
        "scan_point_count": int(len(points)), "reference_point_count": int(len(reference_points)),
        "max_rmse": reg.max_rmse, "min_fitness": reg.min_fitness,
    }
    evidence = Evidence(**evidence_base, method=method_full, extra=extra)
    transform = CoordinateTransform(matrix=final_m.tolist(), from_source="scan_local", to_source="ifc_local",
                                    rmse=float(rmse) if np.isfinite(rmse) else None, method=method_full)

    if not np.isfinite(rmse) or rmse > reg.max_rmse:
        return Registration(scan_id=scan_id, status="registration_failed", transform=transform,
                            rmse=float(rmse) if np.isfinite(rmse) else None, fitness=fitness, inlier_ratio=inlier,
                            method=method_full, evidence=evidence,
                            message=f"rmse {rmse:.4f} m exceeds registration.max_rmse {reg.max_rmse} m — verdict aborted")
    if fitness < reg.min_fitness:
        return Registration(scan_id=scan_id, status="registration_failed", transform=transform, rmse=float(rmse),
                            fitness=fitness, inlier_ratio=inlier, method=method_full, evidence=evidence,
                            message=f"fitness {fitness:.3f} below registration.min_fitness {reg.min_fitness} — verdict aborted")
    note = None if icp_accepted else "ICP did not improve on the control-point transform; control-point transform kept"
    return Registration(scan_id=scan_id, status="ok", transform=transform, rmse=float(rmse), fitness=fitness,
                        inlier_ratio=inlier, method=method_full, evidence=evidence, message=note)


__all__ = [
    "control_point_residual_rmse", "control_points_from_markers", "initial_transform_from_alignment",
    "initial_transform_from_control_points", "register", "sample_reference_from_bboxes", "umeyama_rigid",
]
