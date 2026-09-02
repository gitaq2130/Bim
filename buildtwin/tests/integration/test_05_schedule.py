"""공정표 업로드 → Activity 6개·매핑 → readiness / startable."""
from __future__ import annotations


def test_schedule_job_and_activities(client, auth, project, schedule_job):
    res = schedule_job["result"]
    assert res["activity_count"] == 6 and res["relation_count"] == 5 and res["mapping_count"] > 0
    r = client.get(f"/api/projects/{project}/activities", headers=auth("client"))
    assert r.status_code == 200
    acts = {a["activity_id"]: a for a in r.json()}
    assert set(acts) == {"A100", "A110", "A120", "A200", "A300", "A400"}
    assert acts["A110"]["predecessor_ids"] == ["A100"] and len(acts["A100"]["mapped_global_ids"]) == 6


def test_readiness_and_startable(client, auth, project, schedule_job):
    r = client.get("/api/activities/A110/readiness", headers=auth("client"))
    assert r.status_code == 200
    s = r.json()
    assert 0 <= s["score"] <= 1 and set(s["components"]) == set(s["weights"]) and "evidence" in s and "confidence" in s
    assert any(b["component"] == "predecessor_completion" for b in s["blockers"])
    assert client.get("/api/activities/NOPE/readiness", headers=auth("client")).status_code == 404
    r = client.get(f"/api/projects/{project}/startable", headers=auth("client"))
    assert r.status_code == 200
    st = r.json()
    assert st["startable"] == ["A100"] and "A110" in st["blocked"] and st["evidence"]["source_type"] == "system_logic"


def test_object_detail_links_activities(client, auth, project, schedule_job):
    acts = {a["activity_id"]: a for a in client.get(f"/api/projects/{project}/activities", headers=auth("client")).json()}
    gid = acts["A100"]["mapped_global_ids"][0]
    d = client.get(f"/api/objects/{gid}", headers=auth("client")).json()
    assert "A100" in d["linked"]["activity_ids"]
