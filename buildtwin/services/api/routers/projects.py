from __future__ import annotations

import uuid
from collections import Counter

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models.coordinate import CoordinateSystem
from packages.core.models.orm import FileRow, ProjectMemberRow, ProjectRow, UserRow

from .. import queries
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, require_project_role, require_role
from ..errors import Conflict, NotFound, Unprocessable
from ..schemas.drawings import ModelSummary
from ..schemas.objects import LevelView
from ..schemas.projects import MemberCreate, MemberView, ProjectCreate, ProjectView

router = APIRouter(tags=["projects"])


def get_project_or_404(session: Session, project_id: str) -> ProjectRow:
    """admin 전용 라우트(멤버십 관리 자체)의 프로젝트 존재 확인. 프로젝트 범위 조회·행위 라우트는
    `require_project_role`(멤버십 기반, ADR 0006)을 쓴다 — 여기를 재사용하지 않는다."""
    row = session.get(ProjectRow, project_id)
    if row is None:
        raise NotFound(f"project not found: {project_id}", code="project_not_found")
    return row


def _view(row: ProjectRow, my_role: str | None = None) -> ProjectView:
    return ProjectView(project_id=row.project_id, name=row.name, created_at=row.created_at, my_role=my_role)  # type: ignore[arg-type]


def _member_view(session: Session, row: ProjectMemberRow) -> MemberView:
    user = session.get(UserRow, row.user_id)
    return MemberView(project_id=row.project_id, user_id=row.user_id, email=user.email if user else None,
                      role=row.role, added_by=row.added_by, added_at=row.added_at)  # type: ignore[arg-type]


@router.post("/projects", response_model=ProjectView, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, session: Session = Depends(get_session),
                   _: CurrentUser = Depends(require_role("admin"))) -> ProjectView:
    """admin 전용. ADR 0006 §4: 만든 admin 에게 자동 멤버십을 주지 않는다(admin 은 이미 조회 가능하고 행위
    역할이 없으므로 멤버십이 의미 없다) — 멤버는 `POST /projects/{pid}/members` 로 따로 추가한다."""
    pid = body.project_id or f"p-{uuid.uuid4().hex[:12]}"
    if session.get(ProjectRow, pid) is not None:
        raise Conflict(f"project already exists: {pid}", code="duplicate_project")
    row = ProjectRow(project_id=pid, name=body.name)
    session.add(row)
    session.commit()
    return _view(row)


@router.get("/projects", response_model=list[ProjectView])
def list_projects(session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> list[ProjectView]:
    """ADR 0006 §3 규칙 3: 멤버인 프로젝트만(admin 은 전부, my_role=None)."""
    if user.role == "admin":
        return [_view(r) for r in session.scalars(select(ProjectRow).order_by(ProjectRow.created_at))]
    rows = session.execute(select(ProjectRow, ProjectMemberRow.role)
                           .join(ProjectMemberRow, ProjectMemberRow.project_id == ProjectRow.project_id)
                           .where(ProjectMemberRow.user_id == user.user_id).order_by(ProjectRow.created_at))
    return [_view(project, my_role=role) for project, role in rows]


@router.get("/projects/{project_id}", response_model=ProjectView)
def get_project(project_id: str, session: Session = Depends(get_session), ctx: ProjectContext = Depends(require_project_role())) -> ProjectView:
    return _view(get_project_or_404(session, project_id), my_role=ctx.role)


@router.get("/projects/{project_id}/levels", response_model=list[LevelView])
def list_levels(project_id: str, session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> list[LevelView]:
    counts = Counter(r.level for r in queries.project_objects(session, project_id) if r.level)
    model = queries.latest_model(session, project_id)
    levels: dict[str, LevelView] = {}
    for lv in (model.levels if model else []) or []:
        name = str(lv.get("name"))
        levels[name] = LevelView(name=name, elevation=lv.get("elevation"), object_count=counts.get(name, 0))
    for name, n in counts.items():
        levels.setdefault(name, LevelView(name=name, elevation=None, object_count=n))
    return sorted(levels.values(), key=lambda v: (v.elevation if v.elevation is not None else float("inf"), v.name))


def model_summary(session: Session, m) -> ModelSummary:
    from services.sync.config import load_sync_config

    f = session.get(FileRow, m.file_id)
    return ModelSummary(model_id=m.model_id, project_id=m.project_id, name=f.filename if f else m.model_id,
                        model_uri=f"/api/models/{m.model_id}/mesh", obj_uri=f"/api/models/{m.model_id}/mesh.obj",
                        levels=list(m.levels or []), coordinate_system=CoordinateSystem.model_validate(m.coordinate_system),
                        plan_section_default_offset=load_sync_config().plan_section_default_offset,
                        version=m.version, file_id=m.file_id, stats=dict(m.stats or {}))


@router.get("/projects/{project_id}/models", response_model=list[ModelSummary])
def list_models(project_id: str, session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> list[ModelSummary]:
    return [model_summary(session, m) for m in queries.project_models(session, project_id)]


# ------------------------------------------------------------------ membership (ADR 0006 §4: admin 전용, MVP)
@router.get("/projects/{project_id}/members", response_model=list[MemberView])
def list_members(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(require_role("admin"))) -> list[MemberView]:
    get_project_or_404(session, project_id)
    rows = session.scalars(select(ProjectMemberRow).where(ProjectMemberRow.project_id == project_id).order_by(ProjectMemberRow.added_at))
    return [_member_view(session, r) for r in rows]


@router.post("/projects/{project_id}/members", response_model=MemberView, status_code=status.HTTP_201_CREATED)
def add_member(project_id: str, body: MemberCreate, session: Session = Depends(get_session),
               user: CurrentUser = Depends(require_role("admin"))) -> MemberView:
    get_project_or_404(session, project_id)
    target = session.get(UserRow, body.user_id)
    if target is None:
        raise NotFound(f"user not found: {body.user_id}", code="user_not_found")
    if target.role == "admin":
        # ADR 0006 §2/§4 + 리뷰어 6차 지적 2: 전역 admin 계정은 어떤 프로젝트의 멤버도 될 수 없다.
        # 멤버십을 주면 project_role() 이 멤버 분기(admin 분기보다 먼저)를 타서 caller_project_role() 이
        # 그 역할(예: "cm")을 그대로 돌려주고, actor_for_role() 이 이를 거부하지 못해 CONFIRMED 전이·
        # 검측 승인·검토요청 해소가 admin 계정으로 통과해버린다. 현장 판단이 필요하면 별도 cm 계정을 발급한다.
        raise Unprocessable(
            f"admin account cannot become a project member: {body.user_id}. "
            "admin 계정은 프로젝트 멤버가 될 수 없습니다. 현장 판단이 필요하면 별도의 cm 계정을 발급하세요.",
            code="admin_cannot_be_member",
        )
    if session.get(ProjectMemberRow, (project_id, body.user_id)) is not None:
        raise Conflict(f"user already a member of project {project_id}: {body.user_id}", code="duplicate_member")
    row = ProjectMemberRow(project_id=project_id, user_id=body.user_id, role=body.role, added_by=user.user_id)
    session.add(row)
    session.commit()
    return _member_view(session, row)


@router.delete("/projects/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(project_id: str, user_id: str, session: Session = Depends(get_session),
                  _: CurrentUser = Depends(require_role("admin"))) -> None:
    get_project_or_404(session, project_id)
    row = session.get(ProjectMemberRow, (project_id, user_id))
    if row is None:
        raise NotFound(f"member not found: {user_id} (project {project_id})", code="member_not_found")
    session.delete(row)
    session.commit()
