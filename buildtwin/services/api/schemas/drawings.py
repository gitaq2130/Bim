from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from packages.core.models.coordinate import BBox2D, CoordinateSystem


class ModelSummary(BaseModel):
    model_id: str
    project_id: str
    name: str | None = None
    model_uri: str                      # 메시 번들(JSON) URL: /api/models/{id}/mesh
    obj_uri: str | None = None          # OBJ URL: /api/models/{id}/mesh.obj
    levels: list[dict[str, Any]] = Field(default_factory=list)
    coordinate_system: CoordinateSystem
    version: int = 1
    file_id: str | None = None
    stats: dict[str, Any] = Field(default_factory=dict)


class DrawingSummary(BaseModel):
    drawing_id: str
    project_id: str
    name: str | None = None
    level: str | None = None
    coordinate_system: CoordinateSystem
    alignment: dict[str, Any] | None = None
    svg_uri: str | None = None
    file_id: str | None = None
    stats: dict[str, Any] = Field(default_factory=dict)


class DrawingEntityView(BaseModel):
    handle: str
    layer: str
    dxftype: str
    points: list[tuple[float, float]] = Field(default_factory=list)
    bbox: BBox2D | None = None
    block_name: str | None = None
    insert_point: tuple[float, float] | None = None
    rotation_deg: float | None = None
    scale: tuple[float, float] | None = None
    text: str | None = None
    radius: float | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class DrawingEntitiesResponse(BaseModel):
    drawing_id: str
    project_id: str
    level: str | None = None
    entities: list[DrawingEntityView]
    coordinate_system: CoordinateSystem
    alignment: dict[str, Any] | None = None
    svg_uri: str | None = None


class AlignmentRequest(BaseModel):
    """도면→모델 정합 파라미터(사용자 입력). services.sync.transform.DrawingAlignment 과 동일 의미."""
    origin: tuple[float, float]
    rotation_deg: float
    scale: float = Field(gt=0.0)
    source: Literal["user_input"] = "user_input"
    notes: str | None = None


class ConfirmMappingRequest(BaseModel):
    global_id: str = Field(min_length=1)
    note: str | None = None


class PlanSectionPolyline(BaseModel):
    globalId: str
    ifc_type: str | None = None
    points: list[tuple[float, float]]


class PlanSectionView(BaseModel):
    """viewer 타입(PlanSection) 과 맞추기 위해 camelCase 키를 쓴다."""
    level: str | None
    elevation: float
    cut_elevation: float
    coordinateSystem: CoordinateSystem
    polylines: list[PlanSectionPolyline]
