# ADR 0011 — `CONFIRMED` 이탈에는 사유(`evidence.note`)가 필요하다

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-04
- 관련: ADR 0001(객체 상태 모델 — **이 ADR 은 그 상태기계에 불변식 하나를 더한다**),
  ADR 0001 §5(전이 근거), CLAUDE.md §0 핵심 원칙("확정 완료는 반드시 사람(CM) 승인 액션을 거친다"),
  CLAUDE.md §3 규칙 7·8, `docs/plans/0001-mvp-build.md` 백로그
- 대체하지 않음: ADR 0001 의 상태·전이 표는 그대로다. 전이 **집합**은 바뀌지 않고, 그중 두 전이에
  **근거 요건**이 추가된다.
- 갱신됨: **ADR 0012**(2026-09-05)가 아래 §Decision 규칙 1-a 표 3행에 조건 ③ 을 덧붙였다.
  그 ADR 은 §Deferred 2(검토요청 반려의 `requireNote` 비대칭)를 닫는다.

---

## Context

### 1. 화면이 지키지 못하는 약속

`apps/web/src/components/ObjectDetailPanel.tsx:385` 의 확정 다이얼로그 문구다.

> 이 객체를 '확정(CONFIRMED)' 상태로 전이합니다. CM 승인 행위로 기록되며 **되돌리려면 사유가 필요합니다.**

앞선 사이클의 (C) 계열(존재하지 않는 되돌리기 엔드포인트를 약속한 문구)과는 다르다. **되돌리기 경로는
실재한다** — `packages/core/models/state.py:64-65` 가 `(CONFIRMED, MISMATCH)` 와 `(CONFIRMED, IN_PROGRESS)`
를 CM 에게 허용하고, `:79-80` 이 "leaving CONFIRMED requires actor=cm" 으로 이탈을 CM 에 묶어 둔다.
거짓인 것은 **"사유가 필요합니다"** 쪽이다.

### 2. 실측 — 세 층 전부에서 사유 없이 통과한다

**(가) 서버.** TestClient 로 객체를 CONFIRMED 까지 올린 뒤 두 되돌리기 경로를 태웠다(2026-09-04,
`git archive` 로 뜬 별도 트리).

```
[CONFIRMED 상태에서 CM 에게 주는 next_actions]
    {'kind': 'revoke_confirmation', 'to_state': 'MISMATCH',    'allowed_roles': ['cm']}
    {'kind': 'order_rework',        'to_state': 'IN_PROGRESS', 'allowed_roles': ['cm']}

[note 없이 CONFIRMED -> MISMATCH]      status=201
   응답 evidence: {... 'note': None, 'extra': {'via':'api','role':'cm','user_id':'u-cm-…'}}
[note='' 로 CONFIRMED -> IN_PROGRESS]  status=201
   응답 evidence: {... 'note': '',   'extra': {...}}

[이력 — 되돌리기 전이의 evidence.note]
    CONFIRMED -> IN_PROGRESS | actor: cm | note: ''
    CONFIRMED -> MISMATCH    | actor: cm | note: None
```

**감사 이력에 "왜 확정을 취소했는가"가 존재하지 않는다.** 전이는 기록됐고, 아무 예외도 나지 않았고,
화면은 정상이며, 사라진 것은 이유뿐이다 — 이 저장소의 지배적 실패 모드 그대로다.

**(나) 화면.** 서버가 주는 그 `next_actions` 로 패널을 렌더해 되돌리기 다이얼로그를 열었다.

```
[CONFIRMED / cm] 되돌리기 버튼: [["revoke_confirmation","확정 취소"],["order_rework","재시공 지시"]]
[revoke_confirmation 다이얼로그] 문구: '위치불일치' 상태로 전이를 요청합니다.
[revoke_confirmation 다이얼로그] 사유 라벨: 사유 / 메모      ← '(필수)' 가 붙지 않는다
[revoke_confirmation 다이얼로그] 사유 비어 있을 때 확인 버튼 disabled?: false
```

