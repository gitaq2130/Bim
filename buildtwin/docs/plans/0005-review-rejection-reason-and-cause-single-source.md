# 계획 0005 — 검토요청 반려의 사유 요건(서버) · `cause` 정본 단일화 · CLAUDE.md §6-1 압축

- 작성: architect
- 날짜: 2026-09-05
- 기준 커밋: `209795f`(브랜치 `claude/buildtwin-initial-setup-ubulzb`, 트리 깨끗, CI 8/8 green)
- 관련: ADR 0011 §Deferred 2(과제 1), ADR 0009 §Deferred 5(과제 2), CLAUDE.md §6 압축 규칙(과제 3),
  ADR 0007 §4-2("방어는 공유 본체에 둔다"), CLAUDE.md §3 규칙 11(검토요청 해소 소유)

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

코드는 **한 줄도 고치지 않았다**. 모든 실측은 `git archive HEAD:buildtwin` 로 뜬 별도 트리 두 개에서 했다.

```
$ cd /home/user/Bim && git archive HEAD:buildtwin | tar -x -C <SCRATCH>/tree     # 과제 1 탐침 + 절제
$ cd /home/user/Bim && git archive HEAD:buildtwin | tar -x -C <SCRATCH>/tree2    # 과제 2 절제
$ cd <SCRATCH>/tree && PYTHONPATH=<SCRATCH>/tree .venv/bin/python scripts/fetch_fixtures.py
$ cd <SCRATCH>/tree && PYTHONPATH=<SCRATCH>/tree .venv/bin/pytest tests/unit tests/invariants tests/regression tests/integration -q
```

**탐침 트리 기준선**(`git archive HEAD:buildtwin` 로 뜬 별도 트리, 픽스처 생성 후, 필터 없이 `tail`):

```
726 passed, 1 warning in 62.26s
```

**주의 — 이 726 은 작업 트리의 전량이 아니다**(2026-09-05 실측, 이 계획을 받은 뒤 확인). 작업 트리
`/home/user/Bim/buildtwin` 의 전량은 **738 passed** 이고, 두 트리 모두 `--collect-only` 로는 **738 을
수집한다**. 차이는 `tests/fixtures/sample.ply` 가 `git archive` 에 들어오지 않는 생성 픽스처라는 데서
온다(아카이브 트리를 갓 뜬 상태: `8 failed, 694 passed, 36 errors` — 전부 `FileNotFoundError` 계열).
즉 **아래의 "726 passed" 들은 12건이 빠진 기준선 위의 값**이다.

이것이 무엇을 무효화하고 무엇을 무효화하지 않는가:
- **무효화하지 않는 것 — 비교 자체.** 가드 유무를 같은 트리에서 잰 값이므로 "가드가 기존 테스트를
  하나도 죽이지 않는다"와 "불변식은 넣자마자 무보호다"는 결론은 그대로다.
- **무효화하는 것 — 절대 커버리지 주장.** 빠진 12건이 반려·전이 경로를 태우지 않는다는 것은
  **확인되지 않았다**(아카이브 트리에서 실패한 것은 전부 `tests/unit/scan/` 이라 위험은 낮아 보이지만
  낮아 보이는 것은 근거가 아니다). **모든 완료 조건은 작업 트리에서 738 로 다시 재고**, 그 값을 보고에
  적는다. 아래 본문의 726·728 은 탐침 트리의 값으로 읽는다.

웹: `cd apps/web && npx vitest run` → `Test Files 28 passed (28) / Tests 262 passed (262)`.

**원복 확인** — 저장소 루트에서 `git status --porcelain` 전문:

```
 M buildtwin/CLAUDE.md
?? buildtwin/docs/plans/0005-review-rejection-reason-and-cause-single-source.md
```

(둘 다 이 사이클의 산출물이고 architect 소유다 — `CLAUDE.md` 는 과제 3, 계획 문서는 이 파일 자신.
**코드 변경 0건** — 탐침·절제는 전부 별도 트리에서 했고 작업 트리에 파일을 만들지 않았다.)

---

## 목표

1. **검토요청 반려에 사유를 서버가 요구한다.** 지금 화면만 요구하고 서버는 받아 준다
   (`ReviewsPage.tsx:177` ↔ `usecases.resolve_review`). ADR 0011 §Deferred 2.
2. **`lost_decisions[].cause` 값 셋의 정본을 `packages/core/models/review.py` 하나로 올리고**, 파이썬이
   닫지 못하는 쪽(TS·config)을 **기계적 감사**로 덮는다. ADR 0009 §Deferred 5.
3. **CLAUDE.md §6-1 을 압축한다**(이 문서 안에 옛 불릿 ↔ 새 행 대조표를 남긴다). — **이미 했다**, §과제 3.

---

# 과제 1 — 검토요청 반려의 사유 요건을 서버에 세운다

## 1-a. 전수 목록: `ReviewRequestRow.status` 를 쓰는 자리

**생성 기준(§6-1 ①).** 저장소 루트에서, 소유·계층으로 좁히지 않고 두 문자열 축을 겹쳤다.

```
$ cd /home/user/Bim && grep -rn "\.status" --include=*.py buildtwin/services buildtwin/packages | grep -E "status *=" | grep -v "=="
$ cd /home/user/Bim && grep -rn "row\.status\|review\.status\|old\.status\|\.status," --include=*.py buildtwin/services buildtwin/packages | grep -v "=="
```

두 번째 명령이 필요했던 이유가 곧 첫 번째 기준의 한계다: `usecases.py:507` 과 `review_queue.py:75` 는
**튜플 대입**(`row.status, row.resolution_note, … = decision, note, …`)이라 `status *=` 축에 걸리지 않는다.

| # | 자리 | 쓰는 값 | 소유 | `rejected` 를 쓸 수 있는가 |
|---|---|---|---|---|
| 1 | `services/progress/persistence.py:442` (`save_review_request`) | `review.status`(생성, 기본 `open`) | progress-engine | 아니오 |
| 2 | `services/progress/document_mapper.py:423` | `"open"`(재오픈) | progress-engine | 아니오 |
| 3 | `services/progress/document_mapper.py:484` | `"on_hold"`(시스템 자동 종료) | progress-engine | 아니오 |
| 4 | `services/progress/document_mapper.py:504` (`close_document_mapping_review`) | `"approved"` | progress-engine | 아니오 |
| 5 | `services/progress/state_machine.py:141` (`close_inspection_reviews`) | `INSPECTION_DECISIONS[to_state]` → `approved`\|`rejected` | progress-engine | **예** |
| 6 | `services/api/usecases.py:507` (`resolve_review` 공통 폴백) | `decision` → `approved`\|`rejected`\|`on_hold` | api | **예** |
| 7 | `services/sync/review_queue.py:75` (`resolve_mapping_reviews`) | `decision` → `approved`\|`rejected` | sync-2d3d | **예** |
| 8 | `services/sync/persistence.py:171` | `"on_hold"`(시스템) | sync-2d3d | 아니오 |

**`rejected` 를 쓰는 자리는 셋이고, 소유가 셋 다 다르다.**

*이 목록이 놓치는 것(§6-1 ②).* 축이 **`.status` 라는 속성명**이므로 ① ORM 을 거치지 않는
`UPDATE review_requests SET status=…` 형태의 원시 SQL, ② `setattr(row, "status", …)`,
③ 다른 이름의 별칭 변수(`r.status` 는 잡히지만 `getattr` 경유는 못 잡는다)는 밖이다.

*블라인드 스팟 한 건 실측(§6-1 ③).* ①을 태웠다 — `grep -rn "UPDATE review_requests\|update(ReviewRequestRow)\|setattr(.*status" buildtwin/services buildtwin/packages` → **0건**. 원시 SQL·`setattr` 경로는 이 저장소에 없다.
(기준의 한계는 결과가 아니라 기준에서 판단한다 — 0건이었다는 사실이 이 축을 정당화하지는 않는다.)

**`packages/core/models/` 명시 확인(§6-5).** `packages/core/models/review.py` 의 머리 주석이 자기 파일
밖에 대해 하는 단정은 한 줄이다 — `:41` `"해소에 부수 효과가 없다 — services/api/usecases.resolve_review
의 공통 폴백이 status/note 만 기록한다"`. **이 단정은 지금 참이고**(위 표 6 = 폴백, `document_identity_drift`
분기는 존재하지 않는다), 과제 1 은 이 단정을 바꾸지 않는다(폴백 **앞**에 가드를 넣을 뿐 폴백이 하는 일은 그대로).
과제 2 는 같은 파일에 정의를 추가하므로 이 주석을 **정의로 승격**한다(§2-a).

## 1-b. 병목은 어디인가 — ADR 0011 의 `StateTransition._check` 에 해당하는 자리가 **없다**

ADR 0011 은 `StateTransition` 이 **모든 전이 생성 경로가 반드시 지나는 모델 생성 지점**이라는 사실 위에
불변식을 얹었다. 검토요청에는 그런 자리가 없다:

- `ReviewRequest`(pydantic) 는 **생성 시점에만** 만들어지고(`db.save_review_request`), 이후 상태 변경은
  전부 **ORM 행 직접 변이**다(위 표 2~8). 즉 모델 검증자는 반려를 **한 번도 보지 못한다.**
- 그렇다고 읽기 쪽(`db.review_row_to_model`, `persistence.py:456`)에 검증자를 걸면 **저장된 과거 기록을
  읽을 수 없게 된다.** 실측(§1-e 기준선 표): 현행 코드가 만든 `rejected` 행 중 `resolution_note=null` 인
  것이 실제로 존재한다(예: `mapping/rejected/note-absent` → `status_after="rejected"`,
  `resolution_note=null`). 읽기 검증자는 그 행을 500 으로 만든다. **기각.**

**그래서 병목을 만든다 — 술어 하나 + 호출 자리 둘.**

- **술어(정의는 한 곳)**: `packages/core/models/review.py` 에 `rejection_reason_missing(note) -> bool` 과
  전용 예외 `ReviewRejectionReasonRequiredError`. architect 소유이고 세 서비스가 모두 import 하는 자리다.
- **호출 자리 A** — `services/api/usecases.py::resolve_review` 의 **프롤로그**(`review_already_resolved`
  검사 바로 뒤, 분기 dispatch 앞). 이 함수는 `services/api/routers/review_requests.py:52` **한 곳**에서만
  불린다(`grep -rn "usecases.resolve_review" .` → 라우터 1건 + 문서·주석). 프롤로그는 5 kind × 3 decision
  **전부**가 지나므로 큐 경로의 진짜 병목이다.
- **호출 자리 B** — `services/progress/state_machine.py::close_inspection_reviews`. **큐가 아닌 두 번째
  문이다**(아래 1-b-1).

### 1-b-1. 실측 — "전용 엔드포인트와 큐 승인" 축으로 물으면 답을 놓친다

과제 지시는 `confirm_document_mapping`(전용) ↔ `resolve_review`(큐) 축을 물었다. 그 축은 **승인**의 축이고,
`_confirm_document_mapping_row` 라는 공유 본체가 이미 있어(`usecases.py:310`, ADR 0007 11차 리뷰) 둘 다 같은
방어를 받는다 — 확인함. **그러나 반려에는 전용 엔드포인트가 없다.** 변경 라우트 전수:

```
$ grep -rn "@router.post\|@router.put\|@router.patch\|@router.delete" services/api/routers/
```

반려를 만드는 라우트는 `POST /review-requests/{id}/resolve` 하나뿐이고 `reject_document_mapping` 의 호출자도
`usecases.py:504` 하나뿐이다(`grep -rn "reject_document_mapping(" .`).

**그래서 축을 바꿔서 다시 물었다: "검토요청이 `rejected` 로 닫히는 경로가 몇 개인가?"** 위 1-a 표 5·6·7 이
답이고, **5(`close_inspection_reviews`)는 큐를 거치지 않고도 도달한다.** 실측(별도 트리, TestClient,
가드 없는 HEAD 코드):

