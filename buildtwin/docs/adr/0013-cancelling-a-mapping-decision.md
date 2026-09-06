# ADR 0013 — 매핑 결정의 취소(확정 취소·반려 취소)

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-06
- 관련: **ADR 0007 §Deferred "매핑 확정 취소(unconfirm)"·"매핑 반려 취소(unreject)"**(이 ADR 이 그 둘을
  **함께** 닫는다 — 그 항목 자신이 "확정·반려 두 방향을 따로 만들면 또 비대칭이 생긴다"고 적었다),
  ADR 0007 §4-2 규칙 6 ⑥(그 "영구"를 **대체하지 않고 좁힌다** — 규칙 8),
  **ADR 0009 §Deferred 3**(이 ADR 이 닫는다), ADR 0011(되돌리기에 사유를 요구한 선례 — 규칙 1-a·1-b),
  ADR 0012(사유 술어의 정본 · code 를 가르는 기준 · 검사 **순서**가 계약이라는 판단),
  ADR 0008(대리키 라우트의 `project_id` 쿼리 관례), ADR 0001 §4-1(검토요청 처리는 `cm`),
  CLAUDE.md §0(확정은 사람)·§3 규칙 11(매핑 생명주기·검토요청 해소 소유)·§3-13·§6,
  `docs/plans/0006-cancelling-a-mapping-decision.md` §과제 1
- **다른 ADR 을 갱신한다**: ADR 0007 §Deferred 의 두 항목에 해소 표시(`~~취소선~~ → ADR 0013 으로
  해소됨`, 같은 파일의 `_drop_already_confirmed` 항목이 이미 쓰는 형식) / ADR 0009 §Deferred 3 에 같은
  해소 표시 / ADR 0012 §Deferred 3 에 **실측만 append**(그 ADR 의 불변식·규칙은 바뀌지 않는다).
- 대체하지 않음: ADR 0001 의 상태·전이 표. 이 ADR 은 **객체 상태기계를 건드리지 않는다** — 매핑 결정은
  상태기계 밖에 있고(§Context 2), 그 사실이 이 ADR 이 ADR 0011 과 달라지는 지점 전부다.

---

## 0. 이 ADR 의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, 브랜치 `claude/buildtwin-initial-setup-ubulzb`,
**HEAD `516949a`**. 저장소 루트 `/home/user/Bim` 에서 `git status --porcelain` **전문이 빈 출력**이다
(모든 탐침 전후로 확인했다 — 하위 디렉터리에서 확인하면 상대 경로 때문에 조용히 놓친다).

기준선(이 ADR 을 쓰면서 직접 쟀다, 필터 없이 `tail`):

```
$ cd /home/user/Bim/buildtwin && .venv/bin/pytest -q
783 passed, 1 warning in 63.51s (0:01:03)

$ cd /home/user/Bim/buildtwin/apps/web && npx vitest run
 Test Files  28 passed (28)
      Tests  268 passed (268)
```

아래 실측은 `tests/integration/` 에 **임시 탐침 파일**(`test_zzprobe_0013*.py` — 아래 대괄호 라벨의
접두사가 어느 파일에서 나왔는지 가리킨다: `S*`/`C*` · `B*` · `C3~C6` · `D*` · `ROW*-blockers-full`)을
두고 세션 픽스처(`client`/`auth`/`user_ids`/`project`/`dxf_job`)로 TestClient 를 태운 뒤 파일을 지웠다.
DB 직접 조작이 필요한 칸(곱 표의 네 칸)은 `packages.core.db.session_scope` 로 같은 임시 SQLite 를 열었다.

**이 문서의 모든 `파일:줄` 참조는 HEAD `516949a` 트리의 것이다** — HEAD 가 움직여도 갱신하지 않는다
(CLAUDE.md §3-13 첫째 갈래).

*계획 0006 과 수치가 같은 이유, 그리고 그래도 다시 잰 이유.* 계획 0006 은 HEAD `99d3721` 에서 쟀고 그
뒤 두 커밋은 문서만 바꿨다 — `git diff --stat 99d3721 HEAD` → `CLAUDE.md`(8줄)와
`docs/plans/0006-*.md`(신규) **2 files changed**, 코드 트리 무변경. 그래도 **이 ADR 의 모든 수치는 계획에서
옮겨 적지 않고 이 HEAD 에서 다시 실행해 얻었다.** 문서가 문서를 근거로 삼으면 서로를 가리키는 두 줄이
서로의 근거가 된다(CLAUDE.md §6-3 — "표의 각 칸을 다른 절 참조로 갈음하면 그 행은 검증되지 않은 것이다").

---

## Context

### 1. 두 Deferred 가 남긴 것 — 되돌릴 길이 DB 직접 수정뿐이다

ADR 0007 §Deferred 는 같은 결함을 두 항목으로 나눠 적었다.

- **매핑 확정 취소(unconfirm)**: "문서 매핑 쓰기 경로는 generate 와 confirm 둘뿐이고 확정을 되돌리는
  엔드포인트가 없다 … 즉 확정도 사실상 영구다."
- **매핑 반려 취소(unreject)**: "**남은 운영 위험**: CM 이 잘못 반려하면 그 쌍을 되살릴 경로가 없다.
  우회는 두 가지뿐이다 — 문서 제목이 바뀌면 `doc_id` 가 바뀌어 새 후보가 정상 생성되고, 그 외에는
  DB 를 직접 손대야 한다."

두 항목 모두 "따로 만들면 또 비대칭이 생긴다"고 적었으므로 이 ADR 이 **하나의 취소**로 함께 닫는다.
ADR 0009 §Deferred 3("문서 매핑 확정을 사람이 되돌리는 경로")도 같은 것을 가리키므로 함께 닫힌다.

### 2. ADR 0011 의 모양을 그대로 옮길 수 없다 — 못 박을 병목이 없다

ADR 0011 은 **CM 만 · 사유 필수 · 감사 이력에 남는 새 행** 셋을 세웠고, 그것을 얹을 자리가
`StateTransition._check`(`packages/core/models/state.py:220` 이 그 안의 raise 자리다) 하나였다 —
"저장소의 모든 전이 생성 경로가 반드시 지나는 유일한 병목".

**매핑 결정에는 그런 자리가 없다.** 결정은 상태기계가 아니라 세 곳에 흩어져 있다(실측·코드 인용):

| 무엇을 말하는가 | 어디에 있는가 | 확정이 쓰는 값 | 반려가 쓰는 값 |
|---|---|---|---|
| 사람이 이 쌍을 판단했다 | `ActivityDocumentMappingRow.reviewed_by` + `needs_review` | `reviewed_by=<user_id>`, `needs_review=False`(모델 검증자가 강제 — `services/api/usecases.py:336-340`: 주석 `:336` "reviewed_by 가 채워지면 needs_review=False 를 항상 강제한다", 구성 `:339-340`) | 같은 필드에 같은 모양(`services/progress/document_mapper.py:570-571`) |
| 어느 쪽으로 판단했는가 | `Evidence.extra` 의 네 키 | **키 자체가 없다**(실측 `[B1-row]`: `['activity_id','discipline_trusted','excluded_by','matched_rules','one_sided_tokens','title_similarity']`) | 실측 `[S1-marker-keys]`: `['mapping_review_decision','rejected_at','rejected_by','rejection_note']`(`document_mapper.py:564-567`) |
| 큐에 남은 흔적 | `ReviewRequestRow.status`/`resolved_by`/`resolved_at`/`resolution_note` **한 벌** | `close_document_mapping_review` 가 `approved` 로 덮는다(`document_mapper.py:514-517`) | `resolve_review` 공통 폴백이 `rejected` 로 덮는다(`services/api/usecases.py:523-525`) |

세 번째 줄이 ADR 0011 의 셋째 요구("감사 이력에 남는 **새 행**")를 막는다: 해소 슬롯이 한 벌이고
덮어쓰기이며, `StateTransition` 에 해당하는 **검토요청 이력 테이블이 없다.** 그래서 이 ADR 은 앞의 둘
(누가·무엇이 필요한가)은 ADR 0011 과 **같은 모양으로** 옮기고, 셋째는 **세 자리로 나눠** 만든다
(규칙 2·3).

**그리고 이 저장소에는 이미 "닫힌 검토요청을 다시 여는" 코드가 있는데, 그것이 감사를 지운다.**

```python
# services/progress/document_mapper.py:433-436  (_reopen_reviews_for_invalidated_confirmations)
            review.status = "open"
            review.resolved_by = None
            review.resolved_at = None
            review.resolution_note = None
```

ADR 0011·0012 가 두 사이클을 들여 세운 축은 "결정에는 반드시 이유가 남는다"인데 이 네 줄은 정확히 그
반대를 한다. **취소는 이 모양을 베끼지 않는다**(규칙 2).

### 3. 되돌리기가 착지할 수 있는 네 칸 — 곱으로 셌다 (CLAUDE.md §6-1)

되돌리기가 건드릴 수 있는 축은 둘이다: ① `reviewed_by`/`needs_review`, ② `evidence.extra` 의 반려 표시
네 키. **관계를 세는 목록은 곱으로 만든다**는 §6-1 대로 2 × 2 = 4칸을 전부 태웠다.

