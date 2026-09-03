"""핵심 E2E 흐름(.claude/agents/qa.md §핵심 E2E 시나리오) — 담당: qa. FastAPI TestClient + Celery eager + 임시 sqlite.

1. 로그인(cm) → 프로젝트 생성          5. sample.ply + 기준점 → 정합 rmse → 판정에 CONFIRMED 없음
2. sample.ifc 업로드 → 잡 폴링 → 객체 수  6. schedule.csv → Readiness → 착수 가능 집합
3. sample.dxf 업로드 → 매핑 정확도 ≥ 기준  7. 작업일보 "완료" + 스캔 NOT_BUILT → ReviewRequest, 자동 CONFIRMED 없음
4. 3D 객체 → 2D 엔티티 / 2D 영역 → 3D 객체 8. cm 승인 → CONFIRMED 전이 + ExpertReviewLog
9. ADR 0006 격리: 두 번째 프로젝트(다른 멤버 구성) → 1번 프로젝트의 contractor 는 조회·행위 모두 404, 자기 멤버는 정상

정확도·rmse 기준은 tests/metrics.json(회귀 기준)과 같은 값을 쓴다. 테스트는 파일 순서대로 실행되며 `flow` 에 결과를 누적한다.

ADR 0006: 프로젝트 접근권은 `project_members` 행의 존재로 정의된다(없으면 404 `project_not_found`) — 1단계에서
이 흐름이 실제로 쓰는 역할(cm/contractor)에게만 멤버십을 준다(tests/integration/conftest.py 의 `project`/`add_member`
패턴을 그대로 따른다). admin 은 행위 역할이 없으므로(ADR 0001 §4-1, ADR 0006 §2) 프로젝트 생성에만 남아 있다.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from packages.core.db import new_session
from packages.core.models.orm import ExpertReviewLogRow
from packages.core.models.scan import ScanState

from .conftest import FIXTURES, METRICS, Api, add_member, load_fixture_json

SCAN_STATES = {s.value for s in ScanState}


def _review_logs(entity_type: str, entity_id: str) -> list[ExpertReviewLogRow]:
    s = new_session()
    try:
        return list(s.scalars(select(ExpertReviewLogRow).where(ExpertReviewLogRow.entity_type == entity_type,
                                                              ExpertReviewLogRow.entity_id == entity_id)))
    finally:
        s.close()


def _intersects(b: dict, area: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = area
    return not (b["max"][0] < x0 or x1 < b["min"][0] or b["max"][1] < y0 or y1 < b["min"][1])


@pytest.fixture(scope="module")
def flow(api) -> dict:
    return {"api": Api(api)}


# ----------------------------------------------------------------------------- 1
def test_step1_cm_login_and_project_creation(flow):
    a: Api = flow["api"]
    token = a.login("cm")
    me = a.get("/auth/me", "cm")
    assert me.status_code == 200 and me.json()["role"] == "cm" and token
    # 역할 행렬(api): 프로젝트 생성은 admin 전용 — cm 은 403 (qa.md 1단계의 "cm 생성" 은 admin 위임으로 수행)
    assert a.post("/projects", "cm", json={"name": "E2E 현장"}).status_code == 403
    r = a.post("/projects", "admin", json={"name": "E2E 핵심 흐름 현장"})
    assert r.status_code == 201, r.text
    flow["project"] = r.json()["project_id"]
    # ADR 0006: 멤버십 행이 접근권을 정의한다 — 이 흐름이 실제로 쓰는 역할(cm/contractor)에게 부여한다.
    # client 는 이 프로젝트에 넣지 않는다: 9단계 격리 시나리오의 "다른 프로젝트 전용 멤버" 로 쓴다.
    flow["user_ids"] = {role: a.user_id(role) for role in ("cm", "contractor", "client")}
    add_member(a, flow["project"], flow["user_ids"]["cm"], "cm")
    add_member(a, flow["project"], flow["user_ids"]["contractor"], "contractor")
    assert a.get(f"/projects/{flow['project']}", "cm").status_code == 200


# ----------------------------------------------------------------------------- 2
def test_step2_upload_ifc_poll_job_and_count_objects(flow):
    a: Api = flow["api"]
    expected = load_fixture_json("sample.ifc.expected.json")
    up, job = a.upload(flow["project"], FIXTURES / "sample.ifc", role="cm")
    assert up["kind"] == "ifc" and job["kind"] == "ingest" and job["status"] == "done", job
    assert job["progress"] == 1.0
    assert job["result"]["object_count"] == sum(expected["counts"].values())
    flow["model_id"] = job["result"]["model_id"]
    objects = a.get(f"/projects/{flow['project']}/objects", "cm", page_size=500).json()
    assert objects["total"] == sum(expected["counts"].values())
    by_type: dict[str, int] = {}
    for o in objects["items"]:
        by_type[o["ifc_type"]] = by_type.get(o["ifc_type"], 0) + 1
    assert by_type == expected["counts"]
    assert all(o["state"] == "PLANNED" for o in objects["items"])
    flow["objects"] = {o["global_id"]: o for o in objects["items"]}


# ----------------------------------------------------------------------------- 3
def test_step3_upload_dxf_mapping_accuracy(flow):
    a: Api = flow["api"]
    up, job = a.upload(flow["project"], FIXTURES / "sample.dxf", role="cm", level="1F")
    assert up["kind"] == "dxf" and job["status"] == "done", job
    did = job["result"]["drawing_id"]
    assert job["result"]["mapping"]["status"] == "done"
    flow["drawing_id"] = did
    mappings = a.get(f"/drawings/{did}/mappings", "cm").json()
    assert mappings
    got = {m["entity_handle"]: m["global_id"] for m in mappings}
    expected = load_fixture_json("mapping.expected.json")["mappings"]
    cols = [m for m in expected if m["layer"] == "A-COL"]
    col_acc = sum(got.get(m["handle"]) == m["global_id"] for m in cols) / len(cols)
    all_acc = sum(got.get(m["handle"]) == m["global_id"] for m in expected) / len(expected)
    print(f"\ne2e mapping_column_accuracy={col_acc:.3f} overall={all_acc:.3f}")
    assert col_acc >= METRICS["mapping_column_accuracy"], col_acc
    assert all_acc >= METRICS["mapping_overall_accuracy"], all_acc
    for m in mappings:
        assert 0.0 <= m["confidence"] <= 1.0 and m["evidence"]["source_type"] == "mapping"
        assert m["reviewed_by"] or m["needs_review"] == (m["confidence"] < 0.7)
    flow["mappings"] = mappings
    flow["expected_mapping"] = expected


# ----------------------------------------------------------------------------- 4
def test_step4_3d_click_highlights_2d_and_2d_area_selects_3d(flow):
    """서버 계약으로 검증: 3D 선택(global_id) → linked.entity_handles / 2D 영역(bbox) → 엔티티 → 매핑 → global_ids.
    브라우저 브로커(3D 선택→2D highlight 호출, 2D 영역→3D highlight, 루프 없음)는 apps/web/src/sync 의 vitest 가 검증한다."""
    a: Api = flow["api"]
    did = flow["drawing_id"]
    cols = [m for m in flow["expected_mapping"] if m["layer"] == "A-COL"]
    # 3D 객체 클릭 → 대응 2D 엔티티
    gid, handle = cols[0]["global_id"], cols[0]["handle"]
    detail = a.get(f"/objects/{gid}", "cm").json()
    assert detail["linked"]["drawing_id"] == did
    assert handle in detail["linked"]["entity_handles"], detail["linked"]
    entities = a.get(f"/drawings/{did}/entities", "cm").json()["entities"]
    by_handle = {e["handle"]: e for e in entities}
    assert handle in by_handle and by_handle[handle]["layer"] == "A-COL"
    # 2D 영역 선택 → 3D 객체: 기둥 두 개의 bbox 합집합을 드래그 영역으로 삼는다
    h1, h2 = cols[0]["handle"], cols[1]["handle"]
    b1, b2 = by_handle[h1]["bbox"], by_handle[h2]["bbox"]
    area = (min(b1["min"][0], b2["min"][0]), min(b1["min"][1], b2["min"][1]), max(b1["max"][0], b2["max"][0]), max(b1["max"][1], b2["max"][1]))
    picked = {e["handle"] for e in entities if e["bbox"] and _intersects(e["bbox"], area)}
    assert {h1, h2} <= picked
    to_gid = {m["entity_handle"]: m["global_id"] for m in flow["mappings"]}
    gids = {to_gid[h] for h in picked if h in to_gid}
    assert {cols[0]["global_id"], cols[1]["global_id"]} <= gids
    assert all(flow["objects"][g]["level"] == "1F" for g in gids), "area selection must resolve to 1F objects only"


# ----------------------------------------------------------------------------- 5
def test_step5_upload_scan_align_rmse_and_no_confirmed_verdicts(flow):
    a: Api = flow["api"]
    up, job = a.upload(flow["project"], FIXTURES / "sample.ply", role="cm")
    assert up["kind"] == "ply" and job["status"] == "done", job
    scan_id = job["result"]["scan_id"]
    assert job["result"]["status"] == "needs_alignment_input"   # 자동 ICP 만 믿지 않는다: 기준점 입력 경로
    r = a.post(f"/scans/{scan_id}/alignment", "cm", json=load_fixture_json("alignment.json"))
    assert r.status_code == 202, r.text
    vjob = a.wait_job(r.json()["job_id"])
    assert vjob["kind"] == "verdict" and vjob["status"] == "done", vjob
    reg = a.get(f"/scans/{scan_id}/registration", "cm").json()
    assert reg["status"] == "ok" and reg["rmse"] is not None
    print(f"\ne2e registration_rmse={reg['rmse']:.4f}")
    assert reg["rmse"] <= METRICS["registration_rmse_max"], reg
    body = a.get(f"/scans/{scan_id}/verdicts", "cm").json()
    assert body["total"] == len(body["items"]) > 0
    states = {v["global_id"]: v["state"] for v in body["items"]}
    assert set(states.values()) <= SCAN_STATES and "CONFIRMED" not in states.values()
    for v in body["items"]:
        assert 0.0 <= v["confidence"] <= 1.0 and v["evidence"]["source_type"] == "scan"
    expected = load_fixture_json("verdict.expected.json")["verdicts"]
    common = [g for g in expected if g in states]
    assert len(common) == len(expected)
    acc = sum(states[g] == expected[g] for g in common) / len(common)
    print(f"e2e scan_verdict_accuracy={acc:.3f}")
    assert acc >= METRICS["scan_verdict_accuracy"], {g: (states[g], expected[g]) for g in common if states[g] != expected[g]}
    # 스캔은 객체 상태를 CONFIRMED 로 만들 수 없다
    assert a.get(f"/projects/{flow['project']}/objects", "cm", state="CONFIRMED").json()["total"] == 0
    flow["scan_id"], flow["verdicts"] = scan_id, states


# ----------------------------------------------------------------------------- 6
def test_step6_upload_schedule_readiness_and_startable(flow):
    a: Api = flow["api"]
    up, job = a.upload(flow["project"], FIXTURES / "schedule.csv", role="cm")
    assert up["kind"] == "csv" and job["status"] == "done", job
    expected = load_fixture_json("schedule.expected.json")
    assert job["result"]["activity_count"] == expected["activity_count"]
    assert job["result"]["relation_count"] == expected["relation_count"]
    acts = {x["activity_id"]: x for x in a.get(f"/projects/{flow['project']}/activities", "cm").json()}
    assert set(acts) == set(expected["activities"])
    for aid in ("A100", "A110"):
        s = a.get(f"/activities/{aid}/readiness", "cm").json()
        assert 0.0 <= s["score"] <= 1.0 and 0.0 <= s["confidence"] <= 1.0 and s["evidence"]
        assert set(s["components"]) == set(s["weights"])
    startable = a.get(f"/projects/{flow['project']}/startable", "cm").json()
    assert startable["evidence"]["source_type"] == "system_logic" and 0.0 < startable["threshold"] <= 1.0
    preds = {aid: set(x["predecessor_ids"]) for aid, x in acts.items()}
    # 선후행 위반 없음: 선행이 있는 작업은 착수 가능 집합에 들어올 수 없다(모두 PLANNED/스캔 상태, CONFIRMED 없음)
    assert all(not preds[aid] for aid in startable["startable"]), startable
    assert set(startable["startable"]) <= {"A100"}
    blocked = startable["blocked"]
    assert "A110" in blocked and any(b["component"].startswith("predecessor") for b in blocked["A110"]), blocked.get("A110")
    # A100 은 선행이 없다: 차단된다면 사유는 선행이 아니라 다른 축(스캔 불일치·검측·도면승인 등)이어야 한다
    a100 = blocked.get("A100", [])
    assert not any(b["component"].startswith("predecessor") for b in a100), a100
    if "A100" not in startable["startable"] and "A100" not in blocked:
        # 후보에서 빠졌다면 이미 착수된 작업이어야 한다: 5단계 스캔 판정으로 1F 기둥 상태가 PLANNED 를 벗어났기 때문
        states = {g: a.get(f"/objects/{g}", "cm").json()["current_state"]["state"] for g in acts["A100"]["mapped_global_ids"]}
        assert any(st != "PLANNED" for st in states.values()), states
        assert "CONFIRMED" not in states.values()
    print(f"\ne2e startable={startable['startable']} A100_blockers={[b['component'] for b in a100]}")


# ----------------------------------------------------------------------------- 7
def test_step7_completed_claim_vs_not_built_scan_creates_review_no_auto_confirm(flow):
    a: Api = flow["api"]
    not_built = [g for g, st in flow["verdicts"].items() if st == "NOT_BUILT" and flow["objects"][g]["ifc_type"] == "IfcBeam"]
    assert not_built, "fixture must contain a NOT_BUILT 1F beam"
    gid = not_built[0]
    before = a.get(f"/objects/{gid}", "cm").json()["current_state"]["state"]
    report = {"report_date": "2026-09-01", "crew_count": 4, "equipment": {"crane": 1},
              "items": [{"global_id": gid, "claimed_state": "completed", "quantity": 1.0, "quantity_unit": "m3"}], "note": "보 설치 완료"}
    r = a.post(f"/projects/{flow['project']}/daily-reports", "contractor", json=report)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["transitions"] == []                      # 자동 전이 차단
    assert out["review_requests"] and any(rv["rule_id"] == "VER-001" for rv in out["review_requests"])
    rv = next(rv for rv in out["review_requests"] if rv["rule_id"] == "VER-001")
    assert rv["kind"] == "verification" and 0.0 <= rv["confidence"] <= 1.0 and rv["evidence"]
    assert rv["conflicting_sources"]["scan"]["state"] == "NOT_BUILT"
    assert rv["conflicting_sources"]["daily_report"]["claimed_state"] == "completed"
    d = a.get(f"/objects/{gid}", "cm").json()
    assert d["current_state"]["state"] == before and d["current_state"]["state"] != "CONFIRMED"
    assert d["current_state"]["has_open_review"] is True
    assert a.get(f"/projects/{flow['project']}/objects", "cm", state="CONFIRMED").json()["total"] == 0
    flow["gid"], flow["verification_review"] = gid, rv


# ----------------------------------------------------------------------------- 8
def test_step8_cm_approval_confirms_and_records_expert_review_log(flow):
    a: Api = flow["api"]
    gid, rv = flow["gid"], flow["verification_review"]
    # 8a. 검증 검토요청 승인 → ExpertReviewLog, 상태는 그대로(차단 해제만)
    r = a.post(f"/review-requests/{rv['review_request_id']}/resolve", "cm", json={"decision": "approved", "note": "현장 확인"})
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    logs = _review_logs("review_request", rv["review_request_id"])
    assert len(logs) == 1 and logs[0].proposal["status"] == "open" and logs[0].final["status"] == "approved"
    assert a.get(f"/objects/{gid}", "cm").json()["current_state"]["state"] != "CONFIRMED"
    # 8b. contractor 는 확정 불가(403); 신고 → 검측 요청
    assert a.post(f"/objects/{gid}/transitions", "contractor", json={"to_state": "CONFIRMED"}).status_code == 403
    assert a.post(f"/objects/{gid}/transitions", "contractor", json={"to_state": "REPORTED", "note": "착수"}).status_code == 201
    assert a.post(f"/objects/{gid}/transitions", "contractor", json={"to_state": "INSPECTION_REQUESTED", "note": "완료"}).status_code == 201
    inspections = a.get(f"/projects/{flow['project']}/review-requests", "cm", kind="inspection", status="open", global_id=gid).json()
    assert len(inspections) == 1
    insp = inspections[0]
    # 8c. cm 승인 → CONFIRMED (actor=cm) + ExpertReviewLog
    r = a.post(f"/review-requests/{insp['review_request_id']}/resolve", "cm", json={"decision": "approved", "note": "검측 합격"})
    assert r.status_code == 200, r.text
    d = a.get(f"/objects/{gid}", "cm").json()
    assert d["current_state"]["state"] == "CONFIRMED" and d["current_state"]["actor"] == "cm"
    assert d["history"][0]["to_state"] == "CONFIRMED" and d["history"][0]["review_request_id"] == insp["review_request_id"]
    assert all(h["actor"] == "cm" for h in d["history"] if h["to_state"] == "CONFIRMED")
    assert _review_logs("review_request", insp["review_request_id"])
    confirmed = a.get(f"/projects/{flow['project']}/objects", "cm", state="CONFIRMED").json()
    assert confirmed["total"] == 1 and confirmed["items"][0]["global_id"] == gid


# ----------------------------------------------------------------------------- 9
def test_step9_second_project_membership_isolates_first_projects_contractor(flow):
    """ADR 0006 규칙 2·5·7: project_members 행이 접근권 그 자체다. 두 번째 프로젝트를 만들고 1단계 프로젝트의
    contractor 를 일부러 멤버에서 뺀다 — 조회·업로드 모두 404(project_not_found), 403 이 아니다(프로젝트 존재를
    흘리지 않는다). 반대로 그 프로젝트의 실제 멤버(cm/client)는 정상적으로 조회·행위할 수 있다. 대칭으로,
    2번 프로젝트 전용 멤버(client)는 1번 프로젝트를 보지 못한다 — 같은 사람이 현장마다 다른 자격을 갖는다는
    ADR 0006 의 핵심 주장을 흐름 전체에서 실제로 보여준다(bim_objects PK 가 (project_id, global_id) 라 같은
    sample.ifc 를 다른 프로젝트에 다시 올려도 충돌하지 않는다 — ADR 0005)."""
    a: Api = flow["api"]
    uid = flow["user_ids"]
    r = a.post("/projects", "admin", json={"name": "E2E 격리 확인 현장"})
    assert r.status_code == 201, r.text
    project2 = r.json()["project_id"]
    # 1번 프로젝트의 contractor 는 여기서 뺀다. cm 은 여러 현장을 겸임할 수 있다는 가정으로 같이 넣어
    # "자기 멤버는 행위(업로드)까지 된다" 를 보여주고, client 는 이 프로젝트 전용 멤버로 조회만 확인한다.
    add_member(a, project2, uid["cm"], "cm")
    add_member(a, project2, uid["client"], "client")

    # contractor: project2 멤버가 아니므로 조회도 행위 시도도 404 — 열거 방지(403 이 아님)
    r = a.get(f"/projects/{project2}", "contractor")
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text
    r = a.get(f"/projects/{project2}/objects", "contractor")
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text
    with open(FIXTURES / "sample.ifc", "rb") as fh:
        r = a.post(f"/projects/{project2}/files", "contractor", files={"file": ("sample.ifc", fh)})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text

    # project2 의 실제 멤버는 정상 동작: client 는 조회, cm 은 업로드(행위)까지 된다
    r = a.get(f"/projects/{project2}", "client")
    assert r.status_code == 200 and r.json()["project_id"] == project2, r.text
    _, job = a.upload(project2, FIXTURES / "sample.ifc", role="cm")
    assert job["status"] == "done", job

    # 대칭: project2 전용 멤버(client)는 1번 프로젝트를 못 본다
    r = a.get(f"/projects/{flow['project']}", "client")
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text
    # 1번 프로젝트의 contractor 는 자기 현장에서는 여전히 정상 — 격리가 전면 차단이 아니라 프로젝트 단위임을 재확인
    assert a.get(f"/projects/{flow['project']}", "contractor").status_code == 200