```
[SECOND PATH — HEAD(가드 없음)]
{"to_state":"IN_PROGRESS","req_note":null,"http":201,"review_status_after":"rejected",
 "resolution_note":"INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-…); transition_id=…"}
{"to_state":"MISMATCH",   "req_note":null,"http":201,"review_status_after":"rejected",
 "resolution_note":"INSPECTION_REQUESTED -> MISMATCH by cm (u-cm-…); transition_id=…"}
```

즉 CM 이 **객체 상세 패널**에서 `POST /api/objects/{gid}/transitions` 를 누르면 사유 없이 inspection
검토요청이 `rejected` 로 닫힌다. 화면에도 버튼이 있다 — 같은 실측의 `next_actions`:

```
[NEXT_ACTIONS @ INSPECTION_REQUESTED / cm]
 {"kind":"reject_inspection","label":"검측 반려(재작업)","to_state":"IN_PROGRESS","allowed_roles":["cm"]}
 {"kind":"flag_mismatch",    "label":"불일치 판정",     "to_state":"MISMATCH",   "allowed_roles":["cm"]}
 {"kind":"resolve_review",   "label":"검토요청 처리",   "to_state":null, "review_kind":"inspection"}
```

그리고 `ObjectDetailPanel` 은 이 둘에 `requireNote` 를 넘기지 않는다 —
`grep -n "REVOCATION_KINDS" apps/web/src/components/ObjectDetailPanel.tsx` →
`:304 new Set(["revoke_confirmation", "order_rework"])`.

**결론: 같은 행위(검측 검토요청을 반려한다)에 문이 둘이고, 화면 방어는 큐 쪽 하나에만 있고, 서버 방어는
어느 쪽에도 없다.** 자리 A 하나만 고치면 자리 B 는 그대로 열려 있다 — ADR 0007 이 배운 "방어를 한쪽에만
거는 비대칭을 남기지 않는다"가 여기 그대로 걸린다.

*역방향 확인 — 자리 B 에 거는 조건을 좁히지 않았는가.* 조건을 `status == "rejected" and 미결 inspection 이
있을 때` 로 좁혔다. **이 한정어 때문에 빠지는 것**: 미결 inspection 이 없는 상태의 같은 목적지 전이
(`accept_rework` = MISMATCH→IN_PROGRESS)는 사유 없이 통과한다. 그것이 **의도**다 — 그 전이는 어떤
검토요청도 닫지 않는다. 음성 대조군으로 태웠다(가드 설치 후):

```
{"to_state":"IN_PROGRESS(accept_rework, 미결 inspection 없음)","req_note":null,"http":201}
```

**이 한정어를 빼면**(모든 CM 전이에 사유 요구) 정상 업무가 막힌다 — ADR 0011 이 CONFIRMED **진입**을
같은 이유로 뺀 것과 같은 판단이다.

## 1-c. 어떤 `kind` · 어떤 결정이 대상인가 — 양쪽을 각각 셌다

**서버가 받는 것**(`packages/core/models/review.py:46`, `services/api/schemas/reviews.py:9`):

```
ReviewKind     = Literal["mapping","verification","inspection","document_mapping","document_identity_drift"]   # 5
ReviewDecision = Literal["approved","rejected","on_hold"]                                                      # 3
```

**화면이 보내는 것**(`apps/web/src/api/types.ts:327,443` + `ReviewsPage.tsx:24,161-165`):

```
ReviewKind     = "mapping" | "verification" | "inspection" | "document_mapping" | "document_identity_drift"     # 5
DECISION_LABELS: Record<ReviewDecision,string> = { approved:"승인", rejected:"반려", on_hold:"보류" }           # 3
→ 버튼은 Object.keys(DECISION_LABELS) 전수로 그려진다(kind 로 거르지 않는다)
```

**양쪽 5×3 으로 일치한다.** 그리고 화면의 `requireNote={pending?.decision === "rejected"}`(`:177`)는
**kind 를 보지 않는다** — 5 kind 전부에서 반려에 사유를 요구한다.

**그러므로 서버 요건도 `decision == "rejected"` 전 kind 로 세운다.** kind 별로 가르면 화면과 서버의 축이
어긋나고(계획 0004 §6-3 8회차가 축 불일치로 무주공산을 만든 것과 같은 모양), 어느 kind 만 빼야 하는지에
대한 근거가 없다 — 다섯 kind 모두 반려는 CM 의 판단이고, 그중 `document_mapping` 반려는 **영구**다
(ADR 0007 §4-2 규칙 6 ⑥, 되돌리는 경로 없음).

*역방향 확인 — `approved`·`on_hold` 를 빼면 무엇이 빠지는가.* ① `approved`: 승인에 사유를 요구하는 것은
ADR 0011 §Deferred 1 이 "CM 상시 업무를 바꾸는 결정이므로 실측 없이 정하지 않는다"고 미뤄 둔 항목이고,
화면도 승인에 `requireNote` 를 넘기지 않는다 — 이 사이클 범위 밖(그대로 Deferred). ② `on_hold`: 보류는
"아직 판단하지 않았다"는 기록이고 화면도 사유를 요구하지 않는다. 둘 다 **화면과 서버가 지금 같은 상태**라
비대칭이 없다. 실측으로 확인: §1-e 기준선 표에서 `approved`·`on_hold` 는 30칸 전부 200.

## 1-d. 오류 code 를 가를 것인가 — 지금 나가는 code 와 그 화면 문구를 읽고 판단했다

**지금 나가는 code: 없다.** 사유 없는 반려는 **200** 이다(§1-e 기준선 표 45칸 중 15칸의 `rejected` 행 전부).
그러므로 ADR 0011 과 달리 "거짓 문구를 가른다"가 아니라 **"새 code 를 만들 것인가, 있는 것을 쓸 것인가"** 다.

| 후보 | 그 code 의 지금 화면 문구(실제 인용) | 판단 |
|---|---|---|
| `revocation_reason_required` 재사용 | `ErrorBox.tsx:31` `"확정을 되돌리려면 사유를 입력해야 합니다. 사유를 적은 뒤 다시 시도하세요."` | **기각.** `mapping`·`verification`·`document_mapping`·`document_identity_drift` 반려는 "확정을 되돌리는" 일이 아니다 — 그 문장이 그 자리에서 거짓이다(ADR 0011 이 code 를 가른 근거와 같은 형태). |
| `invalid_transition` 재사용 | `ErrorBox.tsx:23` `"현재 상태에서는 이 작업을 수행할 수 없습니다. 화면을 새로고침해 최신 상태를 확인하세요."` | **기각.** 두 절 다 거짓 — 전이·해소는 허용되고, 새로고침해도 달라지지 않는다. 게다가 큐 경로(4 kind)에는 전이가 아예 없다. |
| `ResolveRequest`(pydantic) 스키마 검증으로 422 | 없음 — 실측 응답: `422 {"detail":[{"type":"value_error","loc":["body"],"msg":"…","input":{…},"ctx":{…}}]}`, **키는 `['detail']` 뿐** | **기각.** `code` 가 없다. glossary 부칙이 FastAPI 422 를 "계약 밖"으로 명시했고, `errorText`(`ErrorBox.tsx:117-128`)는 `code` 없는 422 를 3번 분기로 떨어뜨려 `detail`(여기서는 **배열**)을 그대로 찍는다. 화면이 원인별 안내를 고를 수 없다. |
| **새 code `rejection_reason_required`(409)** | 새로 쓴다 | **채택.** |

