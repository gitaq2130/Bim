# ADR 0012 — 검토요청을 `rejected` 로 닫으려면 사유가 필요하다

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-05
- 관련: **ADR 0011 §Deferred 2**(이 ADR 이 그 항목을 닫는다), ADR 0011 §Decision 규칙 1-a·1-b(같은
  모양의 결함을 전이 경로에서 다뤘다), ADR 0007 §4-2 규칙 6(문서 매핑 반려는 영구), ADR 0001 §4-1
  (검토요청 처리는 `cm`), CLAUDE.md §3 규칙 11(검토요청 해소 소유)·§6-2·§6-3·§6-4,
  `docs/plans/0005-review-rejection-reason-and-cause-single-source.md` §과제 1
- **다른 ADR 을 갱신한다**: ADR 0011 §Decision 규칙 1-a 표 3행 아래의 "이 칸이 거짓이 되는 조건"에
  **③ 을 덧붙인다**(append — ①② 문장과 그 표는 그대로 둔다).
- 대체하지 않음: ADR 0001 의 상태·전이 표, ADR 0011 의 불변식 3. 전이 **집합**은 바뀌지 않는다.

---

## Context

### 0. 이 ADR 의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, HEAD `9989288`, 트리 깨끗. 전량 기준선:

```
$ cd /home/user/Bim/buildtwin && .venv/bin/pytest -q      (필터 없이 tail)
738 passed, 1 warning in 74.91s (0:01:14)
```

아래 실측은 `tests/integration/` 에 **임시 탐침 파일**을 두고 세션 픽스처(`client`/`auth`/`project`/
`ifc_job`/`dxf_job`)로 TestClient 를 태운 뒤 파일을 지웠다. 저장소 루트 `git status --porcelain` 은
탐침 전후 모두 **빈 출력**이다(원복 확인).

> `docs/plans/0005-*.md` 의 "726"은 `git archive` 로 뜬 **탐침 트리**의 값이다(생성 픽스처
> `tests/fixtures/sample.ply` 가 아카이브에 들어오지 않아 12건이 빠진다). **이 ADR 의 수치는 전부
> 작업 트리(738 기준선)의 값**이고, 두 트리의 값을 섞지 않는다.

**이 문서의 모든 `파일:줄` 참조는 위 HEAD `9989288` 트리의 것이다** — HEAD 가 움직여도 갱신하지 않는다
(`.claude/agents/architect.md` §핵심 설계 원칙 7). 갱신하면 이 ADR 이 보고하는 실측과 인용 트리가
어긋나고, 기록물이 사람이 유지하는 열거가 된다. 뒤에 **명시적으로 다른 커밋을 적은 실측**(§한정어
역방향 확인 표의 절제 실측)만 예외이고, 그 자리에 커밋을 적어 둔다.

### 1. 화면만 요구하고 서버는 받아 준다 (ADR 0011 §Deferred 2)

화면은 **다섯 kind 전부**에서 반려에 사유를 요구한다 — `kind` 를 보지 않는다.

```
apps/web/src/pages/ReviewsPage.tsx:177    requireNote={pending?.decision === "rejected"}
```

서버는 받아 준다. 작업 트리 실측(HEAD, 가드 없음):

| # | 요청 | HTTP | 요청 status | `resolution_note` |
|---|---|---|---|---|
| 1 | 큐 `inspection` × `rejected` × note 미전송 | **200** | `rejected` | `INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-dc39d3db); transition_id=9903c09c-…` |
| 2 | 큐 `inspection` × `rejected` × `note="   "` | **200** | `rejected` | `INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-dc39d3db); transition_id=48c2f404-…` |
| 3 | 큐 `inspection` × `approved` × note 미전송 | 200 | `approved` | `INSPECTION_REQUESTED -> CONFIRMED by cm (u-cm-dc39d3db); transition_id=e5ce6faf-…` |
| 4 | 큐 `inspection` × `on_hold` × `note="   "` | 200 | `on_hold` | `"   "`(공백 세 칸이 그대로 저장된다) |
| 5 | 큐 `mapping` × `rejected` × note 미전송 | **200** | `rejected` | **`null`** |

**감사 이력에 "왜 반려했는가"가 존재하지 않는다.** 예외 없음, 테스트 전원 통과, 화면 정상 —
이 저장소의 지배적 실패 모드 그대로다(ADR 0011 §2 와 같은 모양, 다른 경로).

### 2. 문이 둘이다 — 두 번째 문은 큐가 아니다

`rejected` 를 실제로 쓰는 자리는 셋이고 소유가 셋 다 다르다.