`ConfirmDialog` 는 `requireNote` prop 을 갖고 있고 그것을 넘기면 라벨에 "(필수)"가 붙고 확인 버튼이
잠긴다(`components/ConfirmDialog.tsx:34,44`). 그러나 저장소 전체에서 이 prop 이 넘어가는 곳은
**`pages/ReviewsPage.tsx:177` 한 곳**(검토요청 *반려*)뿐이다 — 즉 **패턴은 이미 있고, 확정 취소만
그 패턴 밖에 있다.** 표기 변종까지 포함해 저장소 루트에서 셌다(`git grep` 으로 `사유가 필요`·`사유 필요`·
`사유를 요구`·`requireNote`·`require_note`·`note 필수`): 운영 코드 히트는 위 두 자리와
`ObjectDetailPanel.tsx:385` 뿐이다.

**(다) 확정 다이얼로그 자신.** 같은 실측에서 확정 다이얼로그의 사유 칸도 비워 둔 채 확인 버튼이
활성(`disabled: false`)이었다. 즉 저 문장은 자기 화면에서도 지켜지지 않는다.

### 3. 이 경로에는 테스트가 **한 건도** 없다

저장소 루트 전수(`git grep -n "revoke_confirmation\|order_rework\|CONFIRMED.*IN_PROGRESS" -- tests/ apps/web/src`):
히트는 `apps/web/src/api/types.ts:609,610` 의 타입 리터럴과 `ObjectDetailPanel.tsx:280,281` 의
`CM_ONLY_KINDS` 집합뿐이다. **`tests/` 에는 0건.** 확인차, 아래 Decision 의 모델 불변식을 실제로 넣고
pytest 전량을 돌린 뒤 실패 목록을 기준선과 diff 했다(2026-09-04).

```
=== 패치로 새로 깨진 것 ===
> FAILED tests/integration/test_probe_b2.py::test_probe_revert_confirmed_without_note   ← 내가 방금 만든 탐침
(기준선 실패 8건은 전부 스캔 픽스처 미생성 — `make fixtures` 필요, 이 변경과 무관)
```

**기존 733건 중 이 불변식에 반응하는 것이 하나도 없다.** 좋은 소식은 폭발 반경이 0이라는 것이고,
나쁜 소식은 넣은 뒤에도 그것을 붙들어 줄 것이 없다는 것이다 — qa 작업이 이 ADR 의 일부다.

### 4. 왜 문구를 사실에 맞추는 쪽이 아니라 동작을 바꾸는 쪽인가

문구만 고치면 "확정 취소는 사유 없이 됩니다"라고 적는 셈인데, 그것은 CLAUDE.md §0 과 어긋난다.
이 제품에서 CONFIRMED 는 **AI 판정이 도달할 수 없고 사람만 도달할 수 있는 유일한 상태**이고
(§0 핵심 원칙 1, §3 규칙 8), 그 승인을 무효화하는 행위는 승인 자체와 같은 무게의 감사 대상이다.
`_action_kind`(`services/progress/state_machine.py:311-319`)가 이 두 전이에 이미
`revoke_confirmation` / `order_rework` 라는 **고유한 이름**을 붙여 두었다는 사실이 그 판단을 뒷받침한다 —
이름이 있다는 것은 화면도 서버도 이 경로를 **특정할 수 있다**는 뜻이고, 특정할 수 있으면 요건을 걸 수 있다.

ADR 0001 은 모든 전이에 `evidence` 를 요구하고 `note` 는 그 안에서 선택이다. 이 ADR 은 그 선택을
**두 전이에 한해** 필수로 승격한다. 그 이상은 하지 않는다.

---

## Decision

### 규칙 1 — `from_state == CONFIRMED` 인 전이는 비어 있지 않은 `evidence.note` 없이 성립하지 않는다

