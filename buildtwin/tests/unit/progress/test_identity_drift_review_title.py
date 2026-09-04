"""식별 드리프트 검토요청 제목 — **모르는 경위를 아는 경위로 떨어뜨리지 않는다**
(ADR 0009 §Deferred 5 · §5-3-a · §5-4, CLAUDE.md §6-4 규칙 2, 담당: qa).

`cause` 문자열의 정본은 생산자(`services/ingest/persistence` 의 `_CAUSE_ROW_*`)이고 지금 그 값은 **네
자리에 복제돼 있다**(ADR 0009 §Deferred 5). 값을 한 곳으로 올리는 일은 이 사이클의 범위 밖이므로,
그때까지의 유일한 방어가 **폴백 규칙**이다: **소비 자리 둘**(§Deferred 5 표의 2 `document_mapper` ·
3 `identityDrift.ts` — 4번은 상수가 아니라 `ReviewKind` 머리 **주석**이고 1번은 생산자다) 모두 모르는
`cause` 를 `unspecified` 로 두고 `row_moved` 로 떨어뜨리지 않는다. 모르는 경위를 가장 흔한 경위로
적으면 §5-4 가 고치려는 바로 그 거짓("고아 문서에 남았습니다 / 0건 이동했고 / 새 doc_id 위에서 다시
확정하십시오")이 재생산된다.

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
_PROJECT_SEQ = 0   # 요청은 지문마다 1건이므로 제목을 하나씩 읽으려면 프로젝트를 갈라야 한다
#: 지문은 이 파일의 관심사가 아니므로 **서로 다른 값**으로 고정해 둔다(꼬리는 언제나 "config 가
#: 바뀌었습니다" 갈래). 지문 갈래 자체는 통합 회귀가 세 갈래 모두 따로 고정한다(V7a·V7 시트명·V8c) —
#: 여기서 `previous_fingerprint=None` 을 쓰면 이 파일이 그 뮤테이션에도 함께 빨개져서 "무엇이
#: 깨졌는가"를 가리키지 못한다.
_PREVIOUS_FINGERPRINT = "aaaaaaaaaaaaaaaa"
_CURRENT_FINGERPRINT = "bbbbbbbbbbbbbbbb"


def _title_for(session, lost: dict, **report_fields) -> str:
    """`open_identity_drift_review`(공개 진입점)를 실제로 태우고 CM 큐에 실린 제목을 돌려준다."""
    return _title_for_many(session, [lost], **report_fields)


def _title_for_many(session, lost: list[dict], **report_fields) -> str:
    """경위가 섞인 적재(제목이 절을 나란히 세우는 경로)까지 태우는 판.

    **프로젝트를 항목마다 새로 판다.** `open_identity_drift_review` 는 같은 `current_fingerprint` 로
    열린 요청이 있으면 새로 만들지 않고 **갱신**하므로(적재당 1건 불변식), 한 프로젝트에서 두 번 부르면
    두 번째 호출의 제목이 첫 번째 요청을 덮어써 무엇을 읽고 있는지 알 수 없게 된다.
    """
    global _PROJECT_SEQ
    _PROJECT_SEQ += 1
    project_id = f"{PROJECT_ID}-{_PROJECT_SEQ}"
    db.ensure_project(session, project_id)
    drift = IdentityDriftReport(previous_fingerprint=_PREVIOUS_FINGERPRINT,
                                current_fingerprint=_CURRENT_FINGERPRINT, file_id="f-drift",
                                lost_decisions=list(lost), **report_fields)
    review_id = open_identity_drift_review(session, project_id, drift)
    assert review_id is not None
    rows = [r for r in db.open_reviews(session, project_id, kind="document_identity_drift")
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


# ═══════════════════════════════════════════════════════════════════════════
# 재심 2차에서 살아남은 뮤테이션 — 문구가 **값에서** 읽는가, 경위 이름으로 단정하는가
# (N4·N4b·N5. 셋 다 대장 적재로는 만들 수 없거나 순서를 관측할 수 없어 단위 테스트다.)
# ═══════════════════════════════════════════════════════════════════════════
def _replaced(**overrides) -> dict:
    return _lost(cause="row_replaced", changed_fields=["sender"], **overrides)


def test_row_replaced_reads_whether_there_is_a_new_doc_id_from_the_value(session) -> None:
    """`row_replaced` 절의 "다시 판단할 새 doc_id 가 없다"는 **경위 이름이 아니라 값**에서 나온다.

    **뮤테이션 N4·N4b 를 죽이는 테스트다.**
      · N4  `if not any(d["new_doc_id"] for d in lost):` → **항상** 붙인다
      · N4b 같은 자리 → **절대** 붙이지 않는다
    둘 다 개정 2 코드에서 726건 전부 초록이었다. 대장 적재는 `row_replaced` 에 언제나
    `new_doc_id=None` 을 싣기 때문에(`services/ingest/persistence`) API 경로로는 반대쪽 입력을 만들 수
    없고, 그래서 "값에서 읽는다"는 성질 자체가 어떤 테스트에도 걸리지 않았다.

    ADR 0009 §5-2 (바-2)가 이 자리를 명시적으로 결정했다: "코드는 이 문장을 **값에서** 읽는다 — 경위
    이름으로 단정하지 않는다". 용어집도 같은 근거를 쓴다: "`new_doc_id=null` 은 '모른다'가 아니라
    '없다'는 **사실**". 생산자가 언젠가 `new_doc_id` 를 싣기 시작하면 이름으로 단정하는 구현은 **문구만
    거짓으로** 남는다 — 이 저장소가 반복해 온 "조용히 죽는" 실패 그대로다.

    **문면은 고정하지 않는다**(CLAUDE.md §6-4 규칙 3). 거는 것은 둘뿐이다: ① 값이 갈리면 제목도 갈린다
    ② `new_doc_id` 가 **있는데** "없다"고 적지 않는다. ①은 양방향(N4·N4b)을 함께 죽이고, ②는 ①만으로는
    통과할 수 있는 "값에 따라 아무 말이나 다르게 적는" 구현을 막는다.
    """
    without = _title_for(session, _replaced(new_doc_id=None))
    with_new = _title_for(session, _replaced(new_doc_id="doc-v1-0123456789abcdef"))

    assert without != with_new, without          # 값이 갈리는데 제목이 같다 = 값을 읽지 않는다
    # 표지는 이 문장 **전체**여야 한다. 부분열 "없습니다" 로 걸면 ADR §5-3-b 가 새로 만든 갈래 2
    # 문장("…가릴 수 없습니다")에 걸려, 이 자리와 무관한 문면 변경이 이 테스트를 깨뜨린다.
    _NO_NEW_DOC_ID = "다시 판단할 새 doc_id 는 없습니다"
    assert _NO_NEW_DOC_ID in without, without          # 정말 없을 때는 없다고 말한다
    assert _NO_NEW_DOC_ID not in with_new, with_new    # 있을 때 "없다"는 이 자리에서 참일 수 없는 말이다


def test_causes_are_written_in_the_dangerous_order(session) -> None:
    """경위가 섞이면 **위험한 순서**로 세운다: `row_replaced` → `row_absorbed` → `row_moved`.

    **뮤테이션 N5(`_CAUSE_ORDER` 역순)를 죽이는 테스트다.** 같은 뮤테이션을 화면에 넣으면 vitest 2건이
    죽는데(`identityDrift.test.ts`, `ReviewsPage.test.tsx`) **서버만 비어 있었다** — 통합 회귀
    (`test_v7_mixed_causes_…`)는 두 절이 "또한"으로 나란한지만 보고 순서를 보지 않았다.

    순서가 왜 계약인가: `row_replaced` 가 맨 앞인 이유는 ADR 0009 §3 이 **스스로 최악이라고 적은**
    경로("미승인 도면 위에서 착수 가능을 띄운다")가 이것뿐이기 때문이다. 나머지 둘은 근거가 사라져
    점수가 내려가는 보수적 실패다. 그리고 CM 이 큐 목록에서 **먼저 읽는 것은 제목**이므로, 순서가
    뒤집히면 가장 위험한 사실이 한 줄 뒤로 밀린다.

    표지는 각 절에서만 참인 **값**으로 고른다(문장을 베끼지 않는다): `발신`은 `row_replaced` 의
    `changed_fields` 라벨, `다른 문서`는 `row_absorbed` 가 새 위치를 가리키는 말, `옮겼습니다`는
    `row_moved` 뿐이다. 세 경위를 모두 세우는 이유는 §6-2 규칙 3 이다 — 둘만 두면 반대로 세우는
    구현이 나머지 한 축에서 그대로 통과한다.
    """
    title = _title_for_many(session, [
        _lost(doc_id="doc-v1-aaaaaaaaaaaaaaa1", cause="row_moved",
              new_doc_id="doc-v1-bbbbbbbbbbbbbbb1"),
        _lost(doc_id="doc-v1-aaaaaaaaaaaaaaa2", cause="row_absorbed",
              new_doc_id="doc-v1-bbbbbbbbbbbbbbb2"),
        _replaced(doc_id="doc-v1-aaaaaaaaaaaaaaa3"),
    ], moved=[{"previous_doc_id": "doc-v1-aaaaaaaaaaaaaaa1",
               "new_doc_id": "doc-v1-bbbbbbbbbbbbbbb1", "title": "1F 기둥 배근도 승인요청"}])

    for marker in ("발신", "다른 문서", "옮겼습니다"):
        assert title.count(marker) == 1, (marker, title)   # 표지가 절을 유일하게 가리킨다
    assert title.index("발신") < title.index("다른 문서") < title.index("옮겼습니다"), title
    assert title.count("또한") == 2, title                  # 세 절이 합쳐지지 않고 나란히 적힌다
