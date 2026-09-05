"""매핑 모델. confidence·evidence·needs_review 필수."""
from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from .evidence import Evidence

MAPPING_REVIEW_THRESHOLD = 0.7   # config로 외부화 가능하나 계약값이므로 상수로 둔다


class EntityObjectMapping(BaseModel):
    drawing_id: str
    entity_handle: str
    global_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    needs_review: bool = False
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def _flag(self) -> EntityObjectMapping:
        if self.confidence < MAPPING_REVIEW_THRESHOLD and self.reviewed_by is None:
            self.needs_review = True
        return self


class ActivityObjectMapping(BaseModel):
    activity_id: str
    global_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    needs_review: bool = False

    @model_validator(mode="after")
    def _flag(self) -> ActivityObjectMapping:
        if self.confidence < MAPPING_REVIEW_THRESHOLD:
            self.needs_review = True
        return self
