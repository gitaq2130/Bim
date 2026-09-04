"""ADR 0011 — CONFIRMED 이탈에는 사유(`evidence.note`)가 필요하고, 그 거부는 **자기 code** 로 나간다.

이 파일이 붙들고 있는 것은 두 가지다.

1. **불변식**(`packages/core/models/state.py::StateTransition._check`) — 사유 없는 `revoke_confirmation` /
   `order_rework` 가 201 로 통과하지 않는다. 계획 0004 §반증 목록 2 가 실측한 대로, 이 불변식이 들어가기
   전 pytest 733 건 중 이 경로를 태우는 것이 **0건**이었다(`git grep "revoke_confirmation\\|order_rework"
   -- tests/` → 0). 즉 불변식은 넣자마자 무보호였고, 아래 V8·V9 가 그 자리를 메운다.
2. **오류 code 분기**(`services/api/errors.py::_revocation_reason_required`) — 이 거부가
   `invalid_transition` 이 **아니라** `revocation_reason_required` 로 나간다. 그 code 의 화면 문구가
   "화면을 새로고침해 최신 상태를 확인하세요"인데 이 경우엔 거짓이기 때문이다(CLAUDE.md §6-4 규칙 1).
   `RevocationReasonRequiredError` 는 `InvalidTransitionError` **하위 타입**이라 전용 핸들러를 지우면
   상위 핸들러가 MRO 로 조용히 받아 **여전히 409** 를 돌려준다 — 상태코드만 보는 단언은 그 회귀를
   잡지 못한다. 그래서 아래 단언은 전부 `code` 를 본다.

**음성 대조군이 왜 이 파일의 절반인가**(CLAUDE.md §6-2). "409 면 통과"도, "CONFIRMED 에서 나가는 409 면
새 code"도 아니다 — 모든 409 를 새 code 로 바꾸는 구현이 통과하면 안 되고, `from_state == CONFIRMED` 인
409 를 전부 새 code 로 바꾸는 구현도 통과하면 안 된다. `test_other_conflicts_keep_invalid_transition_code`
가 그 두 축을 각각 막는다.
"""
from __future__ import annotations

REASON = "재시공 필요 — 3층 보 배근 간격 상이"


def _pick_planned(client, auth, project) -> str:
    """아직 아무도 쓰지 않은 PLANNED 객체 하나. 세션 범위 픽스처를 여러 테스트가 공유하므로
    `state=PLANNED` 필터가 곧 '이 테스트가 독점할 수 있다'는 뜻이다(전이를 걸면 목록에서 빠진다)."""
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object available"
    return items[0]["global_id"]


def _transition(client, auth, project, role, gid, body):
    """`?project_id=` 를 반드시 준다 — 전체 스위트에서는 같은 IFC 픽스처가 여러 프로젝트에 올라가 있어
    `global_id` 단독 조회가 `ambiguous_global_id`(409, ADR 0005 §3)로 먼저 걸린다. 그 409 를 이 파일의
    409 단언이 삼키면 테스트가 아무것도 검증하지 않게 된다(실측: 파일 단독 실행은 통과, 전량 실행은 실패)."""
    return client.post(f"/api/objects/{gid}/transitions", headers=auth(role),
                       params={"project_id": project}, json=body)


def _detail(client, auth, project, gid) -> dict:
    return client.get(f"/api/objects/{gid}", headers=auth("cm"), params={"project_id": project}).json()


def _confirmed_object(client, auth, project) -> str:
    """PLANNED → REPORTED → INSPECTION_REQUESTED → CONFIRMED(cm). 되돌리기의 출발점을 만든다."""
    gid = _pick_planned(client, auth, project)
    for role, body in (("contractor", {"to_state": "REPORTED", "note": "착수"}),
                       ("contractor", {"to_state": "INSPECTION_REQUESTED", "note": "검측 요청"}),
                       ("cm", {"to_state": "CONFIRMED", "note": "검측 완료"})):
        r = _transition(client, auth, project, role, gid, body)
        assert r.status_code == 201, r.text
    return gid


def _state_and_history_len(client, auth, project, gid) -> tuple[str, int]:
    d = _detail(client, auth, project, gid)
    return d["current_state"]["state"], len(d["history"])


# --------------------------------------------------------------------------- V8·V9: 사유 없는 이탈은 거부

