"""모든 판정·전이에 붙는 근거(Evidence). 빈 근거는 허용하지 않는다(ADR 0001 §5)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .coordinate import BBox3D

EvidenceSourceType = Literal[
    "scan", "daily_report", "cm_action", "rule", "ingest", "mapping",
    "schedule", "material", "system_logic", "user_input",
    "document",   # ADR 0007 §3-2 규칙 4: 대장에서 온 근거. 기존 어느 축에도 속하지 않아 감사에서 구분되어야 한다
]


class Evidence(BaseModel):
    source_type: EvidenceSourceType
    source_id: str = Field(min_length=1)          # 파일 id, 리포트 id, 사용자 id, 태스크 id 등
    file_uri: str | None = None
    bbox: BBox3D | None = None
    coordinates: list[tuple[float, float, float]] | None = None
    rule_id: str | None = None
    method: str | None = None                     # 알고리즘/규칙명
    note: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("source_id")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("evidence.source_id must not be blank")
        return v


Confidence = Field(ge=0.0, le=1.0)
