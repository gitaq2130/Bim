"""주간 요약 shape, 규칙 엔진 평가."""
from __future__ import annotations


def test_weekly_summary_shape(client, auth, project, ifc_job, schedule_job):
    r = client.get(f"/api/projects/{project}/weekly-summary", headers=auth("client"))
    assert r.status_code == 200, r.text
    s = r.json()
    assert {"project_id", "week_start", "week_end", "state_distribution", "confirmed_this_week", "open_reviews",
            "open_reviews_by_kind", "startable", "state_counts_by_level", "state_counts_by_group", "open_review_requests",
            "estimated_done_count", "startable_set"} <= set(s)
    assert s["project_id"] == project and s["object_total"] == 42
    assert sum(sum(c.values()) for c in s["state_counts_by_level"].values()) == 42
    assert set(s["state_counts_by_level"]) == {"1F", "2F"}
    assert set(s["state_counts_by_group"]) <= {"column", "beam", "slab", "wall", "duct", "pipe", "cable_tray", "facade_panel", "other"}
    assert all({"level", "group", "counts", "total"} <= set(row) for row in s["state_distribution"])
    assert {row["group"] for row in s["state_distribution"]} <= {"column", "beam", "slab", "wall", "duct", "pipe", "cable_tray", "facade_panel", "other"}
    assert sum(row["total"] for row in s["state_distribution"]) == 42
    assert s["confirmed_this_week"] >= 1   # test_03 / test_08 에서 확정
    assert s["open_reviews"] == s["open_review_requests"] == sum(s["open_reviews_by_kind"].values())
    assert s["startable_set"]["project_id"] == project
    assert all({"activity_id", "readiness", "confidence", "evidence", "blockers"} <= set(a) for a in s["startable"])
    assert [a["activity_id"] for a in s["startable"]] == s["startable_set"]["startable"]


def test_rules_list_and_evaluate(client, auth, project, ifc_job):
    r = client.get("/api/rules", headers=auth("client"))
    assert r.status_code == 200 and r.json() and all({"id", "when", "then", "reliability"} <= set(x) for x in r.json())
    verdicts = client.get(f"/api/projects/{project}/scans", headers=auth("client")).json()
    scan_ids = [s["scan_id"] for s in verdicts if s["status"] == "ok"]
    gid = None
    if scan_ids:
        items = client.get(f"/api/scans/{scan_ids[0]}/verdicts", headers=auth("client")).json()["items"]
        mismatch = [v for v in items if v["state"] == "MISMATCH"]
        gid = (mismatch or items)[0]["global_id"]
    if gid is None:
        gid = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page_size": 1}).json()["items"][0]["global_id"]
    r = client.post(f"/api/projects/{project}/rules/evaluate", headers=auth("cm"), json={"global_id": gid})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["global_id"] == gid and out["rules_evaluated"] > 0 and "logic" in out["context"]
    for v in out["verdicts"]:
        assert 0 <= v["confidence"] <= 1 and v["evidence"]["source_type"] == "rule" and v["rule_id"]
    assert client.post(f"/api/projects/{project}/rules/evaluate", headers=auth("cm"), json={"global_id": "nope"}).status_code == 404
