"""ADR 0012 — 검토요청을 `rejected` 로 닫으려면 사유가 필요하고, 그 거부는 **자기 code** 로 나간다.

계획 0005 §검증 시나리오 V1~V12(V13~V15 는 `tests/invariants/test_identity_drift_cause_contract.py`).

## 이 파일이 붙들고 있는 것

ADR 0012 §Consequences 가 스스로 적었다: **"넣자마자 무보호다."** 실측(2026-09-05, 작업 트리 HEAD
`d0a0e88`, 기준선 `pytest -q` → **738 passed**)으로 확인한 무보호 목록과, 이 파일의 어느 단언이
그것을 잡는지:

| 변이 | 잡는 자리 |
|---|---|
| 자리 A 가드(`usecases.resolve_review` 프롤로그) 제거 | `test_queue_resolution_matrix_...`(45칸 곱) |
| 자리 B 가드(`state_machine.close_inspection_reviews`) 제거 | `test_second_door_...`(문 B) |
| `errors.py::_rejection_reason_required` 핸들러 제거 | 위 둘의 `code` 단언(**핸들러가 없으면 500** — 이 예외는 `Exception` 직속이라 MRO 폴백이 없다) |
| `rejection_reason_missing` 의 `.strip()` → `not note` | 45칸 곱의 `blank` 축 · 문 B 의 `blank` 축 |
| `rejection_reason_missing` 본문 → `return False` | 위 전부 |
| 예외 부가 필드(`review_kind`·`review_request_ids`) 이름·포맷 변경 | 위 둘의 부가 필드 단언 |
| `_resolution_note` 가 CM 사유를 함께 싣는 것 되돌림 | `test_cm_reason_reaches_the_queue_...`(V12) |
| 예외를 `InvalidTransitionError` 하위 타입으로 | `test_error_is_not_a_subtype_...`(V11) — **HTTP 로는 관측되지 않는다**, 아래 그 이유 |

## 왜 `code` 를 보는가 (ADR 0011 이 실측한 것)

상태코드만 보는 단언은 회귀를 못 잡는다. 여기서는 방향이 둘이다 — 핸들러를 지우면 **500**(잡힌다),
예외를 하위 타입으로 만들면 전용 핸들러가 그대로 이겨 **409 가 유지된다**(안 잡힌다). 그래서 모든
단언이 `code` 를 보고, 하위 타입 축은 따로 구조 단언을 둔다.

## 어떤 검토요청을 실제로 만드는가 — 그리고 왜 일부는 합성 행인가

가드는 **분기 dispatch 앞의 프롤로그**에 있다(`usecases.py`, `grep -n "ADR 0012 불변식 4 / 규칙 1"`).
그러므로 `decision == "rejected"` + 빈 사유인 칸은 **어느 kind 의 분기에도 들어가지 않는다**. 마찬가지로
`on_hold` 는 어느 kind 분기의 조건(`decision in ("approved", "rejected")`)에도 걸리지 않아 공통 폴백으로
간다. 그 두 부류의 칸은 합성 `ReviewRequestRow`(서버가 만드는 것과 같은 모양)로 태우고, **분기가 실제로
도는 칸**(`approved` 전부, `inspection`·`document_mapping` 의 `rejected` × 사유)은 서버가 만든 진짜
검토요청으로 태운다. 어느 칸이 어느 쪽인지는 `_provision` 이 kind 별로 적는다.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import select

from packages.core.db import new_session
from packages.core.models.orm import (
    ActivityObjectMappingRow,
    BimObjectRow,
    EntityObjectMappingRow,
    ReviewRequestRow,
    ScanVerdictRow,
    StateTransitionRow,
)

from .conftest import FIXTURES, add_member, upload

REASON = "3층 배근 미시공 — 재시공 필요"
BLANK = "   "          # 공백만. 화면은 `ConfirmDialog.tsx` 의 `!note.trim()` 으로 잠그지만 API 직접 호출에는 그 방어가 없다.

KINDS = ("inspection", "mapping", "verification", "document_mapping", "document_identity_drift")
DECISIONS = ("approved", "rejected", "on_hold")
NOTE_AXES = ("none", "blank", "reason")     # 필드 미전송 / 공백만 / 사유 있음

REJECTION_CODE = "rejection_reason_required"

# 이 자리에서 **참일 수 없는 말**(CLAUDE.md §6-4 3 — 문장을 통째로 베끼지 않는다).
# `InvalidTransitionError` 의 부모 포맷 앞머리인데, 사유 부재 거부에서는 거짓이다: 반려는 허용된
# 행위이고(다섯 kind 의 세 결정은 그대로다 — ADR 0012 §Consequences 마지막 줄), 빠진 것은 사유뿐이다.
# 그 사실이 이 사이클이 code 를 새로 가른 **유일한 근거**이므로(ADR 0012 규칙 4), 응답이 싣는 `detail`
# 이 그것을 반박하면 계약이 자기모순이다 — CLAUDE.md §6-3 7회차가 정확히 그 재발이다.
NOT_ALLOWED = "not allowed"


def _body(decision: str, note_axis: str) -> dict:
    if note_axis == "none":
        return {"decision": decision}
    return {"decision": decision, "note": BLANK if note_axis == "blank" else REASON}


def _resolve(client, auth, review_request_id: str, decision: str, note_axis: str):
    return client.post(f"/api/review-requests/{review_request_id}/resolve", headers=auth("cm"),
                       json=_body(decision, note_axis))


def _review(client, auth, review_request_id: str) -> dict:
    r = client.get(f"/api/review-requests/{review_request_id}", headers=auth("cm"))
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- 합성 검토요청

def _synthetic_review(project_id: str, kind: str, *, global_id: str | None = None,
                      conflicting_sources: dict | None = None) -> str:
    """서버가 만드는 것과 **같은 모양**의 열린 검토요청 한 건. 위 머리말이 적은 두 부류의 칸에만 쓴다.

    `ReviewRequestRow` 의 FK 는 `project_id` 하나뿐이므로(`packages/core/models/orm.py`,
    `grep -n "class ReviewRequestRow" -A 20`) 이 행은 실제 도면·문서를 참조하지 않아도 저장된다 —
    그리고 그 사실이 이 헬퍼를 쓸 수 있는 칸의 경계와 같다: 참조를 실제로 따라가는 분기에 들어가는
    칸에는 쓰지 않는다.
    """
    rid = str(uuid.uuid4())
    s = new_session()
    try:
        s.add(ReviewRequestRow(
            review_request_id=rid, project_id=project_id, kind=kind, global_id=global_id,
            title=f"테스트: {kind} 반려 사유 요건", confidence=0.5,
            evidence={"source_type": "cm_action", "source_id": "test_setup", "method": "test_setup",
                      "note": None, "extra": {}},
            conflicting_sources=conflicting_sources or {}, assignee_role="cm", status="open"))
        s.commit()
    finally:
        s.close()
    return rid


# --------------------------------------------------------------------------- 진짜 inspection 검토요청

def _pick_planned(client, auth, project) -> str:
    """아직 아무도 쓰지 않은 PLANNED 객체 하나(test_18 과 같은 근거: 전이를 걸면 목록에서 빠진다).
    실측 2026-09-05: 이 파일이 도는 시점에 세션 프로젝트의 PLANNED 는 **27건** 남아 있다."""
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object available"
    return items[0]["global_id"]


def _transition(client, auth, project, role, gid, body):
    """`?project_id=` 를 반드시 준다 — 전체 스위트에서는 같은 IFC 픽스처가 여러 프로젝트에 올라가 있어
    `global_id` 단독 조회가 `ambiguous_global_id`(409, ADR 0005 §3)로 먼저 걸린다. 그 409 를 이 파일의
    409 단언이 삼키면 테스트가 아무것도 검증하지 않게 된다(test_18 이 실측한 자리)."""
    return client.post(f"/api/objects/{gid}/transitions", headers=auth(role),
                       params={"project_id": project}, json=body)


def _object_state(client, auth, project, gid) -> str:
    return client.get(f"/api/objects/{gid}", headers=auth("cm"),
                      params={"project_id": project}).json()["current_state"]["state"]


def _inspection_requested_object(client, auth, project) -> tuple[str, str]:
    """PLANNED → REPORTED → INSPECTION_REQUESTED. 서버가 만든 **진짜** inspection 검토요청 id 를 함께 준다."""
    gid = _pick_planned(client, auth, project)
    for role, body in (("contractor", {"to_state": "REPORTED", "note": "착수"}),
                       ("contractor", {"to_state": "INSPECTION_REQUESTED", "note": "검측 요청"})):
        r = _transition(client, auth, project, role, gid, body)
        assert r.status_code == 201, r.text
    open_ids = client.get(f"/api/objects/{gid}", headers=auth("cm"),
                          params={"project_id": project}).json()["current_state"]["open_review_ids"]
    assert len(open_ids) == 1, f"expected exactly one open inspection review, got {open_ids}"
    return gid, open_ids[0]


# --------------------------------------------------------------------------- 진짜 document_mapping 검토요청

@pytest.fixture(scope="module")
def dm_project(client, auth, user_ids) -> Iterator[str]:
    """공정표 → 대장 순으로 올려 열린 `document_mapping` 검토요청을 만드는 전용 프로젝트(test_15 와 같은 픽스처
    조합·같은 상수). **IFC 를 올리지 않는다** — 그래야 이 프로젝트의 객체가 세션 프로젝트의 `global_id` 와
    겹쳐 다른 파일의 project_id 없는 조회를 409 로 만드는 일이 없다(test_08 이 그 청소를 하는 이유)."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": f"반려 사유 요건 테스트 {uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    up1, job1 = upload(client, auth("contractor"), project_id, FIXTURES / "schedule.csv")
    assert up1["kind"] == "csv" and job1["status"] == "done", job1
    up2, job2 = upload(client, auth("cm"), project_id, FIXTURES / "document_register.xlsx")
    assert up2["kind"] == "xlsx" and job2["status"] == "done", job2
    yield project_id
    _cleanup_project_objects(project_id)


