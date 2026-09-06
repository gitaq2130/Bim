"""ADR 0013 — 매핑 결정(확정·반려)의 취소. 계획 0006 §검증 시나리오 V1~V9.

## 이 파일이 붙들고 있는 것

ADR 0013 §"이 불변식을 지금 무엇이 붙들어 주는가"가 스스로 적었다: 취소 경로는 **넣자마자 무보호**다.
아래는 이 사이클에서 서버 쪽 변이를 하나씩 개별로 적용해 재현한 무보호 목록과, 이 파일의 어느 단언이
그것을 잡는지다(각 변이는 원복 전 `git status --porcelain` 전문으로 확인했다).

| 변이 | 잡는 자리 |
|---|---|
| `reviewed_by` 를 남긴 **반쪽 취소**(모델을 우회해 행에 직접 쓴다) | `test_v1_...` 의 DB 행 단언 + `drawing_approval != 1.0` + `confirmed_required_documents` 부재. 그리고 그 반쪽 상태가 **모델로는 표현조차 되지 않는다**는 구조적 성질은 `tests/unit/progress/test_document_mapper_invariants.py::test_model_cannot_express_half_cancelled_mapping` |
| 반려 표시 4키를 안 지운다 | `test_v2_...` 의 `_REJECTION_MARKER_KEYS` 부재 단언(readiness 네 칸은 이 변이에서 **완전히 같다** — ADR 0013 §Context 3 표 3행 vs 4행. 값으로 세운 단언은 이 변이를 못 잡는다) |
| 취소가능 검사(`reviewed_by is None` → 409) 삭제 | `test_v7_...`(무동작 200 이 되면 죽는다) |
| 사유 검사 삭제 | `test_v5_...` |
| 옛 요청 행을 되열어 재사용(`_reopen_reviews_for_invalidated_confirmations` 모양) | `test_v1_...`·`test_v2_...` 의 **옛 행 감사** 단언(`resolved_by`·`resolved_at`·`resolution_note` 가 살아 있다). "open 요청 1건"만 보면 통과하므로 둘을 함께 단언한다(CLAUDE.md §6-2 4) |
| 새 요청을 안 연다 | 같은 두 테스트의 open 요청 단언 + 같은 자리에서 readiness blocker `document_mapping_pending` 를 함께 본다(큐가 비었는데 readiness 는 "대기"라고 말하는 것이 이 저장소의 지배적 실패 모드다) |
| `errors.py` 의 전용 핸들러 둘 삭제 | 409 응답의 `code` 단언(예외가 `Exception` 직속이라 핸들러가 없으면 **500 + code 없음**) |
| 취소 이력 append → 덮어쓰기 | `test_v9_...`(2회 취소 후 길이 2) |
| 검사 순서 맞바꿈(사유 검사를 앞으로) | `test_v7_...` 의 **두 요건 동시 위반** 칸(취소할 결정이 없는 CM 에게 "적을 수 없는 사유"를 요구하면 죽는다) |

**반려 방향을 값(`drawing_approval`·`score`)으로 단언하지 않는다.** 실측상 반려 전후가 0.5/0.625 로
같아서 결함 코드와 정상 코드가 구별되지 않는다(ADR 0013 §Context 3 (2)). 그 방향에서 갈리는 관측값은
`blockers[]`(kind·reason·존재)와 `evidence.note` 둘뿐이다.

## 배역 (test_15 와 같은 픽스처 조합·같은 상수)

`schedule.csv`(Activity 6개) × `document_register.xlsx`(TFA 8·TFR 2) = 매핑 정확히 6건. 값 축이 움직이는
배역을 일부러 고른다 — `A100` 에 매핑되는 문서는 처리결과 `APPROVED` 인 TFA 라 확정하면
`drawing_approval` 이 1.0 이 되고, 취소하면 다시 내려온다(그렇지 않은 배역이면 결함이 있어도 값이 같다).

| Activity | 무엇에 쓰는가 |
|---|---|
| `A100` | 확정 → 취소(V1·V3·V4) — 값 축이 움직이는 방향 |
| `A400` | 반려 → 취소(V2) — 값 축이 **안** 움직이는 방향 |
| `A300` | 사유 요건(V5) → 무제한 취소(V9) |
| `A200` | 취소할 결정이 없는 대조군(V7) · 인가(V6) · 404 |
| `A110` | 재확인으로 **이미 열린 요청**이 있는 상태의 취소(중복 방지) — 이 파일 마지막 |

**테스트 순서가 계약의 일부다**(test_15 와 같은 모양): 같은 프로젝트를 순서대로 공유하고, 대장·공정표
재업로드처럼 프로젝트 전체를 재계산하는 시나리오는 **맨 뒤**에 둔다. 재계산은 미확정(=취소된) 매핑의
`evidence` 를 새 후보로 덮어쓰므로 그 앞에서 잰 이력 단언이 무의미해진다(§V8 참고 — 그 사실 자체를
V8 이 관측값으로 적는다).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.db import session_scope
from packages.core.models.orm import ActivityDocumentMappingRow
from services.progress.config_loader import load_readiness_config
from services.progress.document_mapper import confirmed_required_documents

from .conftest import FIXTURES, add_member, upload

A_CONFIRM = "A100"     # 확정 → 취소
A_REJECT = "A400"      # 반려 → 취소
A_REASON = "A300"      # 사유 요건 → 무제한 취소
A_PENDING = "A200"     # 취소할 결정이 없는 대조군
A_REOPENED = "A110"    # 재확인 요청이 열린 채인 확정의 취소
EXPECTED_MAPPING_COUNT = 6

# 취소가 지워야 하는 반려 표시(`services/progress/document_mapper._REJECTION_MARKER_KEYS` 와 같은 넷).
# 여기 다시 적는 이유는 **테스트가 구현 상수를 import 하면 그 상수가 비어도 초록**이기 때문이다.
REJECTION_MARKER_KEYS = ("mapping_review_decision", "rejected_by", "rejected_at", "rejection_note")
CANCELLED_REVIEWS_KEY = "cancelled_mapping_reviews"

BLANK = "   "          # 공백만. 화면은 `ConfirmDialog` 의 `!note.trim()` 로 잠그지만 API 직접 호출에는 없다.


@pytest.fixture(scope="module")
def cancel_project(client, auth, user_ids) -> str:
    """정상 순서(공정표 → 대장)로 올려 6건의 매핑 + 6건의 열린 `document_mapping` 요청을 만든다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "매핑 결정 취소 테스트"})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    up1, job1 = upload(client, auth("contractor"), project_id, FIXTURES / "schedule.csv")
    assert up1["kind"] == "csv" and job1["status"] == "done", job1
    up2, job2 = upload(client, auth("cm"), project_id, FIXTURES / "document_register.xlsx")
    assert up2["kind"] == "xlsx" and job2["status"] == "done", job2
    assert job2["result"]["mapping_count"] == EXPECTED_MAPPING_COUNT, job2
    return project_id


