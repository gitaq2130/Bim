"""객체 식별 — ADR 0001 §1. BimObject.global_id(IFC GlobalId)가 1차 키."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .coordinate import BBox2D, BBox3D
from .state import ObjectState

TARGET_IFC_TYPES: tuple[str, ...] = (
    "IfcColumn", "IfcBeam", "IfcSlab", "IfcWall", "IfcWallStandardCase",
    "IfcDuctSegment", "IfcDuctFitting", "IfcPipeSegment", "IfcPipeFitting",
    "IfcCableCarrierSegment", "IfcCableCarrierFitting", "IfcCurtainWall", "IfcPlate",
)

# 화면·집계용 공종 그룹
IFC_TYPE_GROUP: dict[str, str] = {
    "IfcColumn": "column", "IfcBeam": "beam", "IfcSlab": "slab",
    "IfcWall": "wall", "IfcWallStandardCase": "wall",
    "IfcDuctSegment": "duct", "IfcDuctFitting": "duct",
    "IfcPipeSegment": "pipe", "IfcPipeFitting": "pipe",
    "IfcCableCarrierSegment": "cable_tray", "IfcCableCarrierFitting": "cable_tray",
    "IfcCurtainWall": "facade_panel", "IfcPlate": "facade_panel",
}


class BimObjectDraft(BaseModel):
    """ingest 출력. 상태(state)는 없다 — progress-engine이 PLANNED로 초기화."""
    global_id: str = Field(min_length=1)
    ifc_type: str
    name: str | None = None
    level: str | None = None
    level_elevation: float | None = None
    zone: str | None = None
    bbox: BBox3D | None = None
    mesh_ref: str | None = None            # 저장된 메시 조각 URI
    psets: dict[str, dict[str, Any]] = Field(default_factory=dict)
    material: str | None = None
    quantity: dict[str, float] = Field(default_factory=dict)   # volume, area, length 등
    express_id: int | None = None

    @property
    def group(self) -> str:
        return IFC_TYPE_GROUP.get(self.ifc_type, "other")


class BimObject(BimObjectDraft):
    project_id: str
    model_id: str
    model_version: int = 1
    state: ObjectState = ObjectState.PLANNED
    is_orphaned: bool = False


class DrawingEntityDraft(BaseModel):
    """DXF 엔티티. 키 = (drawing_id, handle)."""
    handle: str
    layer: str
    dxftype: str
    points: list[tuple[float, float]] = Field(default_factory=list)   # 도면 좌표(원본 단위)
    bbox: BBox2D | None = None
    block_name: str | None = None
    insert_point: tuple[float, float] | None = None
    rotation_deg: float | None = None
    scale: tuple[float, float] | None = None
    text: str | None = None
    radius: float | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class DrawingEntity(DrawingEntityDraft):
    drawing_id: str