def _cleanup_project_objects(project_id: str) -> None:
    """이 프로젝트가 만든 객체 행을 지운다. 지금은 IFC 를 올리지 않아 0건이지만, 나중에 이 픽스처에
    IFC 가 더해지면 조용히 다른 파일을 깨뜨리는 대신 여기서 청소된다(test_08 `_delete_all_objects` 와 같은 이유)."""
    s = new_session()
    try:
        for model in (StateTransitionRow, EntityObjectMappingRow, ActivityObjectMappingRow, ScanVerdictRow):
            for row in s.scalars(select(model).where(model.project_id == project_id)):
                s.delete(row)
        s.flush()
        for row in s.scalars(select(BimObjectRow).where(BimObjectRow.project_id == project_id)):
            s.delete(row)
        s.commit()
    finally:
        s.close()


def _open_document_mapping_reviews(client, auth, project_id: str) -> list[dict]:
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping", "status": "open"})
    assert r.status_code == 200, r.text
    return r.json()


# =========================================================================== V1~V4: 큐(문 A) 45칸 곱

def test_queue_resolution_matrix_blocks_exactly_rejection_without_reason(client, auth, project, ifc_job, dm_project):
    """**kind × decision × note = 5 × 3 × 3 = 45칸을 곱으로 세운다**(CLAUDE.md §6-1: 관계를 세는 목록은 곱).

    V1(반려×없음) · V2(반려×공백만) · V3(반려×사유) · V4(승인·보류 30칸)를 **한 표**로 단언한다.
    양성만 세우면 "모든 결정에 사유를 요구하는" 구현이 통과하고, 음성만 세우면 가드가 없는 구현이
    통과한다 — 45칸이 함께 있어야 둘 다 죽는다(§6-2 1·3).

    각 칸의 기대값이 **결함 있는 코드에서 달라지는가**(§6-2):
      - 가드 없음(HEAD 이전) → 15개 `rejected` 칸이 전부 200/`rejected`. 실측(ADR 0012 §1): 45칸 전부 200.
      - `.strip()` 없음 → `blank` 축 5칸이 200 으로 뒤집힌다.
      - 조건을 `decision` 으로 가르지 않음 → `approved`·`on_hold` 30칸이 409 로 뒤집힌다.
      - 전용 핸들러 없음 → 10칸의 status 가 **500**(이 예외는 `Exception` 직속이라 MRO 폴백이 없다).
      - kind 로 가른 구현 → 그 kind 의 2칸만 뒤집혀 이 표에서 죽는다.

    **부분 적용이 없다는 것도 함께 본다**(§6-2 4): 막힌 칸의 검토요청은 `open` 으로 남는다. 상태코드만
    고정하면 "409 를 주면서 요청은 닫는" 구현이 초록이다.
    """
    observed: dict[str, str] = {}
    expected: dict[str, str] = {}
    for kind in KINDS:
        for decision in DECISIONS:
            for axis in NOTE_AXES:
                key = f"{kind} × {decision} × {axis}"
                blocked = decision == "rejected" and axis in ("none", "blank")
                expected[key] = f"409 {REJECTION_CODE} / open" if blocked else f"200 / {decision}"

                rid = _provision(client, auth, project, dm_project, kind, decision, axis)
                r = _resolve(client, auth, rid, decision, axis)
                status_after = _review(client, auth, rid)["status"]
                code = (r.json().get("code") if r.headers.get("content-type", "").startswith("application/json")
                        else None)
                observed[key] = (f"{r.status_code} {code} / {status_after}" if r.status_code != 200
                                 else f"200 / {status_after}")
                # 표 비교가 먼저 보고되도록 상태코드를 확인한 뒤에만 본문을 본다 — 가드를 지운 회귀에서
                # `KeyError: 'review_kind'` 대신 45칸 표의 차이가 실패 메시지에 나오게 하기 위함이다.
                if blocked and r.status_code == 409:
                    got = r.json()
                    # 부가 필드(ADR 0012 규칙 4). 이름·모양을 바꾸는 변이가 여기서 죽는다.
                    assert got["review_kind"] == kind, got
                    assert got["review_request_ids"] == [rid], got
                    # 이 자리에서 참일 수 없는 말이 없다(§6-4 3 — 문장을 베끼지 않는다).
                    assert got["detail"], got
                    assert NOT_ALLOWED not in got["detail"].lower(), got
    assert observed == expected