| 자리 | 쓰는 값 | 소유 | 어느 문 뒤인가 |
|---|---|---|---|
| `services/progress/state_machine.py:136` (`close_inspection_reviews`) | `INSPECTION_DECISIONS[to_state]` → `approved`\|`rejected` | progress-engine | **두 문 모두** |
| `services/api/usecases.py:507` (`resolve_review` 공통 폴백) | `decision` | api | 문 A(큐) |
| `services/sync/review_queue.py:153` (`resolve_mapping_reviews(… "rejected" …)`) | `"rejected"` | sync-2d3d | 문 A(큐) — 호출자는 `resolve_mapping_review`(`review_queue.py:123-153`) 하나이고 그 호출자는 `usecases.py:468` 하나 |

`close_inspection_reviews` 에 닿는 **CM actor 경로 전수**(`grep -rn "transition_with_effects"
--include=*.py services packages`, 그리고 `state_machine.py:190` 이 그 안에서 부른다):

- `services/api/usecases.py:215` — `transition_object` (**문 B**: `POST /api/objects/{gid}/transitions`)
- `services/api/usecases.py:440` — `resolve_review` 의 inspection 분기 (**문 A**)
- `services/progress/state_machine.py:275` — 작업일보 경로. `Actor.CONTRACTOR` 라 `close_inspection_reviews`
  의 첫 줄(`transition.actor != Actor.CM` → `return []`)에서 되돌아간다.
- `state_machine.py:198`(`transition` 래퍼)의 유일한 호출자는 `state_machine.py:211`, `Actor.SYSTEM`.

**문 B 실측**(작업 트리, HEAD):

| 전이 | note | HTTP | 요청 status | `resolution_note` |
|---|---|---|---|---|
| `INSPECTION_REQUESTED → IN_PROGRESS`(cm) | 미전송 | **201** | `rejected` | `INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-dc39d3db); transition_id=3c611d32-…` |
| `INSPECTION_REQUESTED → MISMATCH`(cm) | 미전송 | **201** | `rejected` | `INSPECTION_REQUESTED -> MISMATCH by cm (u-cm-dc39d3db); transition_id=8a7a47bc-…` |
| `MISMATCH → IN_PROGRESS`(cm, 미결 inspection **없음**) | 미전송 | 201 | — (닫히는 요청 없음) | — |

> **3행은 두 축 어느 쪽도 보이지 않는다.** `accept_rework` 는 `close_inspection_reviews` 첫 줄의
> `from_state != INSPECTION_REQUESTED` 에서 먼저 돌아가므로 "미결 inspection 이 있을 때" 한정어는
> **평가조차 되지 않고**, 그렇다고 `from_state` 축을 보는 것도 아니다 — 이 전제는 미결 inspection 이
> 0건이라 그 조건을 지워도 값이 201 그대로다(절제 실측은 §한정어 역방향 확인 표).

화면에도 그 문이 있다. 같은 실측의 `next_actions`(`INSPECTION_REQUESTED` / cm):

```
[("confirm","CONFIRMED"), ("reject_inspection","IN_PROGRESS"),
 ("flag_mismatch","MISMATCH"), ("resolve_review", null)]
```

그리고 객체 패널은 그 둘에 `requireNote` 를 넘기지 않는다:

```
apps/web/src/components/ObjectDetailPanel.tsx:304
const REVOCATION_KINDS: ReadonlySet<NextActionKind> = new Set(["revoke_confirmation", "order_rework"]);
```

**같은 행위(검측 검토요청을 반려한다)에 문이 둘이고, 화면 방어는 큐 쪽 하나에만 있고, 서버 방어는
어느 쪽에도 없다.** 문 A 만 고치면 문 B 는 그대로 열려 있다 — ADR 0007 §4-2 가 배운
"방어를 한쪽에만 거는 비대칭을 남기지 않는다"가 여기 그대로 걸린다.

### 3. ADR 0011 의 `StateTransition._check` 에 해당하는 병목이 **없다**

ADR 0011 은 `StateTransition` 이 모든 전이 생성 경로가 반드시 지나는 모델 생성 지점이라는 사실 위에
불변식을 얹었다. 검토요청에는 그런 자리가 없다.

- `ReviewRequest`(pydantic) 는 **생성 시점에만** 만들어지고(`db.save_review_request`), 이후 상태 변경은
  전부 ORM 행 직접 변이다(§2 표). 모델 검증자는 반려를 **한 번도 보지 못한다.**
- 읽기 쪽(`db.review_row_to_model`)에 검증자를 걸면 **저장된 과거 기록을 읽을 수 없게 된다.**
  실측 §1 표 5행: `status="rejected"` + `resolution_note=null` 인 행이 현행 코드에서 실제로 만들어진다.
  읽기 검증자는 그 행을 500 으로 만든다. **기각.**

**그래서 병목을 만든다 — 술어 하나 + 호출 자리 둘.**

### 4. 왜 문구를 사실에 맞추는 쪽이 아니라 동작을 바꾸는 쪽인가

