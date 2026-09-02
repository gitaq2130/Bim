"""좌표계 모델. 원점·회전·스케일은 항상 이 객체로 전달한다(하드코딩 금지, ADR 0001 §2)."""
from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

CoordinateSource = Literal[
    "ifc_local", "ifc_mapconversion", "dxf_local", "user_input",
    "grid_auto_align", "control_points", "markers", "icp_refined", "scan_local",
]


class BBox3D(BaseModel):
    min: tuple[float, float, float]
    max: tuple[float, float, float]

    @property
    def center(self) -> tuple[float, float, float]:
        return tuple((a + b) / 2 for a, b in zip(self.min, self.max))  # type: ignore[return-value]

    @property
    def size(self) -> tuple[float, float, float]:
        return tuple(b - a for a, b in zip(self.min, self.max))  # type: ignore[return-value]

    def expanded(self, margin: float) -> "BBox3D":
        return BBox3D(min=tuple(v - margin for v in self.min), max=tuple(v + margin for v in self.max))  # type: ignore[arg-type]

    def to_2d(self) -> "BBox2D":
        return BBox2D(min=(self.min[0], self.min[1]), max=(self.max[0], self.max[1]))


class BBox2D(BaseModel):
    min: tuple[float, float]
    max: tuple[float, float]

    def area(self) -> float:
        return max(0.0, self.max[0] - self.min[0]) * max(0.0, self.max[1] - self.min[1])

    def iou(self, other: "BBox2D") -> float:
        ix0, iy0 = max(self.min[0], other.min[0]), max(self.min[1], other.min[1])
        ix1, iy1 = min(self.max[0], other.max[0]), min(self.max[1], other.max[1])
        inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
        union = self.area() + other.area() - inter
        return inter / union if union > 0 else 0.0

    def intersects(self, other: "BBox2D") -> bool:
        return not (self.max[0] < other.min[0] or other.max[0] < self.min[0]
                    or self.max[1] < other.min[1] or other.max[1] < self.min[1])


class CoordinateSystem(BaseModel):
    """어떤 파일/데이터의 좌표계 정의. 모델(IFC 월드) 좌표계로 가는 변환의 근거."""
    source: CoordinateSource
    origin: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation_deg: float = 0.0            # Z축 회전(도). 진북 등
    scale: float = 1.0                    # 이 좌표계 1단위 → 미터
    unit: str = "m"
    epsg: int | None = None
    extent: BBox3D | None = None
    notes: str | None = None


class CoordinateTransform(BaseModel):
    """4x4 동차 변환행렬(행 우선). from_system 좌표 → to_system 좌표."""
    matrix: list[list[float]] = Field(default_factory=lambda: np.eye(4).tolist())
    from_source: CoordinateSource
    to_source: CoordinateSource = "ifc_local"
    rmse: float | None = None
    method: str | None = None

    @classmethod
    def identity(cls, from_source: CoordinateSource) -> "CoordinateTransform":
        return cls(from_source=from_source)

    @classmethod
    def from_system(cls, cs: CoordinateSystem) -> "CoordinateTransform":
        """CoordinateSystem(origin/rotation/scale) → 모델 좌표계 변환행렬."""
        t = np.radians(cs.rotation_deg)
        c, s = np.cos(t), np.sin(t)
        m = np.eye(4)
        m[:3, :3] = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]) * cs.scale
        m[:3, 3] = cs.origin
        return cls(matrix=m.tolist(), from_source=cs.source, method="coordinate_system")

    def as_array(self) -> np.ndarray:
        return np.asarray(self.matrix, dtype=float)

    def apply(self, pts: np.ndarray) -> np.ndarray:
        pts = np.asarray(pts, dtype=float)
        if pts.ndim == 1:
            pts = pts[None, :]
        if pts.shape[1] == 2:
            pts = np.hstack([pts, np.zeros((len(pts), 1))])
        h = np.hstack([pts, np.ones((len(pts), 1))])
        return (self.as_array() @ h.T).T[:, :3]

    def inverse(self) -> "CoordinateTransform":
        return CoordinateTransform(matrix=np.linalg.inv(self.as_array()).tolist(),
                                   from_source=self.to_source, to_source=self.from_source,
                                   rmse=self.rmse, method=self.method)

    def apply_bbox(self, b: BBox3D) -> BBox3D:
        corners = np.array([[x, y, z] for x in (b.min[0], b.max[0]) for y in (b.min[1], b.max[1]) for z in (b.min[2], b.max[2])])
        t = self.apply(corners)
        return BBox3D(min=tuple(t.min(axis=0)), max=tuple(t.max(axis=0)))  # type: ignore[arg-type]