def _provision(client, auth, project, dm_project, kind: str, decision: str, axis: str) -> str:
    """이 칸에 쓸 **열린** 검토요청 하나를 만든다.

    분기가 실제로 도는 칸에만 진짜 검토요청을 쓴다(머리말). 어느 칸이 분기를 돌지 않는지는 코드 인용으로
    고정한다 — `usecases.resolve_review` 의 kind 분기 조건은 전부 `decision in ("approved", "rejected")`
    이므로 `on_hold` 는 어느 분기에도 들어가지 않고, `rejected` + 빈 사유는 그 앞 프롤로그에서 끝난다.
    """
    branch_runs = decision == "approved" or (decision == "rejected" and axis == "reason")
    if kind == "inspection" and branch_runs:
        # 진짜 경로: 객체를 INSPECTION_REQUESTED 로 올려 서버가 만든 요청을 쓴다.
        # approved → CONFIRMED 전이, rejected → IN_PROGRESS 전이가 실제로 일어난다.
        return _inspection_requested_object(client, auth, project)[1]
    if kind == "document_mapping" and branch_runs:
        # 진짜 경로: `_confirm_document_mapping_row` / `reject_document_mapping` 이 실제 매핑 행을 만진다.
        # (합성 행이면 `document_mapping_target_not_found` 404 가 나므로 이 칸은 합성으로 대체 불가.)
        open_reviews = _open_document_mapping_reviews(client, auth, dm_project)
        assert open_reviews, "dm_project 에 열린 document_mapping 검토요청이 없다"
        return open_reviews[0]["review_request_id"]
    if kind == "mapping":
        # `resolve_mapping_review` 는 `conflicting_sources` 의 drawing_id/entity_handle 로만 자기 큐를 찾고
        # (`services/sync/persistence.open_mapping_reviews`), `candidate_global_id` 가 없으면 매핑을
        # 건드리지 않는다 — 그래서 이 kind 는 아홉 칸 전부 합성 행으로 진짜 분기를 지난다.
        return _synthetic_review(project, kind, conflicting_sources={
            "drawing_id": f"dr-{uuid.uuid4().hex[:8]}", "entity_handle": f"H-{uuid.uuid4().hex[:8]}"})
    return _synthetic_review(project, kind)