배역은 `A400`(TFA, 대장 처리결과 `APPROVED` — `tests/integration/test_15_*.py` 와 같은 배역). 일부러
**이미 승인된** 문서를 쓴다: 반려해도 값이 움직일 수 있어야 결함이 관측 가능하다(§6-2 1).
각 칸은 `GET /api/activities/A400/readiness` 의 실행값이고, blocker 칸은 응답 `blockers[]` 의 `kind`
**전부**다. **`kind: None` 인 blocker 가 섞여 있으므로 잘라 적지 않는다** — 이 배역에는
`predecessor_completion`(`kind: None`, `reason: 1/1 predecessor activities not CONFIRMED`)이 늘 하나
깔려 있고, 1행에는 `drawing_approval` 쪽 blocker 하나가 **역시 `kind: None`** 으로 더 붙는다
(`reason: drawing approval unknown` — 실측 `[ROW1-blockers-full]`). 잘라 적으면 다음 사람이
"blocker 가 없다"로 읽는다.

| # | `reviewed_by`/`needs_review` | 반려 표시 4키 | `drawing_approval` | `score` | `blockers[].kind` | `evidence.note` 의 `drawing_approval:` 조각 |
|---|---|---|---|---|---|---|
| 0 | 반려 **전**(시스템 후보 그대로) | absent | 0.5 | 0.625 | `[None, 'document_mapping_pending']` | `approved=0/0; pending_mappings=1` |
| 1 | `set` / `False` (= 지금의 반려 상태) | present | 0.5 | 0.625 | `[None, None]` | `resources.drawing_approved absent` |
| 2 | `set` / `False` | **absent** | **1.0** | **0.7** | `[None]` | **`approved=1/1; pending_mappings=0`** |
| 3 | `null` / `True` | present | 0.5 | 0.625 | `[None, 'document_mapping_pending']` | `approved=0/0; pending_mappings=1` |
| 4 | `null` / `True` | absent | 0.5 | 0.625 | `[None, 'document_mapping_pending']` | `approved=0/0; pending_mappings=1` |

이 표가 답하는 것 넷:

**(1) "잘못 반려하면 `drawing_approval` 이 0.0 으로 굳는다"는 틀렸다.** 실측: 반려 **전** 0.5(0행) →
반려 **후** 0.5(1행). **값도 점수도 같다.** 그 자리의 기본값이 `drawing_approval_unknown: 0.5`
(`config/readiness.yaml:14`)이기 때문이다. 굳는 것은 값이 아니라 **경로**다 — 반려 뒤에는 그 문서를 통해
1.0 에 도달할 길이 재계산으로는 영영 열리지 않는다. 실측(`[C-after-reject]` → `[S1b-after-reupload]`):
반려 직후 그 Activity 의 `document_mapping` 요청은 `['rejected']` 하나이고, **대장을 재업로드해도
`['rejected']` 그대로**다(`_drop_already_confirmed` 가 `reviewed_by is not None` 인 후보를 버린다 —
`services/progress/document_mapper.py:340`(정의) · `:360-361`(그 조건: `if existing is not None and existing.reviewed_by is not None: continue`)).

**(2) 값 축은 이 결함에 대해 눈이 멀었다(§6-2 그 자체).** `components["drawing_approval"] == 0.5` 나
`score` 로 세운 반려 시나리오는 정상 코드와 결함 코드에서 **같은 값**이다. 반려 축에서 갈리는 관측값은
`blockers[]`(1행은 `drawing_approval`/`kind=None`/`reason='drawing approval unknown'`, 3·4행은
`drawing_approval`/`kind='document_mapping_pending'`)와 `evidence.note` 둘뿐이다 — **`kind` 만 보면
1행과 2행이 갈리지 않으므로**(둘 다 `None` 만 남는다) `reason` 또는 그 blocker 의 **존재**까지 봐야 한다. 값 축을 실제로 움직이려면 **확정** 방향을 써야 한다 —
실측(`[B0-before]`→`[B1-confirmed]`): `0.5 → 1.0`, `0.625 → 0.7`, blocker `document_mapping_pending` 소멸,
note `approved=0/0; pending_mappings=1` → `approved=1/1; pending_mappings=0`.

**(3) 2행이 이 ADR 의 가장 위험한 칸이고, 그것이 CLAUDE.md §0 위반이다.** 반려 표시만 지우고
`reviewed_by` 를 남기면 그 매핑은 `confirmed_required_documents` 의 **확정 증거**가 된다 —
`confirmed = [m for m in mappings if not m.needs_review and not is_rejected_mapping(m.evidence)]`
(`services/progress/document_mapper.py:1006`)의 두 조건을 **둘 다** 통과하기 때문이다. 결과는 실측
`drawing_approval` **1.0**, `evidence.note` **`approved=1/1; pending_mappings=0`**, 그리고
**`drawing_approval` blocker 가 사라진다**: 1행의 `blockers[]` 는
`[predecessor_completion(kind=None), drawing_approval(kind=None, reason='drawing approval unknown')]`
인데 2행에서는 `[predecessor_completion(kind=None)]` 하나만 남는다(실측 `[ROW1-blockers-full]` ·
`[ROW2-blockers-full]`). 도면 승인 축에서 CM 을 멈춰 세우던 마지막 표시가 없어진다.