def test_leaving_confirmed_without_reason_is_rejected_with_its_own_code(client, auth, project, ifc_job):
    """계획 0004 V8·V9. 사유가 없는 두 되돌리기 경로(`revoke_confirmation`=→MISMATCH,
    `order_rework`=→IN_PROGRESS)가 거부되고, code 가 `invalid_transition` 이 **아니다**."""
    gid = _confirmed_object(client, auth, project)
    before = _state_and_history_len(client, auth, project, gid)

    # note 채널을 셋 다 태운다: 아예 없음 / 빈 문자열 / 공백만(모델 불변식의 `.strip()`)
    for to_state, body in (("MISMATCH", {"to_state": "MISMATCH"}),
                           ("IN_PROGRESS", {"to_state": "IN_PROGRESS", "note": ""}),
                           ("MISMATCH", {"to_state": "MISMATCH", "note": "   "}),
                           ("IN_PROGRESS", {"to_state": "IN_PROGRESS",
                                            "evidence": {"source_type": "cm_action", "source_id": "ui", "note": " "}})):
        r = _transition(client, auth, project, "cm", gid, body)
        assert r.status_code == 409, r.text
        got = r.json()
        # 이 단언이 이 파일의 전부다. 전용 핸들러를 지워도 상위 핸들러가 409 를 돌려주므로
        # 상태코드만 보면 회귀가 통과한다.
        assert got["code"] == "revocation_reason_required", got
        assert got["code"] != "invalid_transition", got
        # glossary 부칙 "응답 모양 일관성": 전이 거부 응답은 어느 경로로든 세 필드를 싣는다.
        assert got["from_state"] == "CONFIRMED" and got["to_state"] == to_state and got["actor"] == "cm"
        assert got["detail"]

    # 롤백: 거부된 전이는 상태도 이력도 남기지 않는다(전이는 기록됐는데 이유만 사라지는 것이 ADR 0011 이
    # 막으려는 실패 모드이므로, 그 반대편 — 거부인데 절반 기록되는 것 — 도 함께 막는다).
    assert _state_and_history_len(client, auth, project, gid) == before


def test_reason_is_accepted_and_actually_persisted(client, auth, project, ifc_job):
    """사유가 있으면 201 이고, 그 사유가 **감사 이력에 실제로 남는다**. 201 만 보면
    `evidence.note` 를 버리는 구현도 통과한다."""
    gid = _confirmed_object(client, auth, project)
    r = _transition(client, auth, project, "cm", gid,
                    {"to_state": "MISMATCH",
                     "evidence": {"source_type": "cm_action", "source_id": "ui", "note": REASON}})
    assert r.status_code == 201, r.text
    assert r.json()["evidence"]["note"] == REASON

    d = _detail(client, auth, project, gid)
    assert d["current_state"]["state"] == "MISMATCH"
    latest = d["history"][0]        # 최신순
    assert latest["from_state"] == "CONFIRMED" and latest["to_state"] == "MISMATCH"
    assert latest["evidence"]["note"] == REASON


def test_top_level_note_channel_alone_satisfies_the_invariant(client, auth, project, ifc_job):
    """요청 최상위 `note` 만 보내도 통과한다 — `usecases._evidence_from_request` 가 그것을
    `evidence.note` 로 합류시키기 때문이다(ADR 0011 역방향 확인 표 4행). 화면은 `evidence.note` 로
    보내지만 API 계약에는 두 채널이 다 있고, 둘 중 하나만 막히면 CM 이 이유 없이 거부당한다."""
    gid = _confirmed_object(client, auth, project)
    r = _transition(client, auth, project, "cm", gid, {"to_state": "IN_PROGRESS", "note": REASON})
    assert r.status_code == 201, r.text
    assert REASON in (r.json()["evidence"]["note"] or "")

    d = _detail(client, auth, project, gid)
    assert d["current_state"]["state"] == "IN_PROGRESS"
    assert REASON in (d["history"][0]["evidence"]["note"] or "")


# --------------------------------------------------------------------------- 음성 대조군 (§6-2 3)

def test_other_conflicts_keep_invalid_transition_code(client, auth, project, ifc_job):
    """**모든 409 를 새 code 로 바꾸는 구현이 통과하면 안 된다.** 두 축을 각각 막는다.

    - 축 A: `from_state != CONFIRMED` 인 전이 거부(PLANNED→CONFIRMED 직행).
    - 축 B: `from_state == CONFIRMED` 이지만 **원인이 사유 부재가 아닌** 거부(허용 표에 없는 목적지).
      사유를 붙여도 붙이지 않아도 `invalid_transition` 이어야 한다 — 사유 없이도 그러해야 한다는 것이
      중요하다. 모델 검증자가 `validate_transition` 을 먼저 부르므로 "CONFIRMED 에서 나가는데 note 가
      없다"만 보고 code 를 고르는 구현은 여기서 죽는다.
    """
    # 축 A
    gid = _pick_planned(client, auth, project)
    r = _transition(client, auth, project, "cm", gid, {"to_state": "CONFIRMED", "note": "너무 이름"})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "invalid_transition", r.json()

    # 축 B
    gid = _confirmed_object(client, auth, project)
    for body in ({"to_state": "ESTIMATED_DONE"},
                 {"to_state": "ESTIMATED_DONE", "note": REASON}):
        r = _transition(client, auth, project, "cm", gid, body)
        assert r.status_code == 409, r.text
        assert r.json()["code"] == "invalid_transition", r.json()
    assert _state_and_history_len(client, auth, project, gid)[0] == "CONFIRMED"
