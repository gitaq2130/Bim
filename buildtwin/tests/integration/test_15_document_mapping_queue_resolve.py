"""`document_mapping` 검토요청 큐 승인·반려 — CM 이 실제로 지나가는 경로(과제 1·2, 11차 QA 사이클).

배경: 이번 사이클에 같은 종류의 침묵을 세 번 겪었다(매핑 0건인데 전부 통과 / 검토요청을 만드는 코드가
없는데 blocker 는 그 큐를 가리킴 / **큐 승인이 매핑을 확정하지 않는데 화면은 확정된다고 약속**). 세 번째는
`services/api/usecases.resolve_review` 의 `document_mapping` 분기가 실제로 매핑 행(`ActivityDocumentMappingRow`)을
바꾸는지 검증하는 테스트가 없었기 때문이다 — 기존 6개 테스트(tests/unit/progress/
test_document_mapping_review_lifecycle.py)는 `close_document_mapping_review` 를 **직접 호출**해서
CM 이 실제로 타는 `POST /api/review-requests/{id}/resolve` 경로를 우회했다.

이 파일은 그 경로를 `TestClient` 로 끝까지 태운다: `resolve_review` 호출 금지가 아니라 **그것만** 호출한다
(`close_document_mapping_review`/`reject_document_mapping` 을 이 파일에서 직접 호출하지 않는다).

프로젝트 하나를 모듈 스코프로 만들어 정상 순서(공정표 → 대장)로 올린다 — `document_register.xlsx`(TFA 8·
TFR 2) x `schedule.csv`(Activity 6개)는 결정적으로 정확히 6건의 매핑을 만든다(tests/integration/
test_14_document_mapping_order_recovery.py 와 같은 상수). 실제 매핑 결과를 사전에 조사해 아래 세 Activity 를
고정 배역으로 쓴다(값은 안정적 — 두 픽스처 파일이 바뀌지 않는 한 매번 같다):

- `A100` → TFA, 처리결과 **승인(APPROVED)** — 승인(과제 1) 대상.
- `A400` → TFA, 처리결과 **승인(APPROVED)** — 반려(과제 2) 대상. 일부러 "이미 승인된" 문서를 반려해
  누수 A(과제 2-3)를 실제로 관찰 가능하게 한다 — 반려된 문서가 우연히도 미승인 상태라면 누수가 있어도
  없어도 값이 똑같이 0.0 이라 테스트가 아무것도 잡지 못한다.
- `A200` → TFA, 처리결과 반려(REJECTED) — **아무것도 건드리지 않는 대조군**(과제 2-5).

이 배역이 실제 픽스처와 어긋나면(예: 유사도 알고리즘이나 config 가 바뀌어 다른 문서가 매핑됨) 아래 각
테스트가 doc_type/approval_status 를 실행 시점에 다시 확인하고 실패 메시지로 알린다 — doc_id 자체(해시)는
하드코딩하지 않고 매번 API 응답에서 읽는다.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services.progress.config_loader import load_readiness_config

from .conftest import FIXTURES, add_member, upload

ACTIVITY_APPROVE = "A100"    # 승인(과제 1) 대상 — 처리결과 APPROVED
ACTIVITY_REJECT = "A400"     # 반려(과제 2) 대상 — 처리결과 APPROVED(반려해도 누수 A가 보이도록 일부러 승인건을 고른다)
ACTIVITY_UNTOUCHED = "A200"  # 아무것도 건드리지 않는 대조군 — 처리결과 REJECTED
EXPECTED_MAPPING_COUNT = 6   # document_register.xlsx(10건) x schedule.csv(6 Activity)


@pytest.fixture(scope="module")
def dm_project(client, auth, user_ids) -> str:
    """정상 순서(공정표 → 대장)로 올려 대장 업로드 잡 하나가 6건의 매핑 + 6건의 열린 document_mapping
    검토요청을 만든다(ADR 0007 §4 규칙 6 ①). 이 파일 전용 프로젝트라 세션 스코프 `project` 픽스처(다른
    파일들의 activity_id 가정)를 건드리지 않는다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "문서 매핑 큐 승인·반려 테스트"})
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


def _open_document_mapping_reviews(client, auth, project_id: str) -> list[dict]:
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping", "status": "open"})
    assert r.status_code == 200, r.text
    return r.json()