# =========================================================================== V5~V7: 문 B(상태 전이)

def test_second_door_rejects_inspection_without_reason_and_leaves_nothing_half_done(client, auth, project, ifc_job):
    """V5·V6 — **큐가 아닌 두 번째 문**. `POST /api/objects/{gid}/transitions` 의 `reject_inspection`
    (→IN_PROGRESS) · `flag_mismatch`(→MISMATCH)가 사유 없이 inspection 검토요청을 `rejected` 로 닫던 자리다.

    HEAD 이전 실측(ADR 0012 §2 표): 둘 다 **201**, 요청 `rejected`. 자리 A 만 고친 구현이 여기서 죽는다.

    **세 사실을 함께 단언한다**(§6-2 4): ① 409 + 자기 code ② 객체 상태가 `INSPECTION_REQUESTED` 로 남는다
    ③ 검토요청이 `open` 으로 남는다. 하나만 고정하면 나머지가 사라져도 초록이다 — 특히 ②③ 이 없으면
    "거부는 하는데 절반은 이미 적용된" 구현이 통과한다.

    `to_state` 두 축을 모두 태운다: `to_state` 로만 가른 구현(→IN_PROGRESS 만 막음)이 →MISMATCH 에서 죽는다.
    note 채널 셋(미전송 / 공백만 / `evidence.note` 공백)도 함께 — `.strip()` 을 뺀 구현이 죽는다.
    """
    for to_state, body in (("IN_PROGRESS", {"to_state": "IN_PROGRESS"}),
                           ("MISMATCH", {"to_state": "MISMATCH"}),
                           ("IN_PROGRESS", {"to_state": "IN_PROGRESS", "note": BLANK}),
                           ("MISMATCH", {"to_state": "MISMATCH",
                                         "evidence": {"source_type": "cm_action", "source_id": "ui", "note": " "}})):
        gid, rid = _inspection_requested_object(client, auth, project)
        r = _transition(client, auth, project, "cm", gid, body)

        assert r.status_code == 409, r.text
        got = r.json()
        # 핸들러를 지우면 500 이고, `code` 를 안 보면 다른 409(invalid_transition·transition_blocked_by_review)와
        # 구별되지 않는다.
        assert got["code"] == REJECTION_CODE, got
        assert got["code"] != "invalid_transition", got
        assert got["review_kind"] == "inspection", got
        assert got["review_request_ids"] == [rid], got
        assert NOT_ALLOWED not in got["detail"].lower(), got
        # 부분 적용 없음 — 객체도 요청도 그대로다.
        assert _object_state(client, auth, project, gid) == "INSPECTION_REQUESTED", (to_state, body)
        assert _review(client, auth, rid)["status"] == "open", (to_state, body)