반려는 CM 의 판단이고, 그중 `document_mapping` 반려는 **영구**다 — 매핑 후보가 다음 대장 재업로드에서
다시 만들어지지 않도록 표시를 남긴다(ADR 0007 §4-2 규칙 6, `services/api/usecases.py:478-504` 의
`reject_document_mapping` 분기). 되돌리는 경로가 없는 결정의 근거가 **어디에도 없는** 상태를
"화면 문구를 지운다"로 닫으면, CLAUDE.md §0("확정은 사람의 승인 액션")이 요구하는 감사 가능성을
반려 쪽에서만 포기하는 셈이 된다.

---

## Decision

### 불변식 4 — 검토요청을 `rejected` 로 닫는 경로는 비어 있지 않은 사유 없이 성립하지 않는다

`decision`(문 A) 또는 `transition.evidence.note`(문 B)가 `None`·`""`·공백만이면 거부한다.
**판정과 예외의 정의는 `packages/core/models/review.py` 하나**다.

```python
# packages/core/models/review.py  (architect 소유)
class ReviewRejectionReasonRequiredError(Exception): ...
def rejection_reason_missing(note: str | None) -> bool:
    return not (note or "").strip()
```

**왜 `packages/core/models/` 인가.** §2 표대로 `rejected` 를 쓰는 세 자리의 소유가
progress-engine·api·sync-2d3d 로 전부 다르다. 셋의 공통 상위는 `packages/core` 뿐이고, 서비스 층에
두면 같은 판정이 세 벌 복제된다.

### 규칙 1 — 자리 A: `services/api/usecases.py::resolve_review` 의 **프롤로그**

```python
    if row.status != "open":
        raise Conflict(..., code="review_already_resolved")          # ← 기존
    if decision == "rejected" and rejection_reason_missing(note):     # ← 추가
        raise ReviewRejectionReasonRequiredError(row.kind, [review_request_id], "resolve_review")
```

이 함수의 호출자는 **하나**다 — `services/api/routers/review_requests.py:52`
(`grep -rn "resolve_review" --include=*.py .` 의 비테스트 히트 중 호출은 이 한 줄). 프롤로그는
5 kind × 3 decision 전부가 지나므로 큐 경로의 진짜 병목이다.

**순서가 계약이다 — 가드는 `review_already_resolved` 검사 *뒤*에 둔다.** 앞에 두면 이미 처리된
검토요청에 사유 없는 반려를 보냈을 때 `code` 가 `review_already_resolved` 에서
`rejection_reason_required` 로 바뀐다. 그 응답을 고정하고 있는 자리가 있다 — 코드 인용:

```
tests/integration/test_08_review_requests.py:127-129
    r2 = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve",
                     headers=auth("cm"), json={"decision": "rejected"})     # note 미전송
    assert r2.status_code == 409
    assert r2.json()["code"] == "review_already_resolved"
```

요청이 낡은 것과 사유가 빠진 것은 CM 이 할 일이 다르다(새로고침 ↔ 사유 작성). 낡은 요청이 먼저다.

### 규칙 2 — 자리 B: `services/progress/state_machine.py::close_inspection_reviews`

```python
    open_rv = db.open_reviews(session, project_id, [global_id], kind="inspection")
    if status == "rejected" and open_rv and rejection_reason_missing(transition.evidence.note):
        raise ReviewRejectionReasonRequiredError(
            "inspection", [r.review_request_id for r in open_rv], "state_transition")
```

**왜 모델 검증자(`StateTransition._check`)가 아닌가.** 그 검증자는 `session` 을 갖지 않아 "미결
inspection 이 있는가"를 물을 수 없다(`packages/core/models/state.py:174` `def _check(self) -> StateTransition:` — 인자가
`self` 뿐이다). 그 사실을 아는 유일한 자리가 `close_inspection_reviews(session, project_id,
global_id, transition)` 다.

**조건에 `미결 inspection 이 있을 때` 를 넣는다.** 이 한정어가 실제로 가르는 것은
**`from_state == INSPECTION_REQUESTED` 인데 미결 inspection 이 0건인 전이**다 — 큐에서 그 요청을
`on_hold` 로 닫은 뒤의 `reject_inspection` 이 그 상태를 실제로 만든다. 닫는 것이 없으면 사유를 요구할
근거가 없다. **`accept_rework`(`MISMATCH → IN_PROGRESS`)는 이 한정어가 거르는 것이 아니다** — 위
`from_state` 검사에서 먼저 돌아간다. 절제 실측은 §한정어 역방향 확인 표에 있다.

### 규칙 3 — 예외는 `Exception` 직속이다. `InvalidTransitionError` 를 **상속하지 않는다**

`resolve_review` 의 inspection 분기는 `except InvalidTransitionError` 로 받고 `decision == "rejected"`
이면 `log.info` 로 흘려보낸다(`services/api/usecases.py:442-446`). 자리 B 의 예외는 그 분기를 지난다
(문 A 의 inspection 반려가 `transition_with_effects` → `close_inspection_reviews` 로 내려가므로).
**하위 타입이면 그 `log.info` 가 이 예외를 삼킨다.**

