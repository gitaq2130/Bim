"""Celery 워커 진입점: `celery -A services.api.celery_app worker`.

공용 앱(services/common/celery_app.py)을 그대로 쓰되, 모든 서비스의 태스크 모듈을 import 해 워커에 등록한다.
"""
from __future__ import annotations

import services.api.tasks  # noqa: F401,E402 — 태스크 등록
import services.ingest.tasks  # noqa: F401,E402
import services.progress.tasks  # noqa: F401,E402
import services.scan.tasks  # noqa: F401,E402
import services.sync.tasks  # noqa: F401,E402
from services.common.celery_app import celery_app

app = celery_app
__all__ = ["app", "celery_app"]