def _all_document_mapping_reviews(client, auth, project_id: str) -> list[dict]:
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping"})
    assert r.status_code == 200, r.text
    return r.json()


def _review_for_activity(reviews: list[dict], activity_id: str) -> dict:
    matches = [r for r in reviews if r["activity_id"] == activity_id]
    assert len(matches) == 1, f"expected exactly one review for {activity_id!r}, got {matches}"
    return matches[0]


def _document(client, auth, project_id: str, doc_id: str) -> dict:
    r = client.get(f"/api/documents/{doc_id}", headers=auth("cm"), params={"project_id": project_id})
    assert r.status_code == 200, r.text
    return r.json()


def _mapping_for_activity(client, auth, project_id: str, doc_id: str, activity_id: str) -> dict:
    body = _document(client, auth, project_id, doc_id)
    matches = [m for m in body["mappings"] if m["activity_id"] == activity_id]
    assert len(matches) == 1, f"expected exactly one mapping ({activity_id}, {doc_id}), got {matches}"
    return matches[0]


# ═══════════════════════════════════════════════════════════════════════════
# 과제 1 — 큐 승인
# ═══════════════════════════════════════════════════════════════════════════
def test_contractor_cannot_approve_document_mapping_review(client, auth, dm_project):
    """과제 1-4: contractor 가 승인을 시도하면 403 — 요청도 매핑도 건드리지 않는다."""
    review = _review_for_activity(_open_document_mapping_reviews(client, auth, dm_project), ACTIVITY_APPROVE)
    r = client.post(f"/api/review-requests/{review['review_request_id']}/resolve", headers=auth("contractor"),
                    json={"decision": "approved", "note": "계약자가 임의로 승인 시도"})
    assert r.status_code == 403, r.text

    # 부작용 없음: 요청은 여전히 open, 매핑은 여전히 needs_review=True
    assert client.get(f"/api/review-requests/{review['review_request_id']}", headers=auth("cm")).json()["status"] == "open"
    doc_id = review["conflicting_sources"]["doc_id"]
    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_APPROVE)
    assert m["needs_review"] is True and m["reviewed_by"] is None


def test_cm_approving_document_mapping_review_confirms_mapping_row(client, auth, dm_project, user_ids):
    """과제 1-1: `resolve_review` 를 통한 승인이 **요청 status 뿐 아니라 매핑 행**을 실제로 확정한다.

    9차 리뷰가 잡은 원래 버그: 이전에는 `row.kind == "document_mapping"` 이 resolve_review 의 어느 분기에도
    걸리지 않아 검토요청 status 만 바뀌고 `ActivityDocumentMappingRow` 는 손대지 않았다 — 요청 status 만
    확인하는 테스트로는 그 버그가 통과했을 것이므로 반드시 매핑 행을 직접 읽어 확인한다."""
    review = _review_for_activity(_open_document_mapping_reviews(client, auth, dm_project), ACTIVITY_APPROVE)
    doc_id = review["conflicting_sources"]["doc_id"]
    doc = _document(client, auth, dm_project, doc_id)["document"]
    assert doc["doc_type"] == "TFA" and doc["approval_status"] == "APPROVED", (
        f"고정 배역이 어긋났다 — A100 에 매핑된 문서가 더 이상 승인된 TFA 가 아니다: {doc}")

    r = client.post(f"/api/review-requests/{review['review_request_id']}/resolve", headers=auth("cm"),
                    json={"decision": "approved", "note": "대장 확인 결과 승인 확인"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "approved" and out["resolved_by"] == user_ids["cm"]

    # 요청 status 만이 아니라 매핑 행 자체가 확정돼야 한다(이번 과제의 핵심 확인)
    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_APPROVE)
    assert m["needs_review"] is False
    assert m["reviewed_by"] == user_ids["cm"]

    # 확정된 검토요청은 다시 열려 있지 않다
    assert client.get(f"/api/review-requests/{review['review_request_id']}", headers=auth("cm")).json()["status"] == "approved"
    remaining_open = _open_document_mapping_reviews(client, auth, dm_project)
    assert review["review_request_id"] not in {r["review_request_id"] for r in remaining_open}
    assert len(remaining_open) == EXPECTED_MAPPING_COUNT - 1


def test_confirmed_document_feeds_drawing_approval_readiness(client, auth, dm_project):
    """과제 1-3: 확정된 문서가 `drawing_approval` 의 확정 필수 문서로 실제 집계된다 — readiness 가
    그 문서를 근거로 쓴다(ADR 0007 §5-2 순위 1: 논리곱, 필수 문서 전부 승인 -> 1.0)."""
    r = client.get(f"/api/activities/{ACTIVITY_APPROVE}/readiness", headers=auth("cm"))
    assert r.status_code == 200, r.text
    score = r.json()
    assert score["components"]["drawing_approval"] == 1.0
    assert not any(b["component"] == "drawing_approval" for b in score["blockers"])
    assert "approved=1/1; pending_mappings=0" in score["evidence"]["note"], score["evidence"]["note"]


def test_reuploading_register_after_confirmation_does_not_recreate_review(client, auth, dm_project, user_ids):
    """과제 1-2: 승인 후 대장을 재업로드해도(주간 재업로드가 정상 운영 절차, ADR 0007 §4-3) 그 요청이
    재생성되지 않고 전체 요청 수가 늘지 않는다."""
    before_all = _all_document_mapping_reviews(client, auth, dm_project)
    assert len(before_all) == EXPECTED_MAPPING_COUNT   # 이전 테스트가 5 open + 1 approved 를 만들어 둔 상태

    up, job = upload(client, auth("cm"), dm_project, FIXTURES / "document_register.xlsx")
    assert up["kind"] == "xlsx" and job["status"] == "done", job

    after_all = _all_document_mapping_reviews(client, auth, dm_project)
    assert len(after_all) == EXPECTED_MAPPING_COUNT   # 새로 생기지도, 사라지지도 않는다
    assert {r["review_request_id"] for r in after_all} == {r["review_request_id"] for r in before_all}

    approve_review = _review_for_activity(after_all, ACTIVITY_APPROVE)
    assert approve_review["status"] == "approved"   # 재업로드가 다시 open 으로 되돌리지 않았다

    doc_id = approve_review["conflicting_sources"]["doc_id"]
    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_APPROVE)
    assert m["needs_review"] is False and m["reviewed_by"] == user_ids["cm"]   # 확정도 되돌아가지 않았다