**상태코드는 409.** 근거: ① glossary 서문의 호환 약속("신규 code 추가는 표에 행만 더하고 기존 프론트
분기를 깨지 않는다") — `code` 를 모르는 클라이언트에게는 여전히 409 + `detail` 이다. ② 자리 B 에서는
요건이 **대상의 현재 상태에 달려 있다**(미결 inspection 이 있을 때만) — 실측 음성 대조군이 그것을 보인다.

*역방향 확인 — 409 가 자리 A 에서 무엇을 왜곡하는가.* **자리 A 에서는 상태 의존이 아니다**
(`{decision:"rejected"}` + 빈 사유는 어떤 상태에서도 무효). 409 를 "새로고침하면 달라진다"로 읽는
클라이언트는 헛돌게 된다. **그래서 code 를 가르는 것이고**, `ErrorBox` 문구는 "새로고침"이라는 말을
쓰지 않고 다음 행동(**사유를 적는다**)만 말해야 한다 — ADR 0011 이 `revocation_reason_required` 문구에
건 것과 같은 제약이다.

**부가 필드 — glossary "응답 모양 일관성"을 자기 code 에 대해 답한다.** 그 부칙은
`invalid_transition`/`transition_blocked_by_review`(및 ADR 0011 부칙이 더한 `revocation_reason_required`)에
"어느 경로로 발생하든 같은 부가 필드"를 요구한다. 이 code 는 **경로 둘의 공통 분모가 다르다** — 자리 A 의
4 kind 에는 `from_state`/`to_state`/`actor` 가 **존재하지 않는다**. 그러므로 이 code 가 두 경로에서 함께
실을 수 있는 것은 `review_request_ids`(리스트)와 `review_kind` 뿐이고, **그 둘만 싣는다.**
*이 결정이 깨뜨리는 것*: 자리 B 는 "전이가 거부됐는데 `from_state`/`to_state`/`actor` 가 없는" 첫 응답이 된다.
**그 값을 읽는 화면이 있는가 — 실측:** `grep -rn "from_state\|to_state" apps/web/src --include=*.ts*` 의
비테스트 히트 전수는 `ObjectDetailPanel.tsx:257,284,291,330,335,339,412,413`(전부 **전이 이력·next_action**
소비, 오류 응답 아님)과 `api/types.ts:142,143,620,648`(타입 선언)이다. 오류 경로는
`ObjectDetailPanel.tsx:347` `setMessage(errorText(e))` 하나이고 `errorText` 는 `code` 와 `detail` 만 읽는다.
**오늘 그 세 필드를 읽는 화면은 0건이다.** 그래도 이것은 계약면 변경이므로 glossary 에 이 code 의 부가 필드
계약을 **새 행으로** 적는다(부칙은 append-only).

## 1-e. 폭발 반경 — `kind × 결정 × note` 45칸, 구/신 나란히

한 칸마다 **새 검토요청 한 건**을 만들어 `POST /api/review-requests/{id}/resolve` 를 실제로 태웠다
(inspection 은 객체를 `PLANNED→REPORTED→INSPECTION_REQUESTED` 로 올려 서버가 만든 실제 요청을 쓰고,
나머지 넷은 실제 도면·문서·Activity 를 참조하는 행을 `new_session()` 으로 넣는다).
`note` 축 셋: **없음**(필드 미전송) / **공백만**(`"   "`) / **사유**(`"사유 있음"`).

**기준선(HEAD, 가드 없음) — 45칸 전부 `200`.** 막히는 조합 **0**. 요약과 kind 별 차이:

| kind | `approved` × (없음/공백/사유) | `rejected` × (없음/공백/사유) | `on_hold` × (없음/공백/사유) |
|---|---|---|---|
| `inspection` | 200·200·200 → `approved` | **200·200·200 → `rejected`** | 200·200·200 → `on_hold` |
| `mapping` | 200·200·200 → `approved` | **200·200·200 → `rejected`** | 200·200·200 → `on_hold` |
| `document_mapping` | 200·200·200 → `approved` | **200·200·200 → `rejected`** | 200·200·200 → `on_hold` |
| `verification` | 200·200·200 → `approved` | **200·200·200 → `rejected`** | 200·200·200 → `on_hold` |
| `document_identity_drift` | 200·200·200 → `approved` | **200·200·200 → `rejected`** | 200·200·200 → `on_hold` |

**가드 설치 후(별도 트리 절제) — 10칸이 막히고 35칸이 통과한다.** 막히는 칸은 `rejected × {없음, 공백}`
5 kind 전부이고, 응답은 전부 `409 code="rejection_reason_required"`, **검토요청은 `open` 으로 남는다**
(부분 적용 없음 — 실측 `status_after: "open"`, `resolution_note: null`).

| kind | `rejected` × 없음 | `rejected` × 공백만 | `rejected` × 사유 |
|---|---|---|---|
| `inspection` | 409 `rejection_reason_required`, 요청 `open` | 409 동일 | 200, `rejected` |
| `mapping` | 409 동일 | 409 동일 | 200, `rejected` |
| `document_mapping` | 409 동일 | 409 동일 | 200, `rejected` |
| `verification` | 409 동일 | 409 동일 | 200, `rejected` |
| `document_identity_drift` | 409 동일 | 409 동일 | 200, `rejected` |

**두 번째 문(자리 B)의 구/신** — 같은 형식으로:

| 전이 | `note` | HEAD | 가드 후 |
|---|---|---|---|
| `INSPECTION_REQUESTED → IN_PROGRESS`(=`reject_inspection`) | 없음 | 201, 요청 `rejected` | **409 `rejection_reason_required`**, 요청 `open`, 객체 `INSPECTION_REQUESTED` 유지 |
| `INSPECTION_REQUESTED → MISMATCH`(=`flag_mismatch`) | 없음 | 201, 요청 `rejected` | **409 동일**, 객체 상태 유지 |
| `INSPECTION_REQUESTED → IN_PROGRESS` | 공백만 | 201, 요청 `rejected` | **409 동일** |
| `INSPECTION_REQUESTED → IN_PROGRESS` | 사유 | 201, 요청 `rejected` | 201, 요청 `rejected` |
| `MISMATCH → IN_PROGRESS`(=`accept_rework`, 미결 inspection 없음) | 없음 | 201 | **201**(음성 대조군 — 막히지 않는다) |

**기존 스위트 폭발 반경 = 0.** 가드를 넣은 채 전량을 돌렸다:

```
726 passed, 1 warning in 61.39s     ← 기준선과 같다(0 실패, 0 신규)
```

**즉 이 불변식은 넣자마자 무보호다** — ADR 0011 §3 이 관측한 것과 같은 자리이고, qa 작업이 이 계획의
일부인 이유다(§검증 시나리오).

## 1-f. 한정어 역방향 확인 표 (§6-3 산출물 — 각 칸은 실행값 또는 코드 인용)

| 한정어 | 빼면 무엇이 더 들어오는가 | 이 단어 때문에 무엇이 빠지는가 | 근거(실행값·코드) |
|---|---|---|---|
| `decision == "rejected"` | `approved`·`on_hold` 까지 사유 필수 → CM 상시 업무 30칸이 막힌다 | 승인·보류의 사유 부재 | 실측: 가드 후 `approved`·`on_hold` 30칸 전부 200(§1-e 표). 화면도 그 둘에 `requireNote` 를 넘기지 않는다(`ReviewsPage.tsx:177` 은 `decision === "rejected"` 만) |
| **(빠지는 것을 태웠다)** 승인에도 요구하면? | `inspection/approved` = 검측 승인이 사유 없이는 불가 | — | 기각. ADR 0011 §Deferred 1 이 "실측 없이 정하지 않는다"로 미뤄 둔 항목이고 이 사이클 범위 밖. 그대로 Deferred(§Deferred 1) |
| kind 를 가르지 **않는다**(5 kind 전부) | — | kind 별 예외 | 코드 인용: `ReviewsPage.tsx:177` `requireNote={pending?.decision === "rejected"}` 는 kind 를 보지 않는다. 서버를 kind 로 가르면 화면·서버 축이 어긋난다(§1-c) |
| `not (note or "").strip()`(공백만 거부) | 없음 | 공백 한 칸이 사유로 통과하는 경우 | 실측: HEAD 에서 `note="   "` 반려는 200 이고 `resolution_note` 에 `"   "` 가 그대로 저장된다(§1-e 기준선). 화면은 `ConfirmDialog.tsx:44` 에서 `!note.trim()` 으로 잠그지만 API 직접 호출에는 그 방어가 없다 |
| 자리 B 의 `미결 inspection 이 있을 때` | 모든 CM 전이(→IN_PROGRESS·→MISMATCH)에 사유 필수 | 검토요청을 닫지 않는 전이(`accept_rework` 등) | 실측 음성 대조군: `MISMATCH → IN_PROGRESS`, note 없음 → **201**(막히지 않는다) |
| 자리 B 를 `close_inspection_reviews` 에 둔다(`StateTransition._check` 가 아니라) | — | 모델 검증자로는 이 조건을 볼 수 없다 | 코드 인용: `state.py::StateTransition._check` 는 `session` 을 갖지 않아 "미결 inspection 이 있는가"를 물을 수 없다. `close_inspection_reviews(session, project_id, global_id, transition)`(`state_machine.py:132`)가 그 사실을 아는 유일한 자리다 |
| 술어를 `packages/core/models/review.py` 에 둔다 | — | 서비스 층에 두면 세 소유가 각자 복제한다 | 1-a 표: `rejected` 를 쓰는 세 자리가 progress-engine·api·sync-2d3d 로 소유가 전부 다르다. 공통 상위는 `packages/core` 뿐이다 |

*같은 문서·인접 절과의 교차 확인.* ADR 0011 §Decision 규칙 1-a 표 3행은 `resolve_review` 의
`kind=="inspection"` `except` 가 `decision=="rejected"` 를 `log.info` 로 삼킨다고 적었다. **이 계획의 자리 B
예외가 정확히 그 `except` 를 지난다.** `ReviewRejectionReasonRequiredError` 를 `InvalidTransitionError` 의
하위 타입으로 만들면 그 `log.info` 가 이 예외를 조용히 삼킨다 — 그래서 **하위 타입으로 만들지 않는다**
(`Exception` 직속). 실측으로 확인: 절제 트리에서 `inspection/rejected/없음` 이 `log.info` 로 사라지지 않고
409 로 나갔다(§1-e 표 첫 행). ADR 0011 이 그 칸에 적어 둔 "이 `log.info` 가 침묵 경로가 되는 조건"에
**세 번째 조건이 늘어난다**: ③ `resolve_review` 의 inspection 분기가 던지는 새 예외가
`InvalidTransitionError` 하위 타입이면. ADR 0012 가 그 칸을 갱신한다.

## 1-g. §6-4 — 이 사이클이 함께 고치는 문구 둘 (Deferred 로 넘기지 않는다)

**(가) CM 이 적은 사유가 화면에 표시되지 않는다.** `inspection` 반려는 두 경로 모두 `resolution_note` 를
`close_inspection_reviews`(`state_machine.py:144-145`)의 **기계 문자열**로 덮는다. 실측:

```
[NOTE LANDING]
{"경로":"큐 반려",       "review.resolution_note":"INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-…); transition_id=…",
                        "transition.evidence.note":[["PLANNED","REPORTED","착수"],["REPORTED","INSPECTION_REQUESTED","검측"],
                                                    ["INSPECTION_REQUESTED","IN_PROGRESS","3층 배근 미시공"]]}
{"경로":"객체 패널 반려", "review.resolution_note":"INSPECTION_REQUESTED -> IN_PROGRESS by cm (u-cm-…); transition_id=…",
                        "transition.evidence.note":[…,["INSPECTION_REQUESTED","IN_PROGRESS","3층 배근 미시공"]]}
```

`ReviewsPage.tsx:155-158` 은 그 값을 `처리 메모: {r.resolution_note}` 로 보여준다. **즉 사유를 필수로 만든
바로 다음 화면이 그 사유 대신 `transition_id=…` 를 보여준다.** 사유가 사라지지는 않는다(전이 evidence 에
있다) — 그러나 CM 이 큐에서 읽는 자리에 없다. `close_inspection_reviews` 가 `transition.evidence.note` 를
`resolution_note` 에 함께 적도록 고친다(기계 문자열은 남기고 사유를 앞에 붙인다).

**(나) 객체 패널의 `reject_inspection`·`flag_mismatch` 다이얼로그 문구.** 지금은
`ObjectDetailPanel.tsx:413` 의 일반 문구(`'시공중' 상태로 전이를 요청합니다.`)뿐이라, 이 전이가 **검토요청을
반려로 닫는다**는 사실을 말하지 않는다. 가드가 서면 사유 칸도 필수가 되므로, 그 사실을 문구가 말해야 한다.
**문장을 베끼는 테스트를 만들지 않는다**(§6-4 3) — "그 상황에서 참일 수 없는 말이 없다"만 단언한다.

---

# 과제 2 — `cause` 정본을 `packages/core` 로 올리고, 못 닫는 쪽은 기계적 감사로 덮는다

## 2-a. 정본 자리 전수 — 다시 셌다

**생성 기준(§6-1 ①).** 저장소 루트에서, 소유·계층으로 좁히지 않고:

```
$ cd /home/user/Bim && grep -rn "row_moved\|row_replaced\|row_absorbed" . \
    | grep -v "/node_modules/" | grep -v "/.git/" | grep -v __pycache__ \
    | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

```
    60 ./buildtwin/docs/adr/0009-document-identity-vs-matching-normalization.md
    53 ./buildtwin/apps/web/src/domain/identityDrift.test.ts
    48 ./buildtwin/tests/integration/test_17_document_identity_drift.py
    35 ./buildtwin/apps/web/src/domain/identityDrift.ts
    33 ./buildtwin/apps/web/src/pages/ReviewsPage.test.tsx
    22 ./buildtwin/services/progress/document_mapper.py
    17 ./buildtwin/tests/unit/progress/test_identity_drift_review_title.py
    15 ./buildtwin/docs/plans/0003-document-identity-freeze.md
    12 ./buildtwin/.pytest_cache/v/cache/nodeids          ← 생성물(git 미추적)
     7 ./buildtwin/services/ingest/persistence.py
     7 ./buildtwin/apps/web/src/api/types.ts
     6 ./buildtwin/apps/web/src/pages/ReviewsPage.tsx
     3 ./buildtwin/packages/core/models/review.py
     3 ./buildtwin/config/document_register.yaml            ← **과제 지시의 목록에 없던 파일**
     2 ./buildtwin/.pytest_cache/v/cache/lastfailed        ← 생성물
     1 ./buildtwin/docs/glossary.md
```

**과제 지시가 준 목록과 두 곳이 다르다**: `config/document_register.yaml`(3건)이 더 있고,
`.pytest_cache/`(생성물, git 미추적) 둘이 잡힌다. 앞의 것이 실질이다.

**"정본 자리"를 무엇으로 셀 것인가 — 계수의 기준.** 나는 **"그 문자열이 실행 중에 값으로 쓰이거나
값 집합을 선언하는 자리"** 로 센다. 이 기준을 고른 이유: ADR 0009 §Deferred 5 가 이 목록을 만든 목적이
"새 경위를 추가하거나 이름을 바꾸는 변경이 함께 고쳐야 하는 자리"이고, 그 목적에는 **런타임이 읽는 것**만
필요하기 때문이다.

| # | 자리 | 형태 | ADR 0009 §Deferred 5 목록에 있는가 |
|---|---|---|---|
| 1 | `services/ingest/persistence.py:58-60` | 생산. `_CAUSE_ROW_*` 상수(현 정본) | 예(1번) |
| 2 | `services/progress/document_mapper.py:86-91,95,576` | 소비·문구. `_CAUSE_ROW_*` + `_CAUSE_UNSPECIFIED` + `_CAUSE_ORDER` + `IdentityDriftCause = Literal[…]`(**같은 파일 안 두 번째 선언**) | 예(2번) |
| 3 | `apps/web/src/api/types.ts:392` | `export type IdentityDriftCause = "row_moved" \| "row_replaced" \| "row_absorbed"` | **아니오** |
| 4 | `apps/web/src/domain/identityDrift.ts:31,34-38,57-61,68-72,98-107` | `IdentityDriftCauseKind` + `SERVER_CAUSE_TO_LOCAL` + `ORDER`/`LABELS`/`NOTES` 세 Record | 예(3번) |
| 5 | `config/document_register.yaml:254,260,261` | 경고 메시지 정본(런타임 로드, **사용자에게 보이는 문구**) | **아니오** |
| (6) | `packages/core/models/review.py:22-39` | 상수가 아니라 **주석** — 이름 붙은 블라인드 스팟 | 예(4번) |

**즉 런타임 자리는 넷이 아니라 다섯이고**, ADR 0009 가 세지 못한 둘은 **화면 타입 파일**과 **config 메시지**다.

*이 계수가 무엇에 기대는가(§6-1 ②, 그리고 "개수 단정은 결론이 기댈 때만 쓴다").* 이 문서의 결론(=감사가
덮어야 할 자리 목록)이 이 개수에 직접 기대므로 개수를 적는다. 다만 **세 가지 판단에 기댄다**:
① `packages/core/models/review.py` 의 **주석**은 런타임이 읽지 않으므로 "정본 자리"가 아니라 **기록**으로
셌다(그래서 괄호). 과제 2 이후에는 **정의가 되어 1~5 와 같은 줄에 선다** — ADR 0009 §Deferred 5 가
"그때 4번은 주석이 아니라 정의가 된다"고 예고한 그대로다.
② `config/document_register.yaml` 은 값 비교에 쓰이지 않고 **문구**에만 쓰이지만, 런타임이 로드하고
CM 이 읽으므로 넣었다(§6-4: 문구는 장식이 아니다). 이 판단을 뒤집으면 넷이 된다.
③ `docs/`(ADR·계획·glossary)는 **기록**이지 정본이 아니다 — 근거: 이 세 문서는 **옛 이름을 의도적으로
보존한다**(ADR 0009 §5-2 (마) 개명 표, glossary:274 "옛 이름 셋 … 폐기했고 … 번역하지 않는다").
개명이 일어나도 그 문장들은 **참인 채로 남아야 한다.** 그러므로 자동 감사의 대상이 되어서는 안 된다 —
넣으면 감사가 정본을 거짓으로 만든다.

*이 목록이 놓치는 것(§6-1 ②).* 축이 **현재 값 셋의 문자 그대로**라, ① 다른 표기(주석에서 `row-moved`,
한국어 "행 이동")는 밖이고 ② **아직 존재하지 않는 네 번째 경위 이름**은 원리상 밖이다.
*블라인드 스팟 한 건 실측*: ①을 태웠다 —
`grep -rniE "row[- ]moved|row[- ]replaced|row[- ]absorbed" . | grep -v node_modules | grep -v "/.git/" | grep -v "row_"`
→ **0건**(이 계획 문서 자신이 그 패턴을 인용하므로, 문서가 쓰이기 전 실행 기준). 표기 변종은 이 저장소에 없다.

## 2-b. 이 작업이 실제로 닫는 구멍과 **닫지 못하는 것**

**파이썬과 TS 는 같은 상수를 공유할 수 없다.** 그러므로:

- **닫는다**: 파이썬 쪽 **세 자리**(생산 `services/ingest` · 소비 `services/progress` · 그리고
  `packages/core/models/review.py` 의 주석 → 정의) 가 **한 정의**가 된다. 실현 가능성은 절제로 확인했다
  (별도 트리 `tree2` 에서 정본을 `review.py` 로 올리고 두 서비스가 import 하도록 고쳤다):
  ```
  $ python -c "import services.progress.document_mapper as dm, services.ingest.persistence as ip; print(dm._CAUSE_ROW_MOVED, dm._CAUSE_UNSPECIFIED, dm.IdentityDriftCause); print(ip._CAUSE_ROW_MOVED, ip._CAUSE_ROW_ABSORBED)"
  row_moved unspecified typing.Literal['row_moved', 'row_replaced', 'row_absorbed']
  row_moved row_absorbed
  $ pytest tests/unit tests/invariants tests/regression tests/integration -q
  726 passed, 1 warning in 61.05s        ← 기준선과 동일. import 순환 없음
  ```
- **닫지 못한다**: `apps/web/src/api/types.ts`, `apps/web/src/domain/identityDrift.ts`,
  `config/document_register.yaml`. 이 셋은 여전히 **별도 선언**이다.

**닫지 못하는 쪽을 지금 무엇이 지키는가 — 실측으로 답한다.** 값을 **파이썬 전 계층에서 일관되게**
개명하고(생산·소비·파이썬 테스트 전부: `row_absorbed` → `row_relocated`) TS·config·문서를 그대로 둔 뒤
전량을 돌렸다:

```
pytest : 728 passed, 1 warning in 61.95s     (= 기준선 726 + 이 절제용 탐침 2건, 실패 0)
vitest : Test Files 28 passed (28) / Tests 262 passed (262)
```

**아무것도 지키지 않는다.** 그 상태의 제품은: 서버가 `row_relocated` 를 실어 보내고 →
`classifyIdentityDriftCause` 가 `SERVER_CAUSE_TO_LOCAL` 에서 못 찾아 **모든 항목을 `unspecified`("경위 미상")**
로 보내고 → `config/document_register.yaml` 의 경고 문구는 존재하지 않는 값 이름을 CM 에게 읽어 준다.
**예외 없음, 테스트 전원 통과, 화면 정상** — 이 저장소의 지배적 실패 모드 그대로다.

**대조군(§6-2 3)**: 같은 개명을 **생산자에만** 하면(소비자·테스트는 그대로) 통합 5건이 깨진다
(`test_17_document_identity_drift.py` 4건 + `test_v8d…` 1건). 즉 기존 그물은 **파이썬 안의 불일치**는
잡지만 **파이썬 ↔ TS/config 의 불일치**는 못 잡는다. 그 경계가 정확히 이 과제가 메울 자리다.

## 2-c. 기계적 감사 — 설계와 **시제품 실측**

산문으로 "주의한다"고 적지 않는다(§6-1: 산문으로 닫히지 않는다). **불변식 테스트 한 건**을 만든다 —
자리는 `tests/invariants/`(qa 소유), 형식은 이미 있는 grep 기반 lint
(`test_no_hardcoded_coordinate_constants_in_services_and_viewers`)와 같다.

**감사 대상(9칸)과 기대값:**

| 칸 | 추출 방법 | 기대 |
|---|---|---|
| 정본 | `packages/core/models/review.py` 의 `IDENTITY_DRIFT_CAUSES` **import** | — |
| `services/progress/document_mapper.py` `_CAUSE_ROW_*` | 정규식 | == 정본 |
| `services/progress/document_mapper.py` `IdentityDriftCause = Literal[…]` | 정규식 | == 정본 |
| `apps/web/src/api/types.ts` `IdentityDriftCause` 유니온 | 정규식 | == 정본 |
| `apps/web/src/domain/identityDrift.ts` `IdentityDriftCauseKind` | 정규식 | == 정본 ∪ {`unspecified`} |
| 〃 `SERVER_CAUSE_TO_LOCAL` 키 | 괄호 균형 파서 | == 정본 |
| 〃 `IDENTITY_DRIFT_CAUSE_ORDER` | 〃 | == 정본 ∪ {`unspecified`} |
| 〃 `IDENTITY_DRIFT_CAUSE_LABELS` / `…_NOTES` 키 | 〃 | == 정본 ∪ {`unspecified`} |
| `config/document_register.yaml` 의 `row_[a-z_]+` 토큰 | 정규식 | ⊆ 정본 |
| `packages/core/models/review.py` **주석**의 `row_[a-z_]+` 토큰 | 정규식 | == 정본 |

**시제품을 실제로 태웠다.** 현행 트리:

```
[CANON] ['row_absorbed', 'row_moved', 'row_replaced']
[py_consumer] … OK   [py_literal] … OK   [ts_types.IdentityDriftCause] … OK
[ts_kind] … OK   [ts_SERVER_CAUSE_TO_LOCAL] … OK   [ts_ORDER] … OK
[ts_LABELS] … OK   [ts_NOTES] … OK   [config yaml tokens] … OK
[LEGACY leak] none
```

**§6-2 — 결함 있는 코드가 이 단언을 그대로 만족하는가?** 만족하지 않는다. 위 2-b 의 "파이썬만 일관 개명"
상태(pytest 728 / vitest 262 **전원 통과**)에 같은 감사를 태우면:

```
[CANON] ['row_moved', 'row_relocated', 'row_replaced']
[py_consumer] … OK          [py_literal] … OK
[ts_types.IdentityDriftCause] … MISMATCH
[ts_kind] … MISMATCH        [ts_SERVER_CAUSE_TO_LOCAL] … MISMATCH
[ts_ORDER] … MISMATCH       [ts_LABELS] … MISMATCH       [ts_NOTES] … MISMATCH
[config yaml tokens] … MISMATCH
```

**그리고 역사적 결함을 실제로 잡는가 — `git show` 로 확인했다.** ADR 0009 개정 2 의 개명 커밋 시점:

```
$ git show 71fc0de:buildtwin/packages/core/models/review.py | grep -oE "row_[a-z]+" | sort -u
                                                             ← 0건(빈 출력)
$ git show 71fc0de:buildtwin/services/progress/document_mapper.py | grep -oE '_CAUSE_ROW_[A-Z]+ = "[a-z_]+"'
_CAUSE_ROW_MOVED = "row_moved" _CAUSE_ROW_REPLACED = "row_replaced" _CAUSE_ROW_ABSORBED = "row_absorbed"
$ git show 10121d7:buildtwin/packages/core/models/review.py | grep -oE "row_[a-z]+" | sort -u
row_absorbed row_moved row_replaced                          ← 한 개정 뒤에야 고쳐졌다
```

**`71fc0de` 에서 review.py 의 토큰 집합은 공집합이고 코드는 셋이다 → 위 마지막 칸이 그 커밋에서 실패한다.**
그 결함을 잡은 것은 그때 아무 테스트도 아니었다(주석이라 CI 가 침묵 — ADR 0009 §Deferred 5 가 적은 그대로).

*이 감사가 놓치는 것(§6-1 ②).* ① **값 집합만 비교하고 의미는 비교하지 않는다** — 두 이름을 서로 맞바꾸는
개명은 모든 칸을 통과한다. ② `config` 스캔의 축이 `row_` **접두사**라, `row_` 로 시작하지 않는 새 경위
이름은 config 칸에서 보이지 않는다. ③ 옛 이름(`orphaned` 등)의 유출은 **구조적으로 추출한 집합 안에서만**
본다 — 저장소 전체 grep 으로 넓히면 못 쓴다: `orphaned` 는 **살아 있는 무관한 개념**이다
(`is_orphaned`, `orphaned_global_ids`, `DocumentsPage.tsx:84,154`, `ObjectDetailPanel.tsx:132` — 실측 히트 다수).
④ **`docs/` 는 대상이 아니다**(§2-a 기준 ③).

## 2-d. 저장된 과거 기록 — 그 갈래가 이 변경에서 어떻게 되는가 (실측)

ADR 0009 가 규칙으로 올린 것: *"저장된 과거 기록을 읽는 소비자는 생산 시점 계약을 읽는 소비자보다
'값이 없다' 갈래를 하나 더 가진다."* 그 갈래를 양쪽에서 실제로 태웠다(현행 HEAD 코드).

**서버**(`_identity_drift_review_title`, 옛 이름 둘을 실은 `lost_decisions` 를 넣음):

```
문서 식별 드리프트: CM 판단 1건(확정 0 · 반려 1)이 … 걸렸습니다(경위 'merge_overwritten' —
이 문구가 설명할 수 없는 경위입니다. lost_decisions 를 직접 보십시오). 또한 CM 판단 1건(확정 1 · 반려 0)이
… (경위 'orphaned' — 이 문구가 설명할 수 없는 경위입니다. …) — 확인용 요청입니다(매핑은 복구되지 않습니다).
```

**화면**(`groupLostDecisionsByCause` + `identityDriftGroupFacts`, 같은 입력):

```
[{ "cause":"unspecified", "rawCause":"merge_overwritten", "confirmed":0, "rejected":1,
   "facts":["도면 승인 근거가 뒤집혔습니다 — 문서 1건의 승인 상태가 이번 적재에 달라졌습니다.",
            "달라진 대장 원문: 발신.","다시 판단할 새 doc_id 는 없습니다."] },
 { "cause":"unspecified", "rawCause":"orphaned", "confirmed":1, "rejected":0,
   "facts":["다시 판단할 곳: doc-2."] }]
```

**관측 셋.** ① 양쪽 모두 **원문 문자열을 보존**하고 옛 이름을 새 갈래로 번역하지 않는다(ADR 0009 §5-3-a).
② 양쪽 모두 **모르는 값별로 따로 묶는다**(둘이면 두 묶음) — 서버와 화면이 같은 규칙이다.
③ 문장은 **경위 이름이 아니라 값**(`approval_flipped`·`changed_fields`·`new_doc_id`)에서 나오므로,
경위를 몰라도 CM 이 읽을 것이 남는다.

**이 리팩터가 조용히 깨뜨릴 수 있는 것 — 셋.**

| 위험 | 무엇이 깨지는가 | 지금 무엇이 막는가 | 계획의 대응 |
|---|---|---|---|
| ① 정본을 올리면서 `LostDecision.cause` 를 `str` 에서 `IdentityDriftCause`(Literal)로 **좁히는 것** | 저장된 옛 기록을 실은 `IdentityDriftReport` 검증에서 항목이 통째로 튕겨 적재 job 이 실패하거나 사건이 삼켜진다(그 결과가 `document_mapper.py:590-593` 에 이미 적혀 있다) | 코드 주석뿐(`document_mapper.py:590` "`cause` 를 `IdentityDriftCause` 로 좁히지 않는다") | 감사에 **음성 단언**을 넣는다. `LostDecision` 은 pydantic 모델이 아니라 **`TypedDict`**(`document_mapper.py:583`)이므로 `typing.get_type_hints(LostDecision)["cause"] is str` 로 본다 |
| ② 정본 집합에 옛 이름을 **별칭으로 추가**하는 것("호환을 위해") | `SERVER_CAUSE_TO_LOCAL` 이 옛 이름을 새 갈래로 번역하게 되고, ADR 0009 §5-3-a 가 금지한 "고아가 아닌 것을 고아라 부르기"가 되살아난다 | 산문 금지(§5-3-a)뿐 | 감사의 `[LEGACY leak]` 칸: 정본·소비 집합 어디에도 `orphaned`/`merge_overwritten`/`merge_absorbed` 가 없어야 한다 |
| ③ `unspecified` 를 정본 집합에 **넣는 것** | 생산자가 `unspecified` 를 실어 보낼 수 있게 되어 "모른다"가 값이 된다 | 없음 | `IDENTITY_DRIFT_CAUSES` 에는 셋만 넣고 `IDENTITY_DRIFT_CAUSE_UNSPECIFIED` 는 **소비 전용 자리표시자**로 따로 둔다. 감사가 `SERVER_CAUSE_TO_LOCAL == 정본`(unspecified 불포함)을 단언한다 |

*역방향 확인 — "저장된 과거 기록"이라는 한정어가 미는 것.* 이 절은 **이미 저장된 것**만 본다.
**아직 저장되지 않았지만 앞으로 옛 이름으로 들어올 것**(예: 외부 백필 스크립트)은 밖이다.
그런 경로가 지금 있는지 실측: `grep -rn "lost_decisions" --include=*.py services/ scripts/` 의 쓰기 자리는
`services/ingest/persistence.py` 하나이고 `scripts/` 에는 0건이다. 밖에 둔다.

---

# 과제 3 — CLAUDE.md §6-1 압축 (완료, 이 사이클에서 수행)

**한 절만 손댔다.** §6-2·§6-3·§6-4·§6-5 는 건드리지 않았다(§6-5 압축 규칙 블록의 **상태 줄**만 갱신했다 —
"다음: §6-1 하나만"이 이번 사이클에 거짓이 되므로. §6-4 규칙 1).

## 3-a. 옛 불릿 ↔ 새 행 대조표

옛 §6-1 = `CLAUDE.md` 191~253행(63줄). 새 §6-1 = 191~236행(46줄).

| 옛 불릿(옛 줄) | 옛 텍스트의 관측값 | 어디로 갔나 | 잃은 것 |
|---|---|---|---|
| 0008 계획(193-194) | 시그니처 바뀐 호출부 / Celery 잡 예외 삼킴 | **표 1행** | 없음 |
| 0009 계획 §1-a(195-197) | `orphaned=0`, `fingerprint_changed=False`, "폭발 반경은 같아도 관측 가능성이 달랐다" | **표 2행**(밀려난 것 = "관측 가능성(폭발 반경은 같다)") | 없음 |
| 0009 계획 §7(198-199) | `mapping_count == 6` 인데 정상 코드에서 4 | **표 3행** | 없음 |
| 0009 ADR, 두 사이클 연속 누락(200-207) — **관측 둘이 한 불릿에 있었다** | (a) 개정 2 `cause` 정본 목록 기준 = "값이 흐르는 세 층" (b) 재심 `moved=9` 목록 기준 = 실제로 친 grep | **표 4행 + 5행으로 나눴다**(압축 규칙: 대응되지 않는 관측값이 있으면 행을 나눈다) | 없음. "둘 다 작업 분배의 모양이라 그 칸이 없다"는 5행 관측값 칸에, "주석이라 CI 가 못 잡는다"는 4행 관측값 칸에 |
| 계획 0004 백로그 1(209-214) | 목록 `REPORTED` / 상세 `PLANNED`, "기준은 방향도 가진다" | **표 6행**(밀려난 것 칸에 "방향" 포함) | 없음 |
| 이름 붙은 블라인드 스팟 문단의 **근거 부분**(240-244) | `state.py:94` 시제 문장이 `3f358db` 로 거짓 / "핸들러는 다섯뿐"이 같은 커밋으로 거짓 | **표 7행**(새 행 — 옛 텍스트에서는 규칙 문단 안에 섞여 있었다) | 없음 |
| **규칙** 문단(216-219) | — | 그대로. **"관계를 세는 목록은 곱으로"** 를 옛 209-214 불릿 끝에서 규칙 문단으로 **올렸다**(규칙이므로 표에 두면 안 된다) | 없음 |
| 경로 좁힘 문단(228-229) | "관측된 두 번 다 자기 파일 쪽" | 규칙 문단 마지막 문장으로 합쳤다(`4·5회차` 참조 추가) | 없음 |
| 역방향 확인 — 표기 변종(221-226) | `moved = 9`·`moved: 9`·`이동 9건`·`9쌍`·"아홉", 실측 0건 | 그대로(규칙) | 없음 |
| 역방향 확인 — "언제나" 금지(231-234) | 표본 2건 | 그대로(규칙). "개정 2 의 `cause` 정본 목록 / 재심의 `moved=9` 목록"이라는 **서사**를 `4·5회차` 참조로 바꿨다 | **서사만**(회차·파일명·관측값은 표 4·5행에 있다) |
| 이름 붙은 블라인드 스팟의 **규칙 부분**(236-244) | — | 그대로. 근거 문장 셋(초판이 좁혀 3회차를 밀어냈다 / `state.py:94` / "다섯뿐")을 **표 7행 참조**로 바꿨다 | **서사만** |
| 역방향 확인 — "자기 파일 밖에"(245-247) | — | 그대로 | 없음 |
| *새 항목을 만들지 않는다*(248-253) | — | 그대로 | 없음 |

**기계적 확인 — 옛 텍스트에 있고 새 텍스트에 없는 토큰 전수:**

```
검사 토큰 24종: session.get( / Celery / orphaned=0 / fingerprint_changed=False / mapping_count == 6 /
review.py / moved=9 / useCreateDailyReport / REPORTED / PLANNED / moved = 9 / moved: 9 / 이동 9건 / 9쌍 /
아홉 / 0건 / state.py:94 / 3f358db / 다섯뿐 / §7 V4 / §6-4 1 / §6-5 / docs/plans/0004-*.md / 바로 위 줄이 선례다
[옛 텍스트에 있었으나 새 텍스트에 없는 토큰] 없음
```

**외부가 §6-1 을 인용할 때 쓰는 문구 전수 보존 확인**(`grep -rn "§6-1" .` 로 인용문을 모아 대조):

```
'그 기준이 놓치는 것' OK / '저장소 루트에서 만든다' OK / '이름 붙은 블라인드 스팟' OK /
'다른 절을 가리켜 확인을 갈음하지 않는다' OK / '"놓칠 수 있다"고 적는 것은 커버리지가 아니다' OK /
'결과가 아니라 기준에서' OK / '적어 둔 블라인드 스팟을 최소 한 건은 실제로 태워 본다' OK /
'관계를 세는' OK / '곱' OK / 'packages/core/models/' OK / '셋 중 하나만 잡는다' OK
```

## 3-b. 역방향 확인 — 압축 뒤에도 그 둘을 §6-1 이 여전히 잡는가

과제 지시가 지목한 두 실측 사례를 **새 표에서 거꾸로 찾았다**.

| 실측 사례 | 새 §6-1 어디에 | 표 안에서 그 사례를 재구성할 수 있는가 |
|---|---|---|
| `packages/core/models/` 주석이 **두 사이클 연속** 전수 목록에서 빠진 것 | **표 4행 + 5행**(+ 규칙 문단 "관측된 두 번 다 … 자기 파일"과 "표본은 2건뿐(4·5회차)") | 예. 4행이 "어느 기준으로 만든 목록이 무엇을 밀어냈고 관측값이 무엇인지"를, 5행이 "같은 자리 두 번째"를 갖는다. 파일명도 두 행에 있다 |
| "A 가 B 를 덮는가" 목록이 **역방향을 못 묻는** 것 | **표 6행** + 규칙 문단의 `"A 가 B 를 덮는가"로 만든 목록은 "B 가 A 를 덮는가"를 영원히 묻지 못한다` | 예. 6행의 밀려난 것 칸이 "그 기준에는 상세 방향을 볼 칸이 없다 — 기준은 범위뿐 아니라 방향도 가진다", 관측값 칸이 목록 `REPORTED` / 상세 `PLANNED` |

*추가로 확인한 것*: 세 번째 실측 사례(`state.py:94` 시제 문장 + "다섯뿐")는 옛 텍스트에서 **규칙 문단 안에
서사로만** 있었다. 압축이 그것을 **표 7행으로 승격**했으므로 잃지 않았다.

## 3-c. 압축의 실측 이득 — 그리고 그것이 말하는 것

| | 압축 전 | 압축 후 | 차이 |
|---|---|---|---|
| §6-1 줄 수 | 63 | 46 | **-17줄** |
| CLAUDE.md 전체 줄 | 389 | 372 | -17 |
| §6 줄 비중 | 54.8% | **52.7%** | -2.1%p |
| CLAUDE.md 전체 문자 | 20,782 | 20,641 | **-141자** |
| §6 문자 비중 | 58.8% | **58.6%** | -0.2%p |

**표는 같은 관측값을 더 적은 줄에 담지만 더 적은 문자에 담지는 않는다.** 남은 §6-1 의 대부분은
**규칙**이고 규칙은 압축 대상이 아니므로(§6 압축 규칙), "읽히는 길이"를 근거 압축만으로 끌어내리는 데에는
**상한**이 있다. 이 사실을 CLAUDE.md §6-5 압축 규칙에 한 줄로 적어 두었다 — 다음 압축(§6-2·§6-4)이 이
상한을 알고 시작하도록. **압축 자체를 멈추자는 뜻이 아니다**: 손실 0 으로 17줄을 줄였고, 그 검증
가능성(대조표 + 토큰 전수 + 인용 문구 전수)이 이 사이클의 산출물이다.

---

## 영향 범위

| 층 | 파일 | 과제 |
|---|---|---|
| 데이터 모델 | `packages/core/models/review.py` | 1(술어·예외) · 2(`cause` 정본 정의) |
| 서비스 | `services/api/usecases.py`, `services/api/errors.py` | 1 |
| 서비스 | `services/progress/state_machine.py`, `services/progress/document_mapper.py` | 1(자리 B·문구) · 2(import) |
| 서비스 | `services/ingest/persistence.py` | 2(import) |
| 화면 | `apps/web/src/api/client.ts`, `components/ErrorBox.tsx`, `components/ObjectDetailPanel.tsx` | 1 |
| 문서 | `docs/glossary.md`, `docs/api.md`, `docs/adr/0012-*.md`, `docs/adr/0009-*.md` | 1 · 2 |
| 테스트 | `tests/integration/test_19_*.py`, `tests/invariants/test_identity_drift_cause_contract.py`, `apps/web/src/**/*.test.tsx` | 1 · 2 |
| 규약 | `CLAUDE.md` §6-1 | 3 — **완료** |

---

## 작업 분배

축은 **"한 소유가 한 커밋으로 끝낼 수 있는 단위"** 다. (계획 0004 §6-3 8회차가 "ADR 규칙 하나당 한 행"
축을 써서 시나리오 V8~V10 을 무주공산으로 만든 것을 피한다 — 아래 §검증 시나리오의 **모든** V 가 어느
작업의 완료 조건에 들어가는지 마지막 열에서 확인할 수 있다.)

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 | 완료 조건 | 시나리오 |
|---|---|---|---|---|---|---|
| 1 | **architect** | `docs/adr/0012-rejecting-a-review-requires-reason.md` | 이 계획 §과제 1 | ADR 0012 | 불변식 4·자리 둘·code·부가 필드 계약이 적힘. ADR 0011 §Decision 규칙 1-a 표 3행의 "도달 가능해지는 조건"에 **③ 하위 타입이면**을 추가 | — |
| 2 | **architect** | `packages/core/models/review.py` | ADR 0012 · ADR 0009 §Deferred 5 | ① `ReviewRejectionReasonRequiredError`(**`Exception` 직속** — §1-f 교차 확인) + `rejection_reason_missing()` ② `IDENTITY_DRIFT_CAUSE_*` 정본 + `IDENTITY_DRIFT_CAUSES` + `IdentityDriftCause` | **architect 단독 커밋 2건으로 뗀다**(CLAUDE.md §2 — 과제 1 분과 과제 2 분을 섞지 않는다). `LostDecision.cause` 를 좁히지 않는다 | V11 |
| 3 | **api** | `services/api/usecases.py`, `services/api/errors.py`, `docs/api.md` | 작업 2 | `resolve_review` 프롤로그 가드(자리 A) + `_rejection_reason_required` 핸들러(409, `review_request_ids`·`review_kind`) + `transition_object` 에 `except ReviewRejectionReasonRequiredError: session.rollback(); raise` | 45칸 곱이 §1-e "가드 후" 표와 일치. `docs/api.md` 재생성 | V1~V4 |
| 4 | **progress-engine** | `services/progress/state_machine.py` | 작업 2 | `close_inspection_reviews` 가드(자리 B) + CM 사유를 `resolution_note` 에 함께 적기(§1-g 가) | 자리 B 구/신 표 5행 일치. `accept_rework` 음성 대조군 201 유지 | V5~V7, V12 |
| 5 | **frontend** | `apps/web/src/api/client.ts`, `components/ErrorBox.tsx`, `components/ObjectDetailPanel.tsx` | 작업 3·4 | `KnownApiErrorCode` 에 `rejection_reason_required` 추가 → `CODE_MESSAGES` 컴파일 강제. `REVOCATION_KINDS` 옆에 `REVIEW_REJECTING_KINDS`(`reject_inspection`·`flag_mismatch`)를 두고 `requireNote` 를 넘긴다. 다이얼로그 문구(§1-g 나) | 문구에 "새로고침"이 없고 "사유"가 있다. `tsc --noEmit` 통과 | V8~V10 |
| 6 | **architect** | `docs/glossary.md` | 작업 3 | "오류 응답 code 어휘" 표에 `rejection_reason_required` 행 + ADR 0012 부칙(부가 필드가 `from_state` 계열이 **아닌** 이유) | 부칙 append-only 유지 | — |
| 7 | **progress-engine** + **bim-ingest** | `services/progress/document_mapper.py`, `services/ingest/persistence.py` | 작업 2 | `_CAUSE_ROW_*`·`_CAUSE_UNSPECIFIED`·`IdentityDriftCause` 를 정본 import 로 교체 | **작업 트리에서 `pytest` 738 유지**(탐침 트리에서는 726 으로 확인했다 — §0 주의). 두 파일이 문자열 리터럴을 다시 선언하지 않는다 | V13 |
| 8 | **qa** | `tests/invariants/test_identity_drift_cause_contract.py` | §2-c 표 | 9칸 감사 + 자기검증(seeded divergence 를 잡는다) + `LostDecision.cause is str` 음성 단언 + `[LEGACY leak]` | §2-b 의 "파이썬만 일관 개명" 트리에서 **실패**해야 한다 | V13~V15 |
| 9 | **qa** | `tests/integration/test_19_rejection_reason.py`, `apps/web/src/**/*.test.tsx` | §검증 시나리오 | V1~V12 | 각 V 가 §6-2 네 항목을 통과 | 전부 |
| 10 | **architect** | `docs/adr/0009-*.md` | 작업 7·8 | §Deferred 5 를 **닫고**, 정본 자리 목록을 **다섯**으로 고치고(누락 둘: `api/types.ts`·`config/document_register.yaml`), 감사가 그것을 대신한다고 적음 | 목록의 생성 기준과 블라인드 스팟이 함께 적힘 | — |

**커밋 경계(CLAUDE.md §2).** 작업 2 는 `packages/core/models/` 를 건드리므로 **architect 단독 커밋**이다.
작업 3·4·5·7 은 각자 소유 디렉터리만 만진다. 작업 7 은 두 소유(progress-engine·bim-ingest)가 섞이므로
**커밋을 둘로 뗀다** — 뗄 수 없으면 그 이유를 커밋 본문에 적는다.

---

## 인터페이스 정의

```python
# packages/core/models/review.py  (architect)

class ReviewRejectionReasonRequiredError(Exception):
    """불변식 4: 검토요청을 `rejected` 로 닫으려면 비어 있지 않은 사유가 필요하다.

    **`InvalidTransitionError` 를 상속하지 않는다.** 상속하면
    `services/api/usecases.py::resolve_review` 의 inspection 분기가 `decision == "rejected"` 일 때
    `log.info` 로 삼킨다(ADR 0011 규칙 1-a 표 3행이 그 자리를 이미 지목했다).
    """

    def __init__(self, review_kind: str, review_request_ids: list[str], source: str) -> None: ...


def rejection_reason_missing(note: str | None) -> bool:
    """`None`·`""`·공백만이면 True. 세 서비스가 같은 판정을 쓴다."""
    return not (note or "").strip()


# `cause` 정본 (ADR 0009 §Deferred 5 — 지금까지 주석이던 자리가 정의가 된다)
IDENTITY_DRIFT_CAUSE_ROW_MOVED: Final = "row_moved"
IDENTITY_DRIFT_CAUSE_ROW_REPLACED: Final = "row_replaced"
IDENTITY_DRIFT_CAUSE_ROW_ABSORBED: Final = "row_absorbed"
IDENTITY_DRIFT_CAUSES: Final[tuple[str, ...]] = (…MOVED, …REPLACED, …ABSORBED)   # unspecified 는 넣지 않는다
IDENTITY_DRIFT_CAUSE_UNSPECIFIED: Final = "unspecified"                          # 소비 전용 자리표시자
IdentityDriftCause = Literal["row_moved", "row_replaced", "row_absorbed"]
```

```python
# services/api/usecases.py::resolve_review  (api) — 프롤로그, 분기 dispatch 앞
    if row.status != "open":
        raise Conflict(..., code="review_already_resolved")
    if decision == "rejected" and rejection_reason_missing(note):
        raise ReviewRejectionReasonRequiredError(row.kind, [review_request_id], "resolve_review")
```

```python
# services/progress/state_machine.py::close_inspection_reviews  (progress-engine)
    open_rv = db.open_reviews(session, project_id, [global_id], kind="inspection")
    if status == "rejected" and open_rv and rejection_reason_missing(transition.evidence.note):
        raise ReviewRejectionReasonRequiredError(
            "inspection", [r.review_request_id for r in open_rv], "state_transition")
```

```jsonc
// 409 응답 본문 (api) — 두 경로에서 같은 모양
{ "detail": "rejecting review request <id> (kind=<kind>) requires a non-empty reason",
  "code": "rejection_reason_required",
  "review_kind": "inspection",
  "review_request_ids": ["<id>"] }
```

```ts
// apps/web/src/components/ErrorBox.tsx (frontend) — "새로고침"을 말하지 않는다
rejection_reason_required: "반려하려면 사유를 입력해야 합니다. 사유를 적은 뒤 다시 시도하세요.",
```

---

## 검증 시나리오 (§6-2 — 각 항목에 "결함 있는 코드가 이 기대값을 만족하는가?"를 답했다)

| # | 시나리오 | 단언 | 결함 코드가 이 기대값을 만족하는가 |
|---|---|---|---|
| V1 | 5 kind × `rejected` × note 없음 (큐) | 409 **`code == "rejection_reason_required"`**, 요청 `status == "open"` | 아니오. 가드가 없으면 200/`rejected`. **`code` 로 단언한다** — 상태코드만 보면 다른 409 와 구별 불가 |
| V2 | 5 kind × `rejected` × `note="   "` (큐) | V1 과 동일 | 아니오. `.strip()` 을 빼면 200 |
| V3 | 5 kind × `rejected` × 사유 있음 | 200, `status == "rejected"` | 아니오(과잉 차단 방지). 조건을 `decision == "rejected"` 로만 좁혔는지 확인 |
| V4 | 5 kind × {`approved`,`on_hold`} × note 없음 | 200 — **30칸 전수** | 아니오. 조건을 넓힌 구현(모든 결정에 사유)이 여기서 죽는다 |
| V5 | `INSPECTION_REQUESTED → IN_PROGRESS`(cm, note 없음) | 409 `rejection_reason_required` **+ 객체 상태가 `INSPECTION_REQUESTED` 로 남는다 + 요청이 `open` 으로 남는다**(셋을 함께 단언 — §6-2 4) | 아니오. 자리 A 만 고친 구현이 여기서 죽는다(HEAD 실측 201) |
| V6 | `INSPECTION_REQUESTED → MISMATCH`(cm, note 없음) | V5 와 동일 | 아니오. `to_state` 로만 가른 구현(→IN_PROGRESS 만 막음)이 여기서 죽는다 |
| V7 | **음성 대조군** `MISMATCH → IN_PROGRESS`(cm, note 없음, 미결 inspection **없음**) | 201 | **예 — 그래서 V5·V6 과 쌍으로만 의미가 있다.** 이 축이 없으면 "모든 CM 전이를 막는" 구현이 통과한다 |
| V8 | 화면: 객체 패널 `검측 반려(재작업)` 다이얼로그 | 사유 라벨에 "(필수)"가 붙고 사유가 비면 확인 버튼 `disabled` | 아니오. `REVOCATION_KINDS` 만 있는 지금 구현에서 `false`(실측) |
| V9 | 화면: `ErrorBox` 가 `rejection_reason_required` 를 받았을 때 | **"새로고침"이라는 말이 없다** + "사유"라는 말이 있다(문장을 베끼지 않는다 — §6-4 3) | 아니오. `invalid_transition` 문구를 재사용한 구현이 죽는다 |
| V10 | 화면: 큐 반려 다이얼로그(기존) | V8 과 같은 단언, 5 kind 전부 | 부분(기존 `ReviewsPage.test.tsx:362` 가 일부 덮는다). kind 축으로 넓힌다 |
| V11 | `ReviewRejectionReasonRequiredError` 가 `InvalidTransitionError` 의 하위 타입이 **아니다** | `not issubclass(...)` | 아니오. 하위 타입으로 만든 구현이 여기서 죽고, 그 구현은 V1 의 `inspection` 칸에서도 죽는다(`log.info` 로 삼켜져 200) |
| V12 | CM 이 적은 사유가 `resolution_note` 에 있다(두 경로) | `"3층 배근 미시공" in resolution_note` **AND** 기계 문자열도 남아 있다(§6-2 4 — 하나만 단언하면 다른 하나가 사라져도 초록) | 아니오. HEAD 실측은 기계 문자열만 |
| V13 | `cause` 정본 감사 9칸 | 전 칸 == 정본 | 아니오 — §2-c 에 실측: "파이썬만 일관 개명" 트리(pytest 728 · vitest 262 **전원 통과**)에서 7칸이 MISMATCH |
| V14 | 감사 자기검증 | 정본 한 값을 바꾼 임시 입력에 대해 감사가 **실패**한다 | 아니오(감사가 장식이면 죽는다). `test_lint_regex_catches_hardcoded_coordinates` 와 같은 형식 |
| V15 | `typing.get_type_hints(LostDecision)["cause"] is str`(TypedDict — `document_mapper.py:583`)이고, 정본 집합에 옛 이름·`unspecified` 가 없다 | 세 단언 | 아니오. §2-d 위험 ①②③ 각각이 여기서 죽는다 |

**음성 대조군을 한 축에 몰지 않았다(§6-2 3).** 판정 경로가 둘(큐·전이)이므로 각 축에 양성·음성을 뒀다 —
큐: V1·V2(양성) ↔ V3·V4(음성) / 전이: V5·V6(양성) ↔ V7(음성).

---

## 열린 질문 / 리스크

1. **`on_hold` 에 공백만 note 를 보내면 `resolution_note` 에 `"   "` 가 그대로 저장된다**(실측 §1-e).
   해가 없어 이 사이클 범위 밖으로 둔다. 고치려면 폴백에서 `note.strip() or None` — 그때는
   **저장된 과거 기록에 이미 공백 note 가 있다**는 것을 함께 본다(§2-d 와 같은 갈래).
2. **`mapping` 반려는 `resolve_mapping_reviews` 가 그 (도면, 핸들)의 열린 요청을 **전부** 닫는다**
   (`review_queue.py:74`). 자리 A 가 요청 하나의 사유를 검사하지만 닫히는 것은 여럿일 수 있다.
   같은 사유가 전부에 붙는다 — 지금도 그렇고 이 변경이 바꾸지 않는다. 실측하지 않았다(한 핸들에 열린
   mapping 요청이 둘 이상인 상황을 만들지 않았다).
3. **`transition_object` 의 롤백.** 자리 B 예외는 지금 `except` 절이 없어 명시적 `session.rollback()` 을
   타지 않는다. 절제 실측에서는 커밋이 없어 객체 상태가 그대로였다(V5 관측) — 그러나 이는 **의존성이
   세션을 닫는 것**에 기댄 결과이므로 작업 3 이 `except`(rollback + re-raise)를 명시적으로 넣는다.
4. **`docs/api.md` 재생성 필요 여부.** ADR 0011 때는 불필요했다(`detail` 문구를 인용하지 않으므로).
   이번에는 **새 code 와 새 부가 필드**가 생기므로 `:224` 의 "부가 필드를 더 싣는 code" 목록이 낡는다 —
   재생성이 필요하다. 확인 명령: `grep -n "부가 필드" docs/api.md`.
5. **감사를 `make lint` 로 옮길 것인가.** 지금 설계는 `tests/invariants` 다. 계획 0004 §후속 1 이
   `make lint` 한 줄을 별도로 qa 에 넘겨 두었으므로 **자리가 둘로 갈린다.** 합칠지는 qa 판단에 맡긴다 —
   두 검사는 **서로 다른 결함 집합**을 덮는다(그쪽은 주석의 시제, 이쪽은 값 집합의 교차 일치).

---

## ADR 필요 여부

- **필요하다, 1건: ADR 0012 "검토요청 반려에는 사유가 필요하다".** ADR 0011 과 **주제가 다르다**(상태
  전이가 아니라 검토요청 생명주기)고 판단할 수도 있었으나, 자리 B 가 **상태 전이 경로**이므로 두 ADR 이
  같은 표면을 나눠 갖는다. 그래서 ADR 0012 는 ADR 0011 §Decision 규칙 1-a 표 3행을 **갱신하는 것을 자기
  작업으로 포함한다**(그 칸의 "도달 가능해지는 조건"에 세 번째가 늘어난다).
- **새 ADR 이 필요 없는 것: 과제 2.** 결정은 ADR 0009 §Deferred 5 가 이미 내렸다("값을
  `packages/core/models/` 로 올려 한 곳에서 정의하는 것이 옳다"). 이 사이클은 그것을 **집행**하고
  **정본 자리 목록의 오류 둘을 고친다**(개정 3 — 문서만 고친다).
- **과제 3 은 ADR 대상이 아니다.** CLAUDE.md §6 압축 규칙이 이미 절차를 정해 두었고 이 문서가 그 절차의
  산출물(대조표)이다.

---

## 후속 — 다음 사이클로 넘기는 것

1. **§6-2·§6-4 압축**(architect). §6-1 압축의 실측 이득이 **줄 -17 / 문자 -141** 이었다는 사실
   (§3-c)을 알고 시작한다 — 근거 압축의 상한이 거기다. 한 번에 한 절, 대조표와 함께.
2. **검토요청 *승인*의 사유 요건**(ADR 0011 §Deferred 1 그대로). 결정하려면 먼저 볼 것:
   검측 승인 1건당 CM 이 실제로 note 를 남기는 비율. 지금 화면도 서버도 요구하지 않는다(실측 §1-e 30칸).
3. **`resolve_mapping_reviews` 의 다중 종료**(위 열린 질문 2). 실측하지 않았다.
4. **`apps/web/src/api/client.ts:12` 의 TODO**(수작업 code 동기화). 이번에 `rejection_reason_required`
   를 손으로 더하면서 그 목록이 **또 한 줄 길어진다** — glossary 표 ↔ `KnownApiErrorCode` ↔ `CODE_MESSAGES`
   삼자 대조는 과제 2 의 감사와 **같은 모양**이므로(문자열 집합의 교차 일치) 같은 형식으로 붙일 수 있다.
   qa 소유. 이번 사이클 범위 밖.

---

# 사이클 마감 (2026-09-05, architect — 작업 10)

**마감 시점 값**(작업 트리 `/home/user/Bim/buildtwin`, 브랜치 `claude/buildtwin-initial-setup-ubulzb`,
필터 없이 `tail`):

```
$ .venv/bin/pytest -q                     781 passed, 1 warning in 81.36s
$ cd apps/web && npx vitest run           Test Files 28 passed (28) / Tests 268 passed (268)
$ make lint                               exit 0
```

계획 §0 이 요구한 대로 **모든 완료 조건은 작업 트리에서 재고했다**(계획 본문의 726·728 은 `git archive`
탐침 트리의 값이다). 기준선 738 → 781 의 차이는 이 사이클이 더한 검사다(작업 8 감사 35건 + 작업 9 회귀 8건).

## A. 각 작업의 실제 결과

| 작업 | 커밋 | 결과 | 계획과 달랐던 것 |
|---|---|---|---|
| 1 architect ADR 0012 | `b145e0c` | ADR 0012 + ADR 0011 규칙 1-a 표에 조건 ③ | 없음 |
| 2 architect 모델 | `75698ad`(술어·예외) · `568f012`(`cause` 정본) | 단독 커밋 둘로 뗐다(CLAUDE.md §2) | 없음. 다만 `568f012` 가 심은 주석 한 문장이 같은 사이클의 작업 8 로 거짓이 됐다 — 아래 D |
| 3 api | `a5628cc` | 자리 A 가드 + 409 핸들러 + `docs/api.md` 재생성 | 없음(§열린 질문 4 대로 재생성이 필요했다) |
| 4 progress-engine | `41036a0` | 자리 B 가드 + CM 사유를 `resolution_note` 에 함께 적기 | 없음 |
| 5 frontend | `92daacb` | `REVIEW_REJECTING_KINDS` + `ErrorBox` 문구 + 다이얼로그 | 없음 |
| 6 architect glossary | `aacfe77` | code 표 행 + 부칙 | 없음 |
| 7 progress-engine + bim-ingest | `7ae4e34` · `248a061` | 두 소유를 커밋 둘로 뗐다 | **담당이 자기 작업의 부작용을 보고했다**: 정본이 옮겨지면서 "정본은 어디인가"를 말하는 남의 파일 주석 셋이 거짓이 된다. 계획에 그 칸이 없었다 → `d0a0e88`(아래 C) |
| 8 qa 감사 | `7003754` | `tests/invariants/test_identity_drift_cause_contract.py` 35건 | **§2-c 표를 그대로 짜지 않았다**(아래 B). 표에 없던 칸 셋을 더했다: `ReviewsPage.tsx` 의 런타임 비교, `apps/web/src` 전수 대조, config 축의 단어 경계 |
| 9 qa 회귀 | `3f606f3` | V1~V12(통합 `test_19_*` + 웹 3파일) | 없음 |
| 10 architect | 이 커밋 | ADR 0009 §Deferred 5 닫음 · 이 마감 · CLAUDE.md §6 근거 | 계획은 "정본 자리 목록을 **다섯**으로 고치라"고 적었다. 고치지 않았다 — 아래 B-2 |

## B. 계획 자신이 틀린 자리

### B-1. §2-c 감사 설계 — 같은 계획의 작업 7 이 그 전제를 없앤다

§2-c 표의 파이썬 두 칸은 **정규식으로 리터럴을 뽑아 정본과 대조**하는 형태이고, 시제품을 **작업 7 이전
트리**에서 태워 `[py_consumer] … OK` 를 얻었다. 그런데 같은 계획의 작업 7 이 그 리터럴을 없애고 별칭을
정본 심볼로 바꾼다. **표의 전제를 표를 쓴 계획 자신이 무너뜨린다.**

계획대로 짠 칸들을 **작업 7 이후 트리에서 실제로 태웠다**(임시 탐침, `.venv/bin/python`):

| §2-c 의 칸 | 계획이 적은 기대 | 작업 7 이후 트리의 추출 | 결과 |
|---|---|---|---|
| `document_mapper` `_CAUSE_ROW_*` 정규식 | == 정본 | `[]`(공집합) | **실패** |
| `document_mapper` `IdentityDriftCause = Literal[…]` 정규식 | == 정본 | `[]`(공집합) | **실패** |
| (같은 형태) `persistence` `_CAUSE_ROW_*` 정규식 | == 정본 | `[]`(공집합) | **실패** |
| `config` 의 `row_[a-z_]+` 토큰 | ⊆ 정본 | `{row_absorbed, row_moved, row_replaced, row_not_found, row_search_range, row_stop_streak}` | **실패**(축에 단어 경계가 없어 무관한 config 키가 딸려 온다) |
| `review.py` **주석**의 `row_[a-z_]+` 토큰 | == 정본 | `{row_absorbed, row_moved, row_relocated, row_replaced}` | **실패**(실측 서사가 인용하는 이름이 딸려 온다) |

**그래서 정정한다 — 계획대로 짰으면 "조용히 통과하는 장식"이 되는 것이 아니라 정상 코드에서 붉어진다.**
위험은 그 다음 수순에 있다: 정상 코드가 빨간 칸을 **⊆ 로 느슨하게 풀면** 공집합이 통과하고, 그때 비로소
장식이 된다. 작업 8 담당은 그 수순을 밟지 않고 축을 바꿨다 — 두 파이썬 칸을 **"실행 코드에 리터럴이
0건"**(AST) + **"별칭의 우변이 정본 심볼"** 로, config 칸을 `\brow_` 단어 경계 + **등호**로,
`review.py` 주석 칸을 **열거 항목의 모양**(`` `이름` — 설명 ``)으로 바꿨고, ⊆ 로만 비교하는 칸에는
**비어 있지 않음**을 따로 단언했다.

*이 정정이 §6-2 의 새 사례인가 — 아니다.* §6-2 의 근거 둘은 **결함이 있는데 통과**한 경우이고, 위 실측은
**정상 코드에서 실패**한다. §6-2 의 규칙("이 단언의 기대값을 결함 있는 코드가 그대로 만족하는가?")을
그 표에 물었어도 이 결함은 나오지 않는다 — 물어야 했던 것은 **"이 표를 태운 트리가 이 계획이 끝난 뒤의
트리인가?"** 다. 그것은 새로운 종류이고 관측은 이 사이클 **1건**이므로, §6-5 대로 항목을 만들지 않는다.

### B-2. 정본 자리 목록이 한 사이클 안에서 두 번 늘었다 — 그래서 개수로 고치지 않았다

| 어디 | 그 목록의 기준 | 빠진 것 |
|---|---|---|
| ADR 0009 §Deferred 5(개정 2 보정) | "값이 흐르는 층" + 그 뒤 보정 | `api/types.ts` · `config/document_register.yaml` · `ReviewsPage.tsx` |
| 계획 §2-a | 저장소 루트 grep(옳다) **+ 그 뒤의 분류 기준** = "값으로 쓰이거나 **값 집합을 선언하는** 자리" | `ReviewsPage.tsx` — **원시 grep 출력에는 있었다**(§2-a 의 `6 ./buildtwin/apps/web/src/pages/ReviewsPage.tsx`). 걸러 낸 것은 grep 이 아니라 분류다 |
| 작업 10 브리핑 | 계획 §2-a 를 그대로 인용 | 같은 자리 |

`ReviewsPage.tsx` 에서 그 값이 하는 일은 선언이 아니라 **화면 강조**다 — `g.cause === "row_replaced"` 가
`className={… "notice strong" …}` 과 "가장 먼저 확인" 배지를 켠다(`:385,391`). 개명이 거기 닿지 않으면
**가장 위험한 경위의 강조가 조용히 꺼진다.**

**작업 10 은 계획이 시킨 대로 "다섯"으로 고치지 않았다.** 심사 후속 5 가 정한 기준(*개수 단정은 그 자리의
결론이 개수에 기댈 때만 쓴다*)을 적용했다 — ADR 0009 §Deferred 5 의 결론은 "정본이 한 자리이고 나머지는
그것을 가리킨다"이지 자리의 개수가 아니다. 그리고 이제 **열거를 사람이 유지하지 않는다**:
`test_identity_drift_cause_contract.py` 가 정본을 import 해 대조하고, `apps/web/src` 전수를 훑어
비교 자리가 감사 목록과 어긋나면 파일 이름을 대고 실패한다. ADR 0009 §Deferred 5 개정 3 이 그 사실과
감사의 생성 기준·블라인드 스팟을 적는다.

### B-3. `api/types.ts` 주석 정정이 어느 작업에도 배정돼 있지 않았다

작업 7 이 "정본은 `services/ingest/persistence.py` 의 `_CAUSE_ROW_*`" 라고 적은 문장 셋을 거짓으로
만들었는데(`apps/web/src/api/types.ts` · `apps/web/src/domain/identityDrift.ts` ·
`tests/unit/progress/test_identity_drift_review_title.py`), 소유가 frontend·qa 라 담당이 고치지 못했고
계획의 **작업 분배 표에도 그 칸이 없다**. §6-4("사실과 다른 문구는 그것을 만든 사이클이 고친다")에 따라
`d0a0e88` 에서 셋을 함께 닫았다 — architect 커밋이 남의 트리 둘을 만졌고, 그 소유 이탈과 이유(셋이 같은
한 문장의 같은 거짓이라 나누면 어느 커밋도 그 사실을 온전히 말하지 못한다)를 커밋 본문에 적었다.

**이것은 §6-3 8회차와 같은 모양이다.** 계획 0005 는 그 8회차를 **명시적으로 피하려고** 작업 분배 축을
"ADR 규칙 하나당 한 행"에서 **"한 소유가 한 커밋으로 끝낼 수 있는 단위"** 로 바꿨고(§작업 분배 머리말),
그 축에서도 무주공산이 생겼다 — 이번 칸은 **"내 작업이 남의 파일을 낡게 만드는 자리"** 다. 축을 바꾸면
무주공산은 없어지지 않고 **자리를 옮긴다.** 결과도 8회차와 같다: 소유 밖 수정.

## C. 이 마감이 작업 10 안에서 새로 잡은 것 — `packages/core/models/review.py`

`568f012`(작업 2, architect)가 심은 주석은 이렇게 적고 있었다:

```
# 그 경계를 지키는 것은 … 감사이고, **실측 2026-09-05 기준 이 저장소에 그 감사가 없다**
# (`grep -rl "IDENTITY_DRIFT_CAUSES\|SERVER_CAUSE_TO_LOCAL" tests/` → 히트 0).
# 계획 0005 §2-c 가 그 감사의 자리를 `tests/invariants/` 로 지정한다.
```

작업 8(`7003754`)이 그 감사를 만들었으므로 이 문장은 거짓이다(실측: 같은 grep 의 히트는 이제
`tests/invariants/test_identity_drift_cause_contract.py` 를 포함한다). **이름 붙은 블라인드 스팟에서
네 번째 관측**이고, 앞의 셋과 다른 점은 **거짓으로 만든 커밋이 같은 사이클 안에 있었고 계획이 그것을
예고까지 하고 있었다**는 것이다.

§6-1 이 그 디렉터리 주석에 요구하는 것은 "시제 표현 금지 / 개수 세기 금지 / 세는 대신 **부재**를 적어라"
인데, 이 문장은 **그 요구를 지켜서** 부재를 적었다가 낡았다. 배운 것: **부재 단정은 시제 표현의 변장일 수
있다** — "지금 X 가 없다 + 계획이 X 를 만들기로 했다"는 "아직 X 가 없다"와 같은 문장이다. 부재를 적을
때는 **그것을 메우는 작업이 같은 사이클에 있는지** 본다. 있으면 그 부재를 적는 대신, 메운 뒤의 사실을
적거나(작업 순서를 뒤로) 그 자리를 가리키기만 한다.

고친 결과: 그 문단은 자리를 **열거하지 않고** 감사 파일을 가리키며, 감사가 없을 때 무보호라는 사실을
**심어 보고 잰 값**으로 적는다(아래 D). 줄 번호 참조 둘(`identityDrift.ts:48-51` · `:40-47`,
`config/document_register.yaml:254,260,261`)도 함께 걷어냈다 — 둘 다 실측으로 어긋나 있었고, 줄 번호는
같은 종류로 조용히 낡는다.

## D. 이 사이클이 실제로 무엇을 닫았는가 — 심어 보고 잰 값

전부 작업 트리에서 직접 쟀다. 각 심기 뒤 저장소 루트 `git status --porcelain` 전문이 빈 출력임을 확인했다.

| 심은 결함 | 감사 밖 | 감사 |
|---|---|---|
| 파이썬만 일관 개명(`row_absorbed` → `row_relocated`; `services/ingest/persistence` · `services/progress/document_mapper` · `packages/core/models/review` · 파이썬 테스트 둘. TS·yaml·docs 는 그대로) | 감사 제외 `pytest -q` **746 passed** · `vitest run` **268 passed** — 실패 0 | **7 failed**(TS 유니온·`SERVER_CAUSE_TO_LOCAL`·`ORDER`·`LABELS`·`NOTES`·`types.ts`·config) |
| 정본에서 뗀 같은 값 재선언(`_CAUSE_ROW_ABSORBED = "row_absorbed"`) | 감사 제외 `pytest -q` **746 passed**(값이 같으므로 어떤 단언도 달라지지 않는다) | **2 failed** — `test_python_alias_sites_declare_no_literal_of_their_own[persistence.py]`, `test_python_alias_values_equal_canon_at_runtime` |

첫 행이 이 과제가 존재한 이유다: 파이썬 안에서 일관되기만 하면 파이썬도 웹도 전부 초록인데, 그 제품은
서버가 보낸 값을 `classifyIdentityDriftCause` 가 찾지 못해 모든 항목을 "경위 미상"으로 보내고
`config/document_register.yaml` 의 경고 문구는 존재하지 않는 이름을 CM 에게 읽어 준다.

**감사가 못 잡는 것**(ADR 0009 §Deferred 5 개정 3 에 같은 목록이 있다): 값 집합만 비교하고 **의미는
비교하지 않는다 — 두 이름을 서로 맞바꾸는 개명은 모든 칸을 통과한다.** 그 밖에 표기 변종(실측: 저장소
전체에서 히트 **1건**이고 그것은 이 계획 문서가 그 패턴을 인용한 줄), `row_` 로 시작하지 않는 새 이름의
config 칸, `docs/`(옛 이름을 의도적으로 보존하므로 대상 아님), 그리고 파이썬·config 쪽 **파일 목록의
자동 유지 부재**(전수 대조는 `apps/web/src` 에만 있다). 값 이름을 쓰지 않고 `cause` 를 소비하는 자리는
실측 **추가 0건**이다(비테스트 런타임 트리의 `\bcause\b` 히트가 감사가 이미 보는 파일들뿐이다).

## E. CLAUDE.md §6 을 얼마나 늘렸는가 — 그리고 왜 그만큼만

**늘린 것: 표 두 행 + 규칙 문장 하나.**

- **§6-1 표에 한 행**(B-2). 같은 목록이 **세 사이클 연속** 틀렸고, 이번 회차가 새로 말하는 것은
  "루트 grep 은 옳았고 대상 파일도 그 출력에 있었다 — 걸러 낸 것은 **그 뒤의 분류 기준**"이다.
  §6-1 ②("그 기준이 놓치는 것")를 계획은 **수집 축에 대해서만** 답했다.
- **§6-1 이름 붙은 블라인드 스팟 문단에 한 문장**(C). "부재 단정은 시제 표현의 변장일 수 있다."
  §6-1 의 두 요구(시제 금지 / 부재를 적어라)가 서로 부딪히는 자리를 실행으로 만났고, 그 자리를 적지 않으면
  다음 사람이 같은 문장을 같은 이유로 쓴다.
- **§6-3 표에 한 행**(B-3). 계획 0005 는 8회차를 **명시적으로 피하려고** 작업 분배 축을 바꿨는데도
  무주공산이 생겼다 — "축을 바꾸면 무주공산은 자리를 옮긴다"는 것이 그 규칙의 무게에 더해지는 사실이고,
  결과(소유 밖 수정)도 같다.

**늘리지 않은 것: §6-2.** B-1 의 실측이 §6-2 의 패턴(결함이 있는데 통과)과 **다르다** — 계획대로 짠 감사는
정상 코드에서 **붉어진다**. 그것을 "장식"으로 만드는 것은 그 빨강을 ⊆ 로 푸는 다음 수순이고, 이 사이클에서
그 수순은 밟히지 않았다. 새로운 종류로 보더라도 관측은 **1건**이므로 §6-5 대로 항목을 만들지 않는다.
근거만 이 문서 B-1 에 남긴다.

**§6 의 길이 판단.** §6 을 늘리는 것 자체가 비용이라는 판단은 이미 §6-5 압축 규칙에 있다(줄 -17 / 문자
-141 이 §6-1 압축의 실측 이득이었다). 그래서 이번 추가는 **표 행**(근거의 압축 형식)으로만 하고, 규칙
문장은 부딪히는 두 요구를 가르는 한 문장으로 제한했다. 서사는 이 마감 문서에 둔다.
