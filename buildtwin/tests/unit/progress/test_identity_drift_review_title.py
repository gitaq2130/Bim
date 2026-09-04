"""식별 드리프트 검토요청 제목 — **모르는 경위를 아는 경위로 떨어뜨리지 않는다**
(ADR 0009 §Deferred 5 · §5-3-a · §5-4, CLAUDE.md §6-4 규칙 2, 담당: qa).

`cause` 문자열의 정본은 생산자(`services/ingest/persistence` 의 `_CAUSE_ROW_*`)이고 지금 그 값은 **네
자리에 복제돼 있다**(ADR 0009 §Deferred 5). 값을 한 곳으로 올리는 일은 이 사이클의 범위 밖이므로,
그때까지의 유일한 방어가 **폴백 규칙**이다: 세 소비자 모두 모르는 `cause` 를 `unspecified` 로 두고
`row_moved` 로 떨어뜨리지 않는다. 모르는 경위를 가장 흔한 경위로 적으면 §5-4 가 고치려는 바로 그
거짓("고아 문서에 남았습니다 / 0건 이동했고 / 새 doc_id 위에서 다시 확정하십시오")이 재생산된다.

**이 파일이 왜 생겼나.** 개정 2 최종 재심에서 리뷰어가 `_identity_drift_review_title` 의
`_CAUSE_UNSPECIFIED` 를 `_CAUSE_ROW_MOVED` 로 바꾸는 뮤테이션을 넣었는데 **전부 초록이었다.** 화면 쪽은
같은 계약을 이미 고정하고 있었고(`apps/web/src/pages/ReviewsPage.test.tsx`) 서버 쪽만 비어 있었다.
대장 적재는 `cause` 를 언제나 채우므로 이 입력은 API 경로로 만들 수 없다 — 그래서 단위 테스트다.

**반증 — 이것만으로는 잡지 못하는 것:** "모르는 경위" 단언만 두면 **모든** 경위를 `unspecified` 로
적는 구현이 통과한다. 그래서 아래 마지막 테스트가 아는 경위(`row_moved`)의 문구가 실제로 이동을
말한다는 것을 짝으로 고정한다(§6-2 규칙 3 — 대조군을 한 축에 몰지 않는다).
"""
from __future__ import annotations

import pytest

from services.progress import persistence as db
from services.progress.document_mapper import IdentityDriftReport, open_identity_drift_review

PROJECT_ID = "P-DRIFT-TITLE"
#: 지문은 이 파일의 관심사가 아니므로 **서로 다른 값**으로 고정해 둔다(꼬리는 언제나 "config 가
#: 바뀌었습니다" 갈래). 지문 갈래 자체는 통합 회귀가 세 갈래 모두 따로 고정한다(V7a·V7 시트명·V8c) —
#: 여기서 `previous_fingerprint=None` 을 쓰면 이 파일이 그 뮤테이션에도 함께 빨개져서 "무엇이
#: 깨졌는가"를 가리키지 못한다.
_PREVIOUS_FINGERPRINT = "aaaaaaaaaaaaaaaa"
_CURRENT_FINGERPRINT = "bbbbbbbbbbbbbbbb"


def _title_for(session, lost: dict, **report_fields) -> str:
    """`open_identity_drift_review`(공개 진입점)를 실제로 태우고 CM 큐에 실린 제목을 돌려준다."""
    db.ensure_project(session, PROJECT_ID)
    drift = IdentityDriftReport(previous_fingerprint=_PREVIOUS_FINGERPRINT,
                                current_fingerprint=_CURRENT_FINGERPRINT, file_id="f-drift",
                                lost_decisions=[lost], **report_fields)
    review_id = open_identity_drift_review(session, PROJECT_ID, drift)
    assert review_id is not None
    rows = [r for r in db.open_reviews(session, PROJECT_ID, kind="document_identity_drift")
            if r.review_request_id == review_id]
    assert len(rows) == 1, rows
    return str(rows[0].title)


def _lost(**overrides) -> dict:
    return {"activity_id": "A100", "doc_id": "doc-v1-abcdef0123456789", "decision": "confirmed",
            "cause": "row_moved", "new_doc_id": None, "changed_fields": [], "approval_flipped": False,
            **overrides}


@pytest.mark.parametrize("cause", ["", "row_split_v3"])
def test_unknown_cause_is_not_dropped_into_row_moved(session, cause: str) -> None:
    """생산자가 `cause` 를 싣지 못했거나(`""`) 이 모듈이 모르는 새 경위를 실었을 때.

    폴백을 `row_moved` 로 바꾸면 제목이 "대장 행은 그대로인데 우리 식별 규칙이 그 행을 새 doc_id 로
    옮겼습니다(**이번 적재의 이동 0건**)"가 된다 — 관측한 적 없는 이동을, 그것도 0건이라고 적는 문장이다
    (§5-4 가 초판 제목에서 지목한 세 거짓 중 하나가 정확히 "0건 이동했고"였다).

    그래서 두 가지를 함께 건다: ① 이동·고아·병합처럼 **이 경위에서 참일 수 없는 말**이 없다
    ② 서버가 받은 원문 값을 그대로 드러내고 "설명할 수 없는 경위"라고 적는다(CM 이 직접 열어 보게 한다).
    """
    title = _title_for(session, _lost(cause=cause))
    for forbidden in ("이동", "고아", "병합", "다시 확정", "옮겼습니다"):
        assert forbidden not in title, title
    assert "설명할 수 없는 경위" in title, title
    assert "lost_decisions" in title, title          # 어디를 봐야 하는지는 말한다
    # 빈 값은 `unspecified` 자리표시자로, 모르는 값은 **원문 그대로** 드러난다(번역하지 않는다).
    assert (cause or "unspecified") in title, title


def test_known_cause_still_says_what_it_observed(session) -> None:
    """대조군 — 아는 경위(`row_moved`)는 반대로 **이동과 다시 판단할 곳**을 말해야 한다.

    이것이 없으면 "모든 경위를 unspecified 로 적는다"는 구현이 위 테스트를 그대로 통과하고, 그러면
    CM 은 실제로 옮겨 간 doc_id 가 있는데도 매번 "직접 열어 보십시오"만 읽게 된다.
    """
    title = _title_for(
        session, _lost(new_doc_id="doc-v1-0123456789abcdef"),
        moved=[{"previous_doc_id": "doc-v1-abcdef0123456789",
                "new_doc_id": "doc-v1-0123456789abcdef", "title": "1F 기둥 배근도 승인요청"}])
    assert "설명할 수 없는 경위" not in title, title
    assert "이동 1건" in title, title
    assert "새 doc_id" in title and "다시 확정" in title, title
    # 판정이 보지 않는 사실은 이 경위에서도 단정하지 않는다(ADR 0009 §5-3 개정 2 정정 ①).
    assert "고아" not in title and "병합" not in title, title