# --------------------------------------------------------------------------- 읽기 헬퍼

def _reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    """그 Activity 의 `document_mapping` 요청 전부(상태 무관)."""
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping"})
    assert r.status_code == 200, r.text
    return [x for x in r.json() if x["activity_id"] == activity_id]


def _open_reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    return [r for r in _reviews(client, auth, project_id, activity_id) if r["status"] == "open"]


def _closed_reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    return [r for r in _reviews(client, auth, project_id, activity_id) if r["status"] != "open"]


def _doc_id_for(client, auth, project_id: str, activity_id: str) -> str:
    reviews = _reviews(client, auth, project_id, activity_id)
    doc_ids = {r["conflicting_sources"]["doc_id"] for r in reviews}
    assert len(doc_ids) == 1, f"expected one doc_id for {activity_id!r}, got {doc_ids}"
    return doc_ids.pop()


def _mapping(client, auth, project_id: str, doc_id: str, activity_id: str) -> dict:
    r = client.get(f"/api/documents/{doc_id}", headers=auth("cm"), params={"project_id": project_id})
    assert r.status_code == 200, r.text
    matches = [m for m in r.json()["mappings"] if m["activity_id"] == activity_id]
    assert len(matches) == 1, f"expected exactly one mapping ({activity_id}, {doc_id}), got {matches}"
    return matches[0]


def _readiness(client, auth, project_id: str, activity_id: str) -> dict:
    r = client.get(f"/api/activities/{activity_id}/readiness", headers=auth("cm"),
                   params={"project_id": project_id})
    assert r.status_code == 200, r.text
    return r.json()


def _drawing_blockers(score: dict) -> list[tuple[str | None, str | None]]:
    """`drawing_approval` blocker 의 `(kind, reason)` 전부. **잘라 적지 않는다** — 이 배역에는
    `kind: None` 인 blocker 가 섞여 있어(ADR 0013 §Context 3) kind 만 보면 1행(반려)과 2행(반쪽 취소)이
    갈리지 않는다."""
    return [(b.get("kind"), b.get("reason")) for b in score["blockers"] if b["component"] == "drawing_approval"]


