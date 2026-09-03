"""HTTP 라우터. 도메인 로직 없음 — usecases/서비스 호출과 직렬화만."""
from . import (
               activities,
               daily_reports,
               documents,
               drawings,
               files,
               jobs,
               objects,
               projects,
               review_requests,
               rules,
               scans,
)

ALL_ROUTERS = [projects.router, files.router, jobs.router, objects.router, drawings.router, scans.router,
               daily_reports.router, review_requests.router, activities.router, rules.router, documents.router]
__all__ = ["ALL_ROUTERS"]