# ═══════════════════════════════════════════════════════════════════════════
# 과제 2 — 큐 반려
# ═══════════════════════════════════════════════════════════════════════════
def test_cm_rejecting_document_mapping_review_marks_row_without_deleting(client, auth, dm_project, user_ids):
    """과제 2-1: 반려해도 매핑 행이 남고(삭제 금지 — 감사 이력), 반려 표시·반려자·사유가 evidence 에 남는다."""
    review = _review_for_activity(_open_document_mapping_reviews(client, auth, dm_project), ACTIVITY_REJECT)
    doc_id = review["conflicting_sources"]["doc_id"]
    doc = _document(client, auth, dm_project, doc_id)["document"]
    assert doc["doc_type"] == "TFA" and doc["approval_status"] == "APPROVED", (
        f"고정 배역이 어긋났다 — A400 에 매핑된 문서가 더 이상 승인된 TFA 가 아니다: {doc}")

    note = "다른 공종 문서로 확인됨 — 이 Activity 와 무관"
    r = client.post(f"/api/review-requests/{review['review_request_id']}/resolve", headers=auth("cm"),
                    json={"decision": "rejected", "note": note})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected" and r.json()["resolved_by"] == user_ids["cm"]

    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)
    assert m is not None   # 삭제되지 않았다
    assert m["evidence"]["extra"]["mapping_review_decision"] == "rejected"
    assert m["evidence"]["extra"]["rejected_by"] == user_ids["cm"]
    assert m["evidence"]["extra"]["rejection_note"] == note


