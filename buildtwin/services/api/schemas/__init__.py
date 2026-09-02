"""요청/응답 Pydantic 스키마. 코어 모델(packages/core/models)은 그대로 재사용하고, 여기서는 HTTP 계약만 정의한다.

프론트엔드 계약: apps/web/src/api/types.ts 와 필드명을 맞춘다(그쪽이 우선).
"""
from .activities import ActivityView, StartableActivityView, StateDistributionRow, WeeklySummary
from .auth import LoginRequest, LoginResponse, RegisterRequest, UserView
from .drawings import (
    AlignmentRequest,
    ConfirmMappingRequest,
    DrawingEntitiesResponse,
    DrawingEntityView,
    DrawingSummary,
    ModelSummary,
    PlanSectionPolyline,
    PlanSectionView,
)
from .jobs import JobView, UploadResponse, WarningView
from .objects import (
    BimObjectView,
    LevelView,
    LinkedRefs,
    NextAction,
    ObjectDetail,
    ObjectList,
    ObjectStateView,
    TransitionRequest,
)
from .projects import ProjectCreate, ProjectView
from .reports import DailyReportCreate, DailyReportResponse, DailyReportView
from .reviews import ResolveRequest, ReviewRequestView
from .rules import RuleEvaluateRequest, RuleEvaluateResponse
from .scans import AlignmentJobResponse, ScanSummary, ScanVerdictsResponse

__all__ = [n for n in dir() if not n.startswith("_")]
