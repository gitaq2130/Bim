"""IFC 업로드 → job 완료 → 객체 42개·레벨·모델·메시 서빙."""
from __future__ import annotations

from .conftest import FIXTURES, upload


def test_ifc_job_result_and_objects(client, auth, project, ifc_job, ifc_expected):
    assert ifc_job["kind"] == "ingest" and ifc_job["progress"] == 1.0
    res = ifc_job["result"]
    assert res["status"] in ("ok", "partial") and res["model_id"] and res["version"] == 1
    assert res["object_count"] == sum(ifc_expected["counts"].values()) == 42
    assert all(isinstance(w, dict) and "code" in w and "message" in w for w in ifc_job["warnings"])

    r = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page_size": 500})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 42 and len(body["items"]) == 42
    item = body["items"][0]
    assert {"global_id", "ifc_type", "state", "level", "bbox", "group", "model_id"} <= set(item)
    assert all(i["state"] == "PLANNED" for i in body["items"])
    by_type = {}
    for i in body["items"]:
        by_type[i["ifc_type"]] = by_type.get(i["ifc_type"], 0) + 1
    assert by_type == ifc_expected["counts"]


def test_object_filters_and_pagination(client, auth, project, ifc_job):
    r = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"level": "1F", "ifc_type": "IfcColumn"})
    assert r.status_code == 200 and r.json()["total"] == 6
    r = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page": 2, "page_size": 10})
    assert r.status_code == 200 and len(r.json()["items"]) == 10 and r.json()["page"] == 2
    r = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"state": "CONFIRMED"})
    assert r.status_code == 200 and r.json()["total"] == 0


def test_levels(client, auth, project, ifc_job, ifc_expected):
    r = client.get(f"/api/projects/{project}/levels", headers=auth("client"))
    assert r.status_code == 200
    names = {lv["name"]: lv for lv in r.json()}
    assert set(names) == {lv["name"] for lv in ifc_expected["levels"]}
    assert all(names[n]["object_count"] > 0 for n in names)


def test_models_and_mesh_endpoints(client, auth, project, ifc_job):
    r = client.get(f"/api/projects/{project}/models", headers=auth("client"))
    assert r.status_code == 200 and len(r.json()) == 1
    m = r.json()[0]
    assert m["model_uri"] == f"/api/models/{m['model_id']}/mesh" and m["levels"] and m["coordinate_system"]["source"]
    assert isinstance(m["plan_section_default_offset"], float)
    r = client.get(m["model_uri"], headers=auth("client"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    bundle = r.json()
    assert bundle
    r = client.get(f"/api/models/{m['model_id']}/mesh.obj", headers=auth("client"))
    assert r.status_code == 200 and b"v " in r.content
    r = client.get(f"/api/models/{m['model_id']}/plan-section", headers=auth("client"), params={"level": "1F"})
    assert r.status_code == 200
    sec = r.json()
    assert sec["level"] == "1F" and "coordinate_system" in sec and sec["polylines"]
    assert {"global_id", "points", "closed"} <= set(sec["polylines"][0])
    assert sec["offset"] == m["plan_section_default_offset"] and sec["cut_elevation"] == sec["elevation"] + sec["offset"]


def test_file_content_and_list(client, auth, project, ifc_job):
    r = client.get(f"/api/projects/{project}/files", headers=auth("client"))
    assert r.status_code == 200
    f = next(x for x in r.json() if x["kind"] == "ifc")
    assert f["size"] > 0 and len(f["sha256"]) == 64
    r = client.get(f"/api/files/{f['file_id']}/content", headers=auth("client"))
    assert r.status_code == 200 and r.content.startswith(b"ISO-10303-21")


def test_reupload_keeps_state_and_bumps_version(client, auth, project, ifc_job):
    gid = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"level": "2F", "ifc_type": "IfcBeam"}).json()["items"][0]["global_id"]
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"),
                    json={"to_state": "REPORTED", "evidence": {"source_type": "user_input", "source_id": "re-upload-test"}})
    assert r.status_code == 201, r.text
    # admin 은 프로젝트 범위 업로드(행위)를 못한다(ADR 0006 — 행위 역할이 없다) — 그 프로젝트의 cm 으로 올린다.
    _, job = upload(client, auth("cm"), project, FIXTURES / "sample.ifc")
    assert job["status"] == "done" and job["result"]["version"] == 2 and job["result"]["orphaned"] == 0
    assert job["result"]["updated"] == 42 and job["result"]["created"] == 0
    detail = client.get(f"/api/objects/{gid}", headers=auth("client")).json()
    assert detail["basic"]["state"] == "REPORTED" and detail["basic"]["model_version"] == 2
    assert client.get(f"/api/projects/{project}/objects", headers=auth("client")).json()["total"] == 42
    assert len(client.get(f"/api/projects/{project}/models", headers=auth("client")).json()) == 2


def test_unsupported_upload(client, auth, project):
    r = client.post(f"/api/projects/{project}/files", headers=auth("cm"), files={"file": ("notes.txt", b"hello")})
    assert r.status_code == 415