def test_rejected_pair_is_not_recreated_by_repeated_register_reupload(client, auth, dm_project):
    """과제 2-2(핵심): 반려 후 대장을 반복 재업로드해도 그 (activity_id, doc_id) 쌍이 다시 만들어지지
    않는다 — 매핑도, document_mapping 검토요청도. CM 이 "무관하다"고 판단했는데 매주 같은 후보가 다시
    올라오면 검토 큐가 쓰레기가 된다."""
    review = _review_for_activity(_all_document_mapping_reviews(client, auth, dm_project), ACTIVITY_REJECT)
    assert review["status"] == "rejected"
    doc_id = review["conflicting_sources"]["doc_id"]
    total_before = len(_all_document_mapping_reviews(client, auth, dm_project))

    # "매주 재업로드"를 두 번 흉내낸다 — 한 번으로는 우연히 통과할 수 있는 회귀도 잡는다
    for _ in range(2):
        up, job = upload(client, auth("cm"), dm_project, FIXTURES / "document_register.xlsx")
        assert up["kind"] == "xlsx" and job["status"] == "done", job

        assert len(_all_document_mapping_reviews(client, auth, dm_project)) == total_before   # 새 요청 없음
        assert not any(r["activity_id"] == ACTIVITY_REJECT and r["status"] == "open"
                      for r in _all_document_mapping_reviews(client, auth, dm_project))

        m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)
        assert m["needs_review"] is False   # 재계산이 다시 미확정으로 되돌리지 않았다
        assert m["evidence"]["extra"]["mapping_review_decision"] == "rejected"   # 반려 표시도 지워지지 않았다

    final_review = _review_for_activity(_all_document_mapping_reviews(client, auth, dm_project), ACTIVITY_REJECT)
    assert final_review["review_request_id"] == review["review_request_id"]   # 새로 만들어지지 않고 같은 행 그대로
    assert final_review["status"] == "rejected"


def test_rejected_document_not_counted_toward_drawing_approval_readiness(client, auth, dm_project):
    """과제 2-3(누수 A): `reviewed_by` 재사용 때문에 반려도 `needs_review=False` 가 된다 — 방어가 없으면
    반려된(그런데 원래 승인이었던) 문서가 도면 승인 AND 조건의 증거로 도로 들어간다. A400 은 §4-2 규칙 6과
    무관하게 처리결과가 APPROVED 인 문서를 반려했으므로, 누수가 있으면 drawing_approval 이 그대로 1.0 이
    나온다 — 그래서 이 조합을 배역으로 골랐다."""
    r = client.get(f"/api/activities/{ACTIVITY_REJECT}/readiness", headers=auth("cm"))
    assert r.status_code == 200, r.text
    score = r.json()
    cfg = load_readiness_config()
    # 반려된 문서가 "확정 필수 문서"에서 완전히 빠져야 한다 -> 순위 1 근거가 없어 순위 2/3(수동 플래그
    # 없음 -> 기본값)으로 떨어진다. 1.0 이면 반려가 여전히 승인 증거로 쓰이고 있다는 뜻이다.
    assert score["components"]["drawing_approval"] != 1.0
    assert score["components"]["drawing_approval"] == cfg["component_defaults"]["drawing_approval_unknown"]
    assert "drawing_approval" in score["evidence"]["extra"]["missing_components"]


def test_activity_rename_does_not_revive_rejected_mapping_review(client, auth, dm_project, tmp_path: Path):
    """과제 2-4(누수 B): 반려된 매핑은 Activity 가 바뀌어도 "재확인 필요"로 되살아나지 않는다.

    확정(승인) 매핑은 Activity 가 바뀌어 재계산이 더는 지지하지 않으면 `_reopen_reviews_for_invalidated_
    confirmations` 가 재확인 검토요청을 다시 연다(안전을 위해 의도된 동작, 9차 리뷰 후속) — 방어가 없으면
    같은 로직이 반려된 매핑까지 되살린다. `A400`(반려 대상)의 이름을 실제 공정표 재업로드로 완전히
    무관한 텍스트로 바꿔 제목 유사도 자체가 임계값 아래로 떨어지게 만든 뒤(판별 토큰이 아니라 규칙 1이
    걸린다), 되살아나지 않는지 확인한다."""
    original = (FIXTURES / "schedule.csv").read_text(encoding="utf-8")
    lines = original.splitlines()
    renamed_lines = []
    for line in lines:
        if line.startswith(f"{ACTIVITY_REJECT},"):
            cols = line.split(",")
            cols[1] = "완전히 다른 작업 내용 — 리네임 테스트"   # 제목 유사도가 0.55 아래로 떨어질 정도로 무관한 텍스트
            line = ",".join(cols)
        renamed_lines.append(line)
    modified = "\n".join(renamed_lines) + "\n"
    assert modified != original

    modified_path = tmp_path / "schedule.csv"   # 같은 stem 이어야 같은 schedule_id 로 교체된다
    modified_path.write_text(modified, encoding="utf-8")

    up, job = upload(client, auth("contractor"), dm_project, modified_path)
    assert up["kind"] == "csv" and job["status"] == "done", job

    reviews = _all_document_mapping_reviews(client, auth, dm_project)
    reject_reviews = [r for r in reviews if r["activity_id"] == ACTIVITY_REJECT]
    assert len(reject_reviews) == 1, reject_reviews   # 새 요청이 추가로 생기지 않았다
    assert reject_reviews[0]["status"] == "rejected"   # open 으로 되돌아가지 않았다

    doc_id = reject_reviews[0]["conflicting_sources"]["doc_id"]
    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)
    assert m["needs_review"] is False
    assert m["evidence"]["extra"]["mapping_review_decision"] == "rejected"   # 반려 표시 그대로