def _row_fields(project_id: str, activity_id: str, doc_id: str) -> tuple[bool, str | None]:
    """저장된 행을 **직접** 읽는다(API 응답이 아니라). 반쪽 취소 변이는 모델을 우회해 행에 쓰므로
    응답 모양만 보는 단언으로는 잡히지 않을 수 있다."""
    with session_scope() as session:
        row = session.get(ActivityDocumentMappingRow, (project_id, activity_id, doc_id))
        assert row is not None
        return bool(row.needs_review), row.reviewed_by


def _confirmed_doc_ids(project_id: str, activity_id: str) -> list[str]:
    """readiness 의 `drawing_approval` 순위 1 이 실제로 세는 확정 문서 집합(ADR 0013 V3)."""
    doc_cfg = load_readiness_config().get("document_approval", {})
    with session_scope() as session:
        evidence = confirmed_required_documents(session, project_id, [activity_id], doc_cfg)
        return [d.doc_id for d in evidence.confirmed_required]


def _cancel(client, auth, project_id: str, activity_id: str, doc_id: str, *, role: str = "cm",
            note: str | None = "취소 사유"):
    body = None if note is None else {"note": note}
    return client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/cancel-review",
                       headers=auth(role), params={"project_id": project_id}, json=body)


def _confirm(client, auth, project_id: str, activity_id: str, doc_id: str, note: str):
    r = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm", headers=auth("cm"),
                    params={"project_id": project_id}, json={"note": note})
    assert r.status_code == 200, r.text
    return r.json()


def _history(mapping: dict) -> list[dict]:
    return list(mapping["evidence"]["extra"].get(CANCELLED_REVIEWS_KEY) or [])


