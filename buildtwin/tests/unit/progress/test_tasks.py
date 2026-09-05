from __future__ import annotations

from packages.core.models.orm import JobRow
from services.progress import persistence as db
from services.progress.tasks import compute_readiness_task, import_schedule_task

from .conftest import FIXTURES, ensure_model_chain


def test_celery_tasks_run_eagerly_and_persist(session, sample_objects, monkeypatch):
    import packages.core.db as core_db

    # 태스크는 session_scope() 를 쓰므로 테스트 엔진(인메모리)을 그대로 쓰게 한다
    monkeypatch.setattr(core_db, "database_url", lambda: "sqlite:///:memory:")
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
