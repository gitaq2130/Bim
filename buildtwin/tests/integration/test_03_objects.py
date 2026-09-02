"""객체 상세(4섹션) 와 상태 전이 역할 규칙."""
from __future__ import annotations


def _pick_planned(client, auth, project, ifc_type="IfcBeam", level="2F"):
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED", "ifc_type": ifc_type, "level": level}).json()["items"]
    assert items, "no PLANNED object available"
    return items[0]["global_id"]


def test_object_detail_has_four_sections(client, auth, project, ifc_job):
    gid = _pick_planned(client, auth, project)
    r = client.get(f"/api/objects/{gid}", headers=auth("cm"))
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {"basic", "current_state", "history", "next_actions", "linked"}
    assert d["basic"]["global_id"] == gid and d["basic"]["bbox"]
    cs = d["current_state"]
    assert cs["state"] == "PLANNED" and cs["confidence"] is not None and cs["evidence"]["source_type"] == "ingest"
    assert cs["has_open_review"] is False
    assert d["history"] == []
    assert d["next_actions"] == [] or all({"kind", "label", "allowed_roles"} <= set(a) for a in d["next_actions"])
    assert {"entity_handles", "activity_ids", "material_ids", "latest_scan_verdict"} <= set(d["linked"])
    # contractor 는 PLANNED 에서 REPORTED 신고 가능
    r = client.get(f"/api/objects/{gid}", headers=auth("contractor"))
    kinds = {a["kind"]: a for a in r.json()["next_actions"]}
    assert "report_progress" in kinds and kinds["report_progress"]["to_state"] == "REPORTED"
    assert client.get("/api/objects/does-not-exist", headers=auth("cm")).status_code == 404


def test_contractor_cannot_confirm(client, auth, project, ifc_job):
    gid = _pick_planned(client, auth, project)
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"),
                    json={"to_state": "CONFIRMED", "evidence": {"source_type": "user_input", "source_id": "x"}})
    assert r.status_code == 403
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("client"),
                    json={"to_state": "REPORTED", "evidence": {"source_type": "user_input", "source_id": "x"}})
    assert r.status_code == 403


def test_cm_confirm_path(client, auth, project, ifc_job):
    gid = _pick_planned(client, auth, project)
    # cm 이 PLANNED 에서 바로 CONFIRMED 는 상태기계가 거부(409)
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("cm"), json={"to_state": "CONFIRMED", "note": "너무 이름"})
    assert r.status_code == 409
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"),
                    json={"to_state": "REPORTED", "evidence": {"source_type": "daily_report", "source_id": "manual"}, "note": "착수"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["from_state"] == "PLANNED" and t["to_state"] == "REPORTED" and t["actor"] == "contractor" and t["evidence"]["note"]
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "INSPECTION_REQUESTED"})
    assert r.status_code == 201, r.text
    d = client.get(f"/api/objects/{gid}", headers=auth("cm")).json()
    assert d["current_state"]["state"] == "INSPECTION_REQUESTED" and d["current_state"]["has_open_review"] is True
    kinds = {a["kind"] for a in d["next_actions"]}
    assert "confirm" in kinds and "resolve_review" in kinds
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("cm"), json={"to_state": "CONFIRMED", "note": "현장 검측 완료"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["to_state"] == "CONFIRMED" and t["actor"] == "cm" and t["evidence"]["source_type"] == "cm_action"
    d = client.get(f"/api/objects/{gid}", headers=auth("cm")).json()
    assert d["current_state"]["state"] == "CONFIRMED" and d["current_state"]["actor"] == "cm" and d["current_state"]["confidence"] == 1.0
    assert [h["to_state"] for h in d["history"]] == ["CONFIRMED", "INSPECTION_REQUESTED", "REPORTED"]   # 최신순
    assert d["current_state"]["has_open_review"] is False   # 검측 검토요청은 승인으로 종료
    # admin 은 cm 으로 행동: 확정 취소 가능
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("admin"), json={"to_state": "MISMATCH", "note": "후속 발견"})
    assert r.status_code == 201 and r.json()["actor"] == "cm"