def test_second_door_accepts_the_same_transitions_once_a_reason_is_given(client, auth, project, ifc_job):
    """음성 대조군 ①(과잉 차단 방지) — 같은 두 전이가 **사유만 붙이면** 201 이고 요청이 실제로 닫힌다.

    이것이 없으면 "이 두 전이를 아예 금지하는" 구현이 위 테스트만으로 초록이다.
    """
    for to_state in ("IN_PROGRESS", "MISMATCH"):
        gid, rid = _inspection_requested_object(client, auth, project)
        r = _transition(client, auth, project, "cm", gid, {"to_state": to_state, "note": REASON})
        assert r.status_code == 201, r.text
        assert _object_state(client, auth, project, gid) == to_state
        assert _review(client, auth, rid)["status"] == "rejected"


def test_transitions_that_close_no_review_stay_open_without_a_reason(client, auth, project, ifc_job):
    """V7 — 음성 대조군 ②. 가드 조건의 두 한정어를 **각각** 태운다.

    축 A: `accept_rework`(MISMATCH → IN_PROGRESS, cm). `from_state` 가 `INSPECTION_REQUESTED` 가 아니라
      가드에 닿지도 않는다. CM 의 상시 업무이므로 막히면 안 된다.
    축 B: `from_state == INSPECTION_REQUESTED` 인데 **미결 inspection 요청이 0건**인 경우. 큐에서
      `on_hold` 로 닫으면 그 상태가 실제로 만들어진다(`close_inspection_reviews` 주석이 지목한 자리 —
      `grep -n "이 조건이 실제로 가르는 것은" services/progress/state_machine.py`). 닫는 것이 없으면
      사유를 요구할 근거가 없다.

    **이 축이 없으면 "모든 CM 전이에 사유를 요구하는" 구현이 위 두 테스트만으로 통과한다**(§6-2 3).
    """
    # 축 A — 먼저 사유를 붙여 MISMATCH 로 내려간 뒤(그 전이가 요청을 닫는다), 사유 없이 IN_PROGRESS 로.
    gid, rid = _inspection_requested_object(client, auth, project)
    assert _transition(client, auth, project, "cm", gid, {"to_state": "MISMATCH", "note": REASON}).status_code == 201
    assert _review(client, auth, rid)["status"] == "rejected"
    r = _transition(client, auth, project, "cm", gid, {"to_state": "IN_PROGRESS"})
    assert r.status_code == 201, r.text
    assert _object_state(client, auth, project, gid) == "IN_PROGRESS"

    # 축 B — 큐에서 on_hold 로 닫아 미결 inspection 을 0 으로 만든 뒤, 사유 없이 reject_inspection.
    gid2, rid2 = _inspection_requested_object(client, auth, project)
    assert _resolve(client, auth, rid2, "on_hold", "none").status_code == 200
    assert _review(client, auth, rid2)["status"] == "on_hold"
    assert _object_state(client, auth, project, gid2) == "INSPECTION_REQUESTED"
    r2 = _transition(client, auth, project, "cm", gid2, {"to_state": "IN_PROGRESS"})
    assert r2.status_code == 201, r2.text
    assert _object_state(client, auth, project, gid2) == "IN_PROGRESS"


