"""대장(xlsx) 업로드 인가 — ADR 0007 §7 규칙 1: cm 만. contractor 는 403(forbidden_role)이고
파일도 작업도 만들어지지 않는다(부작용 없음). 다른 파일 종류는 contractor 도 여전히 업로드 가능
(이미 test_02/05 등 기존 파일들이 이를 검증한다 — 여기서는 대장에 한정된 예외만 다룬다).

담당: qa. 이 라우트는 이 세션 시점에 `api` 에이전트가 구현 중이다 — 업로드가 아직 xlsx 를 받지
않거나(415 unsupported_file_kind) 역할 구분이 아직 안 되어 있으면 아래 테스트는 실패한다. 그건
버그가 아니라 아직 구현이 도착하지 않았다는 신호다(구현이 들어오면 이 파일이 그대로 통과 조건이 된다).
"""
from __future__ import annotations

from .conftest import FIXTURES, upload


def _file_count(client, headers, project_id: str) -> int:
    r = client.get(f"/api/projects/{project_id}/files", headers=headers)
    assert r.status_code == 200, r.text
    return len(r.json())


def test_contractor_cannot_upload_document_register(client, auth, project):
    """계약자가 대장을 올리면 403 forbidden_role — 파일도 작업도 남지 않는다."""
    before_files = _file_count(client, auth("contractor"), project)
    with open(FIXTURES / "document_register.xlsx", "rb") as fh:
        resp = client.post(f"/api/projects/{project}/files", headers=auth("contractor"), files={"file": ("document_register.xlsx", fh)})
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "forbidden_role"

    after_files = _file_count(client, auth("contractor"), project)
    assert after_files == before_files, "contractor 의 대장 업로드 거부는 부작용이 없어야 한다(파일 생성 금지)"


def test_cm_can_upload_document_register(client, auth, project):
    """cm 은 대장을 올릴 수 있고, 잡이 document_register 종류로 완료된다."""
    up, job = upload(client, auth("cm"), project, FIXTURES / "document_register.xlsx")
    assert up["kind"] == "xlsx"
    assert up["job_kind"] == "document_register"
    assert job["status"] == "done", job


def test_other_file_kinds_remain_open_to_contractor(client, auth, project):
    """대장 예외가 다른 종류의 업로드 권한까지 좁히면 안 된다 — schedule.csv 는 여전히 contractor 도 올릴 수 있다."""
    up, job = upload(client, auth("contractor"), project, FIXTURES / "schedule.csv")
    assert up["kind"] == "csv" and job["status"] == "done"