> CM 이 그 쌍에 대해 한 행위는 **반려 하나뿐**이다. 확정 액션을 한 적이 없다. 그런데 화면은 도면 승인
> 근거가 확정됐다고 말한다. CLAUDE.md §0 핵심 원칙 1("스캔 AI는 '완료 추정'까지만 판정한다. '확정 완료'는
> 반드시 사람(CM) 승인 액션을 거친다")과 §3 규칙 8 이 금지하는 것이 정확히 이것이다 — **사람의 승인
> 액션 없이 확정 증거가 만들어지는 경로**. ADR 0009 §3 이 스스로 "최악"이라 분류한 경로
> (미승인 도면 위에서 착수 가능이 뜬다)와 데이터 모양·결과가 같다.

그래서 **취소는 이 칸에 착지해서는 안 된다.** 이것이 "표시를 지운다"가 아니라 **"미확정으로 되돌린다"**
를 고른 근거다: 표시를 지우는 것만 하면 도착점이 2행이고, 되돌리기를 함께 해야 4행이 된다.
`reviewed_by=None` 은 두 조건 중 첫째(`not m.needs_review`)를 깨므로, **그 하나만으로도** 2행은 닫힌다 —
표시 제거는 그 위에 얹는 별개의 요구이고 근거가 다르다((4)).

**(4) 3행과 4행은 readiness 가 구별하지 못한다** — 네 칸이 전부 같다. 즉 "반려 표시를 남길까 지울까"는
readiness 가 답하지 않는다. 가르는 것은 **화면**이고, 코드 인용이 그것을 보인다:

```ts
// apps/web/src/domain/mappingReview.ts:27-31
export function mappingReviewState(mapping: ActivityDocumentMapping): MappingReviewState {
  if (mapping.needs_review) return "pending";               // ← 3행에서 "검토 대기"
  const decision = (mapping.evidence.extra ?? {})["mapping_review_decision"];
  return decision === REJECTED ? "rejected" : "confirmed";
}
// :34-42  mappingRejection — needs_review 를 보지 않고 extra 의 세 키를 그대로 돌려준다
  return { rejectedBy: str(extra.rejected_by), rejectedAt: str(extra.rejected_at), note: str(extra.rejection_note) };
```

두 함수를 **같은 카드 안에서 나란히** 부르는 자리가 둘이다(실측 `grep -rn "mappingRejection\|mappingReviewState"
apps/web/src`, 비테스트 히트에서 `domain/mappingReview.ts` 를 뺀 것):
`apps/web/src/pages/ReviewsPage.tsx:216-217`, `apps/web/src/pages/DocumentDetailPage.tsx:292-293`.
3행에서 그 카드는 배지로 "검토 대기"라 하면서 같은 카드에 옛 반려자·반려 시각·반려 사유를 계속 보여준다 —
**한 화면의 두 값이 서로를 반박한다.** 그래서 취소는 표시를 지운다(4행). 지운 값은 사라지면 안 되므로
append-only 이력으로 옮긴다(규칙 3).

### 4. 매핑 행만 되돌리면 큐가 비어 있다 — "조용히 죽는 것"의 교과서적 모양

취소를 "매핑 행 되돌리기" 하나로 만들면 어떻게 되는지 태웠다(실측 `[C3-*]`·`[C4-*]`):

```
# (가) 반려 → 매핑 행만 되돌림
[C3-queue-mapping-only]      ['rejected']            ← 그 Activity 의 document_mapping 요청 전부. 열린 것이 없다
[C4-recompute]               200                     ← POST /api/projects/{id}/documents/mappings 를 부른 뒤
[C4-queue]                   ['open', 'rejected']

# (나) 확정 → 매핑 행만 되돌림 (다른 탐침, 다른 프로젝트)
[B2-cancelled-mapping-only]  (0.5, 0.625, blockers kind [None, 'document_mapping_pending'],
                              note '… drawing_approval: approved=0/0; pending_mappings=1 …')
[B2-queue]                   ['approved']            ← 여기서도 열린 것이 없다
```

**readiness 는 "문서 매핑 1건이 CM 검토 대기"라고 말하는데(blocker `document_mapping_pending`,
`reason: 문서 매핑 1건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음`) CM 의 큐에는 열린 것이
없다** — 반려 쪽((가))과 확정 쪽((나)) **양쪽에서** 그렇다. 예외도 없고
화면도 정상이며 사라진 것은 CM 이 할 일뿐이다 — 이 저장소의 지배적 실패 모드 그대로이고, ADR 0009 가
"아무도 만들지 않는 검토요청 때문에 CM 큐가 영원히 비어 있었고 어떤 테스트도 실패하지 않았다"로 이미 한 번
겪은 것이다. 재계산(대장 재업로드 또는 수동 호출)을 **기다리는** 설계는 그 공백을 CM 의 운영 습관에
맡기는 것이다. 그래서 취소는 **그 자리에서 새 요청을 연다**(규칙 2).

*그 새 요청이 중복을 만들지 않는가 — 태웠다.* 열린 요청이 있는 상태에서 재계산을 한 번 더 부르고
(`[C5-recompute-again]`) 대장을 재업로드해도(`[C6-reupload-with-open]`) 결과는 `['open', 'rejected']`
그대로다. `_reopen_reviews_for_invalidated_confirmations` 의 `if review.status == "open": continue`
(`document_mapper.py:431-432`)와 `open_document_mapping_review`(`status="open"` 고정)가 중복 생성을 막는다.

---

## Decision

### 불변식 5 — 매핑 결정의 취소는 **CM 만**, **사유 없이는 성립하지 않고**, **감사가 남는다**

ADR 0011 이 상태 전이에 세운 세 가지를 매핑 결정 축으로 옮긴다. 앞의 둘은 **같은 모양**이고, 셋째만
자리가 없어 **세 자리로 나눈다**(§Context 2).

| ADR 0011(상태 전이) | ADR 0013(매핑 결정) | 같은가 |
|---|---|---|
| 누가 — `from_state==CONFIRMED` 이탈은 `actor==cm` 전이로만(ADR 0001 §4-1, 모델 `state.py:156`) | 누가 — 취소는 그 프로젝트의 `cm` 만 — 확정 라우트와 **같은 한 줄**(`services/api/usecases.py:362` `project_role(session, project_id, user, CONFIRM_ROLE)`, `CONFIRM_ROLE = "cm"` 는 `:92`) | **같다** |
| 무엇이 필요한가 — 비어 있지 않은 `evidence.note` | 무엇이 필요한가 — 비어 있지 않은 `note`. 술어는 **재사용**한다 — `packages/core/models/review.py:147 def rejection_reason_missing(note)` | **같다**(규칙 4) |
| 어디에 남는가 — `StateTransition` 한 행이 그대로 이력이다(append) | 어디에 남는가 — **세 자리**: ① 옛 검토요청 행을 손대지 않는다 ② 새 open 요청 ③ 매핑 `evidence.extra.cancelled_mapping_reviews` append | **다르다** — 이력 테이블이 없어서다(§Context 2 표 셋째 줄) |

### 규칙 1 — 취소의 착지점은 **미확정**(§Context 3 표 4행) 하나다. 반쪽 착지를 금지한다

```
reviewed_by = None
needs_review = True
evidence.extra 에서 반려 표시 4키 제거
```

**세 가지를 한 트랜잭션에서 함께** 한다. 하나만 하면 §Context 3 (3)의 2행(= `drawing_approval` 1.0)에
착지할 수 있고, 그것이 CLAUDE.md §0 위반이다.

*역방향 확인 — "미확정으로만 착지"가 미는 것.* "직전 결정의 **반대**로 착지"(반려 취소 → 확정)를 뺀다.
근거는 같은 실측이다: 반대로 착지하려면 `reviewed_by` 를 남긴 채 표시만 지워야 하고, 그것이 정확히
2행(1.0 · `approved=1/1`)이다. **취소는 확정을 만드는 경로가 아니다** — 확정을 원하면 CM 이 취소 뒤에
확정 액션을 다시 해야 하고, 그 액션이 CLAUDE.md §0 이 요구하는 사람의 승인 행위다.

### 규칙 2 — 옛 검토요청 행은 **손대지 않고**, 새 open 요청을 **그 자리에서** 연다

- **옛 행**: 그 쌍의 마지막 `ReviewRequestRow` 는 `status`(`rejected`/`approved`)와 `resolved_by`·
  `resolved_at`·`resolution_note` 를 **그대로 둔다.** 근거는 `_reopen_reviews_for_invalidated_confirmations`
  가 정확히 반대를 하고 있다는 코드 인용(§Context 2)이고, 그 모양은 ADR 0011·0012 가 세운 축의 정반대다.
- **새 행**: `ReviewRequest(kind="document_mapping", status="open")` 를 취소와 **같은 트랜잭션**에서
  만든다. `conflicting_sources` 는 기존 계약(`doc_id`)에 두 키를 더한다 —
  `cancelled_review_request_id`(어느 결정을 취소한 것인가) · `cancel_note`(왜).
  근거는 §Context 4 의 `[C3-*]` 실측이다: 재계산을 기다리면 readiness 와 큐가 서로 다른 말을 한다.

*역방향 확인 — "그 자리에서 연다"가 미는 것.* 재계산이 열어 줄 때까지의 공백을 뺀다. **더 들어오는
것은 없다**: 열린 요청이 이미 있으면 재계산도 재업로드도 새로 만들지 않는다(실측 `[C5]`·`[C6]` 둘 다
`['open','rejected']` 그대로 — §Context 4).

### 규칙 3 — 지운 반려 표시는 **append-only 이력**으로 옮긴다

`evidence.extra["cancelled_mapping_reviews"]` 에 다음 한 항목을 **append** 한다(덮어쓰지 않는다):

```
{cancelled_by, cancelled_at, cancel_note, previous_decision,
 previous_reviewed_by, previous_rejected_at?, previous_rejection_note?}
```

`previous_decision` 은 `"confirmed"` 또는 `"rejected"` — 취소가 어느 방향이었는지는 취소 뒤에는 매핑
행 어디에도 남지 않기 때문이다(규칙 1 이 두 축을 모두 지운다). **모르는 값을 흔한 값으로 떨어뜨리는
폴백을 두지 않는다**(CLAUDE.md §6-4 2).

**저장된 과거 기록에는 이 키가 없다.** 마이그레이션을 하지 않고, 읽는 쪽이 **키 없음을 빈 목록으로**
읽는다. 이것은 사실 단정이 아니라 구현 요구이므로 계획 0006 작업 3 의 완료 조건이다.

*역방향 확인 — append-only 가 미는 것.* 같은 키를 덮어쓰는 설계(마지막 취소만 남김)를 뺀다. 그 설계가
잃는 것은 반복 취소의 이력이고, 그것은 규칙 7(무제한)이 성립하기 위한 관측 가능성 그 자체다.
readiness 는 이력이 있든 없든 3행·4행을 구별하지 못하므로(§Context 3 표) 이력을 남겨도 **점수는 움직이지
않는다** — 즉 이 이력은 값이 아니라 감사에만 쓰인다.

### 규칙 4 — 사유 술어는 `rejection_reason_missing` 을 **그대로 쓴다**. 이름의 좁음은 기록한다

`packages/core/models/review.py::rejection_reason_missing(note)` 는 `not (note or "").strip()` 이고
판정 축이 같다("비어 있지 않은 문자열"). **이름은 반려를 말하지만 판정은 그렇지 않다.**

개명하지 않는 이유: 지금 그 함수를 부르는 자리는 둘이고(`services/api/usecases.py:445`,
`services/progress/state_machine.py:155` — 실측 `grep -rn "rejection_reason_missing" services packages`
의 비테스트 히트), 개명은 그 둘 + ADR 0012 본문 + glossary 를 함께 움직이는 일이다. **셋째 호출자가
생기는 사이클에 개명하는 것이 자연스럽고**, 이 ADR 이 그 셋째를 만든다는 사실을 여기 적어 둔다 —
다음 사이클이 이 문장을 근거로 개명을 열 수 있다.

### 규칙 5 — 새 예외 둘은 **`services/progress/` 에 둔다**(`packages/core/models/` 가 아니다)

ADR 0012 는 `ReviewRejectionReasonRequiredError` 와 `rejection_reason_missing` 을
`packages/core/models/review.py` 에 두면서 근거를 "`rejected` 를 쓰는 세 자리의 소유가 progress-engine·
api·sync-2d3d 로 전부 달라 공통 상위가 거기뿐"이라고 적었다. **그 근거가 취소에도 서는지 전수로 확인했다.**

**생성 기준(§6-1 ①).** 저장소 루트에서 예외 **정의**를 전수로 뽑고(경로를 먼저 좁히지 않았다), 각
타입의 **raise 자리**를 다시 전수로 뽑아 소유를 셌다.

```
$ cd /home/user/Bim && grep -rnE "^class [A-Za-z_]+\((Exception|BaseException|ValueError|LookupError|RuntimeError|PermissionError|ApiError|[A-Za-z_]*Error)\)" \
    --include=*.py . --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__
$ for e in <위 목록의 각 타입>; do grep -rn "raise $e(" --include=*.py . | grep -v "/tests/"; done
```

| 예외 타입 | 정의 자리 | raise 자리(비테스트 전수) | raise 소유 수 |
|---|---|---|---|
| `InvalidTransitionError` | `packages/core/models/state.py:69` | `state.py:154,156,159` | **0**(정의 파일 자신 = `packages/core`) |
| `RevocationReasonRequiredError` | `packages/core/models/state.py:75` | `state.py:220` | **0**(같음) |
| `ReviewRejectionReasonRequiredError` | `packages/core/models/review.py:102` | `services/progress/state_machine.py:156` · `services/api/usecases.py:446` | **2**(progress·api) |
| `ObjectNotFoundError` | `services/progress/state_machine.py:48` | `state_machine.py:123,199` | 1(progress) |
| `TransitionBlockedByReviewError` | `services/progress/state_machine.py:63` | `state_machine.py:213` | 1(progress) |
| `UnsafeConfigOverrideError` | `services/progress/config_loader.py:41` | `config_loader.py:71,99` | 1(progress) |
| `MappingTargetNotFoundError` | `services/sync/errors.py:18` | `services/sync/review_queue.py:96` | 1(sync-2d3d) |
| `MalformedReviewDataError` | `services/sync/errors.py:10` | `services/sync/review_queue.py:142` | 1(sync-2d3d) |
| `DrawingNotFoundError` | `services/sync/errors.py:26` | `services/sync/persistence.py:49,96` | 1(sync-2d3d) |

**루트 grep 이 뽑은 정의 전부가 위 표에 있는 것은 아니다 — 그 뒤의 분류 기준을 여기 적는다**
(§6-1 8회차가 가르친 것: 루트 grep 은 옳았는데 **그 뒤의 분류 기준**이 걸렀다). 표에 남긴 것은
**raise 자리와 그것을 처리하는 자리의 소유가 다를 수 있는 도메인 예외**뿐이다 — 취소의 두 예외가 바로
그 모양이기 때문이다(progress 가 던지고 api 가 받는다). 뺀 것은 **한 소유 안에서 나고 그 소유가 처리하는**
예외들이고, 그 목록은 다음 다섯 무리다: `services/api/errors.py` 의 `ApiError` 계열
(`ApiError`/`NotFound`/`Forbidden`/`Conflict`/`Unprocessable`/`UnsupportedMedia`/`ServerError` — 정의·raise·
핸들러가 전부 api), `services/api/jobs.py::JobError`, `services/common/safe_expr.py` 의 `SafeExprError`
계열 넷, `services/ingest/rvt_adapter.py::APSError`, `services/knowledge` 의 `RuleLoadError`·`CaseLoadError`.
**이 기준이 놓치는 것과 그것을 태운 결과(§6-1 ②③):** 위 정규식은 기반 클래스 이름을 alternation 으로
열거하므로 **그 목록 밖 기반 클래스를 상속하는 예외**는 밖이다. 태워 봤다 — 같은 루트에서 `^class X(`
전부를 뽑아 위 alternation 히트를 빼고, 다시 `BaseModel`/`Base`/`BaseSettings`/`str, Enum`/
`DeclarativeBase` 같은 비예외 기반을 빼면 남는 것은 여섯이고(`BimObject`·`DrawingEntity`·`DocumentView`·
`TransitionResponse`·`DailyReportResponse`·`ExpertReviewLogMiddleware`) **그중 예외는 하나도 없다.**
0건이라는 결과가 기준을 정당화하지는 않으므로(§6-1) 기준의 한계는 그대로 적어 둔다.

**남긴 아홉이 예외 없이 한 규칙을 따른다: 예외의 자리는 raise 자리의 소유 집합이 정한다.** 소유가 하나면 그
서비스 트리, 정의 파일 자신이 raise 하면 그 파일, **둘 이상일 때만** 공통 상위(`packages/core`)다.
`packages/core/models/` 에 있는 셋 중 둘은 그 디렉터리 안에서 raise 되고, 나머지 하나가 ADR 0012 가
말한 "소유가 여럿" 사례다.

**취소의 raise 자리 소유는 하나다.** 두 판정 모두 `services/progress/document_mapper.py::
cancel_document_mapping_review` 한 함수 안에서 난다(규칙 6 의 순서 계약). api 는 **던지지 않고 받는다** —
`services/api/errors.py` 는 이미 `services/progress/state_machine` 의 두 예외를 import 해 핸들러를
등록하고 있으므로(`errors.py:11`) 새 import 는 같은 모양이다. 따라서 ADR 0012 의 근거는 **여기서 서지
않는다**: 공통 상위가 필요할 만큼 소유가 흩어져 있지 않고, 실제로 공통화가 필요한 것
(`rejection_reason_missing`)은 **이미** `packages/core` 에 있고 그대로 재사용한다(규칙 4).

**결정: `services/progress/` 에 둔다.** 이름은 `MappingDecisionCancelReasonRequiredError` ·
`MappingDecisionNotCancellableError` 이고, 둘 다 **`Exception` 직속**이다(ADR 0012 규칙 3 과 같은 판단 —
상속으로 다른 `except` 에 삼켜지지 않는다). `Exception` 직속이면 상속으로 얻는 폴백이 없으므로
`services/api/errors.py` 의 **전용 핸들러 둘이 이 불변식의 일부**다(핸들러가 없으면 500 + `code` 없음).

*이 예외들이 기대는 부재.* 취소 경로에 넓은 `except` 가 없어야 `Exception` 직속이 값을 한다.
실측(그 경로가 지나는 세 파일):

```
$ grep -n "except Exception\|except BaseException\|except:" \
    services/api/usecases.py services/api/routers/documents.py services/progress/document_mapper.py
(출력 없음, 종료코드 1)
```

*역방향 확인 — `services/progress/` 가 미는 것.* 이 예외를 던지는 자리가 **둘째 소유로 늘어나는 날**
타입이 위로 올라가야 하고, 그때 두 소유가 함께 움직인다. 그 날이 가깝지 않다는 근거는 실측이다:
2D↔3D(`mapping`) 축에는 되돌릴 결정이 **저장되지 않는다** — 반려 직후 그 매핑 행은
`(needs_review=True, reviewed_by=None, mapping_review_decision=None)` 이다(실측 `[D1-mapping-served-after-reject]`).
그러므로 "sync-2d3d 가 같은 예외를 던지게 된다"는 오늘 근거가 없다. **0건이라는 결과가 기준을
정당화하지는 않으므로**(§6-1) 조건만 적어 둔다: *둘째 raise 소유가 생기면 그 사이클이 이 타입을
`packages/core/models/` 로 올린다.*

### 규칙 6 — 오류 code 를 **둘 다 새로 가른다**. 그리고 순서가 계약이다

**후보를 그 code 의 *지금 화면 문구 원문*으로 갈랐다**(ADR 0011 규칙 1-a·ADR 0012 규칙 4 와 같은 기준).
문구는 `apps/web/src/components/ErrorBox.tsx` 의 `CODE_MESSAGES` 에서 그대로 인용한다.

**(가) 사유가 비었을 때**

| 후보 | 그 code 의 지금 화면 문구(원문) | 판단 |
|---|---|---|
| `rejection_reason_required` 재사용 | `"검토요청을 반려하려면 사유를 입력해야 합니다. 반려 사유를 적은 뒤 다시 시도하세요."` | **기각.** 취소는 반려가 아니다 — "반려하려면"·"반려 사유"가 이 자리에서 거짓이고, CM 이 지금 하려는 일은 **반려를 되돌리는 것**이라 정반대다 |
| `revocation_reason_required` 재사용 | `"확정을 되돌리려면 사유를 입력해야 합니다. 사유를 적은 뒤 다시 시도하세요."` | **기각.** 취소는 확정에서도 반려에서도 걸린다 — 반려 취소에서 "확정을 되돌리려면"은 거짓이다. 그리고 그 code 의 응답은 `from_state`/`to_state`/`actor` 를 싣는 계약인데(glossary 부칙 "응답 모양 일관성") 매핑 결정에는 그 셋이 **존재하지 않는다** |
| **새 code `cancel_reason_required`(409)** | 새로 쓴다 | **채택** |

**(나) 취소할 결정이 없을 때**(`reviewed_by is None`)

| 후보 | 그 code 의 지금 화면 문구(원문) | 판단 |
|---|---|---|
| `invalid_transition` 재사용 | `"현재 상태에서는 이 작업을 수행할 수 없습니다. 화면을 새로고침해 최신 상태를 확인하세요."` | **기각 — 다만 문구가 거짓이어서가 아니다.** 두 절은 여기서 **참**이다(정말 수행할 수 없고, 새로고침하면 그 쌍이 "검토 대기"로 보인다). 기각 이유는 **응답 모양**이다: 그 code 의 핸들러(`errors.py:78-82`)는 `exc.from_state.value` 등 세 필드를 반드시 싣는데 매핑 결정에는 전이가 없다. glossary 부칙이 요구하는 "같은 code = 같은 부가 필드"를 깨거나, 없는 값을 지어내야 한다 |
| `review_already_resolved` 재사용 | `"다른 담당자가 이미 이 검토요청을 처리했습니다. 목록을 새로고침해 최신 상태를 확인하세요."` | **기각.** 두 가지가 거짓일 수 있다 — ① 취소의 대상은 검토요청이 아니라 `(activity_id, doc_id)` 쌍이고 ② 그 쌍은 **아무도 판단한 적이 없을 수 있다**(시스템이 만든 `needs_review=True` 후보 그대로 — §Context 3 표 0행). "다른 담당자가 이미 처리했다"는 그 경우 지어낸 원인이다(§6-4 2) |
| `document_mapping_already_rejected` 재사용 | 화면 문구가 **없다** — 실측: `grep -rn document_mapping_already_rejected` 의 비테스트 히트 중 **코드는 `services/api/usecases.py:316` 하나**이고 나머지는 문서다(개수를 적지 않는 이유는 이 문서 자신이 그 히트를 늘리기 때문이다 — §6-1). `KnownApiErrorCode`(`apps/web/src/api/client.ts`)·`CODE_MESSAGES` 어디에도 없어 `errorText` 의 3번 분기(서버 `detail` 그대로)로 떨어진다 | **기각.** 뜻이 반대다(반려돼 있어서 못 한다 ↔ 아무 결정도 없어서 못 한다). 그리고 그 code 가 정본 표에 없다는 사실은 이 ADR 이 따로 고친다(§Consequences) |
| **새 code `mapping_decision_not_cancellable`(409)** | 새로 쓴다 | **채택** |

**상태코드는 둘 다 409.** 요청 스키마 위반(422)이 아니라 **대상의 현재 상태에 대한 요건**이고,
glossary 서문의 호환 약속("신규 code 추가는 표에 행만 더하고 기존 프론트 분기를 깨지 않는다")대로
`code` 를 모르는 클라이언트에게는 그대로 409 + `detail` 이다.

**부가 필드를 싣지 않는다.** ADR 0012 는 "부가 필드는 code 의 성질이 아니라 **raise 자리 집합의
교집합**"이라고 정했다. 이 두 code 는 raise 자리가 하나씩이라 교집합이 상한을 걸지 않는다 — 그래서
상한이 아니라 **필요**를 기준으로 정한다: ① 실을 수 있는 값(`activity_id`·`doc_id`)은 **클라이언트가 방금 URL 로 보낸 값**이라
화면이 분기할 새 정보가 아니고, ② 실측상 오류 응답의 부가 필드를 읽는 화면이 **0건**이다 —
`ApiError` 는 `body` 를 보관하지만(`apps/web/src/api/client.ts:98`) 비테스트 웹 소스에서 `.body` 를
**읽는** 줄은 그 대입 한 줄뿐이고(`grep -rn "\.body\b" apps/web/src | grep -v test` → `hooks.ts:388`
(요청 본문 분해)·`client.ts:98`(대입) 둘), `errorText`(`ErrorBox.tsx`)는 `code`·`status`·`message` 만
읽는다. `detail` 문장에는 어느 쌍인지 적는다.

*역방향 확인 — 부가 필드 없음이 미는 것.* 한 번에 여러 쌍을 취소하는 라우트가 생기면 "어느 쌍이
실패했는가"를 부가 필드로 실어야 한다. 오늘 그런 라우트는 없다(취소 라우트는 쌍 단위 —
아래 §인터페이스). 부가 필드는 계약면이라 **뺄 때가 실을 때보다 비싸므로**, 필요해지는 그 사이클에
더한다.

