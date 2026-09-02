"""스캔 업로드 → 정합 입력 → verdict 작업 → 판정(CONFIRMED 없음)."""
from __future__ import annotations

import pytest

from .conftest import FIXTURES, load_fixture_json, upload, wait_job


@pytest.fixture(scope="module")
def scan(client, auth, project, ifc_job):
    up, job = upload(client, auth("cm"), project, FIXTURES / "sample.ply")
    assert up["kind"] == "ply" and job["status"] == "done", job
    assert job["result"]["scan_id"] and job["result"]["status"] == "needs_alignment_input"
    return job["result"]


def test_scan_listed_awaiting_alignment(client, auth, project, scan):
    r = client.get(f"/api/projects/{project}/scans", headers=auth("client"))
    assert r.status_code == 200
    s = next(x for x in r.json() if x["scan_id"] == scan["scan_id"])
    assert s["status"] == "needs_alignment_input" and s["pointcloud_uri"].startswith("/api/files/") and s["point_count"] > 0
    r = client.get(f"/api/scans/{scan['scan_id']}/registration", headers=auth("client"))
    assert r.status_code == 200 and r.json()["status"] == "needs_alignment_input"
    # cm 의 next_actions 에 align_scan 노출
    gid = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page_size": 1}).json()["items"][0]["global_id"]
    kinds = {a["kind"] for a in client.get(f"/api/objects/{gid}", headers=auth("cm")).json()["next_actions"]}
    assert "align_scan" in kinds


def test_alignment_insufficient(client, auth, scan):
    r = client.post(f"/api/scans/{scan['scan_id']}/alignment", headers=auth("cm"), json={"control_points": []})
    assert r.status_code == 422


def test_alignment_job_produces_verdicts_without_confirmed(client, auth, project, scan):
    alignment = load_fixture_json("alignment.json")
    r = client.post(f"/api/scans/{scan['scan_id']}/alignment", headers=auth("cm"), json=alignment)
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    job = wait_job(client, auth("cm"), job_id)
    assert job["kind"] == "verdict"
    assert job["status"] == "done", job
    res = job["result"]
    assert res["registration"]["status"] == "ok" and res["verdict_count"] > 0

    r = client.get(f"/api/scans/{scan['scan_id']}/verdicts", headers=auth("client"))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == len(body["items"]) == res["verdict_count"]
    states = {v["global_id"]: v["state"] for v in body["items"]}
    assert set(states.values()) <= {"NOT_BUILT", "IN_PROGRESS", "ESTIMATED_DONE", "MISMATCH", "UNVERIFIABLE"}
    for v in body["items"]:
        assert 0 <= v["confidence"] <= 1 and v["evidence"]["source_type"] == "scan" and v["evidence"]["bbox"]
    assert body["registration"]["transform"]["matrix"] and body["registration"]["rmse"] is not None

    # 객체 상태에 CONFIRMED 가 생기지 않았고(스캔은 최대 ESTIMATED_DONE), 판정이 객체 상세에 연결됨
    objects = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page_size": 500}).json()["items"]
    system_confirmed = [o for o in objects if o["state"] == "CONFIRMED" and o["global_id"] in states]
    for o in system_confirmed:
        hist = client.get(f"/api/objects/{o['global_id']}", headers=auth("client")).json()["history"]
        assert all(h["actor"] == "cm" for h in hist if h["to_state"] == "CONFIRMED")
    done = [g for g, st in states.items() if st == "ESTIMATED_DONE"]
    if done:
        d = client.get(f"/api/objects/{done[0]}", headers=auth("client")).json()
        assert d["linked"]["latest_scan_verdict"]["scan_id"] == scan["scan_id"]
        assert d["current_state"]["state"] in ("ESTIMATED_DONE", "REPORTED", "PLANNED", "INSPECTION_REQUESTED", "CONFIRMED", "MISMATCH")
    # 스캔 요약에 정합 결과 반영
    s = next(x for x in client.get(f"/api/projects/{project}/scans", headers=auth("client")).json() if x["scan_id"] == scan["scan_id"])
    assert s["status"] == "ok" and s["registration"]["rmse"] is not None


def test_verdict_accuracy_when_scan_module_stable(client, auth, scan):
    """정확도 의존 단언(스캔 모듈 기준치와 동일). 1F 대상 객체에 대해 verdict.expected.json 과 비교."""
    expected = load_fixture_json("verdict.expected.json")["verdicts"]
    states = {v["global_id"]: v["state"] for v in client.get(f"/api/scans/{scan['scan_id']}/verdicts", headers=auth("client")).json()["items"]}
    common = [g for g in expected if g in states]
    assert len(common) == len(expected)
    hits = sum(1 for g in common if states[g] == expected[g])
    assert hits / len(common) >= 0.85, {g: (states[g], expected[g]) for g in common if states[g] != expected[g]}