def test_other_transition_conflicts_keep_their_own_codes(client, auth, project, ifc_job):
    """음성 대조군 ③ — **모든 409 를 새 code 로 바꾸는 구현이 통과하면 안 된다**(ADR 0011 의 같은 축).

    - 축 A: 허용 표에 없는 전이(PLANNED → CONFIRMED) → `invalid_transition`, 그리고 그 `detail` 에는
      `not allowed` 가 **있어야 한다**(위 부재 단언이 문구 전반의 성질이 아님을 고정 — §6-2 3).
    - 축 B: 열린 검토요청이 막는 전이 → `transition_blocked_by_review`. `INSPECTION_REQUESTED` 에서
      나가는 409 를 전부 새 code 로 바꾸는 구현은 여기서 죽지 않지만, 축 A 가 그것을 잡는다.
    """
    gid = _pick_planned(client, auth, project)
    r = _transition(client, auth, project, "cm", gid, {"to_state": "CONFIRMED", "note": "너무 이름"})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "invalid_transition", r.json()
    assert NOT_ALLOWED in r.json()["detail"].lower(), r.json()

    gid2, _rid = _inspection_requested_object(client, auth, project)
    r2 = _transition(client, auth, project, "contractor", gid2, {"to_state": "REPORTED", "note": "되돌리기"})
    assert r2.status_code == 409, r2.text
    assert r2.json()["code"] in ("transition_blocked_by_review", "invalid_transition"), r2.json()
    assert r2.json()["code"] != REJECTION_CODE, r2.json()