**순서가 계약이다.** 한 요청이 여러 요건을 동시에 어길 수 있으므로 검사 순서를 못박는다:

```
1) 인가(cm 아니면 403 forbidden_role)
2) 그 프로젝트에 (activity_id, doc_id) 매핑 행이 있는가 → 없으면 404 document_mapping_target_not_found
3) 그 쌍에 서 있는 CM 결정이 있는가(reviewed_by) → 없으면 409 mapping_decision_not_cancellable
4) 사유가 비어 있지 않은가 → 비었으면 409 cancel_reason_required
5) 취소 본체(규칙 1·2·3) → 6) record_expert_review → 7) commit
```

3 이 4 보다 **먼저**인 것은 ADR 0012 규칙 1 과 같은 판단이다: 그 ADR 은 `review_already_resolved` 를
사유 검사보다 앞에 두면서 "요청이 낡은 것과 사유가 빠진 것은 CM 이 할 일이 다르다(새로고침 ↔ 사유
작성)"를 근거로 적었다. 여기서도 같다 — **취소할 결정이 없는 CM 에게 "사유를 적으라"고 말하면 그는
적을 수 없는 사유를 적는다.** 계획 0006 §인터페이스는 2 가 4 보다 먼저라는 것까지만 정했고, 이 ADR 이
3 을 그 사이에 넣는다.

