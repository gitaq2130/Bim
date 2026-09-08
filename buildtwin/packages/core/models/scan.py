"""스캔 정합·판정 모델. ScanState에는 CONFIRMED가 없다(ADR 0001 불변식 3)."""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .coordinate import CoordinateTransform
from .evidence import Evidence


class ScanState(str, Enum):
    NOT_BUILT = "NOT_BUILT"
    IN_PROGRESS = "IN_PROGRESS"
    ESTIMATED_DONE = "ESTIMATED_DONE"
    MISMATCH = "MISMATCH"
    UNVERIFIABLE = "UNVERIFIABLE"


assert "CONFIRMED" not in ScanState.__members__


class ControlPoint(BaseModel):
    name: str
    scan_xyz: tuple[float, float, float]
    model_xyz: tuple[float, float, float]


class MarkerObservation(BaseModel):
    marker_id: str
    scan_xyz: tuple[float, float, float]


class MarkerDefinition(BaseModel):
    marker_id: str
    model_xyz: tuple[float, float, float]


class AlignmentInput(BaseModel):
    """기준점 ≥3 또는 마커 ≥3 중 하나는 반드시 있어야 정합을 시작한다."""
    control_points: list[ControlPoint] = Field(default_factory=list)
    marker_observations: list[MarkerObservation] = Field(default_factory=list)
    marker_definitions: list[MarkerDefinition] = Field(default_factory=list)
    scanner_position: tuple[float, float, float] | None = None   # 가림 추정용(스캔 좌표)

    def is_sufficient(self) -> bool:
        if len(self.control_points) >= 3:
            return True
        defined = {m.marker_id for m in self.marker_definitions}
        return len([o for o in self.marker_observations if o.marker_id in defined]) >= 3


RegistrationStatus = Literal["ok", "needs_alignment_input", "registration_failed"]


class Registration(BaseModel):
    scan_id: str
    status: RegistrationStatus
    transform: CoordinateTransform | None = None
    rmse: float | None = None
    fitness: float | None = None
    inlier_ratio: float | None = None
    method: str | None = None
    message: str | None = None
    evidence: Evidence | None = None


class ObjectDiff(BaseModel):
    prev_scan_id: str
    prev_state: ScanState
    curr_state: ScanState
    density_delta: float
    volume_delta: float | None = None


class ScanVerdict(BaseModel):
    scan_id: str
    global_id: str
    state: ScanState
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    diff_from_previous: ObjectDiff | None = None

    @model_validator(mode="after")
    def _no_confirmed(self) -> ScanVerdict:
        if str(self.state.value).upper() == "CONFIRMED":   # 방어: enum 조작 방지
            raise ValueError("scan verdict cannot be CONFIRMED")
        return self


class ScanVerdictBatch(BaseModel):
    scan_id: str
    registration: Registration
    verdicts: list[ScanVerdict]
    bbox_margin: float
    stats: dict[str, int] = Field(default_factory=dict)