# ═══════════════════════════════════════════════════════════════════════════
# V1 · V3 · V4 — 확정 → 취소 (값 축이 움직이는 방향)
# ═══════════════════════════════════════════════════════════════════════════
def test_v1_cancelling_a_confirmation_returns_the_pair_to_pending_and_reopens_the_queue(
        client, auth, cancel_project, user_ids):
    """확정을 취소하면 ① 매핑이 미확정으로 착지하고 ② 도면 승인 근거에서 빠지고 ③ 큐에 새 요청이
    **그 자리에서** 열리며 ④ 옛 요청 행의 감사가 그대로 남는다.

    §6-2 물음("이 기대값을 결함 있는 코드가 그대로 만족하는가?")에 대한 답:
    - 매핑 행을 건드리지 않고 요청만 여는 구현 → `drawing_approval` 이 1.0 그대로라 죽는다.
    - 표시만 지우고 `reviewed_by` 를 남기는 반쪽 구현 → 같은 이유로 1.0 이라 죽는다(§Context 3 표 2행).
    - 옛 행을 되열어 재사용하는 구현 → 옛 행 감사 단언에서 죽는다. **"open 1건"만 보면 통과하므로**
      둘을 함께 단언한다.
    - 재계산을 기다리는 구현 → 이 테스트는 재계산을 **부르지 않는다**.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    confirm_note = "대장 확인 결과 이 문서가 맞다"
    _confirm(client, auth, pid, A_CONFIRM, doc_id, confirm_note)

    # 확정 상태의 기준값 — 취소가 실제로 무엇을 되돌리는지가 여기서 정해진다.
    before = _readiness(client, auth, pid, A_CONFIRM)
    assert before["components"]["drawing_approval"] == 1.0
    assert _drawing_blockers(before) == []
    assert "approved=1/1; pending_mappings=0" in before["evidence"]["note"]
    assert _confirmed_doc_ids(pid, A_CONFIRM) == [doc_id]
    old_review = _reviews(client, auth, pid, A_CONFIRM)
    assert [r["status"] for r in old_review] == ["approved"], old_review

    note = "다른 문서와 혼동해 확정했다 — 되돌린다"
    r = _cancel(client, auth, pid, A_CONFIRM, doc_id, note=note)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["needs_review"] is True and body["reviewed_by"] is None

    # ① 착지점: 응답만이 아니라 저장된 행도 미확정이다(모델을 우회한 반쪽 착지를 잡는 자리).
    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)
    served = _mapping(client, auth, pid, doc_id, A_CONFIRM)
    assert served["needs_review"] is True and served["reviewed_by"] is None

    # ② 확정 증거에서 빠졌다 — 세 가지를 **함께** 단언한다(V3).
    after = _readiness(client, auth, pid, A_CONFIRM)
    assert after["components"]["drawing_approval"] != 1.0
    assert after["components"]["drawing_approval"] == \
        load_readiness_config()["component_defaults"]["drawing_approval_unknown"]
    assert doc_id not in _confirmed_doc_ids(pid, A_CONFIRM)
    assert "approved=0/0; pending_mappings=1" in after["evidence"]["note"]
    assert _drawing_blockers(after) == [("document_mapping_pending",
                                         "문서 매핑 1건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음")]

    # ③ 큐: 재계산을 부르지 않았는데 열린 요청이 정확히 1건이고, ④ 옛 행은 감사가 살아 있다.
    open_rows = _open_reviews(client, auth, pid, A_CONFIRM)
    closed_rows = _closed_reviews(client, auth, pid, A_CONFIRM)
    assert len(open_rows) == 1, open_rows
    assert [c["status"] for c in closed_rows] == ["approved"], closed_rows
    assert closed_rows[0]["review_request_id"] == old_review[0]["review_request_id"]
    assert closed_rows[0]["resolved_by"] == user_ids["cm"]
    assert closed_rows[0]["resolved_at"]
    assert confirm_note in (closed_rows[0]["resolution_note"] or "")

    # 새 요청은 "어느 결정을 왜 취소했는가"를 싣는다(ADR 0013 규칙 2).
    sources = open_rows[0]["conflicting_sources"]
    assert sources["doc_id"] == doc_id
    assert sources["cancelled_review_request_id"] == closed_rows[0]["review_request_id"]
    assert sources["cancel_note"] == note

    # 이력 한 항목. 확정 방향에는 반려 쪽 값이 **없으므로 키 자체가 없다**(모르는 값을 흔한 값으로
    # 떨어뜨리는 폴백을 두지 않는다 — CLAUDE.md §6-4 2).
    history = _history(served)
    assert len(history) == 1, history
    entry = history[0]
    assert entry["previous_decision"] == "confirmed"
    assert entry["previous_reviewed_by"] == user_ids["cm"]
    assert entry["cancelled_by"] == user_ids["cm"] and entry["cancel_note"] == note and entry["cancelled_at"]
    assert "previous_rejected_at" not in entry and "previous_rejection_note" not in entry


# ═══════════════════════════════════════════════════════════════════════════
# V2 — 반려 → 취소 (값 축이 **안** 움직이는 방향)
# ═══════════════════════════════════════════════════════════════════════════
def test_v2_cancelling_a_rejection_clears_the_rejection_marks_and_reopens_the_queue(
        client, auth, cancel_project, user_ids):
    """반려 취소는 `drawing_approval`·`score` 를 움직이지 않는다(실측 0.5→0.5, 0.625→0.625) — 그래서
    값으로 단언하지 않는다. 갈리는 것은 `blockers[]` 와 `evidence.note`, 그리고 매핑의 반려 표시다.

    §6-2 물음: 반려 표시 4키를 안 지우는 구현은 readiness 네 칸이 **완전히 같아** 값·blocker 로는
    구별되지 않는다(ADR 0013 §Context 3 표 3행 vs 4행). 그래서 그 네 키의 **부재**를 직접 단언한다 —
    남으면 한 카드가 "검토 대기" 배지와 옛 반려자·반려 사유를 함께 낸다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REJECT)
    review = _reviews(client, auth, pid, A_REJECT)
    assert [r["status"] for r in review] == ["open"], review
    reject_note = "다른 공종 문서로 확인됨 — 이 Activity 와 무관"
    rr = client.post(f"/api/review-requests/{review[0]['review_request_id']}/resolve", headers=auth("cm"),
                     json={"decision": "rejected", "note": reject_note})
    assert rr.status_code == 200, rr.text

    rejected = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert rejected["evidence"]["extra"]["mapping_review_decision"] == "rejected"
    rejected_at = rejected["evidence"]["extra"]["rejected_at"]
    before = _readiness(client, auth, pid, A_REJECT)
    # 반려 상태의 관측값 — `drawing_approval` blocker 는 있지만 kind 가 없다(`document_mapping_pending`
    # 이 아니다). 취소 뒤 이 칸이 갈린다.
    assert _drawing_blockers(before) == [(None, "drawing approval unknown")]
    assert "drawing_approval: resources.drawing_approved absent" in before["evidence"]["note"]

    note = "잘못 반려했다 — 다시 검토한다"
    r = _cancel(client, auth, pid, A_REJECT, doc_id, note=note)
    assert r.status_code == 200, r.text

    served = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert served["needs_review"] is True and served["reviewed_by"] is None
    assert _row_fields(pid, A_REJECT, doc_id) == (True, None)
    extra = served["evidence"]["extra"]
    for key in REJECTION_MARKER_KEYS:
        assert key not in extra, (key, extra)
    # 취소 뒤 그 매핑은 반려로도 확정으로도 읽히지 않는다 — 화면 판정(`mappingReviewState`)이 보는 값.
    assert doc_id not in _confirmed_doc_ids(pid, A_REJECT)

    after = _readiness(client, auth, pid, A_REJECT)
    assert _drawing_blockers(after) == [("document_mapping_pending",
                                         "문서 매핑 1건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음")]
    assert "approved=0/0; pending_mappings=1" in after["evidence"]["note"]

    open_rows = _open_reviews(client, auth, pid, A_REJECT)
    closed_rows = _closed_reviews(client, auth, pid, A_REJECT)
    assert len(open_rows) == 1, open_rows
    assert [c["status"] for c in closed_rows] == ["rejected"], closed_rows
    assert closed_rows[0]["resolved_by"] == user_ids["cm"]
    assert reject_note in (closed_rows[0]["resolution_note"] or "")
    assert open_rows[0]["conflicting_sources"]["cancelled_review_request_id"] == closed_rows[0]["review_request_id"]

    # 지운 반려 표시는 사라지지 않고 이력으로 옮겨진다(규칙 3) — 반려 방향에서만 있는 두 값이 실린다.
    history = _history(served)
    assert len(history) == 1, history
    entry = history[0]
    assert entry["previous_decision"] == "rejected"
    assert entry["previous_reviewed_by"] == user_ids["cm"]
    assert entry["previous_rejected_at"] == rejected_at
    assert entry["previous_rejection_note"] == reject_note
    assert entry["cancel_note"] == note


