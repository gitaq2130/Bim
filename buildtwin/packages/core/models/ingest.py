"""ingest 출력 계약."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .coordinate import CoordinateSystem
from .identity import BimObjectDraft, DrawingEntityDraft

IngestStatus = Literal["ok", "partial", "failed", "needs_ifc_export"]
# xlsx: 문서관리대장(ADR 0007 §8 규칙 1). 대장 CSV 는 받지 않는다 — csv 는 이미 공정표로 예약되어
# 있어 같은 확장자로 두 파이프라인을 구분할 수 없다(§8 규칙 3).
FileKind = Literal["ifc", "dxf", "dwg", "rvt", "e57", "las", "ply", "csv", "xml", "xer", "xlsx", "unknown"]


class IngestWarning(BaseModel):
    code: str
    message: str
    context: dict[str, Any] = Field(default_factory=dict)


class IngestResult(BaseModel):
    status: IngestStatus
    source_kind: FileKind
    objects: list[BimObjectDraft] = Field(default_factory=list)
    entities: list[DrawingEntityDraft] = Field(default_factory=list)
    warnings: list[IngestWarning] = Field(default_factory=list)
    coordinate_system: CoordinateSystem
    stats: dict[str, int] = Field(default_factory=dict)
    levels: list[dict[str, Any]] = Field(default_factory=list)   # [{name, elevation}]
    mesh_uri: str | None = None                                  # 전체 glTF/OBJ 조각 URI
