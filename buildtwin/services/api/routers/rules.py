from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from packages.core.models.knowledge import Rule

from .. import usecases
from ..deps import CurrentUser, get_current_user, get_session
from ..schemas.rules import RuleEvaluateRequest, RuleEvaluateResponse
from .projects import get_project_or_404

router = APIRouter(tags=["rules"])


@router.get("/rules", response_model=list[Rule])
def list_rules(_: CurrentUser = Depends(get_current_user)) -> list[Rule]:
    return usecases.list_rules()


@router.post("/projects/{project_id}/rules/evaluate", response_model=RuleEvaluateResponse)
def evaluate_rules(project_id: str, body: RuleEvaluateRequest, session: Session = Depends(get_session),
                   _: CurrentUser = Depends(get_current_user)) -> RuleEvaluateResponse:
    """객체의 최신 스캔 판정 + 시스템 논리 컨텍스트(verification.build_logic_context)로 규칙 엔진 평가. 상태는 바꾸지 않는다."""
    get_project_or_404(session, project_id)
    return usecases.evaluate_rules(session, project_id, body.global_id, persist=body.persist)
