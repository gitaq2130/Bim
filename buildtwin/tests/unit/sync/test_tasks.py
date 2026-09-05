from __future__ import annotations

import json

from services.common.celery_app import celery_app
from services.sync.tasks import TASK_NAME, build_mapping_task, run_build_mapping
from tests.helpers.sync_fixtures import (
    accuracy,
    expected_mappings,
    load_dxf_entities,
    load_ifc_objects,
    load_json,
    true_alignment,
)


def _payload():
    entities, unit_scale = load_dxf_entities()
    objects = load_ifc_objects()
    return ([e.model_dump(mode="json") for e in entities], [o.model_dump(mode="json") for o in objects], unit_scale)


def test_task_registered_and_eager():
    assert TASK_NAME in celery_app.tasks
    assert celery_app.conf.task_always_eager is True


def test_task_with_user_alignment():
    ents, objs, _ = _payload()
    res = build_mapping_task.delay("job1", "d1", json.dumps(ents), json.dumps(objs),
                                   true_alignment().model_dump(mode="json"), "1F", None).get()
    assert res["status"] == "done" and res["job_id"] == "job1"
    assert res["mapping_count"] == len(res["mappings"]) > 0
    assert res["alignment"]["source"] == "user_input"
    assert all(0 <= m["confidence"] <= 1 and "evidence" in m for m in res["mappings"])


def test_task_auto_align_from_ifc_grid_then_column_fallback():
    ents, objs, unit_scale = _payload()
    ifc = load_json("sample.ifc.expected.json")
    from packages.core.models import EntityObjectMapping
    res = run_build_mapping("job2", "d1", ents, objs, None, "1F", {"grid_x": ifc["grid_x"], "grid_y": ifc["grid_y"]}, unit_scale)
    assert res["status"] == "done" and res["grid_source"] == "ifc_grid"
    assert abs(res["alignment"]["rotation_deg"] - 15.0) <= 0.5
    ms = [EntityObjectMapping.model_validate(m) for m in res["mappings"]]
    acc, _, _ = accuracy(ms, expected_mappings(), {"A-COL"})
    assert acc >= 0.9
    assert res["review_count"] == sum(1 for m in ms if m.needs_review)
    res2 = run_build_mapping("job3", "d1", ents, objs, None, "1F", None, unit_scale)   # IfcGrid 없음 → 기둥 중심
    assert res2["status"] == "done" and res2["grid_source"] == "column_centers"
    assert res2["warnings"]   # 대칭 그리드 경고


def test_task_fails_gracefully_without_grid():
    ents, objs, unit_scale = _payload()
    no_grid = [e for e in ents if e["layer"] != "GRID"]
    res = build_mapping_task.delay("job4", "d1", no_grid, objs, None, "1F", None, unit_scale).get()
    assert res["status"] == "failed" and "grid auto-align failed" in res["error"]
    res = build_mapping_task.delay("job5", "d1", "not json", objs).get()
    assert res["status"] == "failed" and res["error"]