def test_confirming_after_cancelling_a_rejection_works(client, auth, cancel_project, user_ids):
    """반려 취소 뒤에는 확정이 **가능해야 한다** — 그것이 `document_mapping_already_rejected`(409)의 뜻이
    "영원히 불가"에서 **"먼저 취소하라"** 로 좁아졌다는 말의 관측 가능한 얼굴이다(ADR 0013 규칙 8).

    방어를 넣고 기능을 죽이는 것도 이 저장소가 반복한 실패라 대조군을 둔다: 취소가 반려 표시 4키를
    지우지 못하면 `_reject_confirm_of_rejected_mapping` 이 여기서 409 를 내고, 화면 문구("반려를 먼저
    취소해 … 확정하세요")가 그 순간 거짓이 된다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REJECT)      # 앞 테스트가 반려 → 취소해 둔 쌍
    assert _mapping(client, auth, pid, doc_id, A_REJECT)["needs_review"] is True

    _confirm(client, auth, pid, A_REJECT, doc_id, "취소 뒤 재확정")
    served = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert served["needs_review"] is False and served["reviewed_by"] == user_ids["cm"]
    # 확정은 취소 이력을 지우지 않는다(감사 보존) — 확정 경로가 evidence 를 통째로 갈아치우면 죽는다.
    assert [h["previous_decision"] for h in _history(served)] == ["rejected"]
    assert _confirmed_doc_ids(pid, A_REJECT) == [doc_id]
    assert _readiness(client, auth, pid, A_REJECT)["components"]["drawing_approval"] == 1.0

    # 그리고 그 확정은 취소가 연 요청을 닫는다 — 큐에 열린 채로 남지 않는다.
    assert _open_reviews(client, auth, pid, A_REJECT) == []
    # (목록 순서는 계약이 아니므로 정렬해 비교한다.) 옛 반려 행은 그대로 남고 취소가 연 요청만 닫힌다.
    assert sorted(c["status"] for c in _closed_reviews(client, auth, pid, A_REJECT)) == ["approved", "rejected"]


# ═══════════════════════════════════════════════════════════════════════════
# V5 — 사유 요건
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("note", [None, "", BLANK], ids=["missing", "empty", "blank"])
def test_v5_cancelling_without_a_reason_is_refused_and_changes_nothing(client, auth, cancel_project,
                                                                      user_ids, note):
    """사유가 없으면 409 `cancel_reason_required` 이고 **아무것도 바뀌지 않는다**.

    §6-2 물음: 부분 적용 후 예외를 던지는 구현은 상태코드만 보는 단언을 통과한다 — 그래서 매핑 행·
    요청 상태·이력을 전후로 비교한다. `code` 를 보는 이유는 전용 핸들러가 이 불변식의 일부이기
    때문이다(예외가 `Exception` 직속이라 핸들러가 없으면 500 + `code` 없음).
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REASON)
    if _mapping(client, auth, pid, doc_id, A_REASON)["reviewed_by"] is None:
        _confirm(client, auth, pid, A_REASON, doc_id, "확정")   # 첫 파라미터 칸에서만 실제로 확정한다
    before_mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    before_rows = [(x["review_request_id"], x["status"], x["resolved_by"]) for x in _reviews(client, auth, pid, A_REASON)]

    r = _cancel(client, auth, pid, A_REASON, doc_id, note=note)
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["code"] == "cancel_reason_required", body
    # 부가 필드를 싣지 않는다(ADR 0013 규칙 6 부칙). 어느 쌍인지는 `detail` 문장에 있다 — 그것이
    # 부가 필드를 싣지 않아도 되는 근거이므로 함께 단언한다.
    assert set(body) == {"detail", "code"}, body
    assert A_REASON in body["detail"] and doc_id in body["detail"]

    after_mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    assert after_mapping["reviewed_by"] == before_mapping["reviewed_by"] == user_ids["cm"]
    assert after_mapping["needs_review"] is False
    assert _history(after_mapping) == _history(before_mapping)
    assert [(x["review_request_id"], x["status"], x["resolved_by"])
            for x in _reviews(client, auth, pid, A_REASON)] == before_rows


