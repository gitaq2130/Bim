"""검토요청 — 자동 확정을 막고 CM 확인을 요구한다."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Final, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .evidence import Evidence

# document_mapping: 미확정 문서 매핑(ADR 0007 §4 규칙 5). 기존 mapping 을 재사용하지 않는 이유는
# services/sync 의 해소 로직이 drawing_id/entity_handle 을 기대하기 때문이다 — 해소는 services/progress 가 소유.
#
# document_identity_drift: 대장 원문은 그대로인데 우리 쪽 식별 규칙(sender_aliases·sheet_doc_types·
# column_aliases 등 ADR 0009 §5-1 의 식별 표면, 그리고 워크북 시트명처럼 config 밖 입력)이 바뀌어
# 문서의 정체성이 흔들렸고, 그 결과 CM 이 이미 확정·반려한 판단이 오염된 사건을 알리는
# **확인(acknowledgement) 전용** 요청이다.
#
# 오염 경위는 셋이고(`conflicting_sources.lost_decisions[].cause`, ADR 0009 §5-2 (마)) 사람이 해야 할
# 일이 서로 다르다:
#   `row_moved`      — 대장 행은 그대로인데 우리 식별 규칙이 그 행을 **다른 doc_id 로 옮겼다**.
#                      `new_doc_id` 위에서 같은 판단을 다시 내린다. **고아라고 적지 않는다**: 옛 행이
#                      고아가 되는지는 이 경위가 답하지 않는다(시트명 변경 경로는 안 된다 — 실측
#                      `moved=8` 인데 `is_orphaned=False`).
#   `row_replaced`   — **행도 reviewed_by 도 살아 있고 고아 표시조차 없는데** 그 doc_id 가 담고 있던
#                      **대장 행**이 바뀌었다. 승인 상태가 뒤집힐 수 있고 다시 판단할 새 doc_id 가
#                      **없다**(`new_doc_id=null` — "모른다"가 아니라 그 사실이다). 가장 위험한 경위.
#   `row_absorbed`   — 판단이 가리키던 대장 행이 **다른 doc_id 아래로 갔다**. `new_doc_id` 위에서 다시 판단.
# 한 doc_id 는 한 경위에만 속하지만 **한 적재는 여러 경위를 만든다**(ADR 0009 §5-2 (마)).
#
# **"고아가 된 매핑"으로만 서술하면 나머지 두 경위가 서술 밖으로 나간다** — 초판이 그렇게 적었고,
# 그 좁은 서술이 그대로 구현돼 그 경로가 CM 큐에 닿지 못했다(ADR 0009 §5-4).
# 경위 **이름**도 마찬가지다: 개정 2 이전 이름 셋(`orphaned`/`merge_overwritten`/`merge_absorbed`)은
# 관측과 어긋나 있었고(고아가 아닌 경로를 고아라 하고, `merged=0` 인 주 경로를 병합이라 했다),
# 이름이 거짓이면 그 이름으로 갈린 문구·라벨도 함께 거짓이 된다(ADR 0009 §5-2 (마) 개명 표·§5-5).
# 위 세 문자열의 **정본은 이 파일 아래의 `IDENTITY_DRIFT_CAUSES`** 다 — ADR 0009 §Deferred 5 가
# "값을 `packages/core/models/` 로 올려 한 곳에서 정의한다"로 정한 자리이고, 이 문단은 그 정의에 붙은
# 설명이지 별도의 정본이 아니다.
#
# 해소에 부수 효과가 없다 — `services/api/usecases.resolve_review` 의 공통 폴백이 status/note 만 기록한다
# (document_mapping 처럼 매핑 행을 건드리는 분기를 추가하지 않는다). 사람이 "봤다"고 닫는 것이 목적이고,
# 무엇을 할지(식별 표면 config 되돌리기 / 대장 파일 쪽 입력 확인 / 스킴 마이그레이션)는 요청 본문이
# 안내한다 — 어느 쪽인지는 지문이 답한다(ADR 0009 §5-2 서두: 지문은 판정 조건이 아니라 그 하나를
# 답하는 보고 값이다).
ReviewKind = Literal["mapping", "verification", "inspection", "document_mapping", "document_identity_drift"]
ReviewStatus = Literal["open", "approved", "rejected", "on_hold"]

# ── `document_identity_drift` 의 오염 경위(`conflicting_sources.lost_decisions[].cause`) 정본 ──────────
# ADR 0009 §Deferred 5. 위 머리말이 각 값이 무엇을 뜻하는지, 그리고 개정 2 가 왜 이름을 바꿨는지 적는다.
#
# **이 정의가 닫는 것과 닫지 못하는 것.** 파이썬 생산자(`services/ingest/persistence`)와 소비자
# (`services/progress/document_mapper`)가 이 이름을 import 하므로 파이썬 안의 불일치는 mypy 와 pytest 가
# 잡는다. 파이썬 밖의 선언(`apps/web/src` 의 타입·표·화면 분기와 `config/document_register.yaml` 의
# 경고 문구)은 같은 문자열을 따로 적고 **TS 는 파이썬 상수를 import 할 수 없다** — 그 경계를 넘는
# 불일치를 이 정의는 잡지 못한다.
#
# **그 자리들을 여기 열거하지 않는다.** 열거는 `tests/invariants/test_identity_drift_cause_contract.py`
# 가 이 정본을 import 해 기계로 하고, `apps/web/src` 전수를 **두 축으로** 훑는다. 두 축은 서로의 한계를
# 메우므로 둘 다 남는다 — 축마다 무엇이 밖인지가 곧 그 축의 정의다:
#   · **비교 자리 목록** — `cause` 와 문자열 리터럴이 한 줄에서 **등호로 마주 보는 모양** 하나만 본다.
#     그 모양 밖으로 값을 소비하는 새 화면은 이 칸에서 **이름조차 불리지 않는다**. 대신 얻는 것이 조기
#     경보다: 그 모양으로 정본 **안** 값만 쓰는 새 화면도 개명이 일어나기 **전에** 이름으로 부른다.
#   · **값 토큰 == 정본** — 모양을 묻지 않고 비테스트 웹 소스의 `row_` 토큰을 정본과 등호로 비교한다.
#     모양 축 밖의 소비도 여기서 죽지만, `row_` 로 시작하지 않는 새 이름은 이 축 밖이다.
# ADR 0009 §Deferred 5 개정 3 이 두 축이 잡는 것과 놓치는 것을 실행값과 함께 적는다(가장 큰 구멍: 값
# 집합만 비교하므로 두 이름을 서로 맞바꾸는 개명은 두 축을 모두 통과한다).
#
# 그 감사 밖에는 이 경계를 보는 검사가 **없다**. 이 단정이 기대는 것은 실패 **개수**가 아니라 감사 밖의
# **부재**이므로 개수를 적지 않는다(CLAUDE.md §6-1) — 그 자리에서 도는 재현 명령만 적고 값은 태워서 읽는다:
#   · 파이썬 전 계층만 개명하고(`packages/core/models/review.py` + `tests/integration/`·`tests/unit/` 의
#     그 값을 적은 테스트) TS·config 를 두면 — `.venv/bin/pytest -q --ignore=tests/invariants/`
#     `test_identity_drift_cause_contract.py` 실패 **0**, `(cd apps/web && npx vitest run)` 실패 **0**,
#     실패는 **전부 그 감사 파일 안**이다. 그 제품에서는 서버가 보낸 값을 `classifyIdentityDriftCause` 가
#     `SERVER_CAUSE_TO_LOCAL` 에서 찾지 못해 모든 항목이 `"unspecified"`("경위 미상")로 떨어진다
#     — 예외 없음·테스트 통과·화면 정상.
#   · 별칭 하나를 정본에서 떼어 같은 값 리터럴로 재선언하면(`_CAUSE_ROW_ABSORBED = "row_absorbed"`)
#     감사 밖 실패 **0** 이고, 감사가 그 재선언을 잡는다.
IDENTITY_DRIFT_CAUSE_ROW_MOVED: Final = "row_moved"
IDENTITY_DRIFT_CAUSE_ROW_REPLACED: Final = "row_replaced"
IDENTITY_DRIFT_CAUSE_ROW_ABSORBED: Final = "row_absorbed"
# `unspecified` 는 이 집합에 **들어가지 않는다.** 생산자가 실어 보낼 수 있는 값이 되면 "모른다"가 값이
# 되고, 그것은 소비자가 모르는 값을 가장 흔한 경위로 떨어뜨리지 않기 위해 만든 자리표시자를 무의미하게
# 만든다(`services/progress/document_mapper._CAUSE_UNSPECIFIED` 주석과 `identityDrift.ts` 의
# `classifyIdentityDriftCause` 가 같은 규칙을 적는다).
IDENTITY_DRIFT_CAUSES: Final[tuple[str, ...]] = (
    IDENTITY_DRIFT_CAUSE_ROW_MOVED,
    IDENTITY_DRIFT_CAUSE_ROW_REPLACED,
    IDENTITY_DRIFT_CAUSE_ROW_ABSORBED,
)
IDENTITY_DRIFT_CAUSE_UNSPECIFIED: Final = "unspecified"   # 소비 전용 자리표시자 — 생산자는 쓰지 않는다

# 저장된 과거 기록을 읽는 자리에는 이 Literal 을 쓰지 않는다. `lost_decisions[]` 는 이미 저장된 값을
# 그대로 싣고 오고(옛 이름 `orphaned`·`merge_overwritten`·`merge_absorbed` 를 포함), 좁은 타입은 그런
# 항목을 pydantic 검증에서 통째로 튕겨 적재 job 을 실패시키거나 사건을 삼킨다. 그래서
# `services/progress/document_mapper.LostDecision` 의 `cause` 는 `str` 이다(실측 2026-09-05:
# `typing.get_type_hints(LostDecision)["cause"]` → `<class 'str'>`) — 이 Literal 은 **생산 시점 계약**을
# 적는 데에만 쓴다.
IdentityDriftCause = Literal["row_moved", "row_replaced", "row_absorbed"]


class ReviewRejectionReasonRequiredError(Exception):
    """불변식 4(ADR 0012): 검토요청을 `rejected` 로 닫으려면 비어 있지 않은 사유가 필요하다.

    **`InvalidTransitionError` 를 상속하지 않는다 — `Exception` 직속이다.**
    `services/api/usecases.py::resolve_review` 의 inspection 분기는 `except InvalidTransitionError` 로
    받고 `decision == "rejected"` 이면 그 예외를 `log.info` 로 흘려보낸다. ADR 0012 규칙 2 가 이 예외의
    raise 자리로 지정한 `services/progress/state_machine.py::close_inspection_reviews` 는 그 분기
    안쪽에 있으므로, 하위 타입이면 방어가 그 `log.info` 안에서 사라진다. 실측(2026-09-05, 작업 트리
    HEAD `9989288`, 임시 탐침이 `transition_with_effects` 를 갈아 끼워 각각을 던지게 했다):
    하위 타입 → **200 · 응답에 `code` 없음 · 요청은 `rejected` 로 닫힘**, `Exception` 직속 → 전파.
    ADR 0011 §Decision 규칙 1-a 표 3행이 그 사실을 조건 ③ 으로 싣는다.

    **이 타입이 기대는 부재.** 둘 다 **부재가 시제 표현의 변장인지 먼저 확인하고** 적는다(§6-1) —
    ADR 0012 와 계획 0005 가 적은 핸들러는 이 타입 **전용** 하나뿐이고, 넓은 `except` 나 상위 핸들러를
    두는 항목은 두 문서 어디에도 없다.
    ① `services/api/usecases.py`·`services/api/routers/review_requests.py`·
       `services/progress/state_machine.py` 에 `except Exception`·bare `except` 가 **없다**
       (`grep -n "except Exception\\|except BaseException\\|except:"` → 히트 0). 넓은 `except` 가
       그 경로에 생기면 상속을 끊어 둔 것이 무의미해진다.
    ② `Exception` 자체(또는 이 타입의 상위)를 받는 핸들러가 **없다**
       (`grep -rn "exception_handler(Exception\\|exception_handler(BaseException" --include=*.py .`
       → 히트 0). 상속으로 얻는 HTTP 폴백이 없다는 것이 `Exception` 직속의 값이자 대가다 —
       이 예외를 409 `rejection_reason_required` 로 내보내는 일은 전용 핸들러가 한다(ADR 0012 규칙 4).
       *여기 있던 등록 핸들러 열거를 지웠다.* 그 목록은 이 문장이 기대는 **부재**가 아니라 **현황**
       이라 핸들러가 하나 늘 때마다 조용히 거짓이 되고, 실제로 이 타입 전용 핸들러가 빠진 채 커밋됐다
       — 열거는 길이가 곧 개수이므로 §6-1 의 "세지 않는다"에 그대로 걸린다. **지워서 잃는 것**:
       독자가 "무엇이 전용 핸들러를 갖는가"를 이 주석만 읽고 알던 일. 그 답은 위 grep 의 자매 명령
       `grep -n "@app.exception_handler" services/api/errors.py` 가 그 자리에서 돌려주므로, 잃는 것은
       답이 아니라 **한 번의 실행**이다.

    부가 필드는 `review_kind` 와 `review_request_ids` 다. 응답이 그 둘만 싣는 이유는 raise 자리들의
    공통 분모가 그것뿐이기 때문이다 — 큐 경로에는 전이가 없어 `from_state`/`to_state`/`actor` 가
    존재하지 않는다(ADR 0012 규칙 4).
    """

    def __init__(self, review_kind: str, review_request_ids: list[str], source: str) -> None:
        self.review_kind = review_kind
        self.review_request_ids = list(review_request_ids)
        self.source = source   # "resolve_review" | "state_transition" — 어느 문으로 들어왔는지(로그·테스트용)
        ids = ", ".join(self.review_request_ids) or "(none)"
        super().__init__(f"rejecting review request {ids} (kind={review_kind}) requires a non-empty reason")


def rejection_reason_missing(note: str | None) -> bool:
    """`None`·`""`·공백만이면 True — 즉 "사유가 없다".

    판정을 `packages/core/models/` 에 두는 이유는 `rejected` 를 쓰는 자리의 **소유가 서로 다르기**
    때문이다: `services/progress/state_machine.py`(progress-engine) · `services/api/usecases.py`(api) ·
    `services/sync/review_queue.py`(sync-2d3d). 공통 상위는 `packages/core` 뿐이라, 서비스 층에 두면
    같은 판정이 소유마다 복제된다.

    `.strip()` 을 쓰는 이유는 공백만인 사유가 실제로 저장되기 때문이다 — 실측(2026-09-05, 작업 트리
    HEAD `9989288`): `POST /api/review-requests/{id}/resolve {"decision":"on_hold","note":"   "}` →
    200 이고 `resolution_note` 에 `"   "` 가 그대로 남는다. 화면은 `ConfirmDialog.tsx:44` 의
    `!note.trim()` 으로 잠그지만 API 직접 호출에는 그 방어가 없다.
    """
    return not (note or "").strip()


class ReviewRequest(BaseModel):
    review_request_id: UUID = Field(default_factory=uuid4)
    project_id: str
    kind: ReviewKind
    global_id: str | None = None
    activity_id: str | None = None
    rule_id: str | None = None
    title: str
    conflicting_sources: dict[str, Any] = Field(default_factory=dict)   # {"daily_report": ..., "scan": ..., "system_logic": ...}
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    assignee_role: Literal["cm"] = "cm"   # ADR 0001 §4-1: 검토요청 처리는 cm만
    status: ReviewStatus = "open"
    resolution_note: str | None = None
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
