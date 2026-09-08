"""공용 Celery 앱. 작성: progress-engine (다른 서비스도 이 앱에 태스크를 등록한다).

- broker/backend: settings.redis_url (.env REDIS_URL)
- 개발·테스트 기본: settings.celery_always_eager=True → 태스크가 호출 즉시 동기 실행
"""
from __future__ import annotations

from celery import Celery

from packages.core.settings import settings

celery_app = Celery("buildtwin", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_always_eager=settings.celery_always_eager,
    task_eager_propagates=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)

__all__ = ["celery_app"]