*역방향 확인 — 3 을 4 앞에 두면 잃는 것.* 두 요건을 동시에 어긴 요청(결정도 없고 사유도 없음)은
사유 문제를 **영영 보지 못한다**. 그것이 옳다: 그 요청은 사유를 채워도 성공하지 않는다.

### 규칙 7 — 취소는 **무제한**이다. 그 근거가 어디에 기대는지 함께 적는다

같은 쌍을 몇 번이든 확정·반려·취소할 수 있다. 횟수 제한을 두지 않는다.

| | 무제한(채택) | 결정→취소 1회 제한(기각) |
|---|---|---|
| 막는 것 | 아무것도 | 두 번째 오조작의 정정 |
| 여는 것 | 같은 쌍에 닫힌 요청 행이 누적된다(취소마다 새 요청 — 규칙 2) | 두 번째 오조작 때의 우회 = **다시 DB 직접 수정**(이 ADR 이 없애려는 바로 그것) |
| 비용 | 없음(기존 컬럼·기존 JSON 필드만 쓴다) | `ActivityDocumentMappingRow` 에 카운터 컬럼 신설 = `packages/core/models/` 스키마 변경 |

**무제한이 CLAUDE.md §0 을 우회하지 않는 이유는 규칙 1 의 착지점 하나다**: 취소는 어느 방향에서 불러도
`needs_review=True`(§Context 3 표 **3·4행**)로 착지하고, 그 상태는 `confirmed_required_documents` 의
첫 조건(`not m.needs_review`)에서 걸러진다. 확정을 만드는 경로가 아니므로 반복해도 확정이 늘지 않는다.

> **이 판단이 기대는 실측은 §Context 3 표의 3·4행 **한 쌍**뿐이다**(§6-1 ②를 이 규칙에 대해 답한다).
> 그 두 칸이 틀리면 — 즉 `needs_review=True` 인 매핑이 어떤 경로로든 `drawing_approval` 을 1.0 으로
> 만들 수 있다면 — "무제한이 안전하다"는 결론이 통째로 무너진다. 다른 근거가 이 결론을 받치고 있지
> 않다. 그래서 그 두 칸은 **검증에서 값 하나로 단언하면 안 되고**(3행과 4행은 readiness 가 구별하지
> 못한다 — §Context 3 (4)), `confirmed_required_documents` 에 그 doc 이 **없다**는 것까지 함께
> 단언해야 한다(계획 0006 V3).

그리고 반복은 **조용하지 않다**: 매 취소가 사유를 요구하고(규칙 4), 이력에 항목을 하나 더 쌓고(규칙 3),
CM 큐에 새 요청을 연다(규칙 2).

*역방향 확인 — 무제한이 실제로 미는 것.* 확정↔취소를 반복하면 그 쌍의 닫힌 `document_mapping` 요청 행이
계속 늘어난다(규칙 2 가 매번 새 행을 만든다). 그 누적이 운영에서 문제가 되는지는 **실측이 없다** —
문제가 되면 카운터가 아니라 **큐의 누적 표시**("이 쌍은 n 번째 재검토")로 연다. §Deferred 1.

### 규칙 8 — ADR 0007 §4-2 규칙 6 ⑥의 "반려는 영구하다"를 **대체하지 않고 좁힌다**

그 규칙이 실제로 지키던 것은 **"CM 이 매주 같은 후보를 다시 반려하지 않는다"**(시스템 재계산이 사람의
판단을 뒤집지 않는다)이고, **그것은 그대로 참이다.** 이 ADR 은 `_drop_already_confirmed` 를 바꾸지
않는다 — 실측 `[C-after-reject]` → `[S1b-after-reupload]`: 반려 뒤 대장을 재업로드해도 그 Activity 의
요청은 `['rejected']` 하나 그대로다.