def test_other_mappings_remain_normal_after_reject_and_recompute_cycles(client, auth, dm_project, user_ids):
    """과제 2-5: 반려하지 않은 다른 매핑들은(앞선 승인·반려·재계산 반복을 모두 거친 뒤에도) 정상 유지된다."""
    reviews = _all_document_mapping_reviews(client, auth, dm_project)

    # 아무것도 건드리지 않은 대조군(A200) — 여전히 open, 매핑은 여전히 미확정
    untouched = _review_for_activity(reviews, ACTIVITY_UNTOUCHED)
    assert untouched["status"] == "open"
    untouched_doc_id = untouched["conflicting_sources"]["doc_id"]
    um = _mapping_for_activity(client, auth, dm_project, untouched_doc_id, ACTIVITY_UNTOUCHED)
    assert um["needs_review"] is True and um["reviewed_by"] is None
    assert um["evidence"]["extra"].get("mapping_review_decision") is None

    # 승인된 A100 — 이 파일의 재계산·재업로드 반복(과제 1-2, 2-2, 2-4)을 다 거치고도 여전히 확정 상태
    approved = _review_for_activity(reviews, ACTIVITY_APPROVE)
    assert approved["status"] == "approved"
    approved_doc_id = approved["conflicting_sources"]["doc_id"]
    am = _mapping_for_activity(client, auth, dm_project, approved_doc_id, ACTIVITY_APPROVE)
    assert am["needs_review"] is False and am["reviewed_by"] == user_ids["cm"]

    assert len(reviews) == EXPECTED_MAPPING_COUNT   # 전체 요청 수도 처음 그대로(재생성·중복 없음)


# ═══════════════════════════════════════════════════════════════════════════
# 10차 리뷰 — 반려된 매핑의 확정 시도
# ═══════════════════════════════════════════════════════════════════════════
def test_confirming_a_rejected_mapping_is_refused_with_409(client, auth, dm_project, user_ids):
    """반려된 매핑을 확정 엔드포인트로 확정하려 하면 **409 로 거절**한다.

    원래 결함(10차 리뷰): `_confirm_document_mapping_row` 가 evidence 를 그대로 복사해
    `extra.mapping_review_decision="rejected"` 가 남은 채 `reviewed_by` 만 갈아끼웠다. 그 결과 **200 을
    돌려주고 화면은 "확정됨"을 그리는데 readiness 는 이 확정을 영원히 보지 못하는** 반쪽 상태가 됐다
    (`confirmed_required_documents` 가 반려 표시로 계속 걸러내므로). 이번 사이클에서 네 번째로 나온
    "응답은 성공인데 아무 효과가 없다"이다.

    ADR 0007 §4-2 규칙 6 ⑥ 이 반려를 영구로 설계했으므로 설계대로 거절한다 — 반려 취소는 별개 기능이다.
    A400 은 앞선 테스트에서 이미 반려됐다(이 파일은 모듈 스코프 프로젝트를 순서대로 공유한다)."""
    review = _review_for_activity(_all_document_mapping_reviews(client, auth, dm_project), ACTIVITY_REJECT)
    assert review["status"] == "rejected"
    doc_id = review["conflicting_sources"]["doc_id"]
    before = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)

    r = client.post(f"/api/documents/mappings/{ACTIVITY_REJECT}/{doc_id}/confirm",
                    headers=auth("cm"), json={"note": "실수로 확정 시도"})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "document_mapping_already_rejected", r.text

    # 거절이므로 매핑 행은 조금도 바뀌지 않아야 한다(반려 표시·반려자·사유 전부 그대로)
    after = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)
    assert after["evidence"]["extra"]["mapping_review_decision"] == "rejected"
    assert after["evidence"]["extra"]["rejected_by"] == user_ids["cm"]
    assert after["evidence"]["extra"]["rejection_note"] == before["evidence"]["extra"]["rejection_note"]
    assert after["needs_review"] is False

    # readiness 도 그대로 — 반려된 문서는 여전히 도면 승인 근거가 아니다
    score = client.get(f"/api/activities/{ACTIVITY_REJECT}/readiness", headers=auth("cm")).json()
    assert score["components"]["drawing_approval"] != 1.0