**실측**(작업 트리, HEAD, 임시 탐침 — `usecases.ObjectStateMachine.transition_with_effects` 를
monkeypatch 로 갈아 끼워 각각을 던지게 하고 `POST /api/review-requests/{id}/resolve
{"decision":"rejected"}` 를 태웠다):

```
[SUBTYPE] 200 rejected None        ← InvalidTransitionError 하위 타입: 삼켜지고 요청이 rejected 로 닫힌다.
                                     응답에 code 없음
[DIRECT]  propagated out of resolve_review (not swallowed)
                                   ← Exception 직속: resolve_review 밖으로 그대로 올라간다
```

그 경로에 넓은 `except` 는 없다 — 코드 인용(`grep -n "except Exception\|except BaseException\|except:"
services/api/usecases.py services/api/routers/review_requests.py services/progress/state_machine.py`
→ **히트 0, 종료코드 1**). 즉 `Exception` 직속이면 ASGI 예외 핸들러까지 그대로 간다.

`InvalidTransitionError` 를 상속하지 않으므로 `services/api/errors.py::_invalid_transition` 이
MRO 로 이 예외를 받지 않는다. **전용 핸들러가 없으면 500 + `code` 없음**이다 — ADR 0011 이
`ValueError` 를 기각한 것과 같은 이유이고, 그래서 규칙 4 의 핸들러가 이 불변식의 일부다.

### 규칙 4 — code 는 `rejection_reason_required`(409), 부가 필드는 `review_kind`·`review_request_ids` 둘뿐

**새 code 를 만든다.** 후보 셋을 그 code 의 **지금 화면 문구**를 읽고 갈랐다.

| 후보 | 그 code 의 지금 화면 문구(원문 인용) | 판단 |
|---|---|---|
| `revocation_reason_required` 재사용 | `ErrorBox.tsx:31` `"확정을 되돌리려면 사유를 입력해야 합니다. …"` | 기각. `mapping`·`verification`·`document_mapping`·`document_identity_drift` 반려는 "확정을 되돌리는" 일이 아니다 — 그 문장이 그 자리에서 거짓이다 |
| `invalid_transition` 재사용 | `ErrorBox.tsx:23` `"현재 상태에서는 이 작업을 수행할 수 없습니다. 화면을 새로고침해 최신 상태를 확인하세요."` | 기각. 두 절 다 거짓이고(전이·해소는 허용된다, 새로고침해도 달라지지 않는다), 문 A 의 네 kind 에는 전이가 아예 없다 |
| `ResolveRequest` 스키마 검증(422) | 없음 — FastAPI 422 는 glossary 부칙이 "이 계약 밖"으로 명시했고 본문에 `code` 가 없다 | 기각. 화면이 원인별 안내를 고를 수 없다 |
| **새 code `rejection_reason_required`(409)** | 새로 쓴다 | **채택** |