좁아지는 것은 **주어**뿐이다: 영구하다 → **재계산에 대해서만** 영구하고, **CM 의 명시적 취소**로는
풀린다. 문서·코드 문구도 그 주어를 갖도록 고친다(규칙 9).

*역방향 확인 — 옛 조건이 잡던 것을 계속 잡는가.* 잡는다(위 실측). 만약 취소 구현이
`_drop_already_confirmed` 를 함께 건드리면 반려 뒤 재업로드에서 요청이 다시 열리거나 매핑이 새로
만들어져 옛 조건이 깨진다 — 그래서 계획 0006 V8 이 그 회귀를 따로 태운다.

### 규칙 9 — 이 사이클이 거짓으로 만드는 문구는 이 사이클이 고친다 (CLAUDE.md §6-4 1)

**생성 기준.** 저장소 루트에서 "취소·되돌리기가 없다"고 말하는 문장을 찾고(경로를 먼저 좁히지 않았다),
각 줄을 열어 참·거짓을 **개별 판정**했다 — "취소"라는 낱말이 들어갔다고 전부 낡는 것이 아니다.

```
$ cd /home/user/Bim && grep -rn "취소\|되돌리" --include=*.tsx --include=*.ts --include=*.py \
    --include=*.yaml --include=*.md . --exclude-dir=.venv --exclude-dir=node_modules \
    --exclude-dir=.git --exclude-dir=dist | grep -iE "확정|반려|매핑|unreject|unconfirm"
```

| 자리(HEAD `516949a`) | 지금 문장 | 이 변경 뒤 | 소유 |
|---|---|---|---|
| `apps/web/src/pages/ReviewsPage.tsx:55` | "…**확정을 취소하는 기능은 없습니다.** Activity 정보가 바뀌면…" | **거짓** | frontend |
| `apps/web/src/pages/ReviewsPage.tsx:51`·`:52`(주석) | "**되돌리는 API 가 없다**" / "unconfirm/revoke/DELETE 는 존재하지 않는다" | **거짓** | frontend |
| `apps/web/src/pages/ReviewsPage.tsx:59` | "…**되돌릴 수 없으니** 확인 후 진행하세요." | **거짓** | frontend |
| `apps/web/src/pages/ReviewsPage.test.tsx:166` | `expect(text).toMatch(/확정을 취소하는 기능은 없습니다/)` — **거짓 문구를 계약으로 고정한 자리** | **거짓** | qa |
| `services/progress/document_mapper.py:541` | "**반려는 (activity_id, doc_id) 쌍에 대해 영구하다** — Activity 쪽 정보가 바뀌어도 되돌리지 않는다." | **주어를 좁혀야 한다**(규칙 8) | progress-engine |
| `services/api/usecases.py:306` | "확정 시 반려 표시를 지우는 쪽(반려 취소)은 별개의 기능이고 … ADR Deferred 에 남겼다" | **낡는다**(그 Deferred 가 닫힌다) | api |
| `tests/integration/test_15_…py:315` | "반려 취소는 별개 기능이다" | **낡는다** | qa |
| `docs/adr/0007-*.md` §Deferred 두 항목 · `docs/adr/0009-*.md` §Deferred 3 | "매핑 확정 취소(unconfirm)" · "매핑 반려 취소(unreject)" · "문서 매핑 확정을 사람이 되돌리는 경로" | **닫힌다** | architect(이 사이클) |
| `docs/glossary.md` `매핑 반려` 행 | "…남는 **영구 표시**" | **거짓** | architect(이 사이클) |
| `apps/web/src/pages/DocumentDetailPage.tsx:255` | "확정 이후에는 **시스템이** 이 매핑을 되돌리지 않습니다" | **참으로 남는다** — 취소는 시스템이 아니라 사람이 한다. 취소 버튼이 이 화면에 붙으므로 그 사실을 **더한다**(지우지 않는다) | frontend |
| `config/document_register.yaml` `DOCUMENT_IDENTITY_DRIFT` 문구 | "되돌리려면 바꾼 쪽을 원래대로 두고 대장을 다시 올린다" | **참으로 남는다** — config 되돌리기를 말하는 것이지 매핑 결정 취소가 아니다 | — |

*새 문구 테스트(§6-4 3).* 문장을 통째로 베끼지 않는다. 단언은 "그 상황에서 참일 수 없는 말이 없다"이다:
`ReviewsPage` 의 `document_mapping` 승인 안내에 **"확정을 취소하는 기능은 없습니다"가 없다**,
`ErrorBox` 의 `cancel_reason_required` 안내에 **"새로고침"이 없고 "사유"가 있다**.
`cancel_reason_required` 에서 새로고침은 아무것도 바꾸지 않는다 — 다음 행동은 사유를 적는 것 하나다.
(`mapping_decision_not_cancellable` 은 다르다 — 거기서는 새로고침이 실제로 답이므로 그 말을 써도 된다.
같은 사이클의 두 code 가 서로 다른 요구를 갖는 것이 이 규칙이 **문장**이 아니라 **상황**을 보는 이유다.)

---

## 인터페이스

```
POST /api/documents/mappings/{activity_id}/{doc_id}/cancel-review?project_id=<pid>
body: {"note": "<비어 있지 않은 사유>"}
→ 200 ActivityDocumentMapping   (needs_review=true, reviewed_by=null)
```

확정 라우트(`POST /api/documents/mappings/{activity_id}/{doc_id}/confirm` —
`services/api/routers/documents.py:68`)와 **같은 축**에 둔다: 취소의 대상은 검토요청 하나가 아니라 그
`(activity_id, doc_id)` 쌍에 **서 있는 CM 의 결정**이고, 한 쌍은 생애 동안 여러 요청 행을 갖는다
(복귀·재오픈 — ADR 0007 §4-2 규칙 6 ⑤). `project_id` 를 쿼리 필수로 받는 것은 ADR 0008 의 대리키 라우트
관례이자 확정 라우트와 같은 모양이다.

본체는 progress 가 소유한다(CLAUDE.md §3 규칙 11 — 매핑 생명주기·검토요청 해소):

```python
# services/progress/document_mapper.py
def cancel_document_mapping_review(
    session: Session, project_id: str, activity_id: str, doc_id: str,
    cancelled_by: str, note: str,
) -> tuple[ActivityDocumentMapping, str]:
    """CM 이 이 쌍에 서 있는 결정(확정 또는 반려)을 취소한다. (매핑, 새 검토요청 id) 를 돌려준다.

    순서(규칙 6): reviewed_by is None → MappingDecisionNotCancellableError,
                  이어서 rejection_reason_missing(note) → MappingDecisionCancelReasonRequiredError.
    ① 옛 ReviewRequestRow 는 손대지 않는다. ② 새 open 요청을 그 자리에서 연다.
    ③ 매핑 행: reviewed_by=None, needs_review=True, 반려 표시 4키 제거,
       extra["cancelled_mapping_reviews"] 에 append(키가 없으면 빈 목록으로 읽는다).
    매핑 행이 없으면 LookupError(호출자 사전조건 — api 가 존재를 이미 확인한다).
    """
```

api 는 인가 → 존재 확인(404) → 본체 호출 → `record_expert_review` → commit 만 한다.
전문가 검토 로그는 새 테이블을 만들지 않고 기존 것을 쓴다 — `services/api/usecases.py` 가
`drawing_alignment`·`activity_document_mapping` 에 이미 같은 것을 남긴다.

---

## 한정어 역방향 확인 (CLAUDE.md §6-3 산출물 — 각 칸은 **실행값 또는 코드 인용**이고 다른 절을 가리키지 않는다)