def test_confirming_a_pending_mapping_still_works(client, auth, dm_project, user_ids):
    """위 409 방어가 **정상 확정까지 막지는 않는다** — 아무도 손대지 않은 A200 매핑은 그대로 확정된다.
    (방어를 넣고 기능을 죽이는 것도 이 사이클이 반복한 실패라 대조군을 둔다.)"""
    review = _review_for_activity(_all_document_mapping_reviews(client, auth, dm_project), ACTIVITY_UNTOUCHED)
    assert review["status"] == "open"
    doc_id = review["conflicting_sources"]["doc_id"]

    r = client.post(f"/api/documents/mappings/{ACTIVITY_UNTOUCHED}/{doc_id}/confirm",
                    headers=auth("cm"), json={"note": "대장 확인"})
    assert r.status_code == 200, r.text

    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_UNTOUCHED)
    assert m["needs_review"] is False and m["reviewed_by"] == user_ids["cm"]
    assert m["evidence"]["extra"].get("mapping_review_decision") is None   # 확정은 이 키를 쓰지 않는다


def test_every_confirm_path_shares_the_rejection_guard(client, auth, dm_project):
    """확정 경로 **전부**가 반려 방어를 받는다 — 방어가 한쪽 경로에만 걸려 있지 않다(11차 리뷰).

    처음 고칠 때는 `confirm_document_mapping`(전용 엔드포인트)에만 가드를 붙였다. 그러면 같은 확정
    행위인데 검토 큐 승인(`resolve_review`) 경로만 무방비가 되고, 그 경로로 들어오면 10차 major 3 이
    고친 "200 인데 아무 효과가 없다"가 그대로 재현된다 — 반려 표시가 남아 readiness 가 그 확정을 영원히
    보지 못한다. **오늘 API 로는 도달할 수 없다**(반려된 요청은 이미 닫혀 있어 409 review_already_resolved
    에 먼저 걸린다) — 그래서 두 경로가 공유하는 본체를 직접 불러 계약을 고정한다. 이 사이클이 겪은 네 번의
    사고가 전부 "한쪽 경로에만 방어를 걸었다"에서 나왔으므로, 도달 불가라는 이유로 비대칭을 남기지 않는다.

    HTTP 레벨에서 그 두 경로가 실제로 막히는지는 각각 `test_confirming_a_rejected_mapping_is_refused_with_409`
    (전용 엔드포인트 409)와 아래 큐 재승인 확인(409 review_already_resolved)이 담당한다."""
    from packages.core.db import session_scope
    from packages.core.models.orm import ActivityDocumentMappingRow
    from services.api.errors import Conflict
    from services.api.usecases import _confirm_document_mapping_row

    review = _review_for_activity(_all_document_mapping_reviews(client, auth, dm_project), ACTIVITY_REJECT)
    doc_id = review["conflicting_sources"]["doc_id"]

    with session_scope() as session:
        row = session.get(ActivityDocumentMappingRow, (ACTIVITY_REJECT, doc_id))
        assert row is not None and row.evidence["extra"]["mapping_review_decision"] == "rejected"
        with pytest.raises(Conflict) as exc:
            _confirm_document_mapping_row(session, row, "u-any-cm")
        assert exc.value.code == "document_mapping_already_rejected"

    # 큐 경로를 HTTP 로 다시 밀어도 막힌다(요청이 이미 닫혀 있어 다른 코드로 먼저 걸린다)
    r = client.post(f"/api/review-requests/{review['review_request_id']}/resolve",
                    headers=auth("cm"), json={"decision": "approved", "note": "재승인 시도"})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "review_already_resolved", r.text

    # 어느 쪽으로도 매핑이 바뀌지 않았다
    m = _mapping_for_activity(client, auth, dm_project, doc_id, ACTIVITY_REJECT)
    assert m["evidence"]["extra"]["mapping_review_decision"] == "rejected"
