"""계획 0006 §과제 2 — `close_inspection_reviews` 의 `from_state` 축(V11 양성 · V12 음성 대조군).

## 무엇을 지키는가

`services/progress/state_machine.close_inspection_reviews` 의 첫 줄은 두 조건을 함께 본다
(`grep -n "transition.from_state != ObjectState.INSPECTION_REQUESTED" services/progress/state_machine.py`):

    if transition.actor != Actor.CM or transition.from_state != ObjectState.INSPECTION_REQUESTED:
        return []

계획 0006 §2-a 가 그 `from_state` 조건만 지운 트리를 태워 보고 두 가지를 관측했다 — ① CM 의 평범한
`accept_rework`(MISMATCH → IN_PROGRESS)가 **409 `rejection_reason_required`** 로 막히고 ② 그런데도
전량(783)이 통과했다. 즉 그 조건은 실재하는 경로를 가르는데 어떤 테스트도 지키지 않았다. 이 파일이
그 자리다.

**그 409 가 왜 거짓말인가**: `accept_rework` 는 아무 검토요청도 반려하지 않는다(실측 — 아래 V11 이
그 사실을 함께 단언한다). "반려하려면 사유를 입력해야 합니다"라는 안내를 받은 CM 은 자기가 반려하고
있지 않은 요청의 사유를 적게 된다(CLAUDE.md §6-4: 부정확한 문구는 작동하지 않는 안전 장치다).

## 그 상태를 어떻게 만드는가 (전부 운영 경로)

`PLANNED →(contractor) REPORTED →(contractor) INSPECTION_REQUESTED` 로 미결 inspection 요청을 만든 뒤,
**system 스캔 판정**(`ScanState.MISMATCH` → `ObjectStateMachine.apply_scan_verdict`)으로 MISMATCH 로
내려온다. `close_inspection_reviews` 가 `actor != CM` 에서 되돌아가므로 **미결 inspection 이 열린 채
MISMATCH** 가 된다 — 이것이 `from_state != INSPECTION_REQUESTED` 인데 미결 inspection 이 있는 유일한
운영 상태다. 스캔 판정에는 HTTP 진입점이 없다(역할→actor 매핑에 `system` 이 없다 — CLAUDE.md §3 규칙 8)
그래서 그 한 걸음만 `session_scope` 로 부른다. 나머지는 전부 API 다.

## §6-2 물음 — 이 기대값을 결함 있는 코드가 그대로 만족하는가

- V11 의 **201 만** 단언하면 `close_inspection_reviews` 를 통째로 지운 코드도 통과한다. 그래서 그
  inspection 요청이 **여전히 열려 있고 처리자·처리 메모가 없다**를 함께 단언한다(§6-2 4).
- 그래도 "가드를 통째로 지운 코드"는 V11 만으로는 죽지 않는다 — 그래서 **V12(같은 축의 음성 대조군)**
  가 함께 있다: `INSPECTION_REQUESTED` 에서 사유 없는 `reject_inspection` 은 409 여야 한다. 가드가
  사라지면 그것이 201 이 되어 V12 가 죽는다.
"""
from __future__ import annotations

import pytest

from packages.core.db import session_scope
from packages.core.models.evidence import Evidence
from packages.core.models.scan import ScanState, ScanVerdict
from services.progress.state_machine import ObjectStateMachine

REJECTION_CODE = "rejection_reason_required"


def _pick_planned(client, auth, project) -> str:
    """아직 아무도 쓰지 않은 PLANNED 객체 하나(test_18·test_19 와 같은 근거: 전이를 걸면 목록에서 빠진다)."""
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object available — 앞선 파일들이 세션 프로젝트의 PLANNED 를 모두 소진했다"
    return items[0]["global_id"]


def _transition(client, auth, project, role, gid, body):
    """`?project_id=` 를 반드시 준다 — 같은 IFC 픽스처가 여러 프로젝트에 있어 `global_id` 단독 조회는
    `ambiguous_global_id`(409)로 먼저 걸린다. 그 409 를 이 파일의 409 단언이 삼키면 아무것도 검증하지
    않게 된다(test_18 이 실측한 자리)."""
    return client.post(f"/api/objects/{gid}/transitions", headers=auth(role),
                       params={"project_id": project}, json=body)


def _object(client, auth, project, gid) -> dict:
    r = client.get(f"/api/objects/{gid}", headers=auth("cm"), params={"project_id": project})
    assert r.status_code == 200, r.text
    return r.json()