| 한정어 | 빼면 무엇이 더 들어오는가 | 이 단어 때문에 무엇이 빠지는가 | 근거 |
|---|---|---|---|
| **`document_mapping` 축만**(2D↔3D 는 밖) | 2D↔3D 매핑 반려의 취소까지 | 그 축 전체 | 실행값 `[D1-mapping-served-after-reject]`: 2D↔3D 반려 직후 그 핸들의 매핑은 `('0BcjbttMr12PUpme0A2uXY', needs_review=True, reviewed_by=None, decision=None)` — **매핑 행에 되돌릴 것이 하나도 없다.** 실행값 `[D2-realign1]`·`[D3-realign2]`: 재정합 한 번에 그 핸들의 open 요청이 다시 생긴다(`{'53': 1}`). 그 축의 결함은 다른 것이다(§Deferred 2) |
| **취소는 미확정으로만 착지한다** | "직전 결정의 반대로 착지"(반려 취소 → 확정) | 확정으로 바로 가는 지름길 | 실행값 §Context 3 표 2행: `reviewed_by` 를 남긴 채 표시만 지우면 `drawing_approval` **1.0** · `score` **0.7** · note **`approved=1/1; pending_mappings=0`** · blocker `[None]`. CM 의 유일한 행위가 반려였는데 착수 가능이 뜬다 |
| **사유 필수(`note` 가 비어 있지 않다)** | 없음 | 사유 없는 취소 | 코드 인용: 판정은 `packages/core/models/review.py:147` `def rejection_reason_missing(note: str \| None) -> bool: return not (note or "").strip()` 를 그대로 쓴다. 같은 판단이 ADR 0011 규칙 1·ADR 0012 불변식 4 에 이미 있다 |
| **`reviewed_by is None` 이면 409**(무동작 200 이 아니라) | 미확정 매핑에 취소를 걸면 **200 을 주면서 아무 일도 하지 않는다** | 무동작 200 | 코드 인용: 이 저장소가 그 모양을 이미 겪었다 — `services/api/usecases.py:303-304` 의 docstring "그 결과 **200 을 돌려주면서 readiness 는 이 확정을 영원히 보지 못하는** 반쪽 상태가 만들어졌다(이번 사이클에서 네 번째로 나온 '응답은 성공인데 아무 효과가 없다')" |
| **옛 요청 행을 손대지 않는다** | 옛 행을 `open` 으로 되돌려 재사용하는 설계 | 그 설계 | 코드 인용: `services/progress/document_mapper.py:433-436` 이 정확히 그것을 하는데 `review.resolved_by = None` · `resolved_at = None` · `resolution_note = None` 으로 **누가 왜 닫았는지를 지운다** |
| **취소가 그 자리에서 새 요청을 연다**(재계산을 기다리지 않는다) | 없음 — 열린 요청이 있으면 재계산·재업로드가 새로 만들지 않는다(실행값 `[C5-recompute-again]`·`[C6-reupload-with-open]` 둘 다 `['open','rejected']`) | 재계산까지의 공백 | 실행값 `[C3-queue-mapping-only]`: 매핑 행만 되돌린 뒤 그 Activity 의 `document_mapping` 요청은 `['rejected']` 하나뿐인데 readiness 는 `document_mapping_pending`("문서 매핑 1건이 CM 검토 대기") — **열린 것이 없다.** `[C4-queue]`(재계산 호출) 후에야 `['open', 'rejected']` |
| **반려 표시를 지운다**(남기지 않는다) | 이력을 `extra` 의 **같은 키**에 남기는 설계 | 옛 반려자·반려 사유가 활성 값으로 보이는 것 | 실행값 §Context 3 표 3행 vs 4행: readiness 의 네 칸이 **완전히 같다**(0.5 / 0.625 / `[None,'document_mapping_pending']` / `approved=0/0; pending_mappings=1`). 가르는 것은 화면이다 — 코드 인용 `apps/web/src/domain/mappingReview.ts:28`(`if (mapping.needs_review) return "pending";`)과 `:41`(`rejectedBy: str(extra.rejected_by), rejectedAt: …, note: str(extra.rejection_note)`)이 3행에서 서로를 반박하고, 두 함수를 한 카드에서 나란히 부르는 자리가 `ReviewsPage.tsx:216-217`·`DocumentDetailPage.tsx:292-293` 이다 |
| **`services/progress/` 에 예외를 둔다**(`packages/core/models/` 가 아니라) | 소유가 하나인 예외까지 공통 상위로 | 소유가 하나인 예외를 공통 상위에 두는 선택 | 실행값(전수 표, 규칙 5): `packages/core/models/` 의 예외 셋 중 둘은 **그 파일 자신이 raise** 하고, 나머지 하나(`ReviewRejectionReasonRequiredError`)만 raise 소유가 둘이다(`state_machine.py:156`·`usecases.py:446`). 서비스 트리의 여섯은 전부 raise 소유가 하나다 |
| **`Exception` 직속**(하위 타입이 아니라) | 상위 핸들러의 MRO 폴백 | 다른 `except` 에 삼켜질 가능성 | 코드 인용: ADR 0012 규칙 3 의 실측이 하위 타입 → **200 · `code` 없음**(삼켜짐)을 보였다. 그리고 취소 경로에는 넓은 `except` 가 없다 — 실행값 `grep -n "except Exception\|except BaseException\|except:" services/api/usecases.py services/api/routers/documents.py services/progress/document_mapper.py` → **출력 없음, 종료코드 1** |
| **`mapping_decision_not_cancellable` 검사가 사유 검사보다 먼저** | 두 요건을 동시에 어긴 요청이 사유 오류를 받는다 | 그 경우의 사유 오류 | 코드 인용: ADR 0012 규칙 1 이 같은 판단을 `review_already_resolved` 에 대해 적고 `tests/integration/test_08_review_requests.py:127-129` 가 그 순서를 고정한다. 취소는 새 라우트라 그런 고정이 없으므로 **여기서 순서를 계약으로 못박는다** |
| **무제한**(1회 제한이 아니라) | 두 번째 오조작의 정정 | 없음 | 실행값: 취소가 착지하는 두 상태(`reviewed_by=null`/`needs_review=true`, 반려 표시 present / absent)가 readiness 에서 **둘 다** `drawing_approval` 0.5 · `score` 0.625 · blocker `[None, 'document_mapping_pending']` · note `approved=0/0; pending_mappings=1` 이다 — 즉 몇 번을 반복해도 확정 증거가 생기지 않는다. **그리고 이 결론을 받치는 실행값은 그 두 칸뿐이다**(규칙 7 의 인용 블록) |
| **(옛 조건이 잡던 것)** ADR 0007 §4-2 규칙 6 ⑥ 의 "반려는 영구" | — | — | 그 조건이 실제로 잡던 것은 "재계산이 사람의 판단을 뒤집지 않는다"이고 **취소가 생겨도 그대로다**: `_drop_already_confirmed`(`document_mapper.py:340`, 조건은 `:360-361`)를 바꾸지 않는다. 실행값 `[C-after-reject]` `['rejected']` → `[S1b-after-reupload]` `['rejected']`(대장 재업로드 뒤에도 open **0건**) |
| **(옛 조건이 잡던 것)** `_reject_confirm_of_rejected_mapping`(409 `document_mapping_already_rejected`) | — | — | 그대로 둔다. 그것이 막는 것은 "반려된 매핑을 **취소 없이** 확정하는 것"이고, 취소는 그 앞 단계에서 반려 표시를 지우므로 이 방어를 우회하지 않는다 — 코드 인용: `services/api/usecases.py:313-316` 은 `if is_rejected_mapping(row.evidence):` 하나만 보고, 취소 뒤 그 함수는 `False` 다(`document_mapper.py:337` `return bool((evidence or {}).get("extra", {}).get("mapping_review_decision") == …)`) |

*같은 문서·인접 절과의 교차 확인(§6-3).* 세 쌍을 대조했다.

1. §Context 3 (1)은 "반려해도 값이 0.5 그대로"라고 적고 §Context 1 은 그것을 "운영 위험"이라 적는다.
   위험한 것은 **값이 아니라 1.0 에 도달할 경로가 닫히는 것**이며, (1)이 그 구분을 명시하고 실행값
   (`[S1b-after-reupload]`)이 그것을 보인다. 두 문장은 서로를 반박하지 않는다.
2. 규칙 1 은 "표시를 지운다"를 요구하고 규칙 5·§Context 3 (3)은 "`reviewed_by=None` 하나만으로도
   2행은 닫힌다"고 적는다. 둘은 같은 방향이다 — 표시 제거의 근거는 §0 위반 방지가 아니라 **화면의 자기
   모순**(§Context 3 (4))이고, 근거가 다르므로 두 요구는 각각 서 있어야 한다. 규칙 1 이 셋을 **한
   트랜잭션**으로 묶는 이유가 이것이다.
3. 규칙 6 (나)는 `invalid_transition` 의 문구가 이 자리에서 **참**이라고 적는데, ADR 0011 규칙 1-a 와
   ADR 0012 규칙 4 는 같은 code 를 **문구가 거짓이라서** 기각했다. 이 ADR 은 그 판정을 뒤집지 않는다 —
   거기서 거짓이었던 것은 전이 경로의 이야기이고, 여기서 기각 사유는 문구가 아니라 **응답 모양**
   (없는 `from_state`/`to_state`/`actor`)이다. 근거가 다르면 같은 결론이라도 그 근거를 적어야
   다음 사람이 잘못된 일반화("그 code 는 언제나 거짓")를 물려받지 않는다.

---

## 이 불변식을 지금 무엇이 붙들어 주는가

