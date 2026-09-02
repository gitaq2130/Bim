"""BuildTwin 공용 데이터 모델 (담당: architect, 기준: docs/adr/0001)."""
from .coordinate import BBox2D, BBox3D, CoordinateSystem, CoordinateTransform
from .evidence import Evidence
from .identity import IFC_TYPE_GROUP, TARGET_IFC_TYPES, BimObject, BimObjectDraft, DrawingEntity, DrawingEntityDraft
from .ingest import FileKind, IngestResult, IngestStatus, IngestWarning
from .knowledge import CaseRecord, ExpertReviewLog, RiskLevel, Rule, RuleVerdict
from .mapping import MAPPING_REVIEW_THRESHOLD, ActivityObjectMapping, EntityObjectMapping
from .progress import (Activity, ActivityRelation, Blocker, DailyReport, DailyReportItem, MaterialMovement,
                       ReadinessScore, Schedule, StartableSet)
from .review import ReviewRequest
from .scan import (AlignmentInput, ControlPoint, MarkerDefinition, MarkerObservation, ObjectDiff, Registration,
                   ScanState, ScanVerdict, ScanVerdictBatch)
from .state import (ALLOWED_TRANSITIONS, Actor, InvalidTransitionError, ObjectState, StateTransition, UserRole,
                    allowed_targets, validate_transition)

__all__ = [n for n in dir() if not n.startswith("_")]
