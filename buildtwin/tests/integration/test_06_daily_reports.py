"""작업일보: NOT_BUILT 스캔 판정이 있는 객체의 완료 신고 → 검토요청 생성 + 상태 유지."""
from __future__ import annotations

from datetime import UTC, datetime

from packages.core.db import new_session
from packages.core.models.orm import FileRow, ScanRow, ScanVerdictRow


def _planned_column_1f(client, auth, project):
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED", "ifc_type": "IfcColumn", "level": "1F"}).json()["items"]
    assert items
    return items[0]["global_id"]


def _insert_not_built_verdict(project: str, gid: str) -> str:
    """스캔 파이프라인 없이 NOT_BUILT 판정 행을 직접 넣는다(정합 결과와 독립)."""
    s = new_session()
    try:
        file_row = FileRow(file_id="f-synthetic-scan", project_id=project, kind="ply", filename="synthetic.ply", uri="/nonexistent.ply",
                           sha256="0" * 64, size=0)
        if s.get(FileRow, file_row.file_id) is None:
            s.add(file_row)
        scan_id = "s-synthetic-not-built"
        if s.get(ScanRow, scan_id) is None:
            s.add(ScanRow(scan_id=scan_id, project_id=project, file_id=file_row.file_id,
                          registration={"scan_id": scan_id, "status": "ok", "rmse": 0.01}))
        s.add(ScanVerdictRow(scan_id=scan_id, global_id=gid, project_id=project, state="NOT_BUILT", confidence=0.9,
                             evidence={"source_type": "scan", "source_id": scan_id, "method": "test_fixture",
                                       "extra": {"rule_id": "SCAN-VERDICT-v1"}}, created_at=datetime.now(UTC)))
        s.commit()
        return scan_id
    finally:
        s.close()


def test_completed_claim_vs_not_built_scan_creates_review(client, auth, project, ifc_job):
    gid = _planned_column_1f(client, auth, project)
    _insert_not_built_verdict(project, gid)
    body = {"report_date": "2026-09-01", "crew_count": 4, "equipment": {"crane": 1},
            "items": [{"global_id": gid, "claimed_state": "completed", "quantity": 1.0, "quantity_unit": "m3"}], "note": "기둥 타설 완료"}
    r = client.post(f"/api/projects/{project}/daily-reports", headers=auth("contractor"), json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["report_id"] and out["reporter_id"] and out["items"][0]["global_id"] == gid
    assert out["transitions"] == []
    assert out["review_requests"] and any(rv["rule_id"] == "VER-001" for rv in out["review_requests"])
    assert out["skipped"] and out["skipped"][0]["reason"] == "verification mismatch"
    rv = out["review_requests"][0]
    assert rv["kind"] == "verification" and 0 <= rv["confidence"] <= 1 and rv["evidence"]["source_type"] == "rule"
    assert rv["conflicting_sources"]["scan"]["state"] == "NOT_BUILT" and rv["conflicting_sources"]["daily_report"]["claimed_state"] == "completed"
    d = client.get(f"/api/objects/{gid}", headers=auth("cm")).json()
    assert d["current_state"]["state"] == "PLANNED" and d["current_state"]["has_open_review"] is True
    assert d["linked"]["latest_scan_verdict"]["state"] == "NOT_BUILT"
    # 검토요청 목록에서 확인 가능
    reviews = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"), params={"kind": "verification", "status": "open"}).json()
    assert any(x["global_id"] == gid for x in reviews)
    # 목록 조회
    r = client.get(f"/api/projects/{project}/daily-reports", headers=auth("client"))
    assert r.status_code == 200 and any(x["report_id"] == out["report_id"] for x in r.json())


def test_started_claim_transitions_and_multipart(client, auth, project, ifc_job):
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED", "ifc_type": "IfcWall", "level": "2F"}).json()["items"]
    gid = items[0]["global_id"]
    import json

    report = {"report_date": "2026-09-02", "crew_count": 2, "equipment": {}, "items": [{"global_id": gid, "claimed_state": "started"}]}
    r = client.post(f"/api/projects/{project}/daily-reports", headers=auth("contractor"),
                    data={"report": json.dumps(report)}, files=[("photos", ("site.jpg", b"\xff\xd8\xff\xd9", "image/jpeg"))])
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["transitions"] and out["transitions"][0]["to_state"] == "REPORTED" and out["transitions"][0]["actor"] == "contractor"
    assert out["inspection_review_ids"] == []   # started 신고는 검측 요청을 만들지 않는다
    assert out["items"][0]["photo_uris"] and out["items"][0]["photo_uris"][0].startswith("/api/files/")
    photo = client.get(out["items"][0]["photo_uris"][0], headers=auth("client"))
    assert photo.status_code == 200 and photo.content.startswith(b"\xff\xd8")
    assert client.post(f"/api/projects/{project}/daily-reports", headers=auth("contractor"), json={"report_date": "x", "items": []}).status_code == 422