def _review(client, auth, review_request_id: str) -> dict:
    r = client.get(f"/api/review-requests/{review_request_id}", headers=auth("cm"))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def inspection_requested(client, auth, project, ifc_job) -> tuple[str, str]:
    """PLANNED → REPORTED → INSPECTION_REQUESTED. 서버가 만든 **진짜** inspection 요청 id 를 함께 준다."""
    gid = _pick_planned(client, auth, project)
    for role, body in (("contractor", {"to_state": "REPORTED", "note": "착수"}),
                       ("contractor", {"to_state": "INSPECTION_REQUESTED", "note": "검측 요청"})):
        r = _transition(client, auth, project, role, gid, body)
        assert r.status_code == 201, r.text
    open_ids = _object(client, auth, project, gid)["current_state"]["open_review_ids"]
    assert len(open_ids) == 1, f"expected exactly one open inspection review, got {open_ids}"
    return gid, open_ids[0]


def test_v11_accept_rework_after_a_system_mismatch_needs_no_reason_and_closes_nothing(
        client, auth, project, inspection_requested):
    """V11(양성) — `from_state != INSPECTION_REQUESTED` 인데 미결 inspection 이 열려 있는 상태에서,
    사유 없는 `accept_rework`(MISMATCH → IN_PROGRESS, cm)는 **201** 이고 그 요청은 **열린 채** 남는다.

    두 단언이 함께여야 의미가 있다: 201 만 보면 `close_inspection_reviews` 를 통째로 지운 코드도
    통과하고, "열려 있다"만 보면 사유 요건이 켜져 전이가 막힌 코드(409)를 구별하지 못한다.
    """
    gid, rid = inspection_requested

    # system 스캔 판정으로 MISMATCH 로 내려온다 — 이 한 걸음만 HTTP 진입점이 없다.
    with session_scope() as session:
        verdict = ScanVerdict(scan_id="scan-from-state-guard", global_id=gid, state=ScanState.MISMATCH,
                              confidence=0.62,
                              evidence=Evidence(source_type="scan", source_id="scan-from-state-guard",
                                                method="probe_alignment"))
        transition = ObjectStateMachine().apply_scan_verdict(session, project, verdict)
        assert transition is not None, "스캔 판정이 전이를 만들지 못했다 — 이 시나리오의 전제가 깨졌다"
        assert (transition.from_state.value, transition.to_state.value, transition.actor.value) == \
            ("INSPECTION_REQUESTED", "MISMATCH", "system")

    state = _object(client, auth, project, gid)["current_state"]
    assert state["state"] == "MISMATCH"
    assert state["open_review_ids"] == [rid]     # system 판정은 검측 요청을 닫지 않는다(종료는 cm 결정에서만)

    r = _transition(client, auth, project, "cm", gid, {"to_state": "IN_PROGRESS"})   # note 미전송
    assert r.status_code == 201, r.text

    assert _object(client, auth, project, gid)["current_state"]["state"] == "IN_PROGRESS"
    review = _review(client, auth, rid)
    assert review["status"] == "open"            # 이 전이는 아무 요청도 반려하지 않았다
    assert review["resolved_by"] is None and review["resolved_at"] is None
    assert not (review["resolution_note"] or "")


def test_v12_reject_inspection_without_a_reason_is_still_refused(client, auth, project, inspection_requested):
    """V12(음성 대조군, 같은 축) — `from_state == INSPECTION_REQUESTED` 이고 미결 inspection 이 있으면
    사유 없는 `reject_inspection`(→IN_PROGRESS, cm)은 **409 `rejection_reason_required`** 이고 객체 상태도
    요청 상태도 움직이지 않는다.

    이것이 없으면 V11 은 "가드를 통째로 지운 코드"에서도 초록이다(그 코드에서 V11 은 여전히 201 이고
    요청도 열린 채다). 두 테스트가 같은 축의 양쪽이다.
    """
    gid, rid = inspection_requested

    r = _transition(client, auth, project, "cm", gid, {"to_state": "IN_PROGRESS"})   # note 미전송
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["code"] == REJECTION_CODE, body
    assert body["review_kind"] == "inspection" and body["review_request_ids"] == [rid], body

    assert _object(client, auth, project, gid)["current_state"]["state"] == "INSPECTION_REQUESTED"
    review = _review(client, auth, rid)
    assert review["status"] == "open" and review["resolved_by"] is None

    # 사유를 채우면 같은 전이가 통과한다 — 요건은 잠금이지 차단이 아니다.
    ok = _transition(client, auth, project, "cm", gid, {"to_state": "IN_PROGRESS", "note": "배근 간격 미달 — 재시공"})
    assert ok.status_code == 201, ok.text
    closed = _review(client, auth, rid)
    assert closed["status"] == "rejected" and closed["resolved_by"]
    assert "배근 간격 미달 — 재시공" in (closed["resolution_note"] or "")