# =========================================================================== V12: 사유가 실제로 남는가

def test_cm_reason_reaches_the_queue_note_together_with_the_machine_string(client, auth, project, ifc_job):
    """V12 — CM 이 적은 사유가 **큐 화면이 읽는 자리**(`ReviewRequest.resolution_note`)에 실제로 남는다.

    HEAD 이전 실측(ADR 0012 규칙 5 (가)): `inspection` 반려는 두 문 모두 `resolution_note` 를
    `close_inspection_reviews` 의 기계 문자열로 **덮었다** — 사유를 필수로 만든 바로 다음 화면이 그 사유
    대신 `transition_id=…` 를 보여줬다.

    **둘을 함께 단언한다**(§6-2 4): 사유가 있고, 기계 문자열도 남아 있다. 사유만 보면 전이 추적을 잃는
    구현이 초록이고, 기계 문자열만 보면 사유를 잃는 구현이 초록이다.

    **문장을 베끼지 않는다**(§6-4 3): 기계 문자열은 리터럴로 고정하지 않고 **응답이 스스로 싣는 값**
    (transition_id · from_state · to_state)이 메모 안에 있는지로 본다. 어순·구두점을 바꾸는 정당한
    개정은 여기서 죽지 않고, 값을 잃는 개정만 죽는다.

    두 문을 모두 태운다 — 문 B 만 고치면 큐 반려가, 큐만 고치면 객체 패널 반려가 낡은 값을 남긴다.
    """
    # 문 A(큐)
    gid, rid = _inspection_requested_object(client, auth, project)
    r = _resolve(client, auth, rid, "rejected", "reason")
    assert r.status_code == 200, r.text
    note_a = _review(client, auth, rid)["resolution_note"] or ""
    assert REASON in note_a, note_a

    # 문 B(객체 패널)
    gid2, rid2 = _inspection_requested_object(client, auth, project)
    t = _transition(client, auth, project, "cm", gid2, {"to_state": "MISMATCH", "note": REASON})
    assert t.status_code == 201, t.text
    transition = t.json()
    note_b = _review(client, auth, rid2)["resolution_note"] or ""
    assert REASON in note_b, note_b
    for value in (transition["transition_id"], transition["from_state"], transition["to_state"]):
        assert value in note_b, (value, note_b)

    # 음성 대조군: 사유를 요구하지 않는 승인 경로에서는 기계 문자열만 남는다 — 접두사가 무조건 붙는
    # (그래서 사유가 없어도 있는 척하는) 구현이 여기서 죽는다.
    gid3, rid3 = _inspection_requested_object(client, auth, project)
    t3 = _transition(client, auth, project, "cm", gid3, {"to_state": "CONFIRMED"})
    assert t3.status_code == 201, t3.text
    note_c = _review(client, auth, rid3)["resolution_note"] or ""
    assert t3.json()["transition_id"] in note_c, note_c
    assert not note_c.startswith("|") and " | " not in note_c, note_c


# =========================================================================== V11: 하위 타입 아님

