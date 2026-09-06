# packages/core/models

- 담당 에이전트: `architect` (구현 에이전트는 필드 추가를 제안만)
- 내용: 모든 서비스가 import하는 공용 SQLAlchemy ORM + Pydantic 스키마. 기준 문서는 `docs/adr/0001-object-identity-and-state-model.md`.
- 예정 모듈: `identity.py`(BimObject, DrawingEntity), `state.py`(ObjectState, StateTransition, Evidence), `coordinate.py`(CoordinateSystem, CoordinateTransform), `mapping.py`(EntityObjectMapping, ActivityObjectMapping), `scan.py`(ScanVerdict, ObjectDiff), `progress.py`(Activity, ReadinessScore, Blocker), `review.py`(ReviewRequest, DailyReport), `knowledge.py`(Rule, RuleVerdict, CaseRecord, ExpertReviewLog)
