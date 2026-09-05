"""포인트클라우드 로더. PLY(open3d/plyfile) · LAS/LAZ(laspy) · E57(pye57, 선택 의존성) → (N,3) float64 + 다운샘플.

담당: reality-capture. 좌표는 파일 좌표계(scan_local) 그대로 돌려준다 — 모델 좌표 변환은 registration이 한다.
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

import numpy as np

SUPPORTED_SUFFIXES: tuple[str, ...] = (".ply", ".las", ".laz", ".e57")


class PointCloudData(NamedTuple):
    points: np.ndarray        # (N,3) float64, 파일 좌표계
    point_count: int
    source_path: str
    format: str               # "ply" | "las" | "laz" | "e57"


def _as_xyz(arr: np.ndarray) -> np.ndarray:
    pts = np.asarray(arr, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] < 3:
        raise ValueError(f"point array must be (N,3), got {pts.shape}")
    return np.ascontiguousarray(pts[:, :3])


def _load_ply(path: Path) -> np.ndarray:
    import open3d as o3d

    pcd = o3d.io.read_point_cloud(str(path))
    pts = np.asarray(pcd.points)
    if len(pts) == 0:
        # open3d가 못 읽는 변형 PLY(속성명 등)는 plyfile로 재시도
        from plyfile import PlyData

        ply = PlyData.read(str(path))
        v = ply["vertex"]
        pts = np.column_stack([v["x"], v["y"], v["z"]])
    return _as_xyz(pts)


def _load_las(path: Path) -> np.ndarray:
    import laspy

    try:
        las = laspy.read(str(path))
    except Exception as exc:  # LAZ 백엔드(lazrs/laszip) 부재 등
        if path.suffix.lower() == ".laz":
            raise RuntimeError(f"LAZ decode failed for {path.name}: install 'lazrs' or 'laszip' backend ({exc})") from exc
        raise
    # laspy는 scale/offset을 적용한 실좌표(x,y,z)를 제공한다
    return _as_xyz(np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)]))


def _load_e57(path: Path) -> np.ndarray:
    try:
        import pye57  # type: ignore[import-not-found]
    except ImportError as exc:
        raise NotImplementedError(
            "E57 loading requires the optional dependency 'pye57' (pip install pye57; needs libE57Format). "
            "Alternatively convert the E57 to PLY/LAS (e.g. CloudCompare) and upload that."
        ) from exc
    e57 = pye57.E57(str(path))
    chunks: list[np.ndarray] = []
    for i in range(e57.scan_count):
        data = e57.read_scan(i, ignore_missing_fields=True, transform=True)   # 스캔 pose 적용(파일 공통 좌표계)
        chunks.append(np.column_stack([data["cartesianX"], data["cartesianY"], data["cartesianZ"]]))
    if not chunks:
        raise ValueError(f"E57 file has no scans: {path}")
    return _as_xyz(np.vstack(chunks))


def load_point_cloud(path: str | Path) -> PointCloudData:
    """파일 확장자로 포맷을 고르고 (N,3) 점 배열과 점 개수를 돌려준다. 미지원 포맷은 ValueError."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"point cloud not found: {p}")
    suffix = p.suffix.lower()
    if suffix == ".ply":
        pts = _load_ply(p)
    elif suffix in (".las", ".laz"):
        pts = _load_las(p)
    elif suffix == ".e57":
        pts = _load_e57(p)
    else:
        raise ValueError(f"unsupported point cloud format '{suffix}' (supported: {', '.join(SUPPORTED_SUFFIXES)})")
    pts = pts[np.all(np.isfinite(pts), axis=1)]
    return PointCloudData(points=pts, point_count=int(len(pts)), source_path=str(p), format=suffix.lstrip("."))


def downsample(points: np.ndarray, voxel_size: float) -> np.ndarray:
    """open3d voxel_down_sample. voxel_size ≤ 0이면 그대로 반환."""
    import open3d as o3d

    pts = _as_xyz(points)
    if voxel_size <= 0 or len(pts) == 0:
        return pts
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)
    return _as_xyz(np.asarray(pcd.voxel_down_sample(float(voxel_size)).points))


__all__ = ["PointCloudData", "SUPPORTED_SUFFIXES", "downsample", "load_point_cloud"]