def test_error_is_not_a_subtype_of_invalid_transition(client, auth, project, ifc_job):
    """V11 — `ReviewRejectionReasonRequiredError` 는 `InvalidTransitionError` 의 하위 타입이 **아니다**.

    **이 변이는 HTTP 로 관측되지 않는다 — 그래서 구조 단언이 필요하다.** 하위 타입으로 바꿔도
    `errors.py` 의 **전용 핸들러가 정확히 일치하는 타입으로 먼저 이기므로** 응답은 그대로 409
    `rejection_reason_required` 다. 문 B 의 `transition_object` 도 `except InvalidTransitionError` 와
    `except ReviewRejectionReasonRequiredError` 가 둘 다 `rollback` + `raise` 라 결과가 같다.
    위험은 **다른 자리**에 있다: `usecases.resolve_review` 의 inspection 분기가 `except
    InvalidTransitionError` 를 `decision == "rejected"` 일 때 `log.info` 로 흘려보낸다. 지금은 자리 A 의
    프롤로그가 사유 없는 반려를 먼저 막아 그 조합이 도달하지 않지만, 하위 타입이 되는 순간 그 침묵은
    **자리 A 가 사라지거나 우회되는 날** 이 불변식을 통째로 삼킨다(ADR 0011 규칙 1-a 표 3행 + ADR 0012
    규칙 6 의 조건 ③). 그래서 아래 두 단언을 **함께** 둔다:

      ① 구조: 상속하지 않는다.
      ② 그 `log.info` 분기가 **살아 있는 경로**라는 것 — 아래에서 `decision == "rejected"` 로 실제로 태운다.

    ②가 없으면 ①은 "언젠가 쓸모없어질지도 모르는" 단언이고, ①이 없으면 ②는 아무것도 막지 못한다.
    """
    from packages.core.models.review import ReviewRejectionReasonRequiredError
    from packages.core.models.state import InvalidTransitionError

    # ① 구조
    assert not issubclass(ReviewRejectionReasonRequiredError, InvalidTransitionError)
    assert ReviewRejectionReasonRequiredError.__bases__ == (Exception,), ReviewRejectionReasonRequiredError.__bases__

    # ② 그 침묵 분기를 실제로 태운다 — `global_id` 가 PLANNED 인 inspection 요청을 큐에서 **반려**하면
    #    상태기계가 (PLANNED, IN_PROGRESS, cm) 를 거부하고(허용 actor 는 SYSTEM 뿐 —
    #    `packages/core/models/state.py` ALLOWED_TRANSITIONS), `except InvalidTransitionError` 가
    #    `decision == "rejected"` 이므로 `log.info` 로 흘려보낸 뒤 공통 폴백이 요청을 닫는다.
    gid = _pick_planned(client, auth, project)
    rid = _synthetic_review(project, "inspection", global_id=gid)
    r = _resolve(client, auth, rid, "rejected", "reason")
    assert r.status_code == 200, r.text
    assert _review(client, auth, rid)["status"] == "rejected"
    # 전이는 일어나지 않았다(= InvalidTransitionError 가 실제로 났고 삼켜졌다).
    assert _object_state(client, auth, project, gid) == "PLANNED"
    # 그리고 사유는 폴백이 그대로 기록한다(기계 문자열이 아니다 — close_inspection_reviews 가 돌지 않았다).
    assert _review(client, auth, rid)["resolution_note"] == REASON


# =========================================================================== 순서 계약

def test_already_resolved_wins_over_missing_reason(client, auth, project, ifc_job):
    """ADR 0012 규칙 1 — 가드는 `review_already_resolved` 검사 **뒤**에 있다.

    낡은 요청과 빠진 사유는 CM 이 할 일이 다르다(목록 새로고침 ↔ 사유 작성). 순서를 뒤집으면
    `tests/integration/test_08_review_requests.py:127-129` 가 고정한 code 가 바뀐다 — 그 파일은
    **승인된** 요청에 대해서만 그 조합을 태우므로, 여기서는 **반려된** 요청으로도 같은 순서를 고정한다.
    """
    gid, rid = _inspection_requested_object(client, auth, project)
    assert _resolve(client, auth, rid, "rejected", "reason").status_code == 200

    r = _resolve(client, auth, rid, "rejected", "none")
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "review_already_resolved", r.json()
    assert r.json()["code"] != REJECTION_CODE, r.json()
