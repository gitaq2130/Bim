"""DXF 업로드 → 엔티티·매핑(기둥 ≥6)·저신뢰 검토요청 → 정합 재입력·매핑 확정."""
from __future__ import annotations

from .conftest import load_fixture_json


def test_dxf_job_entities_and_mappings(client, auth, project, dxf_job, expected_objects):
    res = dxf_job["result"]
    assert res["drawing_id"] and res["level"] == "1F" and res["mapping"]["status"] == "done", dxf_job
    did = res["drawing_id"]
    r = client.get(f"/api/projects/{project}/drawings", headers=auth("client"))
    assert r.status_code == 200 and any(d["drawing_id"] == did for d in r.json())
    r = client.get(f"/api/drawings/{did}/entities", headers=auth("client"))
    assert r.status_code == 200
    body = r.json()
    expected_dxf = load_fixture_json("sample.dxf.expected.json")
    assert len(body["entities"]) == sum(expected_dxf["entity_counts_by_layer"].values())
    # 정합 후 sync.save_alignment 가 좌표계를 정합된 좌표계(grid_auto_align)로 갱신한다. 단위 스케일은 유지.
    assert body["coordinate_system"]["source"] in ("dxf_local", "grid_auto_align", "user_input")
    assert body["coordinate_system"]["scale"] == expected_dxf["unit_to_m"]
    assert body["alignment"] and body["alignment"]["alignment"]["source"] == "grid_auto_align"

    r = client.get(f"/api/drawings/{did}/mappings", headers=auth("client"))
    assert r.status_code == 200
    mappings = r.json()
    assert mappings and all({"entity_handle", "global_id", "confidence", "evidence", "needs_review"} <= set(m) for m in mappings)
    columns = [m for m in mappings if expected_objects.get(m["global_id"], {}).get("category") == "columns"]
    assert len(columns) >= 6, [m["global_id"] for m in mappings]
    expected_map = {m["handle"]: m["global_id"] for m in load_fixture_json("mapping.expected.json")["mappings"]}
    hits = sum(1 for m in mappings if expected_map.get(m["entity_handle"]) == m["global_id"])
    assert hits / len(expected_map) >= 0.8, (hits, len(expected_map))
    # 저신뢰 매핑 → 검토요청(kind=mapping)
    low = [m for m in mappings if m["needs_review"]]
    reviews = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"), params={"kind": "mapping", "status": "open"}).json()
    assert len(reviews) == len(low) == res["mapping"]["review_count"]
    for rv in reviews:
        assert rv["confidence"] < 0.7 and rv["evidence"]["source_type"] == "mapping" and rv["conflicting_sources"]["drawing_id"] == did


def test_object_detail_links_entities(client, auth, project, dxf_job):
    mappings = client.get(f"/api/drawings/{dxf_job['result']['drawing_id']}/mappings", headers=auth("client")).json()
    m = mappings[0]
    d = client.get(f"/api/objects/{m['global_id']}", headers=auth("client")).json()
    assert m["entity_handle"] in d["linked"]["entity_handles"] and d["linked"]["drawing_id"] == m["drawing_id"]


def test_user_alignment_rebuilds_mappings(client, auth, project, dxf_job, expected_objects):
    did = dxf_job["result"]["drawing_id"]
    a = load_fixture_json("sample.dxf.expected.json")["alignment"]
    body = {"origin": a["origin_m"], "rotation_deg": a["rotation_deg"], "scale": a["scale"], "source": "user_input"}
    r = client.post(f"/api/drawings/{did}/alignment", headers=auth("cm"), json=body)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["status"] == "done" and res["job_id"] and res["mapping_count"] > 0
    job = client.get(f"/api/jobs/{res['job_id']}", headers=auth("cm")).json()
    assert job["status"] == "done" and job["kind"] == "mapping"
    # 이전 open mapping 검토요청은 시스템이 on_hold(superseded_by=...) 로만 표시(ADR 0001 §6)
    if res["superseded_ids"]:
        old = client.get(f"/api/review-requests/{res['superseded_ids'][0]}", headers=auth("cm")).json()
        assert old["status"] == "on_hold" and old["resolution_note"].startswith("superseded_by=") and old["resolved_by"] is None
    open_now = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"), params={"kind": "mapping", "status": "open"}).json()
    assert len(open_now) == res["review_requests_created"]
    mappings = client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()
    assert all(m["evidence"]["extra"]["transform_source"] == "user_input" for m in mappings)
    expected_map = {m["handle"]: m["global_id"] for m in load_fixture_json("mapping.expected.json")["mappings"]}
    hits = sum(1 for m in mappings if expected_map.get(m["entity_handle"]) == m["global_id"])
    assert hits / len(expected_map) >= 0.8
    entities = client.get(f"/api/drawings/{did}/entities", headers=auth("client")).json()
    assert entities["alignment"]["alignment"]["source"] == "user_input"


def test_confirm_mapping_records_expert_review(client, auth, project, dxf_job):
    from sqlalchemy import select

    from packages.core.db import new_session
    from packages.core.models.orm import ExpertReviewLogRow

    did = dxf_job["result"]["drawing_id"]
    mappings = client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()
    m = mappings[0]
    other = next(x["global_id"] for x in mappings if x["global_id"] != m["global_id"])
    r = client.post(f"/api/drawings/{did}/mappings/{m['entity_handle']}/confirm", headers=auth("contractor"), json={"global_id": other})
    assert r.status_code == 403
    r = client.post(f"/api/drawings/{did}/mappings/{m['entity_handle']}/confirm", headers=auth("cm"), json={"global_id": other, "note": "도면 확인"})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["global_id"] == other and c["reviewed_by"] and c["needs_review"] is False
    assert c["evidence"]["extra"]["auto_global_id"] == m["global_id"]
    s = new_session()
    try:
        logs = list(s.scalars(select(ExpertReviewLogRow).where(ExpertReviewLogRow.entity_type == "entity_object_mapping")))
        assert logs and logs[-1].entity_id == f"{did}:{m['entity_handle']}"
        assert any(d["path"] == "global_id" for d in logs[-1].diff)
    finally:
        s.close()
    # 재정합해도 사용자 확정 매핑은 유지
    a = load_fixture_json("sample.dxf.expected.json")["alignment"]
    r = client.post(f"/api/drawings/{did}/alignment", headers=auth("cm"),
                    json={"origin": a["origin_m"], "rotation_deg": a["rotation_deg"], "scale": a["scale"], "source": "user_input"})
    assert r.status_code == 200 and r.json()["kept_confirmed"] >= 1
    again = {x["entity_handle"]: x for x in client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()}
    assert again[m["entity_handle"]]["global_id"] == other and again[m["entity_handle"]]["reviewed_by"]