# ═══════════════════════════════════════════════════════════════════════════
# V9 — 취소는 무제한이고, 반복은 조용하지 않다
# ═══════════════════════════════════════════════════════════════════════════
def test_v9_cancelling_twice_appends_to_the_history_and_keeps_both_closed_rows(client, auth, cancel_project,
                                                                              user_ids):
    """확정 → 취소 → 확정 → 취소. 둘째 취소도 200 이고 이력이 **2** 이며 닫힌 요청 행 둘이 각자 그
    시점의 status·처리자를 유지한다.

    §6-2 물음: 1회 제한 구현은 둘째 취소에서 409 로 죽고, 이력을 **덮어쓰는** 구현은 길이 1 에서 죽는다.
    길이만 보면 덮어쓰기 구현이 "마지막 것 하나"로 통과할 수 있으므로 두 항목의 `cancel_note` 를 각각
    확인한다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REASON)
    assert _mapping(client, auth, pid, doc_id, A_REASON)["reviewed_by"] == user_ids["cm"]   # V5 가 확정해 뒀다

    first = _cancel(client, auth, pid, A_REASON, doc_id, note="첫째 취소")
    assert first.status_code == 200, first.text
    assert len(_history(_mapping(client, auth, pid, doc_id, A_REASON))) == 1

    _confirm(client, auth, pid, A_REASON, doc_id, "재확정")
    second = _cancel(client, auth, pid, A_REASON, doc_id, note="둘째 취소")
    assert second.status_code == 200, second.text

    mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    assert mapping["needs_review"] is True and mapping["reviewed_by"] is None
    history = _history(mapping)
    assert [h["cancel_note"] for h in history] == ["첫째 취소", "둘째 취소"], history
    assert [h["previous_decision"] for h in history] == ["confirmed", "confirmed"]

    open_rows = _open_reviews(client, auth, pid, A_REASON)
    closed_rows = _closed_reviews(client, auth, pid, A_REASON)
    assert len(open_rows) == 1, open_rows           # 열린 것은 언제나 하나뿐이다
    assert len(closed_rows) == 2, closed_rows       # 취소마다 닫힌 행이 하나씩 쌓인다(ADR 0013 §Deferred 1)
    assert {c["status"] for c in closed_rows} == {"approved"}
    assert all(c["resolved_by"] == user_ids["cm"] and c["resolution_note"] for c in closed_rows)


# ═══════════════════════════════════════════════════════════════════════════
# V7 — 취소할 결정이 없다 / 검사 순서
# ═══════════════════════════════════════════════════════════════════════════
def test_v7_cancelling_a_pending_mapping_is_refused_and_the_order_of_checks_is_a_contract(
        client, auth, cancel_project):
    """검토 대기 매핑에 취소를 걸면 409 `mapping_decision_not_cancellable`(무동작 200 이 아니다).

    **두 요건을 동시에 어긴 요청(결정도 없고 사유도 없음)도 같은 code 다** — 검사 순서가 계약이기
    때문이다(ADR 0013 규칙 6). 순서를 맞바꾼 구현은 여기서 `cancel_reason_required` 를 내고,
    그러면 취소할 결정이 없는 CM 이 **적을 수 없는 사유**를 적게 된다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_PENDING)
    before = _mapping(client, auth, pid, doc_id, A_PENDING)
    assert before["needs_review"] is True and before["reviewed_by"] is None
    before_rows = [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_PENDING)]

    for note in ("사유는 적었다", None, BLANK):
        r = _cancel(client, auth, pid, A_PENDING, doc_id, note=note)
        assert r.status_code == 409, (note, r.text)
        body = r.json()
        assert body["code"] == "mapping_decision_not_cancellable", (note, body)
        assert set(body) == {"detail", "code"}, body
        assert A_PENDING in body["detail"] and doc_id in body["detail"]

    after = _mapping(client, auth, pid, doc_id, A_PENDING)
    assert after["needs_review"] is True and after["reviewed_by"] is None
    assert CANCELLED_REVIEWS_KEY not in after["evidence"]["extra"]
    assert [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_PENDING)] == before_rows


