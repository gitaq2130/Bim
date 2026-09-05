"""판단 규칙·사례·전문가 검토 로그."""
from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

from .evidence import Evidence


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class RuleScope(BaseModel):
    discipline: str | None = None
    object_types: list[str] = Field(default_factory=list)


class RuleThen(BaseModel):
    risk_level: RiskLevel
    action: str
    required_evidence: list[str] = Field(default_factory=list)


class Rule(BaseModel):
    id: str
    version: int = 1
    source: Literal["expert", "case", "standard"]
    source_ref: str | None = None
    reliability: float = Field(ge=0.0, le=1.0)
    scope: RuleScope = Field(default_factory=RuleScope)
    when: str
    then: RuleThen
    tags: list[str] = Field(default_factory=list)
    description: str | None = None


class RuleVerdict(BaseModel):
    rule_id: str
    rule_version: int
    global_id: str | None = None
    activity_id: str | None = None
    risk_level: RiskLevel
    action: str
    required_evidence: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence


class CaseRecord(BaseModel):
    case_id: str
    project_type: str
    discipline: str
    situation: str
    early_signals: list[str] = Field(default_factory=list)
    direct_impact: str
    cascading_impacts: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    outcome: str | None = None
    source_ref: str | None = None
    reliability: float = Field(default=0.5, ge=0.0, le=1.0)
    created_by: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ExpertReviewLog(BaseModel):
    log_id: str
    entity_type: str
    entity_id: str
    proposal: dict[str, Any]
    final: dict[str, Any]
    diff: list[dict[str, Any]]
    reviewer: str
    reviewed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
