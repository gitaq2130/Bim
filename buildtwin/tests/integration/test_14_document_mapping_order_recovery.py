"""업로드 순서 역전(과제 2, ADR 0007) — 담당: qa.

대장을 공정표보다 먼저 올리면(현장에서 흔한 순서 — 대장은 매주, 공정표는 가끔 갱신) 매핑할 Activity 가
아직 없어 문서 매핑이 0건으로 남는다. 예전에는 이후 공정표를 올려도 재생성되지 않아 `drawing_approval`
이 추측값 0.5 로 조용히 되돌아갔다. 지금은 (1) `run_schedule` 이 끝에서 문서 매핑을 재생성하고,
(2) 매핑되지 않은 문서가 있으면 경고가 난다. 실제 잡 흐름(Celery eager)을 타야 `run_schedule` 의
재생성이 검증되므로 API 레벨(TestClient)로 확인한다.

이 파일은 자기 소유의 프로젝트를 새로 만든다 — 세션 스코프 `project` 픽스처는 다른 테스트 파일들이
이미 `schedule_job`(test_05)을 통해 공정표를 올려둔 상태라 업로드 순서를 통제할 수 없다.
"""
from __future__ import annotations

import pytest

from .conftest import FIXTURES, add_member, upload

EXPECTED_MAPPING_COUNT = 6   # tests/fixtures/document_register.xlsx(10건) x tests/fixtures/schedule.csv(6 Activity)
EXPECTED_DOCUMENT_COUNT = 10


@pytest.fixture(scope="module")
def order_reversal_project(client, auth, user_ids) -> str:
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "문서 매핑 순서 역전 테스트"})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    return project_id


def test_register_before_schedule_then_schedule_recovers_mappings(client, auth, order_reversal_project):
    project_id = order_reversal_project

    # 1) 대장을 먼저 올린다 — 매핑할 Activity 가 아직 없다
    up, job = upload(client, auth("cm"), project_id, FIXTURES / "document_register.xlsx")
    assert up["kind"] == "xlsx" and job["status"] == "done", job
    assert job["result"]["mapping_count"] == 0

    # 과제 2 선택지 2: 매핑 후보가 없는 문서가 있으면 경고가 실제로 난다
    warning_codes = {w["code"] for w in job["warnings"]}
    assert "DOCUMENT_UNMAPPED" in warning_codes, job["warnings"]
    unmapped = next(w for w in job["warnings"] if w["code"] == "DOCUMENT_UNMAPPED")
    assert unmapped["context"]["unmapped_count"] == EXPECTED_DOCUMENT_COUNT   # 대장 전체가 미매핑

    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping"})
    assert r.status_code == 200, r.text
    assert r.json() == []   # 매핑이 없으니 검토요청도 없다

    # 2) 이제 공정표를 올린다 — run_schedule 이 끝에서 map_project_documents 를 다시 호출한다
    up2, job2 = upload(client, auth("contractor"), project_id, FIXTURES / "schedule.csv")
    assert up2["kind"] == "csv" and job2["status"] == "done", job2
    assert job2["result"]["document_mapping_count"] == EXPECTED_MAPPING_COUNT   # 0 -> 6 회복

    r2 = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                    params={"kind": "document_mapping", "status": "open"})
    assert r2.status_code == 200, r2.text
    assert len(r2.json()) == EXPECTED_MAPPING_COUNT


def test_reuploading_schedule_alone_does_not_duplicate_document_mapping_reviews(client, auth, order_reversal_project):
    """앞 테스트가 이미 6건을 만들어 둔 프로젝트에 공정표만 다시 올려도(예: 공정표 갱신) 문서 매핑
    검토요청이 중복 생성되지 않는다 — map_project_documents 의 중복 방지가 run_schedule 경로에서도 지켜진다."""
    project_id = order_reversal_project

    before = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                        params={"kind": "document_mapping", "status": "open"}).json()
    assert len(before) == EXPECTED_MAPPING_COUNT

    up, job = upload(client, auth("contractor"), project_id, FIXTURES / "schedule.csv")
    assert up["kind"] == "csv" and job["status"] == "done", job
    assert job["result"]["document_mapping_count"] == EXPECTED_MAPPING_COUNT

    after = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                       params={"kind": "document_mapping", "status": "open"}).json()
    assert len(after) == EXPECTED_MAPPING_COUNT
    assert {r["review_request_id"] for r in after} == {r["review_request_id"] for r in before}