# ═══════════════════════════════════════════════════════════════════════════
# V6 — 인가 · 대상 부재
# ═══════════════════════════════════════════════════════════════════════════
def test_v6_only_cm_can_cancel_and_the_target_must_exist(client, auth, cancel_project, user_ids):
    """취소는 그 프로젝트의 `cm` 만(ADR 0013 불변식 5 = 확정 라우트와 같은 한 줄). 부작용 0.

    인가가 **행 조회보다 먼저**인 것도 계약이다 — 뒤에 두면 비멤버에게 매핑의 존재 여부를 흘린다.
    그래서 멤버가 아닌 계정에는 **존재하는 쌍**으로도 403 이 나가야 한다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    # 이 시점 A100 은 취소된(=검토 대기) 상태다. 인가가 먼저 걸리므로 409 가 아니라 403 이어야 한다 —
    # 그 사실이 "인가가 앞이다"를 관측 가능하게 만든다.
    before_rows = [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_CONFIRM)]
    for role in ("contractor", "client", "admin"):
        r = _cancel(client, auth, pid, A_CONFIRM, doc_id, role=role, note="권한 없는 취소 시도")
        assert r.status_code == 403, (role, r.text)
        assert r.json()["code"] == "forbidden_role", (role, r.json())
    assert [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_CONFIRM)] == before_rows
    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)

    # 없는 쌍: cm 이어도 404. `not_found` 기본값이 아니라 원인별 code 여야 한다.
    r = _cancel(client, auth, pid, A_CONFIRM, "doc-does-not-exist", note="사유")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "document_mapping_target_not_found", r.json()
    r = _cancel(client, auth, pid, "A999", doc_id, note="사유")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "document_mapping_target_not_found", r.json()


# ═══════════════════════════════════════════════════════════════════════════
# V8 — 재계산·재업로드가 취소를 되돌리지 않고, 요청을 중복으로 만들지도 않는다
# ═══════════════════════════════════════════════════════════════════════════
def test_v8_recompute_and_register_reupload_neither_revive_the_decision_nor_duplicate_the_request(
        client, auth, cancel_project, user_ids):
    """취소된 쌍 위에서 재계산(수동 호출)과 대장 재업로드를 각각 태운다.

    단언 셋: ① 매핑은 미확정 그대로다(재계산이 확정·반려를 되살리지 않는다) ② 그 쌍의 열린 요청은
    **1건 그대로**(중복 생성 없음 — `open_document_mapping_review` 가 막는다) ③ 취소가 남긴 감사,
    즉 닫힌 요청 행들의 `status`·`resolved_by`·`resolution_note` 가 그대로다.

    **관측하고 단언하지 않는 것(정직하게 적는다).** 재계산은 미확정 매핑의 `evidence` 를 새 후보로
    덮어쓰므로 `extra.cancelled_mapping_reviews` **이력이 사라진다**(실측: 재계산 직후 길이 1 → 0).
    ADR 0013 규칙 3 은 그 이력을 append-only 로 설계했는데 재계산이 그것을 지운다 — 감사 자체는 닫힌
    요청 행에 남으므로 "결정에 이유가 남는다"는 축은 유지되지만, **이력의 수명은 다음 재계산까지**다.
    이 파일은 그 현재 동작을 계약으로 고정하지 않는다(어느 방향이 옳은지는 이 사이클이 정하지 않았다) —
    없어진다는 사실만 보고한다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    before_open = _open_reviews(client, auth, pid, A_CONFIRM)
    before_closed = [(c["review_request_id"], c["status"], c["resolved_by"], c["resolution_note"])
                     for c in _closed_reviews(client, auth, pid, A_CONFIRM)]
    assert len(before_open) == 1 and before_closed

    r = client.post(f"/api/projects/{pid}/documents/mappings", headers=auth("cm"))
    assert r.status_code == 200, r.text
    up, job = upload(client, auth("cm"), pid, FIXTURES / "document_register.xlsx")
    assert up["kind"] == "xlsx" and job["status"] == "done", job

    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)
    served = _mapping(client, auth, pid, doc_id, A_CONFIRM)
    assert served["needs_review"] is True and served["reviewed_by"] is None
    assert doc_id not in _confirmed_doc_ids(pid, A_CONFIRM)

    after_open = _open_reviews(client, auth, pid, A_CONFIRM)
    assert [x["review_request_id"] for x in after_open] == [x["review_request_id"] for x in before_open]
    assert [(c["review_request_id"], c["status"], c["resolved_by"], c["resolution_note"])
            for c in _closed_reviews(client, auth, pid, A_CONFIRM)] == before_closed

    # 옛 조건이 잡던 것(ADR 0007 §4-2 규칙 6 ⑥ — 재계산은 사람의 판단을 뒤집지 않는다)은 **반려된 채
    # 남아 있는 쌍이 없어** 이 프로젝트에서는 여기서 재확인할 수 없다. 그 회귀는 test_15 가 계속 잡는다.
    # 여기서 확인하는 것은 그 규칙의 취소 쪽 절반이다: 취소된 쌍도 재계산이 확정으로 되돌리지 않는다.