**상태코드 409.** ① glossary 서문의 호환 약속("신규 code 추가는 표에 행만 더하고 기존 프론트 분기를
깨지 않는다") — `code` 를 모르는 클라이언트에게는 여전히 409 + `detail` 이다. ② 요청 스키마 위반이
아니라 **대상의 현재 상태에 대한 요건**이다(문 B 에서는 "미결 inspection 이 있을 때"만 걸린다).

**부가 필드는 `review_kind`(문자열)와 `review_request_ids`(리스트) 둘뿐이다.** glossary 부칙
"응답 모양 일관성"은 "어느 경로로 발생하든 같은 부가 필드"를 요구하는데, 이 code 의 두 경로는
공통 분모가 다르다 — 문 A 의 네 kind 에는 `from_state`/`to_state`/`actor` 가 **존재하지 않는다**
(그 경로에는 전이가 없다). 그러므로 두 경로가 함께 실을 수 있는 것은 저 둘뿐이고, 그 둘만 싣는다.

*이 결정이 깨뜨리는 것.* 문 B 는 "전이가 거부됐는데 `from_state`/`to_state`/`actor` 가 없는" 첫
응답이 된다. **그 세 필드를 오류 응답에서 읽는 화면이 있는가 — 실측**:

```
$ grep -rn "from_state\|to_state" apps/web/src --include=*.ts --include=*.tsx | grep -v test
apps/web/src/components/ObjectDetailPanel.tsx:257,284,291,330,335,339,412,413   ← 전부 전이 이력·next_action 소비
apps/web/src/api/types.ts:142,143,620,648                                        ← 타입 선언
```

오류 경로는 `ObjectDetailPanel.tsx:347` `setMessage(errorText(e))` 하나이고 `errorText` 는 `code` 와
`detail` 만 읽는다. **그 세 필드를 오류 응답에서 읽는 화면은 0건이다.** 그래도 계약면 변경이므로
glossary "오류 응답 code 어휘" 표에 행을 더하고, 부가 필드가 `from_state` 계열이 **아닌 이유**를
부칙에 append 한다(계획 0005 작업 6).

응답 본문:

```jsonc
{ "detail": "rejecting review request <id> (kind=<kind>) requires a non-empty reason",
  "code": "rejection_reason_required",
  "review_kind": "inspection",
  "review_request_ids": ["<id>"] }
```

`detail` 이 부모 포맷을 쓰지 않는 이유는 ADR 0011 규칙 1-b 와 같다 — 이 예외는 `Exception` 직속이라
상속할 부모 포맷 자체가 없고, `"… not allowed."` 는 이 자리에서 거짓이다(반려는 허용된 행위이고
빠진 것은 사유뿐이다).

### 규칙 5 — 사용자에게 보이는 문구 둘을 같은 사이클에서 고친다 (CLAUDE.md §6-4 1)

**(가) CM 이 적은 사유가 큐 화면에 표시되지 않는다.** `inspection` 반려는 **두 문 모두**
`resolution_note` 를 `close_inspection_reviews`(`state_machine.py:144-145`)의 기계 문자열로 덮는다 —
§1 표 1·2행과 §2 표 1·2행이 같은 값을 보인다. 그런데 `ReviewsPage.tsx:157` 은 그 값을
`처리 메모: {r.resolution_note}` 로 보여준다. **사유를 필수로 만든 바로 다음 화면이 그 사유 대신
`transition_id=…` 를 보여주는 것**은 문구가 아니라 안전 장치의 고장이다(§6-4: 문구는 CM 이 다음
행동을 고르는 입력이다). `close_inspection_reviews` 가 `transition.evidence.note` 를 앞에 붙이고
기계 문자열은 뒤에 남긴다(둘 다 필요하다 — 사유는 사람용, 기계 문자열은 전이 추적용).

**(나) 객체 패널의 `reject_inspection`·`flag_mismatch` 다이얼로그.** 지금 문구는
`ObjectDetailPanel.tsx:413` 의 일반 문장(`'시공중' 상태로 전이를 요청합니다.`)뿐이라, 이 전이가
**검토요청을 반려로 닫는다**는 사실을 말하지 않는다. 가드가 서면 사유 칸도 필수가 되므로 문구가
그 사실을 말해야 한다.

**(다) `ErrorBox` 문구는 "새로고침"이라는 말을 쓰지 않는다.** 이 code 로 오는 실패에서 새로고침은
아무것도 바꾸지 않는다 — 다음 행동은 **사유를 적는 것** 하나다.
예: `"반려하려면 사유를 입력해야 합니다. 사유를 적은 뒤 다시 시도하세요."`

*문구 테스트(§6-4 3).* 문장을 통째로 베끼지 않는다. "그 상황에서 참일 수 없는 말이 없다"를
단언한다 — 이 code 의 안내에 **"새로고침"이 없고 "사유"가 있다**.

### 규칙 6 — ADR 0011 §Decision 규칙 1-a 표 3행에 **③ 을 더한다**

그 표 3행은 `resolve_review` 의 inspection 분기 `except` 가 `decision == "rejected"` 를 `log.info` 로
삼킨다고 적고, 그 아래에 "이 칸이 거짓이 되는 조건" ①②를 두었다. 규칙 3 의 실측이 **세 번째 조건**을
만든다: ③ **그 분기가 던지는 새 예외가 `InvalidTransitionError` 하위 타입이면.** ①②는 그 자리에
`RevocationReasonRequiredError` 가 **도달**하는 조건이고, ③ 은 도달 여부와 무관하게 **다른 예외가
그 침묵을 물려받는** 조건이다. ADR 0011 파일에 그 문장을 append 한다(기존 ①② 는 그대로 둔다).

---

## 한정어 역방향 확인 (CLAUDE.md §6-3 산출물 — 각 칸은 실행값 또는 코드 인용)

| 한정어 | 빼면 무엇이 더 들어오는가 | 이 단어 때문에 무엇이 빠지는가 | 근거 |
|---|---|---|---|
| `decision == "rejected"`(문 A) | `approved`·`on_hold` 까지 사유 필수 → CM 상시 업무가 막힌다 | 승인·보류의 사유 부재 | 실행값(HEAD, 작업 트리): `inspection/approved/note 미전송` → **200 `approved`**, `inspection/on_hold/note="   "` → **200 `on_hold`**. 코드 인용: `ReviewsPage.tsx:177` 도 그 둘에 `requireNote` 를 넘기지 않는다 |
| **(빠지는 것을 태웠다)** 승인에도 요구하면? | 검측 승인이 사유 없이는 불가 | — | 기각. ADR 0011 §Deferred 1 이 "CM 상시 업무를 바꾸는 결정이므로 실측 없이 정하지 않는다"로 미뤄 둔 항목이다. 그대로 Deferred(§Deferred 1) |
| kind 를 가르지 **않는다**(5 kind 전부) | — | kind 별 예외 | 코드 인용: `ReviewsPage.tsx:177` `requireNote={pending?.decision === "rejected"}` 는 kind 를 보지 않는다. 서버를 kind 로 가르면 화면·서버의 축이 어긋난다 |
| `not (note or "").strip()`(공백만 거부) | 없음 | 공백 한 칸이 사유로 통과하는 경우 | 실행값: `rejected` + `note="   "` → **200**, 그리고 `on_hold` + `note="   "` 는 `resolution_note` 에 `"   "` 가 **그대로 저장**된다(§1 표 2·4행). 화면은 `ConfirmDialog.tsx:44` 에서 `!note.trim()` 으로 잠그지만 API 직접 호출에는 그 방어가 없다 |
| 문 B 의 `미결 inspection 이 있을 때` | **`from_state == INSPECTION_REQUESTED` 인데 미결 inspection 이 0건**인 전이까지 사유 필수(큐에서 `on_hold` 로 닫은 객체의 `reject_inspection`) | 바로 그 전이 — 닫는 요청이 없으므로 사유를 요구할 근거가 없다 | **절제 실행값**(작업 트리 `404022d`, 가드에서 `and open_reviews` 만 뺀 트리와 나란히): 큐 `on_hold` 200 → 객체 `INSPECTION_REQUESTED` 유지·`has_open_review=false`·`open_review_ids=[]`, 이어 note 미전송 `reject_inspection` → **한정어 있음 201 / 뺌 409 `rejection_reason_required` + 객체 `INSPECTION_REQUESTED` 유지**. 그 요청의 최종 상태는 양쪽 다 `on_hold` 라 불변식은 서 있다 |
| **(이 한정어의 음성 대조군이 아니다)** `accept_rework` = `MISMATCH → IN_PROGRESS`, note 미전송 | — | — | 같은 절제 실행값에서 **양쪽 다 201**. 이 전이를 거르는 것은 이 한정어가 아니라 `close_inspection_reviews` 첫 줄의 `transition.from_state != ObjectState.INSPECTION_REQUESTED` 이고, 그래서 한정어는 평가조차 되지 않는다. **이 행은 `from_state` 조건도 지키지 않는다** — 이 전제가 앞선 CM 전이로 요청을 이미 닫아 미결 inspection 이 0건이라, 그 조건만 지운 트리에서도 201 그대로다(실측 2026-09-05, HEAD `41e5fe0`: 그 조건만 지운 트리 `.venv/bin/pytest -q` → **783 passed**, 실패 0). **`from_state` 축은 현재 어떤 테스트도 지키지 않는다.** 그 조건이 무보호로 지키고 있는 것 자체는 실재한다(탐침 실측 2026-09-05): `INSPECTION_REQUESTED` 에서 **system** 스캔 판정(`ScanState.MISMATCH` → `ObjectStateMachine.apply_scan_verdict`, 운영 진입점은 `services/api/jobs.py` 의 `verdict` 잡)으로 MISMATCH 에 내려오면 `close_inspection_reviews` 가 `actor != CM` 에서 돌아가 **미결 inspection 이 열린 채 MISMATCH** 가 된다(그 객체의 `open_reviews(kind="inspection")` **1건**). 그 상태에서 note 없는 `accept_rework` 는 **조건 있음 → 201·`closed=[]` / 조건 뺌 → `ReviewRejectionReasonRequiredError`** 다 |
| 문 B 를 `close_inspection_reviews` 에 둔다(`StateTransition._check` 가 아니라) | — | 모델 검증자로는 이 조건을 볼 수 없다 | 코드 인용: `packages/core/models/state.py` `def _check(self) -> StateTransition:` — 인자가 `self` 뿐이라 `session` 이 없다. `close_inspection_reviews(session, project_id, global_id, transition)`(`state_machine.py:132`)가 그 사실을 아는 유일한 자리다 |
| 예외를 `Exception` **직속**으로 둔다 | — | `InvalidTransitionError` 핸들러의 MRO 상속(409 + `invalid_transition`) | 실행값(monkeypatch 탐침): 하위 타입 → **200, `code` 없음**(삼켜짐) / `Exception` 직속 → **resolve_review 밖으로 전파**. 코드 인용: `usecases.py:442-446` `except InvalidTransitionError … log.info("inspection rejected but no rework transition: %s", exc)` |
| 가드를 `review_already_resolved` **뒤**에 둔다 | — | 낡은 요청에 사유 없는 반려를 보낸 경우가 새 code 로 바뀐다 | 코드 인용: `tests/integration/test_08_review_requests.py:127-129` 가 그 조합(`{"decision":"rejected"}`, note 미전송, 이미 `approved` 인 요청)에 `code == "review_already_resolved"` 를 고정한다 |
| 술어를 `packages/core/models/review.py` 에 둔다 | — | 서비스 층에 두면 세 소유가 각자 복제한다 | 코드 인용(§2 표): `rejected` 를 쓰는 세 자리가 `services/progress`·`services/api`·`services/sync` 로 소유가 전부 다르다 |

*같은 문서·인접 절과의 교차 확인(§6-3).* ADR 0011 §Decision 규칙 1-a 표 3행은 그 `log.info` 를
"도달 불가"로 적었다. 이 ADR 은 그 판정을 **뒤집지 않는다** — 거기서 도달 불가인 것은
`RevocationReasonRequiredError` 이고, 이 ADR 이 더하는 것은 **다른 예외가 같은 자리를 지난다**는
사실이다(규칙 6 의 ③). 두 문장은 같은 칸의 다른 축이고, 실측이 그것을 가른다(규칙 3).

---

## Consequences

- **좋아지는 것.** 반려된 검토요청에 반드시 이유가 남는다. `document_mapping` 반려는 되돌리는 경로가
  없고(ADR 0007 §4-2 규칙 6), `inspection` 반려는 재시공 지시와 같은 무게의 현장 지시다.
- **치러야 하는 값.** ① CM 이 반려할 때 한 칸을 더 채워야 한다(승인·보류는 그대로 — 실측 §1 표 3·4행).
  ② 사유 없이 검토요청을 반려로 닫는 **서버 내부 호출**이 앞으로 생기면
  `ReviewRejectionReasonRequiredError` 가 난다.
- **넣자마자 무보호다.** 이 불변식을 붙들어 주는 테스트가 저장소에 없다 — `{"decision": "rejected"}`
  를 note 없이 보내는 파이썬 테스트는 `test_08_review_requests.py:127` 한 줄뿐이고, 그것은 **이미
  처리된** 요청에 대한 409 를 고정하는 것이라 이 불변식을 태우지 않는다(위 표 마지막에서 두 번째 행).
  ADR 0011 §3 과 같은 자리이고, qa 작업이 계획 0005 의 일부인 이유다.
- **잡지 못하는 것.** 사유의 **내용**은 검사하지 않는다("."도 통과한다) — ADR 0011 과 같은 판단이다.
- **반려 자체는 계속 가능하다.** 이 ADR 은 반려를 어렵게 만들지 않는다. 다섯 kind 의 세 결정은 그대로다.

## Alternatives

1. **화면에서만 요구한다(`ObjectDetailPanel` 에도 `requireNote` 추가, 서버는 그대로).** 기각.
   그 방어는 API 를 직접 부르면 사라진다. ADR 0011 §Alternatives 2 가 이미 이 저장소의 선례로
   "검토요청 반려의 `requireNote` 는 화면에만 있다"를 들었는데, 그 선례가 바로 이 ADR 이 닫는 결함이다.
2. **읽기 검증자(`db.review_row_to_model`)로 막는다.** 기각. 저장된 과거 기록을 500 으로 만든다 —
   실측 §1 표 5행(`rejected` + `resolution_note=null`)이 현행 코드의 산물이다.
3. **`ResolveRequest`(pydantic)에서 422 로 막는다.** 부분 기각. 문 A 는 덮지만 **문 B 를 덮지 못하고**
   (그 경로는 `ResolveRequest` 를 지나지 않는다), 본문에 `code` 가 없어 화면이 원인별 안내를 고를 수 없다.
4. **자리 A 하나만 고친다.** 기각. 문 B 가 그대로 열려 있다(실측 §2 표 1·2행 — 201, 요청이 `rejected`
   로 닫힌다). 화면 방어가 큐 쪽에만 있는 지금의 비대칭을 서버에서 한 번 더 재현하는 셈이다.
5. **`transition_with_effects` 안에서 검사한다(`close_inspection_reviews` 가 아니라).** 기각.
   그 함수는 미결 inspection 목록을 만들지 않는다 — 조건이 기대는 사실(`open_reviews(… kind="inspection")`)을
   실제로 들고 있는 자리가 `close_inspection_reviews` 다.

## Deferred

1. **검토요청 *승인*의 사유 요건.** ADR 0011 §Deferred 1 을 그대로 이어받는다. 결정하려면 먼저 볼 것:
   검측 승인 1건당 CM 이 실제로 note 를 남기는 비율. 지금은 화면도 서버도 요구하지 않는다(실측 §1 표 3행).
2. **`on_hold` 에 공백만 note 를 보내면 `"   "` 가 그대로 저장된다**(실측 §1 표 4행). 이 ADR 은
   `rejected` 만 다룬다. 고치려면 폴백에서 `note.strip() or None` — 그때는 저장된 과거 기록에 이미
   공백 note 가 있다는 것을 함께 본다.
3. **`resolve_mapping_reviews` 의 다중 종료.** `mapping` 반려는 그 (도면, 핸들)의 열린 요청을 **전부**
   닫는다(`services/sync/review_queue.py:153`). 자리 A 는 요청 하나의 사유를 검사하지만 닫히는 것은
   여럿일 수 있고, 같은 사유가 전부에 붙는다 — 지금도 그렇고 이 ADR 이 바꾸지 않는다.
   한 핸들에 열린 mapping 요청이 둘 이상인 상황은 **실측하지 않았다.**

   ### append — 2026-09-06(계획 0006 §1-g / ADR 0013 사이클): 만들어 보려 했고 **못 만들었다**

   > 이 블록은 위 문장에 **실측만 더한다.** 이 ADR 의 불변식 4·규칙 1~6 은 바뀌지 않는다.
   > **항목은 닫지 않는다** — 닫지 않는 이유는 이 블록 끝에 있다.
   > 아래 `파일:줄`·수치는 전부 HEAD **`516949a`** 트리에서 잰 것이다(전량 기준선 `783 passed` /
   > vitest `268 passed`, 저장소 루트 `git status --porcelain` 은 탐침 전후 빈 출력).
   > 방법: `tests/integration/` 의 임시 탐침이 세션 픽스처(`project`/`dxf_job`)로 TestClient 를 태워
   > 큐 반려 1건 → 재정합 2회를 돌리고, 열린 `mapping` 요청을 **핸들별로** 셌다. 탐침은 지웠다.

   ```
   [D0-open-per-handle]                {'53': 1}
   [D1-reject]                         200 rejected
   [D1-mapping-served-after-reject]    [('0BcjbttMr12PUpme0A2uXY', True, None, None)]
                                       (global_id, needs_review, reviewed_by, mapping_review_decision)
   [D1-open-per-handle]                {}
   [D2-realign1]                       200  created=1  superseded=0
   [D2-open-per-handle]                {'53': 1}  max 1
   [D3-realign2]                       200  created=1  superseded=1
   [D3-open-per-handle]                {'53': 1}  max 1
   [D4-rows-per-handle]                [('3A', 1), ('3B', 1), ('3C', 1)]
   ```

   **왜 만들 수 없는가 — 코드 인용.** `kind="mapping"` 검토요청을 만드는 생산 코드는
   `services/sync/review_queue.py:25`(`review_request_for`, `kind="mapping"` 리터럴은 `:27`) 하나이고
   (`grep -rn 'kind="mapping"' --include=*.py .` 의 비테스트 히트 중 생성은 이 한 줄 —
   나머지는 `usecases.py:397` 의 `JobRow(kind="mapping")`, 즉 **잡**이지 검토요청이 아니다),
   그 유일한 호출자는 같은 파일 `:38`(`mappings_needing_review`)이며, 그것의 비테스트 호출자는 둘이다 —
   `services/sync/persistence.py:163`(`rebuild_mappings`)과 `services/sync/tasks.py:87`(결과에 개수만 싣고
   저장하지 않는다). `rebuild_mappings` 는 같은 호출 안에서 그 도면의 이전 open 요청을 전부 `on_hold` 로
   바꾸고(`services/sync/persistence.py:171-172` — `old.status = "on_hold"` · `resolution_note =
   f"superseded_by={…}"`), `build_mappings`(`services/sync/matcher.py:123`)는 엔티티 하나당
   `out.append`(`:169`)를 한 번만 한다.

   **그러나 스키마는 허용한다.** `EntityObjectMappingRow` 의 PK 는 `(drawing_id, entity_handle, global_id)`
   세 칸이다(`packages/core/models/orm.py:141-143`) — 한 핸들에 서로 다른 `global_id` 행이 여럿 저장될 수
   있다. **막고 있는 것은 스키마가 아니라 파이프라인이다.**

   **그래서 닫지 않는다.** ① 이 항목의 본체("닫히는 것은 여럿일 수 있고 같은 사유가 전부에 붙는다")는
   실측이 아니라 **코드가 그대로 하는 일**이고 이 사이클이 고치지 않았다. ② 닫는 근거가 될 수 있는 것은
   "오늘 파이프라인이 그 상황을 만들지 않는다"뿐인데, 이 저장소는 그 형태의 근거가 틀렸던 선례를 갖고
   있다 — ADR 0007 §Deferred 의 `_drop_already_confirmed` 항목이 "지금은 `activity_id` 가 전역 고유해
   무해하다"로 시작해 실제로는 **이미 누수**였음이 드러났다(ADR 0008 §Context 2). "지금은 무해하다"를
   닫는 근거로 쓰지 않는다.

4. **`confirm_mapping_row` 의 `.first()`**(위 3 의 잔여 위험, 2026-09-06 분리). 같은 PK 사실
   (`packages/core/models/orm.py:141-143`)에서 나오는 다른 결과다 — 한 핸들에 여러 매핑 행이 저장될 수
   있는데 그 조회는 첫 행만 쓴다:

   ```python
   # services/sync/review_queue.py:98-99
   row = session.scalars(select(EntityObjectMappingRow).where(
       EntityObjectMappingRow.drawing_id == drawing_id, EntityObjectMappingRow.entity_handle == entity_handle)).first()
   ```

   오늘 저장된 행은 핸들당 하나다(위 `[D4-rows-per-handle]`). 그러므로 지금은 무해하고, **그것이 이
   항목을 닫는 근거가 아니다**(위 3 의 ② 와 같은 이유). 관측으로만 남긴다.