**모델 레벨에서 막는다**(architect 설계 원칙 2: "상태 enum 과 허용 전이 표 밖의 전이는 모델 레벨에서
막는다"). 자리는 `packages/core/models/state.py` 의 `StateTransition._check` 로 정한다 —
`StateTransition` 은 `evidence` 를 **필수 필드로 이미 갖고 있고**, 그 검증자는 저장소의 모든 전이 생성
경로가 반드시 지나는 유일한 병목이다(`services/progress/state_machine.py:180` 이 유일한 운영 구성 지점).
바로 위 줄에 같은 모양의 선례가 있다.

```python
@model_validator(mode="after")
def _check(self) -> StateTransition:
    validate_transition(self.from_state, self.to_state, self.actor)
    if self.actor == A.SYSTEM and self.confidence is None:
        raise ValueError("system transitions require confidence")     # ← 기존 선례
    if self.from_state == S.CONFIRMED and not (self.evidence.note or "").strip():
        raise RevocationReasonRequiredError(self.from_state, self.to_state, self.actor)    # ← 추가
    return self
```

**초판은 이 자리에 `raise ValueError(…)` 라고 적었다.** 구현에서 전용 예외 타입으로 바뀌었고
(규칙 1-a·1-b), 이 블록은 그 사실에 맞춘 것이다 — `ValueError` 면 pydantic 이 `ValidationError` 로
감싸는데 `services/api/errors.py` 에 그 핸들러가 없어 **500 + `code` 없음**이 된다(실측).

`validate_transition(from, to, actor)` 의 시그니처는 **바꾸지 않는다.** 그 함수는 `evidence` 를 받지
않고, `allowed_targets`(→ `next_actions` 생성)와 `tests/invariants` 가 3인자로 부른다. 근거 요건은
근거를 실제로 들고 있는 모델에 둔다.

*역방향 확인 — 한정어 하나씩.*

| 한정어 | 이 단어를 빼면 무엇이 더 들어오는가 | 이 단어 때문에 무엇이 빠지는가 | 근거(실행값 또는 코드) |
|---|---|---|---|
| `from_state == CONFIRMED` | 모든 전이에 사유 필수가 된다 — 스캔 판정·작업일보가 만드는 `system` 전이까지 걸려 적재가 통째로 막힌다 | CONFIRMED **진입**(승인 자체)은 빠진다 | 실측: 불변식 삽입 후 pytest 전량 diff 결과 새로 깨진 것은 내 탐침 1건뿐 — 즉 `system` 전이 경로에 note 를 채우는 코드가 없다 |
| **(빠지는 것을 태웠다)** CONFIRMED **진입**에도 요구하면? | `INSPECTION_REQUESTED→CONFIRMED` 가 사유 없이는 불가 | — | 기각한다. 검측 승인은 검토요청 큐 경로(`resolve_review`, `kind=="inspection"`)로도 일어나고(`services/api/usecases.py:436-441`) 그 화면의 **승인** 버튼은 지금 `requireNote` 를 넘기지 않는다(`ReviewsPage.tsx:177` 은 `rejected` 일 때만). 승인까지 필수로 만들면 **CM 의 정상 업무를 막는 변경**이고 이 사이클 범위 밖이다. §Deferred 1 |
| `not (…).strip()` (공백만인 note 를 거부) | 없음 | 공백 한 칸이 사유로 통과하는 경우가 빠진다 | 실측: 현행은 `note=''` 로도 **201**(§2-(가) 두 번째 호출). 빈 문자열이 실제로 오는 경로가 있다 — 화면이 `note.trim()` 을 보내지만 `ConfirmDialog.onConfirm(note.trim())` 은 빈 문자열도 보낸다(`ConfirmDialog.tsx:46`) |
| `evidence.note`(top-level `note` 가 아니라) | — | 서버 `TransitionRequest` 의 최상위 `note` 필드만 채운 요청이 빠질 뻔했다 | 코드: `_evidence_from_request`(`services/api/usecases.py:187-188`)가 `req.note` 를 `evidence.note` 로 **합류**시킨다. 따라서 두 채널 중 어느 쪽으로 와도 이 불변식에 걸린다. (참고: TS `TransitionRequest` 에는 최상위 `note` 가 없다 — `api/types.ts:647-651`. 화면은 `evidence.note` 로만 보낸다) |

*같은 문서·인접 절과의 교차 확인.* ADR 0001 §5 는 "모든 상태 전이에 `evidence`"를 요구하되 `note` 를
선택으로 둔다. 이 ADR 은 그것과 **충돌하지 않는다** — 선택을 두 전이에서 필수로 좁히는 것이고,
`Evidence` 모델(`packages/core/models/evidence.py:25`)의 `note: str | None` 은 그대로다.
CLAUDE.md §3 규칙 7("전이는 반드시 actor 와 evidence 를 기록")도 강화 방향이다.

### 규칙 1-a — 이 거부는 자기 `code`(`revocation_reason_required`)로 나간다. 그 예외를 **받는 자리 전수**

예외 타입은 `RevocationReasonRequiredError`(`InvalidTransitionError` 하위 타입)이고, 핸들러는
`services/api/errors.py::_revocation_reason_required` 다. 갈라 놓은 이유는 `invalid_transition` 의 화면
문구("…수행할 수 없습니다. 화면을 새로고침해…")가 이 경우엔 거짓이기 때문이다(§6-4).

**§6-3 "조건을 바꾸면 그 결과를 소비하는 게이트·문구도 같은 PR 에서 확인한다".** 초판은 이 확인을
`errors.py` 의 **핸들러만** 열거하고 끝냈다. 저장소 루트에서 다시 세니(`grep -rn
"InvalidTransitionError\|RevocationReasonRequiredError" .` — 소유·계층으로 좁히지 않았다, §6-1)
`except` 로 같은 타입을 받는 자리가 **둘 더** 있다.

| # | 자리 | 이 예외가 오면 | 오늘 도달하는가(실측 2026-09-04) |
|---|---|---|---|
| 1 | `services/api/errors.py::_revocation_reason_required` | 409 + `code="revocation_reason_required"` + `from_state`/`to_state`/`actor` | **예.** `detail: CONFIRMED -> MISMATCH by cm requires evidence.note (revocation reason)` / `code: revocation_reason_required` |
| 2 | `services/api/usecases.py:217`(`transition_object`) | 롤백 후 **그대로 re-raise** — 하위 타입이 그대로 올라가 1번 핸들러가 받는다 | 예. **안전** |
| 3 | `services/api/usecases.py:442`(`resolve_review`, `kind=="inspection"`) | `decision=="approved"` → `Conflict(inspection_confirm_failed)`. `decision=="rejected"` → **`log.info` 로 조용히 삼킨다** | **아니오, 도달 불가.** 이 경로의 전이는 `<현재 상태> -> IN_PROGRESS` 라 `from_state == CONFIRMED` 이려면 **CONFIRMED + 미결 inspection 요청**이 공존해야 하는데, 실측: 검측 요청 시점 미결 inspection = **1**, cm 확정 직후 같은 객체 `state=CONFIRMED` / 미결 inspection = **0** |

3번의 도달 불가는 **구조**에서 온다: CONFIRMED 진입은 표에서 `(INSPECTION_REQUESTED, CONFIRMED)`
하나뿐이고, 그 전이가 `close_inspection_reviews`(`services/progress/state_machine.py:132`)로 미결
inspection 을 전부 닫으며, 생성은 `ensure_inspection_review`(`:111`)가 `INSPECTION_REQUESTED`
**진입에서만** 한다. **이 칸이 거짓이 되는 조건**: ① CONFIRMED 로 가는 전이가 표에 하나라도 더 생기거나
② `INSPECTION_REQUESTED` 진입 밖에서 inspection 요청을 만드는 경로가 생길 때. 둘 중 하나를 하는 사이클은
이 `log.info` 를 함께 본다 — 그때부터 그것은 침묵 경로다.

**추가 — 조건 ③ (ADR 0012, 2026-09-05).** 위 ①② 는 `RevocationReasonRequiredError` 가 이 칸에
**도달**하는 조건이다. 도달 여부와 무관하게 이 `log.info` 를 침묵 경로로 만드는 세 번째 조건이 있다:
③ **`resolve_review` 의 inspection 분기가 던지는 새 예외가 `InvalidTransitionError` 하위 타입이면.**
그 분기 안에서 새로 던져지는 예외는 타입만으로 이 `except` 에 걸리고, `decision == "rejected"` 이면
그대로 `log.info` 로 사라진다 — 그 예외가 무엇을 막으려던 것이든.

실측(작업 트리 `/home/user/Bim/buildtwin`, HEAD `9989288`, `tests/integration/` 의 임시 탐침으로
`usecases.ObjectStateMachine.transition_with_effects` 를 monkeypatch 해 각각을 던지게 하고
`POST /api/review-requests/{id}/resolve {"decision":"rejected"}` 를 태운 뒤 파일을 지웠다):

```
[SUBTYPE] 200 rejected None      ← InvalidTransitionError 하위 타입: 삼켜지고 요청이 rejected 로 닫힌다.
                                   응답에 code 없음
[DIRECT]  propagated out of resolve_review (not swallowed)      ← Exception 직속
```

그래서 ADR 0012 의 `ReviewRejectionReasonRequiredError` 는 `RevocationReasonRequiredError` 와 달리
**`Exception` 직속**이다(ADR 0012 규칙 3). 이 `except` 안으로 새 예외를 들이는 사이클은 그 선택을
함께 본다 — 상속 관계 하나가 방어를 통째로 침묵시킨다.

### 규칙 1-b — 이 거부의 `detail` 은 부모(`InvalidTransitionError`)의 포맷을 쓰지 않는다

부모 포맷은 `"{from} -> {to} by {actor} not allowed. {reason}"` 이다. 이 예외에서는 그 앞머리가
**거짓**이다 — 전이는 허용 표에 있고(`(CONFIRMED, MISMATCH)`·`(CONFIRMED, IN_PROGRESS)` = `{cm}`)
actor 도 cm 이다. 그런데 code 를 가른 **유일한 근거**가 바로 "'수행할 수 없습니다'는 거짓이다"이므로,
부모 포맷을 그대로 쓰면 **응답이 싣는 `detail` 자신이 그 근거를 반박한다.** glossary "오류 응답 code
어휘" 서문이 "모르는 `code` 는 `detail` 을 그대로 보여준다"고 약속하는 이상 이것은 내부 문자열이 아니라
**계약면**이다(§6-4 규칙 1·3).

그래서 `RevocationReasonRequiredError` 는 자기 메시지를 만든다:
`"{from} -> {to} by {actor} requires evidence.note (revocation reason)"`.

*역방향 확인 — 부모 포맷은 왜 그대로 두는가.* 다른 거부는 **실제로 허용되지 않은 것**이라 "not allowed"
가 참이다. 양쪽을 다 태웠다(2026-09-04, `git archive` 별도 트리, TestClient).

| 요청 | `code` | `detail`(원문) |
|---|---|---|
| `CONFIRMED -> MISMATCH`, note 없음, cm | `revocation_reason_required` | `CONFIRMED -> MISMATCH by cm requires evidence.note (revocation reason)` |
| `CONFIRMED -> IN_PROGRESS`, `note="  "`, cm | `revocation_reason_required` | `CONFIRMED -> IN_PROGRESS by cm requires evidence.note (revocation reason)` |
| `CONFIRMED -> ESTIMATED_DONE`, 사유 있음, cm(표에 없는 목적지) | `invalid_transition` | `CONFIRMED -> ESTIMATED_DONE by cm not allowed.` |
| `PLANNED -> CONFIRMED`, 사유 있음, cm | `invalid_transition` | `PLANNED -> CONFIRMED by cm not allowed.` |
| `CONFIRMED -> IN_PROGRESS`, 사유 있음, **contractor** | `invalid_transition` | `CONFIRMED -> IN_PROGRESS by contractor not allowed. leaving CONFIRMED requires actor=cm` |

### 규칙 2 — 화면은 두 되돌리기 행동에 `requireNote` 를 넘긴다

`ObjectDetailPanel` 의 `ConfirmDialog` 에 `requireNote={pending?.kind === "revoke_confirmation" ||
pending?.kind === "order_rework"}` 를 넘긴다. **`kind` 로 가른다** — `to_state` 로 가르면
`MISMATCH`·`IN_PROGRESS` 로 가는 다른 전이(`flag_mismatch`·`accept_rework`·`reject_inspection`)까지
휩쓸린다. `_action_kind` 가 이 둘에만 고유 이름을 붙여 둔 것이 여기서 값을 한다(§4).

*역방향 확인.* `kind` 로 가르면 **빠지는 것**: 서버가 `next_actions` 를 주지 않는 경로로 이 전이를
일으키는 화면. 저장소 루트 전수(`git grep -n "useTransition" -- apps/web/src ':!*test*'`)로 확인했다 —
`ObjectDetailPanel.tsx:9,301` 뿐이다. 화면에서 전이를 거는 곳은 이 패널 하나다. 그래도 규칙 1(모델)이
최종 방어이므로, 화면이 빠뜨려도 사용자는 **409 `revocation_reason_required` 를 보게 되지
조용히 통과하지 않는다**(실측 — 규칙 1-b 표). 초판은 이 자리에 "422"라고 적었다. 거짓이다 — 이 예외는
요청 스키마 위반이 아니라 **대상의 현재 상태에 대한 요건**이라 409 이고, 그것이 규칙 1-a 가 상태코드를
409 로 유지한 이유이기도 하다.

### 규칙 3 — 문구를 고친다. 이 사이클 안에서, 두 번 고친다

CLAUDE.md §6-4 규칙 1: 사실과 다른 문구는 그것을 만든 사이클이 고치고, "다음 변경이 자연히 좁혀
준다"를 미루는 근거로 쓰지 않는다. 그래서 **문구 정정을 규칙 1·2 의 구현에 매달지 않는다.**

- **1단계(먼저, 독립적으로 머지 가능).** `:385` 를 지금 참인 문장으로 바꾼다. 되돌리기 경로가
  실재한다는 사실은 남기고, 거짓인 절만 없앤다.
  예: `"이 객체를 '확정(CONFIRMED)' 상태로 전이합니다. CM 승인 행위로 기록되며, 이 확정은 CM 만 되돌릴 수 있습니다."`
- **3단계(규칙 1·2 가 들어간 뒤).** 같은 줄을 새 사실로 갱신한다.
  예: `"… CM 승인 행위로 기록되며, 되돌리는 것도 CM 만 할 수 있고 그때는 사유를 남겨야 합니다."`

같은 줄을 두 번 고치는 값은 싸다. 거짓 문장이 구현 지연 때문에 살아남는 값은 싸지 않다 —
그것이 §6-4 가 세 사이클에 걸쳐 배운 것이다.

*문구 테스트(§6-4 3).* 문장을 통째로 베끼지 않는다. "그 상황에서 참일 수 없는 말이 없다"를 단언한다:
확정 다이얼로그 문구에 **"사유가 필요"** 라는 취지의 말이 있으면 같은 화면의 되돌리기 다이얼로그가
`requireNote` 상태여야 한다 — 둘을 **함께** 단언한다(§6-2 4).

---

## Consequences

- **좋아지는 것.** CM 확정을 되돌린 기록에 반드시 이유가 남는다. `revoke_confirmation`(확정 취소)과
  `order_rework`(재시공 지시)는 현장에서 금액·공기와 직결되는 지시이고, 지금은 그 지시의 근거가
  **어디에도 없다**(§2-(가) 이력 실측).
- **치러야 하는 값.** ① CM 이 되돌릴 때 한 칸을 더 채워야 한다. ② `evidence.note` 를 채우지 않고
  이 전이를 거는 **서버 내부 호출**이 앞으로 생기면 `RevocationReasonRequiredError` 가 난다
  (API 를 통해 오면 409 `revocation_reason_required` — 실측). 초판은 "422"라고 적었다. 의도한 값이다.
  현재 그런 호출은 없다(§3 실측: 폭발 반경 0).
- **잡지 못하는 것.** note 의 **내용**은 검사하지 않는다("."도 통과한다). 내용 품질은 규칙이 아니라
  운영의 문제이고, 최소 길이 같은 임의의 문턱을 두면 CM 이 "aaa"를 치게 만들 뿐이다.
- **되돌리기 자체는 계속 가능하다.** 이 ADR 은 CONFIRMED 이탈을 **어렵게** 만들지 않는다.
  `(CONFIRMED, MISMATCH)`·`(CONFIRMED, IN_PROGRESS)` 는 표에 그대로 남고 actor 제약도 그대로다.

## Alternatives

1. **문구만 사실에 맞춘다("사유가 필요합니다"를 삭제).** 부분 기각. 1단계로는 채택했지만
   **종착점으로는 기각**한다 — §4 의 근거(확정 무효화는 확정과 같은 무게의 감사 대상)를 포기하게 된다.
2. **화면에서만 `requireNote` 를 건다(서버는 그대로).** 기각. 그 방어는 API 를 직접 부르면 사라지고,
   지금 저장소에 이미 그 형태의 선례가 있다 — 검토요청 반려의 `requireNote` 는 화면에만 있고 서버
   `resolve_review(… note: str | None …)`(`services/api/usecases.py:417`)는 note 없이도 받는다.
   이 ADR 이 그 패턴을 한 번 더 늘리면 "화면이 지키는 척하는 규칙"이 두 개가 된다.
3. **`services/progress/state_machine.py::transition_with_effects` 에서 검사한다.** 기각. 그 자리는
   progress-engine 소유이고 전이를 만드는 **한 경로**일 뿐이다. 모델 검증자는 `StateTransition` 을
   만드는 **모든** 경로를 덮는다(앞으로 생길 경로 포함).
4. **`validate_transition` 에 `evidence` 인자를 추가한다.** 기각. 그 함수는 `allowed_targets` 를 통해
   `next_actions` 생성에도 쓰이고(`state_machine.py:296`) `tests/invariants/test_invariants.py:70,80` 이
   3인자로 부른다. 근거를 들고 있지 않은 함수에 근거 요건을 넣는 것은 자리가 틀렸다.

## Deferred

1. **확정(진입)에도 사유를 요구할 것인가.** 이 ADR 은 **이탈**만 다룬다. 진입에 요구하면 검토요청
   큐의 승인 버튼(지금 `requireNote` 없음)까지 바뀌고, 그것은 CM 의 상시 업무 흐름을 바꾸는 결정이라
   실측 없이 정하지 않는다. 결정하려면 먼저 볼 것: 검측 승인 1건당 CM 이 실제로 note 를 남기는 비율.
2. **검토요청 반려의 `requireNote` 가 화면에만 있다.** `ReviewsPage.tsx:177` ↔
   `usecases.resolve_review` 의 비대칭. 이 ADR 과 같은 모양의 결함이지만 다른 경로이므로 따로 다룬다.
   계획 0004 §열린 질문 2.