# ═══════════════════════════════════════════════════════════════════════════
# 중복 방지 — 재확인 요청이 이미 열린 확정을 취소하면 그 행을 재사용한다
# ═══════════════════════════════════════════════════════════════════════════
def test_cancelling_while_a_reopened_request_is_already_open_does_not_create_a_second_request(
        client, auth, cancel_project, user_ids, tmp_path: Path):
    """확정된 매핑은 Activity 가 바뀌면 재확인 요청이 **다시 열린다**(ADR 0007 §4-2 규칙 6 ⑤ —
    `_reopen_reviews_for_invalidated_confirmations`). 그 상태에서 확정을 취소하면 같은 쌍에 열린 요청이
    둘이 되면 안 된다 — CM 이 하나를 닫아도 큐에 남는다.

    §6-2 물음: 무조건 새 행을 만드는 구현은 열린 요청 2건이 되어 죽는다. 그리고 이 경로에는 **닫힌 요청
    행이 없으므로**(재오픈이 그 행을 다시 열었다) `cancelled_review_request_id` 가 `None` 이어야 한다 —
    아무 id 나 지어내는 폴백을 두면 죽는다(CLAUDE.md §6-4 2: 모르는 값은 모른다고 적는다).
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REOPENED)
    _confirm(client, auth, pid, A_REOPENED, doc_id, "확정")
    assert [r["status"] for r in _reviews(client, auth, pid, A_REOPENED)] == ["approved"]

    original = (FIXTURES / "schedule.csv").read_text(encoding="utf-8")
    lines = []
    for line in original.splitlines():
        if line.startswith(f"{A_REOPENED},"):
            cols = line.split(",")
            cols[1] = "완전히 다른 작업 내용 — 재확인 유도"   # 유사도가 임계값 아래로 떨어질 만큼 무관하게
            line = ",".join(cols)
        lines.append(line)
    modified = tmp_path / "schedule.csv"      # 같은 stem 이어야 같은 schedule_id 로 교체된다
    modified.write_text("\n".join(lines) + "\n", encoding="utf-8")
    up, job = upload(client, auth("contractor"), pid, modified)
    assert up["kind"] == "csv" and job["status"] == "done", job

    reopened = _reviews(client, auth, pid, A_REOPENED)
    assert [r["status"] for r in reopened] == ["open"], reopened   # 재확인 요청이 다시 열렸다
    reopened_id = reopened[0]["review_request_id"]
    assert _mapping(client, auth, pid, doc_id, A_REOPENED)["needs_review"] is False   # 매핑은 확정 그대로

    r = _cancel(client, auth, pid, A_REOPENED, doc_id, note="재확인 중 확정을 취소한다")
    assert r.status_code == 200, r.text

    rows = _reviews(client, auth, pid, A_REOPENED)
    assert len(rows) == 1, rows                                  # 새 행을 만들지 않고 그 행을 쓴다
    assert rows[0]["review_request_id"] == reopened_id and rows[0]["status"] == "open"
    sources = rows[0]["conflicting_sources"]
    assert sources["cancel_note"] == "재확인 중 확정을 취소한다"
    assert sources["cancelled_review_request_id"] is None          # 닫힌 결정이 없다 — 지어내지 않는다
    assert _row_fields(pid, A_REOPENED, doc_id) == (True, None)