ADR 0011 §3 과 ADR 0012 §Consequences 는 각각 "넣자마자 무보호다"를 적었다. **여기서 같은 문장을
쓰면 그것은 부재 단정이 아니라 시제 표현이다**(CLAUDE.md §6-1: "부재를 적을 때 그것을 메우는 작업이
같은 사이클에 있는지 본다") — 취소 경로 자체가 아직 코드에 없고, 계획 0006 작업 6·9 가 같은 사이클에
V1~V10 을 붙인다. 그러므로 여기 적는 것은 부재가 아니라 **각 규칙이 무엇과 *함께* 단언돼야 하는가**다
(§6-2 4).

| 규칙 | 값 하나만 단언하면 통과하는 결함 코드 | 그래서 함께 단언할 것 |
|---|---|---|
| 1(착지점) | 표시만 지우고 `reviewed_by` 를 남긴 구현 — `reviewed_by is None` 만 보면 죽지만 `drawing_approval` 만 보면 **0.5 → 0.5** 라 반려 방향에서 아무것도 갈리지 않는다(§Context 3 표 1행 vs 4행) | `reviewed_by is None` **그리고** `drawing_approval != 1.0` **그리고** `confirmed_required_documents` 에 그 doc 이 **없다** |
| 2(큐) | 옛 행을 되열어 `resolved_by=None` 으로 지우는 구현(`document_mapper.py:433-436` 모양) — "open 요청 1건"만 보면 통과한다 | open 요청 1건 **그리고** 옛 행이 여전히 `rejected`/`approved` 이고 `resolved_by`·`resolution_note` 가 살아 있다 |
| 4(사유) | 부분 적용 후 예외를 던지는 구현 — 409 만 보면 통과한다 | 409 `cancel_reason_required` **그리고** 매핑 행·요청 상태가 **아무것도 바뀌지 않았다** |
| 7(무제한) | 1회 제한 구현 — 첫 취소만 보면 통과한다 | 둘째 취소도 200 **그리고** `extra.cancelled_mapping_reviews` 길이 2 **그리고** 옛 요청 행 둘이 각자 그 시점 status 를 유지 |
| 8(옛 조건) | `_drop_already_confirmed` 를 함께 건드린 구현 — 취소 동작만 보면 통과한다 | 취소 뒤 대장 재업로드에서 그 쌍의 open 요청이 **1건 그대로**(중복 없음), 매핑 행 그대로 |

**반려 방향의 시나리오를 값(`drawing_approval`·`score`)으로 단언하면 안 된다** — 실측상 반려 전후가
0.5/0.625 로 같아서 결함 코드와 정상 코드가 구별되지 않는다(§Context 3 (2)). 그 방향에서 갈리는
관측값은 `blockers[]` 와 `evidence.note` 둘뿐이고, **`kind` 만으로도 부족하다** — 1행(반려)과
2행(반쪽 취소)은 남는 `kind` 가 둘 다 `[None]` 계열이라 갈리지 않는다. `reason`(`drawing approval
unknown` ↔ 없음) 또는 `drawing_approval` blocker 의 **존재**까지 봐야 한다(실측 `[ROW1-blockers-full]` ·
`[ROW2-blockers-full]`).

---

## Consequences

- **좋아지는 것.** CM 의 오조작에 되돌릴 길이 생기고, 되돌린 기록에 **누가·언제·왜**가 남는다.
  지금은 그 길이 DB 직접 수정뿐이고(ADR 0007 §Deferred), DB 직접 수정에는 감사도 사유도 없다.
- **치러야 하는 값.** ① CM 이 취소할 때 사유 한 칸을 더 채운다. ② 같은 쌍에 닫힌 검토요청 행이
  취소마다 하나씩 쌓인다(규칙 7 의 역방향 확인 · §Deferred 1). ③ 오류 code 어휘가 둘 늘어나고,
  `apps/web/src/api/client.ts` 의 수작업 동기화 목록(`KnownApiErrorCode`)이 **세 줄** 길어진다(신규 둘 +
  아래 `document_mapping_already_rejected`) —
  그 목록의 자동화는 그 파일 상단 TODO 가 이미 후속으로 적어 둔 것이고 이 ADR 이 부담을 키운다.
- **잡지 못하는 것.** 사유의 **내용**은 검사하지 않는다("."도 통과한다) — ADR 0011·0012 와 같은 판단.
- **저장된 과거 기록은 마이그레이션하지 않는다.** 이미 확정·반려된 매핑 행에는
  `extra.cancelled_mapping_reviews` 키가 없고, 읽는 쪽이 빈 목록으로 읽는다(규칙 3).
- **정본 표의 구멍 하나를 함께 메운다.** 실측: `document_mapping_already_rejected`(409)는 서버가
  2026-09-03 부터 내보내는데(`services/api/usecases.py:316`) glossary "오류 응답 code 어휘" 표에 행이
  없고 `KnownApiErrorCode`·`CODE_MESSAGES` 에도 없어 화면이 서버 `detail` 을 그대로 보여준다.
  이 ADR 이 그 code 의 **뜻을 바꾸므로**(반려는 이제 CM 이 풀 수 있다) 정본 표에 행을 더한다.
  화면 쪽(`client.ts`·`ErrorBox.tsx`)은 frontend 소유라 이 커밋이 건드리지 않는다 — §Deferred 5.
- **`services/sync/` 는 무변경이다.** 2D↔3D 축에는 되돌릴 결정이 저장되지 않는다(실측 `[D1-*]`).

## Alternatives

1. **표시만 지우고 `reviewed_by` 를 남긴다(= 직전 결정의 반대로 착지).** 기각. 실측상 그 착지점은
   `drawing_approval` **1.0** 이고 CLAUDE.md §0 위반이다(§Context 3 (3)).
2. **옛 검토요청 행을 다시 `open` 으로 되돌려 재사용한다.** 기각. 그 모양의 기존 코드가
   `resolved_by`·`resolved_at`·`resolution_note` 를 지운다(`document_mapper.py:433-436`) — ADR 0011·0012 가
   두 사이클 들여 세운 "결정에는 이유가 남는다"의 정반대다. 지우지 않고 되열면 **닫힌 적 없는 요청이
   `resolution_note` 를 갖게 되어** 큐 화면이 처리되지 않은 요청에 처리 메모를 보인다.
3. **매핑 행만 되돌리고 큐는 재계산에 맡긴다.** 기각. 실측 `[C3-*]`: readiness 는 "1건 대기"인데 큐가
   비어 있다 — 이 저장소의 지배적 실패 모드다.
4. **취소를 검토요청 단위 라우트로 만든다(`/review-requests/{id}/cancel`).** 기각. 취소의 대상은
   요청 하나가 아니라 그 쌍에 서 있는 결정이고, 한 쌍은 생애 동안 여러 요청 행을 갖는다
   (ADR 0007 §4-2 규칙 6 ⑤ 의 복귀·재오픈 — `document_mapper.py:427-441` 이 그 코드다).
   요청 id 로 부르면 "어느 요청을 골라야 하는가"가 호출자의 문제가 된다.
5. **결정→취소 1회 제한.** 기각. 두 번째 오조작의 우회가 다시 DB 직접 수정이 되고,
   `packages/core/models/` 스키마 변경이 필요하다(규칙 7 표).
6. **새 예외를 `packages/core/models/review.py` 에 둔다(ADR 0012 를 그대로 베낀다).** 기각.
   그 ADR 의 근거는 "raise 소유가 여럿"이었고 취소는 하나다(규칙 5 전수 표). 공통화가 실제로 필요한
   술어는 이미 거기 있고 그대로 재사용한다.
7. **`rejection_reason_required` 를 재사용한다.** 기각. 그 code 의 화면 문구가 이 자리에서 거짓이다
   (규칙 6 (가)).

## Deferred

1. **확정↔취소 반복의 누적.** 반복할 때마다 그 쌍의 닫힌 `document_mapping` 요청 행이 하나씩 쌓인다
   (규칙 2 가 매번 새 행을 만든다). 운영에서 문제가 되는지 **실측이 없다** — 문제가 되면 카운터 컬럼이
   아니라 **큐의 누적 표시**("이 쌍은 n 번째 재검토")로 연다.
2. **반려된 2D↔3D 매핑이 뷰어 계약에 계속 실린다.** 실측 `[D1-mapping-served-after-reject]`: 큐에서
   반려한 직후에도 `GET /api/drawings/{id}/mappings` 가 그 핸들(`53`)을 그 객체
   (`0BcjbttMr12PUpme0A2uXY`)로 계속 돌려주고, 매핑 행에는 반려의 흔적이 없다
   (`needs_review=True, reviewed_by=None, mapping_review_decision=None`). 이것은 **취소의 부재가 아니라
   반려가 아무 효과를 내지 않는 것**이다 — 다른 결함이고 sync-2d3d 소유이며 별도 ADR 이 필요하다.
3. **`rejection_reason_missing` 의 이름이 판정보다 좁다.** 규칙 4. 이 ADR 이 셋째 호출자를 만들므로
   개명은 다음 사이클에서 자연스럽다 — 함께 움직여야 하는 자리는 그때 다시 전수로 센다.
4. **`"rejected"` 라는 *값* 리터럴의 전수 감사.** 이 ADR 의 목록 축은 **필드 이름**과 **예외 타입**이고
   값 축이 아니다. 계획 0005 가 `cause` 에 대해 만든 `tests/invariants/test_identity_drift_cause_contract.py`
   와 같은 감사를 이 값으로 넓힐지는 qa 의 판단이다(계획 0006 §후속 2).
5. **`document_mapping_already_rejected` 가 화면 code 목록에 없다.** 실측(§Consequences): 서버는 내는데
   `KnownApiErrorCode`·`CODE_MESSAGES` 에 없어 원인별 안내가 나가지 않는다. 이 ADR 은 정본 표(glossary)에만
   행을 더한다 — 그 두 파일은 frontend 소유이고, 새 code 둘과 함께 한 번에 더하는 것이 옳다.
