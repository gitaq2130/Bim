from __future__ import annotations

from packages.core.models.orm import JobRow
from services.progress import persistence as db
from services.progress.tasks import compute_readiness_task, import_schedule_task

from .conftest import FIXTURES, ensure_model_chain


def test_celery_tasks_run_eagerly_and_persist(session, sample_objects, monkeypatch, axis_db_url):
    import packages.core.db as core_db

    # 태스크는 session_scope() 를 쓰므로 테스트 엔진을 그대로 쓰게 한다. 엔진이 이미 서 있으면
    # `get_engine()` 이 그것을 돌려주므로 이 값은 안 쓰이지만, 엔진이 리셋된 뒤라면 이 값이 쓰인다 —
    # 그때 개발용 기본 DB(`sqlite:///./buildtwin.db`)로 새지 않게 **이 테스트의 축 URL** 을 준다.
    monkeypatch.setattr(core_db, "database_url", lambda: axis_db_url)
    db.ensure_project(session, "P-TASK")
    model = ensure_model_chain(session, "P-TASK", "M")
    db.save_objects(session, "P-TASK", "M", sample_objects, model.file_id)
    session.add(JobRow(job_id="job-1", project_id="P-TASK", kind="schedule"))
    session.commit()

    result = import_schedule_task.delay("job-1", str(FIXTURES / "schedule.xer"), "P-TASK").get()
    assert result["activity_count"] == 6 and result["relation_count"] == 5 and result["mapping_count"] == 27
    job = session.get(JobRow, "job-1")
    session.refresh(job)
    assert job.status == "done" and job.result["schedule_id"] == result["schedule_id"]

    out = compute_readiness_task.delay("P-TASK").get()
    assert set(out["readiness"]) == {"A100", "A110", "A120", "A200", "A300", "A400"}
    assert out["startable"]["startable"] == ["A100"]
