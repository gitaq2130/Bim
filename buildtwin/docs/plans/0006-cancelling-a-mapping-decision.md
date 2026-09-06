# 계획 0006 — 매핑 결정의 취소 경로 · `from_state` 축의 보호 여부 · CLAUDE.md §2 서수 참조

- 작성: architect
- 날짜: 2026-09-06
- 관련: **ADR 0007 §Deferred "매핑 확정 취소(unconfirm)"·"매핑 반려 취소(unreject)"**(이 사이클이 그 둘을
  함께 닫는다 — 그 항목 자신이 "따로 만들면 또 비대칭이 생긴다"고 적었다), ADR 0007 §4-2 규칙 6 ⑥,
  ADR 0011(되돌리기에 사유를 요구한 선례), ADR 0012 §Deferred 3(다중 종료 — 이 계획이 실측한다),
  ADR 0001 §4-1·§6, CLAUDE.md §0(삼중 검증)·§2·§3 규칙 11·§3-13·§6 전체,
  `docs/plans/0005-*.md` §후속 3

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, 브랜치 `claude/buildtwin-initial-setup-ubulzb`,
**HEAD `99d3721`**. 저장소 루트 `/home/user/Bim` 에서 `git status --porcelain` **전문이 빈 출력**이다
(모든 탐침 전후로 확인했다 — 하위 디렉터리에서 확인하면 상대 경로 때문에 조용히 놓친다).

기준선(전부 이 사이클에서 직접 쟀다, 필터 없이 `tail`):

```
$ cd /home/user/Bim/buildtwin && .venv/bin/pytest -q
783 passed, 1 warning in 66.01s (0:01:06)

$ cd /home/user/Bim/buildtwin/apps/web && npx vitest run
 Test Files  28 passed (28)
      Tests  268 passed (268)

$ cd /home/user/Bim/buildtwin && make lint ; echo "exit=$?"
exit=0
```

아래 실측은 `tests/integration/` 에 **임시 탐침 파일**(`test_zzprobe_0006.py`)을 두고 세션 픽스처
(`client`/`auth`/`user_ids`/`project`/`ifc_job`/`dxf_job`)로 TestClient 를 태운 뒤 파일을 지웠다.
DB 직접 조작이 필요한 칸은 `packages.core.db.session_scope` 로 같은 임시 SQLite 를 열었다.
`git archive HEAD:buildtwin` 트리는 생성 픽스처 `tests/fixtures/sample.ply` 가 들어오지 않아 전량이
다르므로 **쓰지 않았다** — 모든 수치는 작업 트리(783 기준선)의 값이다.

**이 문서의 모든 `파일:줄` 참조는 HEAD `99d3721` 트리의 것이다** — HEAD 가 움직여도 갱신하지 않는다
(CLAUDE.md §3-13 첫째 갈래). 명시적으로 다른 트리를 적은 **절제 실측**만 예외이고, 그 자리에 어떤
조건을 뺀 트리인지 적어 둔다.

---

## 목표

1. **매핑 결정(확정·반려)에 취소 경로를 만든다.** 지금은 둘 다 설계상 영구이고 오조작 시 되살릴 방법이
   DB 직접 수정뿐이다(ADR 0007 §Deferred 두 항목). 계획 0005 가 "반려는 되돌릴 수 없으니 사유를
   요구하자"로 끝났는데, 그 전제 자체가 현장 위험이다.
2. **`close_inspection_reviews` 의 `from_state` 축을 보호할지 결정한다.** 계획 0005 V7 이 "무보호로
   기록만 하고 닫는다"로 남겼고, 리뷰어가 "기록만 하고 잊는 상태로 두지 않는 것"을 다음 사이클의 몫으로
   지목했다.
3. **CLAUDE.md §2 의 서수 줄 참조를 문구 참조로 바꾼다**(이 사이클에서 완료 — §과제 3).

---

# 과제 1 — 매핑 결정에 취소 경로를 만든다

## 1-a. 전수 목록 — 매핑 결정이 실제로 어디에 어떻게 남는가

**생성 기준(§6-1).** 저장소 루트 `/home/user/Bim` 에서, 결정을 담는 **필드에 대입하는 줄**을 찾았다.
소유·계층으로 경로를 먼저 좁히지 않았다.

```
$ cd /home/user/Bim && grep -rnE "(reviewed_by|needs_review|mapping_review_decision|resolution_note|resolved_by|resolved_at)[\"' ]*\]? *= *[^=]" . \
    --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=.git \
    --exclude-dir=.mypy_cache --exclude-dir=.pytest_cache --exclude-dir=dist --exclude-dir=__pycache__
```

그 출력에서 **비테스트·비문서 생산 코드**만 남긴 것이 아래다(소유는 목록을 만든 **뒤에** 나눴다).

### (가) 쓰는 자리 — `document_mapping` 축(문서 ↔ Activity)

| # | 자리 | 무엇을 쓰는가 | 소유 |
|---|---|---|---|
| 1 | `services/progress/document_mapper.py:564-571` (`reject_document_mapping`) | `evidence.extra` 에 `mapping_review_decision="rejected"`·`rejected_by`·`rejected_at`(`:567` `rejection_note`), 그리고 `row.reviewed_by = rejected_by`(`:570`) · `row.needs_review = False`(`:571`) | progress-engine |
| 2 | `services/api/usecases.py:340` (`_confirm_document_mapping_row`) | 매핑 모델을 `reviewed_by=user_id` 로 저장(모델 검증자가 `needs_review=False` 를 강제) | api |
| 3 | `services/progress/document_mapper.py:514-517` (`close_document_mapping_review`) | 검토요청 행을 `status="approved"` + `resolved_by`/`resolved_at`/`resolution_note` | progress-engine |
| 4 | `services/progress/document_mapper.py:494-497` (`_close_reviews_for_orphaned_documents`) | 검토요청 행을 `on_hold` + 고아화 사유 | progress-engine |
| 5 | `services/progress/document_mapper.py:433-436` (`_reopen_reviews_for_invalidated_confirmations`) | 닫힌 검토요청을 `status="open"` 으로 되돌리고 **`resolved_by`·`resolved_at`·`resolution_note` 를 `None` 으로 지운다** | progress-engine |
| 6 | `services/api/usecases.py:523·525` (`resolve_review` 공통 폴백) | `row.status, row.resolution_note, row.resolved_by, row.resolved_at` | api |
| 7 | `services/progress/persistence.py:357·362` (`save_document_mapping` upsert) | `needs_review`·`reviewed_by` 를 모델 값으로 | progress-engine |

**5 번이 이 과제의 선례이자 반례다.** 이 저장소에는 이미 "닫힌 검토요청을 다시 여는" 코드가 있는데,
그것이 **누가 언제 닫았는가를 지운다**(`review.resolved_by = None` — `document_mapper.py:434`).
ADR 0011·0012 가 세운 축("결정에는 반드시 감사 흔적")과 정반대 모양이므로, 취소는 이 모양을 베끼면 안 된다.

### (나) 쓰는 자리 — `mapping` 축(2D 엔티티 ↔ 3D 객체)

| # | 자리 | 무엇을 쓰는가 | 소유 |
|---|---|---|---|
| 8 | `services/sync/review_queue.py:75` (`resolve_mapping_reviews`) | 검토요청 행만 — `status, resolved_by, resolved_at, resolution_note` | sync-2d3d |
| 9 | `services/sync/review_queue.py:51`(`confirm_mapping`) · `:109`(`confirm_mapping_row` 수동 생성) | 매핑 모델의 `reviewed_by`·`needs_review=False` | sync-2d3d |
| 10 | `services/sync/persistence.py:169-173` (`rebuild_mappings`) | 이 도면의 이전 open 요청을 `on_hold` + `superseded_by=…` | sync-2d3d |
| 11 | `services/sync/matcher.py:170` (`build_mappings`) | 생성 시 `needs_review = conf < review_threshold` | sync-2d3d |

### (다) 읽는 자리 — 관계는 **곱**으로 센다(§6-1)

쓰는 자리만 세면 "되돌리면 무엇이 따라 움직이는가"를 영영 묻지 못한다. 반대 방향을 따로 만들었다:

```
$ cd /home/user/Bim && grep -rn "is_rejected_mapping\|mappingReviewState\|mappingRejection" . \
    --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.mypy_cache \
    --exclude-dir=dist --exclude-dir=__pycache__
```

비테스트·비문서 소비자 **여섯**(이 칸의 결론이 개수에 기대지 않으므로 열거가 곧 목록이다):

| 자리 | 무엇을 하는가 | 취소가 여기 닿는가 |
|---|---|---|
| `services/progress/document_mapper.py:1006` (`confirmed_required_documents`) | `not needs_review and not is_rejected_mapping` → readiness `drawing_approval` 의 확정 필수 문서 | **닿는다** — §1-c 표 |
| `services/progress/document_mapper.py:411` (`_reopen_reviews_for_invalidated_confirmations`) | 반려된 행은 재확인 대상에서 제외 | 닿는다 — 취소 후 `reviewed_by is None` 이라 `:409` 에서 먼저 걸러진다 |
| `services/api/usecases.py:313` (`_reject_confirm_of_rejected_mapping`) | 반려된 매핑의 확정을 409 로 거절 | **닿는다** — 취소 후에는 확정이 다시 가능해야 한다 |
| `services/ingest/persistence.py:489` (`_lost_decisions`) | 식별 드리프트 보고의 `decision` 을 확정/반려로 가름 | 닿지 않는다 — 같은 루프의 `:485-486` 이 `row.reviewed_by is None` 이면 `continue` 한다(코드 인용). 취소된 쌍은 서 있는 판단이 없으므로 보고에서 빠지는 것이 옳다 |
| `apps/web/src/domain/mappingReview.ts:27` (`mappingReviewState`) | `needs_review` → `pending`, 아니면 `rejected`/`confirmed` | **닿는다** — 취소 후 `pending` |
| `apps/web/src/domain/mappingReview.ts:34` (`mappingRejection`) | `rejected_by`/`rejected_at`/`rejection_note` 를 그대로 돌려준다 | **닿는다 — 그리고 이것이 §1-d 의 설계를 가른다** |

### 이 기준이 놓치는 것(§6-1 ②)과 적어 둔 블라인드 스팟의 실측(§6-1 ③)

| 놓치는 것 | 왜 밖인가 | 태워 본 결과 |
|---|---|---|
| ⓐ 필드 이름이 좌변에 나오지 않는 대입(`setattr` 등) | 정규식이 좌변의 이름을 본다 | `grep -rn "setattr(" services packages apps/web/src` → **히트 2**, 둘 다 `setattr(job, k, v)`(`services/progress/tasks.py:23`, `services/api/jobs.py:86`)로 `JobRow` 대상이다. **추가 자리 0건** |
| ⓑ evidence dict 의 키를 변수·첨자로 쓰는 자리 | 같은 이유 | `grep -rnE "extra\[[^]]+\] *=[^=]" services packages` → **히트 2**: `document_mapper.py:567`(이미 위 목록 1번 안), `readiness.py:175`(`manual_flag_overridden` — 결정 필드가 아니다). **추가 자리 0건** |
| ⓒ 생성물(`.pyc`·`.mypy_cache`·`dist`) | 제외 디렉터리로 뺐다 | 소스에서 같은 줄이 이미 잡히므로 실해 없음. 그러나 **기준의 한계는 결과가 아니라 기준에서 판단한다**(§6-1) |
| ⓓ 표기 변종 | 필드 이름 여섯 개의 **문자 그대로**만 본다. 값(`"rejected"`)을 리터럴로 쓰는 자리는 §과제 2(계획 0005)가 만든 `tests/invariants/` 감사가 아니라 **이 축 밖**이다 | 태우지 않았다 — §열린 질문 3 |
| ⓔ 화면·config 의 **문구** | 필드에 대입하지 않으므로 이 축 밖이다 | 별도 목록을 §1-i 에서 만든다(그 목록의 기준은 "취소가 없다고 말하는 문장") |

---

## 1-b. 두 축의 모양이 다르다 — 실측이 이 과제의 전제를 반쯤 뒤집는다

PR 본문의 알려진 한계는 "매핑 확정·반려 모두 취소 경로가 없다"였다. 두 축을 **각각** 태우니 그 문장이
`document_mapping` 축에만 맞는다.

| | `document_mapping`(문서 ↔ Activity) | `mapping`(2D ↔ 3D) |
|---|---|---|
| 반려가 매핑 행에 남기는 것 | `reviewed_by`·`needs_review=False`·`extra.mapping_review_decision="rejected"`(+3키) — 실측 `S1-mapping` | **아무것도 없다** — 실측 `N1`: 반려 직후 행이 `('0BcjbttMr12PUpme0A2uXY', needs_review=True, reviewed_by=None, decision=None)` |
| 반려가 영구한가 | **영구** — 실측 `S1b`: 대장 재업로드 뒤 그 Activity 의 open 요청 **0건**, 매핑 행 그대로 | **영구가 아니다** — 실측 `N2`: 재정합(`POST /api/drawings/{id}/alignment`) 한 번에 같은 핸들의 open 요청이 **다시 생긴다**(`N2-open-for-handle` 1건) |
| readiness 를 움직이는가 | 움직인다(§1-c) | 움직이지 않는다 |
| 취소 경로가 필요한가 | **필요하다** | 이미 다음 재정합이 되돌린다 |

**그래서 과제 1 의 범위를 `document_mapping` 축으로 좁힌다.** ADR 0007 §Deferred 의 두 항목이 정확히 그
축이고, 그 항목 자신이 "확정·반려 두 방향을 따로 만들면 또 비대칭이 생긴다"고 적었으므로 둘을 함께 닫는다.

*그 대신 2D↔3D 축에서 다른 결함을 봤다 — 조용히 접어 넣지 않는다.* 실측 `N1-mapping-served`:
반려 직후에도 `GET /api/drawings/{drawing_id}/mappings` 가 그 엔티티(handle `53`)를 그 객체로 계속
돌려준다(`needs_review=True`, `reviewed_by=None`). CM 이 "이 매핑은 틀렸다"고 반려했는데 뷰어는 계속 그
객체를 가리킨다. 이것은 **취소의 부재가 아니라 반려의 무효**이고 다른 결함이므로 §Deferred 2 로 적고
이 사이클에서 고치지 않는다.

---

## 1-c. 되돌리면 무엇이 따라 움직이는가 — 곱 4칸을 실측했다

되돌리기가 건드릴 수 있는 축은 둘이다: ① `reviewed_by`/`needs_review`, ② `extra` 의 반려 표시 4키.
**§6-1 대로 곱으로 만들었다**(2 × 2 = 4칸). 배역은 `A400`(TFA, 처리결과 `APPROVED`) — 반려해도 값이
움직일 수 있도록 일부러 승인된 문서를 쓴다(`tests/integration/test_15_*.py` 와 같은 배역).
각 칸은 `GET /api/activities/A400/readiness` 의 실행값이다. 마지막 열은 `evidence.note` 안의
`drawing_approval:` 조각이고, 이 곱 탐침은 그것을 첫 `;` 에서 잘라 읽었다. **자르지 않은 값도 따로
쟀다**(3·4행과 같은 상태의 `S0`·`S2` 탐침): `evidence.note` 전문은
`inspection: no predecessor objects; material_delivery: no material data; drawing_approval: approved=0/0; pending_mappings=1; open_clashes: no mapped objects`
이다 — 즉 3·4행의 잘린 `approved=0/0` 뒤에 `pending_mappings=1` 이 이어진다.

| # | `reviewed_by`/`needs_review` | 반려 표시 | `drawing_approval` | `score` | blocker `kind` | `evidence.note` 의 `drawing_approval:` 칸 |
|---|---|---|---|---|---|---|
| 1 | `set` / `False` (= 지금의 반려 상태) | present | 0.5 | 0.625 | `None` | `resources.drawing_approved absent` |
| 2 | `set` / `False` | **absent** | **1.0** | **0.7** | `None` | **`approved=1/1`** |
| 3 | `null` / `True` | present | 0.5 | 0.625 | `document_mapping_pending` | `approved=0/0` |
| 4 | `null` / `True` | absent | 0.5 | 0.625 | `document_mapping_pending` | `approved=0/0` |

이 표가 답하는 것 넷:

**(1) "잘못 반려하면 `drawing_approval` 이 0.0 으로 굳는다"는 틀렸다.** 실측: 반려 **전** 0.5(1행이 아니라
반려 전 상태 — `S0`: `document_mapping_pending`, `approved=0/0; pending_mappings=1`) → 반려 **후** 0.5.
**값도 점수도 같다.** 굳는 것은 값이 아니라 **경로**다: 반려 뒤에는 그 문서를 통해 1.0 에 도달할 길이
영구히 닫힌다(`_drop_already_confirmed` 가 `reviewed_by is not None` 인 후보를 버리므로 — 실측 `S1b`).

**(2) 값 축은 이 결함에 대해 눈이 멀었다.** `components["drawing_approval"] == 0.5` 나 `score` 로 세운
시나리오는 **정상 코드와 결함 코드에서 같은 값**이다(§6-2 그 자체). 반려 축에서 갈리는 관측값은
`blockers[].kind`(`document_mapping_pending` ↔ `None`)와 `evidence.note` 둘뿐이다. 값 축을 실제로
움직이려면 **확정** 방향을 써야 한다(0.5 → 1.0, 0.625 → 0.7 — 실측 `C1`).

**(3) 2행이 이 과제의 가장 위험한 칸이다.** 반려 표시만 지우고 `reviewed_by` 를 남기면 그 매핑은
`confirmed_required_documents` 의 **확정 증거**가 되어 `drawing_approval` 이 1.0 이 된다 — **CM 이 한
행위는 반려뿐인데** 미승인·미확정 상태에서 착수 가능이 뜬다. CLAUDE.md §0("확정 완료는 반드시 사람(CM)
승인") 위반이고, ADR 0009 §3 이 스스로 "최악"이라 적은 경로와 같은 모양이다. **취소는 이 칸에 착지해서는
안 된다.**

**(4) 3행과 4행은 readiness 가 구별하지 못한다** — 네 칸이 전부 같다. 즉 "표시를 남길까 지울까"는
readiness 가 답하지 않는다. 가르는 것은 화면이다: `mappingReviewState`(`apps/web/src/domain/mappingReview.ts:28`)
는 `needs_review` 를 먼저 보므로 3행에서 `"pending"`("검토 대기")을 주는데, 같은 파일의
`mappingRejection`(`:34-42`)은 옛 반려자·반려 사유를 계속 돌려준다. 한 화면에서 두 값이 서로를 반박한다
— **그래서 취소는 표시를 지운다(4행).**

---

## 1-d. 취소를 무엇으로 모델링하는가

ADR 0011 이 상태 전이에 세운 모양(**CM 만 · 사유 필수 · 감사 이력에 남는 새 행**)을 그대로 옮길 수
있는가? 앞의 둘은 그대로 옮긴다. 셋째는 **자리가 없다**: `ReviewRequestRow` 는 해소 슬롯이
`status`/`resolved_by`/`resolved_at`/`resolution_note` **한 벌**뿐이고 덮어쓰기다(§1-a 표 3·6·8번).
`StateTransition` 에 해당하는 검토요청 이력 테이블이 없다. 그래서 "새 행"을 세 자리로 나눠 만든다.

### 결정 — 취소는 세 가지를 함께 한다

| 무엇을 | 어디에 | 왜 |
|---|---|---|
| **① 옛 검토요청 행을 손대지 않는다** | `ReviewRequestRow`(그 쌍의 마지막 요청) — `rejected`/`approved` 와 `resolved_by`·`resolution_note` 를 **그대로 둔다** | §1-a 5번(`document_mapper.py:434-436`)이 정확히 반대를 하고 있고, 그것이 감사 흔적을 지운다. 이 저장소가 ADR 0011·0012 두 사이클을 들여 세운 축은 "결정에는 반드시 이유가 남는다"이다 |
| **② 그 자리에서 새 open 요청을 연다** | 새 `ReviewRequestRow(kind="document_mapping", status="open")`. `conflicting_sources` 에 `doc_id`(기존 계약) + `cancelled_review_request_id` + `cancel_note` | 실측 `C3`: 매핑 행만 되돌리고 요청을 열지 않으면 readiness 는 "문서 매핑 1건이 CM 검토 대기"라고 말하는데 **CM 큐는 비어 있다**. 재계산(`POST /api/projects/{id}/documents/mappings`)을 불러야 비로소 열린다(실측 `C4`) — 그 재계산을 기다리는 설계는 이 저장소의 지배적 실패("조용히 죽는 것") 그대로다 |
| **③ 매핑 행을 미확정으로 되돌리고 이력을 append 한다** | `reviewed_by=None`, `needs_review=True`, `extra` 에서 반려 표시 4키 제거, `extra.cancelled_mapping_reviews` 에 `{cancelled_by, cancelled_at, cancel_note, previous_decision, previous_reviewed_by, previous_rejected_at?, previous_rejection_note?}` append | §1-c (3)(4): 4행에 착지해야 하고 표시는 지워야 한다. 지운 값은 사라지면 안 되므로 append-only 이력으로 옮긴다 — readiness 는 3행·4행을 구별하지 못하므로(실측) 이력을 남겨도 점수는 움직이지 않는다 |

추가로 `record_expert_review(session, "document_mapping_decision", f"{activity_id}/{doc_id}",
proposal=<취소 전 매핑>, final=<취소 후 매핑>, reviewer=user_id)` 를 남긴다 — `services/api/usecases.py:408`
이 `drawing_alignment` 에 이미 같은 것을 하는 기존 로그이고, 새 테이블을 만들지 않는다.

### 인터페이스

확정 라우트(`POST /api/documents/mappings/{activity_id}/{doc_id}/confirm`)와 **같은 축**에 둔다 —
취소의 대상은 검토요청 하나가 아니라 그 `(activity_id, doc_id)` 쌍에 **서 있는 CM 의 결정**이고, 한 쌍은
생애 동안 여러 요청 행을 갖는다(복귀·재오픈 — ADR 0007 §4-2 규칙 6 ⑤, `document_mapper.py:433`).

```
POST /api/documents/mappings/{activity_id}/{doc_id}/cancel-review?project_id=<pid>
body: {"note": "<비어 있지 않은 사유>"}
→ 200 ActivityDocumentMapping  (needs_review=true, reviewed_by=null)
```

`project_id` 를 쿼리 필수로 받는 것은 ADR 0008 의 대리키 라우트 관례이고 확정 라우트와 같다.

### 오류

| code | HTTP | 언제 | 화면 문구가 말해야 하는 것 |
|---|---|---|---|
| `cancel_reason_required` | 409 | `note` 가 `None`·`""`·공백만 | "**사유**를 적는다". **"새로고침"이라는 말을 쓰지 않는다** — 새로고침은 아무것도 바꾸지 않는다 |
| `mapping_decision_not_cancellable` | 409 | `reviewed_by is None`(서 있는 CM 결정이 없다) | "취소할 CM 결정이 없다"(= 이미 검토 대기다) |
| `document_mapping_target_not_found` | 404 | 그 프로젝트에 `(activity_id, doc_id)` 매핑 행이 없다 | 기존 code 재사용(`services/api/usecases.py:512-514` 가 이미 쓴다) |
| `forbidden_role` | 403 | cm 이 아니다 | 기존 |

**`rejection_reason_required` 를 재사용하지 않는다.** 그 code 의 지금 화면 문구는 반려에 대해
말하는데(glossary "오류 응답 code 어휘" 표 `rejection_reason_required` 행), 취소는 반려가 아니다 — ADR 0012
규칙 4 가 `revocation_reason_required`·`invalid_transition` 을 기각한 것과 **같은 기준**(그 code 의 지금
화면 문구가 이 자리에서 참인가)을 그대로 적용한 결과다.

---

## 1-e. 되돌리기 자체가 오조작이면? — **무제한으로 둔다**

| | 무제한(채택) | 결정→취소 1회 제한(기각) |
|---|---|---|
| **막는 것** | 아무것도 막지 않는다 | 두 번째 오조작의 정정 |
| **여는 것** | 같은 쌍에 닫힌 요청 행이 누적된다(취소마다 새 요청) | 두 번째 오조작 때의 우회 = **다시 DB 직접 수정** — 이번에 없애려는 바로 그것 |
| **비용** | 없음(기존 컬럼만 쓴다) | `ActivityDocumentMappingRow` 에 카운터 컬럼 신설 = architect 소유 스키마 변경 |

**무제한이 안전한 이유는 실측이 답한다: 취소는 어느 방향에서도 미확정으로만 착지한다**(§1-c 표 3·4행).
반려 취소도, 확정 취소도, 도착점은 `needs_review=True` 하나다. 확정을 만드는 경로가 아니므로 반복해도
CLAUDE.md §0 을 우회할 수 없다. 그리고 반복은 **조용하지 않다** — 매 취소가 사유를 요구하고, 이력에
행을 하나 더 쌓고, CM 큐에 새 요청을 연다.

*역방향 확인 — 무제한이 실제로 미는 것.* 확정↔취소를 반복하면 그 쌍의 `document_mapping` 요청 행이
계속 늘어난다(② 가 매번 새 행을 만들기 때문이다). 그 누적이 운영에서 문제가 되는지는 **실측이 없다** —
제한이 필요해지면 그때 카운터가 아니라 **누적 표시**(큐에서 "이 쌍은 n 번째 재검토"를 CM 에게 보이는 것)로
연다. §Deferred 3.

---

## 1-f. 삼중 검증 원칙(CLAUDE.md §0)과 충돌하지 않는가

**충돌하지 않는다 — 그리고 그 확인은 실행으로 했다.** 세 문장을 각각 태웠다.

| 확인해야 할 문장 | 취소가 그것을 우회하는가 | 근거 |
|---|---|---|
| "확정 완료는 반드시 사람(CM) 승인 액션을 거친다" | 아니다 | 취소의 착지점은 `needs_review=True`(§1-c 3·4행). 확정을 만들려면 그 뒤에 CM 이 확정 액션을 다시 해야 한다 |
| "시스템 매핑 최대 상태 = `needs_review=True`"(ADR 0007 §4-2 규칙 5) | 아니다 | 취소는 그 상태를 **복원**하는 방향이다 |
| "미확정 매핑은 `drawing_approval` 점수에 반영되지 않는다" | 아니다 | 실측 3·4행: 취소 후 `approved=0/0`, blocker `document_mapping_pending` |
| **취소가 우회를 만드는 유일한 모양** | **있다 — §1-c 2행** | 반려 표시만 지우고 `reviewed_by` 를 남기면 `drawing_approval` **1.0**·`approved=1/1`. 구현이 ③ 을 반쪽만 하면 이 칸에 착지한다. 그래서 검증 시나리오 V3 이 이 칸을 명시적으로 태운다 |

---

## 1-g. ADR 0012 §Deferred 3 — 만들어 보려 했고 **못 만들었다**

ADR 0012 §Deferred 3 은 "한 (도면, 핸들)에 열린 `mapping` 요청이 둘 이상인 상황은 실측하지 않았다"로
남아 있었다. 이 사이클에서 **API 로 만들어 보려 했고 실패했다.**

실측(`N2`·`N3` — 같은 도면에 재정합을 두 번 태우고 모든 열린 `mapping` 요청을 핸들별로 셌다):

```
[N2-open-per-handle] {'53': 1}
[N3-realign2] (200, 1)
[N3-open-per-handle] {'53': 1}
[N3-max-open-per-handle] 1
[N3-rows-per-handle-max] [('3A', 1), ('3B', 1), ('3C', 1)]
```

**왜 만들 수 없는가 — 코드 인용으로 답한다.** `kind="mapping"` 검토요청을 만드는 생산 코드는
`services/sync/review_queue.py:27`(`review_request_for`) 하나이고
(`grep -rn 'kind="mapping"' .` 의 비테스트 히트 중 생성은 이 한 줄), 그 유일한 호출자는 같은 파일 `:38`
(`mappings_needing_review`)이며, 그것의 비테스트 호출자는 둘이다 —
`services/sync/persistence.py:163`(`rebuild_mappings`)과 `services/sync/tasks.py:87`(결과에 개수만 싣고
저장하지 않는다). `rebuild_mappings` 는 같은 호출 안에서 그 도면의 **이전 open 요청을 전부 `on_hold`** 로
바꾸고(`:169-173`), `build_mappings`(`services/sync/matcher.py:140-170`)는 엔티티 하나당 `out.append`(`:169`)를
한 번만 한다.

**그러나 스키마는 허용한다.** `EntityObjectMappingRow` 의 PK 는 `(drawing_id, entity_handle, global_id)`
세 칸이다(`packages/core/models/orm.py:141-143`) — 한 핸들에 서로 다른 `global_id` 행이 여럿 저장될 수
있고, `confirm_mapping_row`(`services/sync/review_queue.py:98-99`)는 그 조회의 `.first()` 를 쓴다.
**막고 있는 것은 스키마가 아니라 파이프라인이다.** 이 사실을 ADR 0012 §Deferred 3 에 append 하고
(재현 시도와 그 결과), 잔여 위험(`.first()`)을 §Deferred 4 로 옮긴다.

*이 결과가 과제 1 의 설계를 바꾸는가 — 아니다.* 취소는 `document_mapping` 축이고 그 축의 요청 조회는
`open_document_mapping_review`(`status="open"` 고정, 쌍 단위)라 다중 종료 문제와 다른 자리다.

---

## 1-h. 한정어 역방향 확인 표 (§6-3 산출물 — 각 칸은 실행값 또는 코드 인용)

| 한정어 | 빼면 무엇이 더 들어오는가 | 이 단어 때문에 무엇이 빠지는가 | 근거 |
|---|---|---|---|
| **`document_mapping` 축만** | 2D↔3D 매핑 반려의 취소까지 | 그 축 전체 | 실행값 `N1`: 2D↔3D 반려는 매핑 행에 아무것도 쓰지 않는다(`needs_review=True, reviewed_by=None, decision=None`). 실행값 `N2`: 재정합 한 번에 같은 핸들의 open 요청이 다시 생긴다. **되돌릴 것이 없다** — 그 축의 결함은 다른 것이고 §Deferred 2 |
| **취소는 미확정으로만 착지한다** | "직전 결정의 반대로 착지"(반려 취소 → 확정) | 확정으로 바로 가는 지름길 | 실행값 §1-c 2행: `reviewed_by` 를 남긴 채 표시만 지우면 `drawing_approval` **1.0**·`approved=1/1`. CM 의 유일한 행위가 반려였는데 착수 가능이 뜬다 |
| **사유 필수(`note` 가 비어 있지 않다)** | 없음 | 사유 없는 취소 | 코드 인용: 같은 판단이 ADR 0011 불변식 3·ADR 0012 불변식 4 에 이미 있다. 술어는 `packages/core/models/review.py::rejection_reason_missing` 를 그대로 쓴다(이름이 반려를 말하지만 판정은 "비어 있지 않은 문자열"이라 축이 같다 — 개명하면 그 함수를 쓰는 두 자리가 함께 움직여야 하므로 이 사이클에서 하지 않는다, §열린 질문 2) |
| **`reviewed_by is None` 이면 409** | 미확정 매핑에 취소를 걸면 **200 을 주면서 아무 일도 하지 않는다** | 무동작 200 | 코드 인용: 이 저장소가 그 모양을 네 번 겪었다 — `services/api/usecases.py:303-304` 의 docstring 이 그중 하나를 적는다("응답은 성공인데 아무 효과가 없다") |
| **옛 요청 행을 손대지 않는다** | 옛 행을 다시 `open` 으로 되돌려 재사용하는 설계 | 그 설계 | 코드 인용: `services/progress/document_mapper.py:433-436` 이 정확히 그것을 하는데 `review.resolved_by = None`·`resolved_at = None`·`resolution_note = None` 으로 **누가 왜 닫았는지를 지운다**. ADR 0011·0012 가 두 사이클 들여 세운 축의 정반대다 |
| **취소가 그 자리에서 새 요청을 연다**(재계산을 기다리지 않는다) | 없음 | 재계산까지의 공백 | 실행값 `C3`: 매핑 행만 되돌린 뒤 readiness 는 `document_mapping_pending`("문서 매핑 1건이 CM 검토 대기")인데 큐의 그 Activity 요청은 `['approved']` 하나뿐 — **열린 것이 없다.** `C4`(재계산 호출) 후에야 `['open','approved']` |
| **반려 표시를 지운다(남기지 않는다)** | 이력을 `extra` 의 같은 키에 남기는 설계 | 옛 반려자·사유가 활성 값으로 보이는 것 | 실행값 §1-c 3행 vs 4행: **readiness 는 두 칸이 완전히 같다**(0.5 / 0.625 / `document_mapping_pending` / `approved=0/0`). 가르는 것은 화면이다 — 코드 인용 `apps/web/src/domain/mappingReview.ts:28`(`needs_review` → `"pending"`) 과 `:34-42`(`rejected_by`/`rejected_at`/`rejection_note` 를 계속 돌려준다)이 3행에서 서로를 반박한다 |
| **무제한**(1회 제한이 아니라) | 두 번째 오조작의 정정 | 없음 | §1-e. 실행값 근거는 같은 §1-c 3·4행(어느 방향에서도 미확정 착지) |
| **(옛 조건이 잡던 것)** ADR 0007 §4-2 규칙 6 ⑥의 "반려는 영구" | — | — | 그 조건이 실제로 잡던 것은 "CM 이 매주 같은 후보를 다시 반려하지 않는다"이고, **취소가 생겨도 그대로다**: `_drop_already_confirmed` 를 바꾸지 않고, 취소는 CM 이 명시적으로 부를 때만 돈다. 실행값 `S1b`: 반려 뒤 대장 재업로드에서 그 Activity 의 open 요청 **0건**(이 계획 이후에도 같아야 한다 — 시나리오 V8) |

*같은 문서·인접 절과의 교차 확인(§6-3).* §1-b 는 "2D↔3D 반려는 영구가 아니다"라고 적고 §1-h 첫 행은
"되돌릴 것이 없다"고 적는다. 두 문장은 같은 실측(`N1`·`N2`)의 두 면이고 서로를 반박하지 않는다.
§1-c 는 "반려해도 값이 0.5 그대로"라고 적고 §목표 1 은 "현장 위험"이라고 적는다 — 위험한 것은 값이
아니라 **1.0 에 도달할 경로가 영구히 닫히는 것**이며, §1-c (1)이 그 구분을 명시한다.

---

## 1-i. §6-4 — 이 사이클이 함께 고치는 문구, 그리고 그것을 **계약으로 고정한 테스트**

**생성 기준.** 저장소 루트에서 "취소·되돌리기가 없다"고 말하는 문장을 찾았다:

```
$ cd /home/user/Bim && grep -rn "취소\|되돌리" --include=*.tsx --include=*.ts --include=*.py \
    --include=*.yaml --include=*.md . --exclude-dir=.venv --exclude-dir=node_modules \
    --exclude-dir=.git --exclude-dir=dist | grep -iE "확정|반려|매핑|unreject|unconfirm"
```

그 출력에서 **이 변경이 거짓으로 만드는 것**만 남긴 것이 아래다. 각 줄을 열어 참·거짓을 개별 판정했다 —
"취소"라는 낱말이 들어갔다고 전부 낡는 것이 아니다.

| 자리 | 지금 문장 | 이 변경 뒤 | 소유 | 배정 |
|---|---|---|---|---|
| `apps/web/src/pages/ReviewsPage.tsx:55` | "…**확정을 취소하는 기능은 없습니다.** Activity 정보가 바뀌면…" | **거짓** | frontend | 작업 5 |
| `apps/web/src/pages/ReviewsPage.tsx:51·56` (주석) | "되돌리는 API 가 없다" / "되돌리는 경로가 없으므로" | **거짓** | frontend | 작업 5 |
| `apps/web/src/pages/ReviewsPage.test.tsx:162·166` | `expect(text).toMatch(/확정을 취소하는 기능은 없습니다/)` — **거짓 문구를 계약으로 고정한 자리** | **거짓** | qa | 작업 8 |
| `services/progress/document_mapper.py:541` | "**반려는 (activity_id, doc_id) 쌍에 대해 영구하다**" | **거짓**(CM 의 명시적 취소로 풀린다 — 재계산은 여전히 안 푼다) | progress-engine | 작업 3 |
| `services/api/usecases.py:305-306` | "확정 시 반려 표시를 지우는 쪽(반려 취소)은 별개의 기능이고 … ADR Deferred 에 남겼다" | **낡는다**(그 Deferred 가 닫힌다) | api | 작업 4 |
| `tests/integration/test_15_*.py:315` | "반려 취소는 별개 기능이다" | **낡는다** | qa | 작업 8 |
| `docs/adr/0007-*.md` §Deferred 두 항목 | "매핑 확정 취소(unconfirm)" · "매핑 반려 취소(unreject)" | **닫힌다** — 같은 파일의 `_drop_already_confirmed` 항목이 이미 쓰는 `~~취소선~~ → ADR 00NN 으로 해소됨` 형식을 그대로 쓴다 | architect | 작업 1 |
| `docs/glossary.md:361` (`매핑 반려`) | "…남는 **영구 표시**" | **거짓** | architect | 작업 1 |
| `apps/web/src/pages/DocumentDetailPage.tsx:255` | "확정 이후에는 **시스템이** 이 매핑을 되돌리지 않습니다" | **참으로 남는다** — 취소는 시스템이 아니라 사람이 한다. 그러나 취소 버튼이 이 화면에 붙으므로 그 사실을 **더한다**(지우지 않는다) | frontend | 작업 5 |
| `config/document_register.yaml:260` (`DOCUMENT_IDENTITY_DRIFT` 문구) | "되돌리려면 바꾼 쪽을 원래대로 두고 대장을 다시 올린다" | **참으로 남는다** — config 되돌리기를 말하는 것이지 매핑 결정 취소가 아니다 | — | 없음 |

*문구 테스트(§6-4 3).* 새 문구를 통째로 베끼지 않는다. 단언은 "그 상황에서 참일 수 없는 말이 없다"이다:
`ReviewsPage` 의 `document_mapping` 승인 안내에 **"확정을 취소하는 기능은 없습니다"가 없다**,
`ErrorBox` 의 `cancel_reason_required` 안내에 **"새로고침"이 없고 "사유"가 있다**.

---

# 과제 2 — `from_state` 축을 **보호한다**

## 2-a. 실측 — 그 조건이 지키는 것, 그리고 무보호라는 사실

대상은 `services/progress/state_machine.py:145`:

```python
    if transition.actor != Actor.CM or transition.from_state != ObjectState.INSPECTION_REQUESTED:
        return []
```

**(가) 그 조건이 지키는 상태를 운영 진입점만으로 만들었다**(실측, HEAD `99d3721`):

```
[F1-REPORTED]               201   (contractor, PLANNED → REPORTED)
[F1-INSPECTION_REQUESTED]   201   (contractor, REPORTED → INSPECTION_REQUESTED)
[F3-open-inspection]        ['1a8f4718']            ← 미결 inspection 1건
[F4-scan]                   ('INSPECTION_REQUESTED', 'MISMATCH', 'system')
                                   (ObjectStateMachine.apply_scan_verdict, ScanState.MISMATCH)
[F5]                        current_state = MISMATCH, has_open_review = True
[F5-open-inspection]        ['1a8f4718']            ← 여전히 열려 있다
[F6-accept_rework(no note)] 201   (cm, MISMATCH → IN_PROGRESS, note 미전송)
[F6-inspection-rows]        [('1a8f4718', 'open', '')]
```

`close_inspection_reviews` 가 `actor != CM` 에서 되돌아가므로(system 스캔 판정) **미결 inspection 이 열린
채 MISMATCH** 가 된다. 그 상태에서 note 없는 `accept_rework` 는 **201** 이고 요청은 그대로 열려 있다.

**(나) 조건만 지운 트리**(위 두 줄을 `if transition.actor != Actor.CM: return []` 로 바꾼 것 — 그 외 무변경):

```
[F6-accept_rework(no note)] 409 {"detail":"rejecting review request 1a8f4718-… (kind=inspection) requires
                                 a non-empty reason","code":"rejection_reason_required", …}
```

**변이가 무동작이 아니다** — 같은 시나리오에서 201 → 409 로 갈린다.

**(다) 그런데 전량은 통과한다**(같은 절제 트리):

```
$ .venv/bin/pytest -q
783 passed, 1 warning in 64.05s (0:01:04)
```

기준선과 **같은 783**. 실패 0. 원복 후 저장소 루트 `git status --porcelain` 전문이 빈 출력임을 확인했다.

## 2-b. 판단 — 보호한다

**근거는 셋이고 전부 실행값이다.**

1. **그 조건은 실재하는 경로를 가른다**(2-a 나). "지금은 안 깨진다"가 아니다 — 조건을 지우면 CM 의
   평범한 `accept_rework` 가 **409 `rejection_reason_required`** 로 막힌다.
2. **그 409 는 거짓말이다**(§6-4). 그 전이는 아무 요청도 반려하지 않는다 — 실측 F6 에서 요청은 `open`
   그대로이고 `closed=[]` 다. "반려하려면 사유를 입력해야 합니다"라는 안내를 받는 CM 은 자기가 반려하고
   있지 않은 요청의 사유를 적어야 한다. 부정확한 문구는 "나중에 다듬을 표현"이 아니라 **작동하지 않는
   안전 장치**다.
3. **그런데 어떤 테스트도 그 축을 지키지 않는다**(2-a 다). 조건을 지운 트리가 783 전원 통과다. 그 조건이
   실수로 사라지는 날 CI 는 초록이고 CM 만 막힌다 — 이 저장소의 지배적 실패 모드다.

`from_state` 축은 진입점을 만들 수 있고(2-a 가 — contractor 두 전이 + system 스캔 판정, 전부 운영 경로),
결함의 결과가 CM 을 막는 것이며, 무보호다. 세 조건이 다 맞으면 보호한다.

## 2-c. qa 에게 넘길 시나리오의 모양 (§6-2 — 테스트는 architect 가 쓰지 않는다)

두 개를 **쌍으로** 넘긴다. 하나만 붙이면 §6-2 에 걸린다.

- **V11(양성, 이 축).** 2-a (가)의 상태를 만들고 note 없는 `accept_rework` → **201**, **그리고 그
  inspection 요청이 여전히 `open`** 이며 `resolution_note` 가 비어 있다.
  *§6-2 물음 — 이 기대값을 결함 있는 코드가 그대로 만족하는가?* `from_state` 조건을 지운 코드는 409 라
  **만족하지 못한다**(2-a 나 실측). 다만 **201 하나만 단언하면** `close_inspection_reviews` 를 통째로
  지운 코드도 만족한다 — 그래서 "요청이 열린 채로 남아 있다"를 **함께** 단언한다(§6-2 4).
- **V12(음성 대조군, 같은 축).** 같은 객체를 `INSPECTION_REQUESTED` 에 두고 note 없는
  `reject_inspection`(`INSPECTION_REQUESTED → IN_PROGRESS`, cm) → **409 `rejection_reason_required`**,
  객체 상태·요청 상태 불변. 이것이 없으면 V11 은 "가드를 통째로 지운 코드"에서도 초록이다.

## 2-d. 이 사이클이 고치지 않는 것 — 그리고 그것을 적어 두는 이유

2-a 실측이 **다른 것**도 보여준다: `accept_rework` 뒤에도 그 inspection 요청은 **영원히 `open`** 이다
(`[('1a8f4718', 'open', '')]`). 객체는 검측 루프를 떠났는데 요청은 남는다 — ADR 0007 §4-2 규칙 6 ④가
`on_hold` 를 도입하며 피하려던 것("만들어지지만 절대 닫히지 않는 요청이 쌓인다")과 같은 모양이다.

**이 사이클에서 고치지 않는다.** 고치려면 "객체가 검측 루프를 떠난 요청을 무엇으로 닫는가"를 정해야
하는데, 그 답은 ADR 0001 §6 의 시스템 `on_hold` 사유 집합을 **셋째로 넓히는 일**이고(대체됨 / 판단 대상
소실 / **판단 대상이 루프를 떠남**), 그 결정은 ADR 0007 §4-2 규칙 6 ④가 근거를 길게 적은 자리와 같은
무게를 갖는다. §Deferred 1 에 실측과 함께 적는다.

---

# 과제 3 — CLAUDE.md §2 의 서수 참조 (완료, 이 사이클에서 수행)

`f884953` 이 §2 에 `` `.claude/agents/reviewer.md` 체크 3 **둘째 줄** `` 이라는 **서수 줄 참조**를 넣었다.
가리키는 대상은 실재하고 문장도 참이다 — 실측:

```
$ grep -n "명시적 허가" .claude/agents/reviewer.md
50:- 담당 밖 파일이 있는데 `architect` 계획 문서나 커밋 메시지에 명시적 허가가 없으면 FAIL.
```

체크 (3) 의 불릿 셋 중 둘째가 맞다. 문제는 **자리의 종류**다: `.claude/agents/*.md` 는 CLAUDE.md §3-13
둘째 갈래가 지목한 "**계속 편집되는 자리**"라 못박을 트리가 없고, 불릿 하나가 앞에 끼면 서수가 조용히
낡는다. §3-13 을 세운 커밋(`f884953`)이 같은 커밋에서 그 규칙에 걸렸다 — §6-3 이 이미 적은
"규칙과 그 위반은 같은 커밋에서 함께 태어날 수 있다"의 또 한 사례다(**근거만 더하고 규칙은 더하지
않는다** — §6-5).

**고친 것:** 서수를 빼고 그 불릿의 문구로 부른다 — `` 체크 3 의 "`architect` 계획 문서나 커밋 메시지에
명시적 허가" 불릿 ``. 위 grep 이 그 자리에서 도는 재현 명령이다.

*새로 쓴 문장에도 같은 확인을 했고, 한 번 틀렸다(§6-3 — "그 자리를 메우려고 새로 쓰는 문장").*
초고는 그 자리에 **"실측: 파일 지정 시 1, 저장소 전체 검색 시 2"** 라고 적었다. 태워 보니 저장소 전체는
2 가 아니었고 — 이 계획 문서가 같은 문구를 여러 줄에서 인용하고 CLAUDE.md 자신도 그 문구를 두 번 쓴다 —
**그 수는 이 문단을 쓰는 동안에도 움직였다**(고친 문장을 적자마자 다시 늘었다). 서수를 빼려고 쓴 문장이
**같은 종류의 낡는 값**(개수)을 갖고 태어난 것이다. 이 저장소가 아는 모양이다: §6-3 이 "그 자리를 메우려고
새로 쓰는 문장에는 같은 확인을 하지 않았다"를 3회차로 적어 두었고, 이번 사이클의 major-A 도 같은 것이었다.

고친 결과 두 문서 어디에도 그 개수를 적지 않는다. 남는 것은 **한 자리에서만 참인 재현 명령**과
그 참조가 실제로 기대는 **부재**뿐이다:

```
$ grep -c "명시적 허가" .claude/agents/reviewer.md          → 1
```

기대: 그 파일 안에 그 문구를 쓰는 다른 불릿이 **없다**(§6-1 — 개수를 세지 않고 부재를 적는다).
저장소 전체 검색의 히트 수는 이 참조가 기대는 값이 **아니다** — 이 규칙을 인용하는 문서가 늘 때마다
움직이기 때문이고, 그래서 그 수를 적으면 다음 인용이 그 문장을 거짓으로 만든다.

*역방향 확인 — 문구 참조가 서수 참조보다 무엇을 잃는가.* 문구가 **바뀌면** 서수보다 먼저 낡는다
(줄이 밀리는 것보다 문구가 바뀌는 것이 드물다는 보장은 없다). 잃지 않는 것은 **낡았을 때의 관측
가능성**이다 — 서수는 다른 불릿을 가리키며 조용히 참인 척하지만, 문구는 grep 히트 0 으로 죽는다.
§3-13 이 "심볼 이름이나 그 자리에서 도는 grep 으로 적는다"고 말한 것이 이 성질이다.

---

## 영향 범위

**데이터 모델(`packages/core/models/`).** 스키마 변경 **없음**. 취소는 기존 컬럼(`reviewed_by`,
`needs_review`)과 기존 JSON 필드(`evidence.extra`)만 쓴다. 새 예외 타입 둘
(`MappingDecisionCancelReasonRequiredError`, `MappingDecisionNotCancellableError`)이 늘어나는데, 이 둘을
`packages/core/models/review.py` 에 둘지 `services/api/errors.py` 계열에 둘지는 §열린 질문 1.

**서비스.** `services/progress/document_mapper.py`(취소 본체 — CLAUDE.md §3 규칙 11: 매핑 생명주기·
검토요청 해소는 progress 소유), `services/api/`(라우트·인가·오류 핸들러·`docs/api.md`).
`services/sync/` **무변경**(§1-b: 그 축은 이 과제 밖).

**화면.** `apps/web/src/pages/DocumentDetailPage.tsx`(취소 버튼 — 매핑 배지가 이미 있는 자리),
`apps/web/src/pages/ReviewsPage.tsx`(문구), `apps/web/src/components/ErrorBox.tsx`(새 code 둘의 안내),
`apps/web/src/api/client.ts`(`KnownApiErrorCode`), `hooks.ts`(mutation + 캐시 무효화 — 취소는 매핑 목록
**과** 검토요청 목록 둘 다를 바꾼다).

**문서.** ADR 0013(신규), ADR 0007 §Deferred 두 항목 해소 표시, ADR 0012 §Deferred 3 에 실측 append,
`docs/glossary.md`(용어 + code 표 두 행), `docs/api.md`(재생성).

---

## 작업 분배

**축(§6-3 8·9회차를 알고 고른다).** 계획 0004 는 "ADR 규칙 하나당 한 행"으로 만들어 오류 표현 계층을
무주공산으로 남겼다. 계획 0005 는 "한 소유가 한 커밋으로 끝낼 수 있는 단위"로 바꿨고, 그 축에서
**"내 작업이 남의 파일을 낡게 만드는 자리"** 가 무주공산이 됐다(마감 B-3). 이번 축은 같은 단위를 쓰되
**그 칸을 표에 넣는다 — 그리고 §6-1 대로 두 방향을 각각 칸으로 둔다**(내가 남을 낡게 하는 것 / 남이
나를 낡게 하는 것).

*역방향 확인 — 이 축이 여전히 놓치는 것.* 이 표는 **파일**을 낡게 만드는 것을 본다. 파일이 아니라
**저장된 데이터**를 낡게 만드는 것(이미 반려된 채 저장된 매핑 행에 취소 이력 키가 없다는 사실)은 이
축 밖이다 — §열린 질문 4 에 따로 적는다. 축을 바꿔도 무주공산은 없어지지 않고 자리를 옮긴다.

| # | 에이전트 | 담당 파일 | 입력 | 출력 | 완료 조건 | 이 작업이 낡게 만드는 남의 자리 → 배정 | 이 작업을 낡게 만들 수 있는 작업 |
|---|---|---|---|---|---|---|---|
| 1 | architect | `docs/adr/0013-*.md`(신규) · `docs/adr/0007-*.md` §Deferred · `docs/adr/0012-*.md` §Deferred 3 · `docs/glossary.md` | 이 계획 §1-a~§1-h | ADR 0013(취소의 불변식·모양·오류 code) + ADR 0007 두 Deferred 해소 표시 + ADR 0012 §Deferred 3 에 §1-g 실측 append + glossary 용어·code 두 행 | ADR 0013 이 §1-c 곱 표와 §1-h 표를 자기 산출물로 갖는다. glossary `매핑 반려` 행의 "영구 표시"가 고쳐졌다 | 없음(문서만) | 작업 3·4 가 구현에서 벗어나면 ADR 이 낡는다 → 작업 10 이 대조 |
| 2 | **architect(이 사이클, 이 커밋)** | `CLAUDE.md` | 과제 3 | 서수 참조 → 문구 참조 | `grep -n "둘째 줄" CLAUDE.md` 히트 0 | 없음 | 없음 |
| 3 | progress-engine | `services/progress/document_mapper.py` | ADR 0013 | `cancel_document_mapping_review(session, project_id, activity_id, doc_id, cancelled_by, note)` — §1-d ①②③ 을 한 트랜잭션에 | 반려·확정 어느 쪽에서 불러도 착지가 §1-c **4행**이다. 옛 요청 행의 `status`/`resolved_by`/`resolution_note` 가 그대로다. 새 open 요청이 그 자리에서 생긴다 | `document_mapper.py:541` 의 "반려는 영구하다" **자기 파일** / `services/api/usecases.py:305-306` → 작업 4 / `tests/integration/test_15_*.py:315` → 작업 8 | 작업 4 가 호출 규약을 바꾸면 |
| 4 | api | `services/api/usecases.py` · `routers/documents.py` · `errors.py` · `docs/api.md` | 작업 3 의 시그니처 | 라우트 + 인가(cm) + 두 오류 code 의 전용 핸들러 + `docs/api.md` 재생성 | `POST …/cancel-review` 가 200/409×2/404/403 을 §1-d 표대로 준다. `usecases.py:305-306` docstring 정정 | `apps/web/src/api/client.ts` 의 `KnownApiErrorCode` → 작업 5 / glossary code 표 → 작업 1 | 작업 1 이 code 이름을 바꾸면 |
| 5 | frontend | `apps/web/src/pages/DocumentDetailPage.tsx` · `ReviewsPage.tsx` · `components/ErrorBox.tsx` · `api/client.ts` · `api/hooks.ts` | 작업 4 의 계약 | 취소 버튼(사유 필수 다이얼로그) + 두 code 안내 + 캐시 무효화 | 취소 후 매핑 목록·검토요청 목록이 **둘 다** 갱신된다. `ReviewsPage.tsx:55` 의 "확정을 취소하는 기능은 없습니다"가 사라졌다. `ErrorBox` 안내에 "새로고침"이 없다 | `apps/web/src/pages/ReviewsPage.test.tsx:166`(계약 고정) → 작업 8 | 작업 4 |
| 6 | qa | `tests/integration/`(신규 `test_20_*`) · `tests/unit/progress/` | 이 계획 §검증 시나리오 V1~V10 | 과제 1 회귀 | V1~V10 전원 통과. **각 시나리오가 §6-2 물음에 답을 갖는다** | 없음 | 작업 3·4·5 |
| 7 | qa | `tests/integration/` · `tests/unit/progress/test_state_machine.py` | §2-c V11·V12 | 과제 2 회귀 | `from_state` 조건만 지운 트리에서 **V11 이 실패한다**(구현자가 절제로 확인하고 보고한다) | 없음 | 없음 |
| 8 | qa | `apps/web/src/pages/ReviewsPage.test.tsx` · `tests/integration/test_15_*.py` | 작업 3·5 | 낡은 계약 문자열 교체 + 주석 정정 | `/확정을 취소하는 기능은 없습니다/` 를 고정하는 단언이 없다. 대신 "그 상황에서 참일 수 없는 말"을 단언한다 | 없음 | 작업 5 가 문구를 다시 바꾸면 |
| 9 | frontend | `apps/web/src/pages/DocumentDetailPage.test.tsx` 등 웹 테스트 | 작업 5 | 취소 UI 회귀 | 취소 버튼이 `mappingReviewState !== "pending"` 일 때만 보인다 | 없음 | 작업 5 |
| 10 | architect | `docs/plans/0006-*.md` §사이클 마감 | 전부 | 마감(각 작업의 실제 결과 / 계획이 틀린 자리 / 심어 보고 잰 값 / §6 을 얼마나 늘렸는가) | 작업 트리에서 전량을 다시 재고, 계획과 다른 자리를 전부 적는다 | — | — |

**커밋 규칙(CLAUDE.md §2).** `packages/core/models/` 를 건드리는 변경이 생기면(§열린 질문 1의 결론에
따라) 그것만 **architect 단독 커밋**으로 뗀다. 작업 3·4 처럼 두 소유가 한 사이클에 걸리는 자리는
소유별로 커밋을 나누고, 나눌 수 없으면 그 이유를 커밋 본문에 적는다.

---

## 인터페이스 정의

```python
# services/progress/document_mapper.py  (progress-engine)
def cancel_document_mapping_review(
    session: Session, project_id: str, activity_id: str, doc_id: str,
    cancelled_by: str, note: str,
) -> tuple[ActivityDocumentMapping, str]:
    """CM 이 이 쌍에 서 있는 결정(확정 또는 반려)을 취소한다. (매핑, 새 검토요청 id) 를 돌려준다.

    ① 옛 ReviewRequestRow 는 손대지 않는다(status/resolved_by/resolution_note 그대로).
    ② 새 ReviewRequest(kind="document_mapping", status="open") 를 그 자리에서 연다.
       conflicting_sources: {"doc_id": …, "cancelled_review_request_id": …, "cancel_note": note}
    ③ 매핑 행: reviewed_by=None, needs_review=True, evidence.extra 에서 반려 표시 4키 제거,
       extra["cancelled_mapping_reviews"] 에 append.

    row.reviewed_by is None 이면 MappingDecisionNotCancellableError.
    매핑 행이 없으면 LookupError(호출자 사전조건 — api 가 존재를 이미 확인한다).
    """
```

```python
# services/api/usecases.py  (api)
def cancel_document_mapping_review(session, project_id, activity_id, doc_id, note, user) -> ActivityDocumentMapping:
    #  1) project_role(session, project_id, user, CONFIRM_ROLE)      ← cm 만
    #  2) 매핑 행 존재 확인 → 없으면 404 document_mapping_target_not_found
    #  3) rejection_reason_missing(note) → 409 cancel_reason_required
    #     (순서가 계약이다: 대상 부재가 사유 부재보다 **먼저**다 — ADR 0012 규칙 1 이 낡은 요청을
    #      사유보다 먼저 둔 것과 같은 판단. CM 이 할 일이 다르다: 화면 갱신 ↔ 사유 작성)
    #  4) progress 의 본체 호출 → 5) record_expert_review → 6) commit
```

```ts
// apps/web/src/api/hooks.ts  (frontend)
useCancelDocumentMappingReview(projectId: string):
  mutate({ activityId, docId, note }) → ActivityDocumentMapping
  // onSuccess: 문서 상세 · 매핑 목록 · 검토요청 목록(kind=document_mapping) 전부 무효화
```

---

## 검증 시나리오 (§6-2 — 각 항목에 "결함 있는 코드가 이 기대값을 그대로 만족하는가?"를 답했다)

배역은 `tests/integration/test_15_*.py` 와 같다: `A400`(TFA, `APPROVED`) — 값 축이 움직일 수 있는 배역.

| # | 시나리오 | 단언 | 이 기대값을 만족하는 결함 코드가 있는가 |
|---|---|---|---|
| V1 | **확정 → 취소**(값 축이 움직이는 방향) | `drawing_approval` **1.0 → 0.5**, `evidence.note` `approved=1/1` → `approved=0/0; pending_mappings=1`, blocker kind `None` → `document_mapping_pending`, 매핑 `needs_review` False→True·`reviewed_by` 값→`null` | 없다. 매핑 행을 건드리지 않고 요청만 여는 구현은 1.0 을 그대로 둔다(실측 §1-c 2행이 그 코드의 출력이다) |
| V2 | **반려 → 취소**(값 축이 **안** 움직이는 방향) | 값·점수로 단언하지 **않는다**(실측: 0.5→0.5, 0.625→0.625). blocker kind `None` → `document_mapping_pending`, note `resources.drawing_approved absent` → `approved=0/0; pending_mappings=1` | 값으로 단언하면 **있다** — 그래서 값으로 단언하지 않는다. 이 행이 §6-2 의 사례 자체다 |
| V3 | **반쪽 취소 금지**(§0 회귀) | 취소 직후 `reviewed_by is None` **그리고** `drawing_approval != 1.0` **그리고** `confirmed_required_documents` 에 그 doc 이 없다 — 셋을 함께 | 없다. 표시만 지우고 `reviewed_by` 를 남긴 구현은 `1.0`·`approved=1/1` 이라 죽는다(실측 §1-c 2행) |
| V4 | **큐가 그 자리에서 열린다 + 감사가 보존된다** | 재계산을 **부르지 않고** 그 쌍의 open 요청 1건 **그리고** 옛 요청은 여전히 `rejected`(또는 `approved`)이고 `resolved_by`·`resolution_note` 가 살아 있다 | 없다. 앞 절반만 하면 옛 행을 되열어 `resolved_by=None` 으로 지우는 구현(`document_mapper.py:433-436` 모양)이 통과한다 — 그래서 둘을 함께 단언한다(§6-2 4) |
| V5 | **사유 요건** | note 미전송 → 409 `cancel_reason_required`; `note="   "` → 같은 409. **그리고** 매핑 행·요청 상태가 **아무것도 바뀌지 않았다** | 없다. 부분 적용 후 예외를 던지는 구현이 뒷 단언에서 죽는다 |
| V6 | **인가** | contractor 취소 시도 → 403, 부작용 0 | 없다 |
| V7 | **취소할 결정이 없다** | `needs_review=True` 인 매핑에 취소 → 409 `mapping_decision_not_cancellable` | 없다. 무동작 200 을 주는 구현이 죽는다 |
| V8 | **재계산이 취소를 되돌리지 않는다**(옛 조건이 잡던 것 — §1-h 마지막 행) | 취소 뒤 대장 재업로드 → 그 쌍의 open 요청이 **1건 그대로**(중복 생성 없음), 매핑 행 그대로 | 없다. 취소가 `_drop_already_confirmed` 를 함께 건드리면 요청이 둘이 되거나 매핑이 새로 만들어져 죽는다 |
| V9 | **무제한 취소** | 확정 → 취소 → 확정 → 취소. 둘째 취소도 200, `extra.cancelled_mapping_reviews` 길이 2, 옛 요청 행 둘이 각자 그 시점 status 를 유지 | 없다. 1회 제한 구현이 둘째에서 409 로 죽는다 |
| V10 | **문구**(§6-4 3 — 문장을 베끼지 않는다) | `ReviewsPage` 의 `document_mapping` 승인 안내에 "확정을 취소하는 기능은 없습니다"가 **없다**. `ErrorBox` 의 `cancel_reason_required` 안내에 "새로고침"이 **없고** "사유"가 **있다** | 없다. 옛 문구를 남긴 구현이 죽는다 |
| V11 | **과제 2 양성** | §2-a (가) 상태에서 note 없는 `accept_rework` → **201** **그리고** 그 inspection 요청이 여전히 `open` | 없다. `from_state` 조건을 지운 코드는 409(실측). **201 만 단언하면** `close_inspection_reviews` 를 통째로 지운 코드가 통과하므로 둘을 함께 단언한다 |
| V12 | **과제 2 음성 대조군(같은 축)** | `INSPECTION_REQUESTED` 에서 note 없는 `reject_inspection` → **409 `rejection_reason_required`**, 객체·요청 상태 불변 | 없다. 이것이 없으면 V11 은 가드를 통째로 지운 코드에서도 초록이다 |

**음성 대조군을 한 축에만 몰지 않았다(§6-2 3).** 과제 1 의 판정 경로는 둘(확정 취소 / 반려 취소)이고
V1·V2 가 각 축의 양성이며, V3·V7 이 각각 "너무 많이 되돌림"·"되돌릴 것이 없음"의 음성이다.
과제 2 는 V11(양성)·V12(음성)이 같은 축의 양쪽이다.

---

## 열린 질문 / 리스크

1. **새 예외 둘을 어디에 두는가.** ADR 0012 는 술어·예외를 `packages/core/models/review.py` 에 두었는데
   근거가 "`rejected` 를 쓰는 세 자리의 소유가 전부 다르다"였다. 취소는 지금 **progress 하나**가 던지고
   api 하나가 받는다 — 그 근거가 그대로 서지 않는다. `services/progress/` 안에 두면
   `packages/core/models/` 를 건드리지 않아 커밋 분리 부담도 없다. **작업 1(ADR 0013)이 정한다.**
   판단 기준은 "이 예외를 던지는 자리가 앞으로 둘 이상의 소유로 늘어날 근거가 지금 있는가"이고, 지금은
   없다.
2. **`rejection_reason_missing` 이름을 그대로 쓰는가.** 판정은 "비어 있지 않은 문자열"이라 축이 같지만
   이름은 반려를 말한다. 개명하면 그것을 쓰는 두 자리(`usecases.py:445`, `state_machine.py:155`)와
   ADR 0012 본문이 함께 움직여야 한다. 이 사이클에서는 **그대로 쓰고** 이름의 좁음을 ADR 0013 에
   적는다 — 개명은 그 함수를 쓰는 자리가 셋째로 늘어난 뒤가 자연스럽다.
3. **`"rejected"` 라는 **값** 리터럴의 전수는 이 계획이 세지 않았다.** §1-a 의 축은 **필드 이름**이다.
   값 축은 계획 0005 §과제 2 가 `cause` 에 대해 만든 감사와 같은 모양이 필요한데, 그 감사를 이 값으로
   확장할지는 이 사이클 범위 밖이다(§후속 2).
4. **저장된 과거 기록.** 이미 반려·확정된 매핑 행에는 `extra.cancelled_mapping_reviews` 키가 없다.
   취소 구현은 **키가 없는 것을 빈 목록으로** 읽어야 하고(마이그레이션 없음), 그 사실을 작업 3 의
   완료 조건에 넣는다. 계획 0005 §2-d 와 같은 갈래다.
5. **`docs/api.md` 재생성이 필요하다** — 새 라우트 하나와 새 code 둘이 생긴다. 확인 명령:
   `grep -n "cancel-review\|cancel_reason_required" docs/api.md`(재생성 전 기대 히트 0).

---

## ADR 필요 여부

- **필요하다, 1건: ADR 0013 "매핑 결정의 취소".** ADR 0007 §Deferred 의 두 항목("매핑 확정 취소" ·
  "매핑 반려 취소")을 **함께** 닫는다 — 그 항목 자신이 따로 만들면 비대칭이 생긴다고 적었다.
  ADR 0007 §4-2 규칙 6 ⑥의 "영구" 서술을 **대체하지 않고 좁힌다**: 재계산에 대해서는 여전히 영구이고
  (`_drop_already_confirmed` 무변경 — 실측 V8), CM 의 명시적 취소에 대해서만 풀린다.
- **ADR 0012 는 개정하지 않는다 — §Deferred 3 에 실측만 append 한다**(§1-g). 그 항목의 결론("실측하지
  않았다")이 이 사이클에서 "만들어 보려 했고 못 만들었다 + 파이프라인이 막고 스키마는 허용한다"로
  바뀌므로 문장이 늘어나지만, 불변식은 바뀌지 않는다.
- **과제 2 는 ADR 대상이 아니다.** 이미 있는 조건을 지키기로 정한 것이고, 새 규칙이 아니다.
  §2-d 의 "닫히지 않는 inspection 요청"은 ADR 대상이지만 이 사이클 범위 밖이다(§Deferred 1).
- **과제 3 도 아니다.** CLAUDE.md §3-13 이 이미 규칙을 갖고 있고 이 문서가 그 이행이다.

---

## 리뷰어가 남긴 과제 — **뺀다**

리뷰어의 다음 사이클 과제: *"문서가 인용하는 실측을 사람이 옮겨 적지 않고 그 자리에서 재현되게 만들 수
있는가."* **이 계획에 넣지 않는다.** 근거 셋:

1. **없던 것은 규칙이 아니라 습관이다.** 리뷰어가 근거로 든 세 건 중 내가 원문에서 확인한 것은 둘이다 —
   `99d3721`("감사 머리말에서 낡는 **전량 수**를 빼고")과 `f62872a`("`Exception` 직속의 근거에서 등록
   핸들러 **열거**를 지운다"). 둘 다 **개수·열거** 형태이고, CLAUDE.md §6-1 은 이미 그 형태에 대한 규칙을
   갖고 있다("개수도 세지 않는다" · "열거는 길이가 곧 개수다"). 규칙이 이미 있는 자리에 기계를 하나 더
   놓는 것은 커버리지가 아니다. (셋째 건은 원문을 확인하지 않았다 — §확인하지 않은 것.)
2. **기계를 새로 만들면 그 기계가 새 무주공산이 된다.** 계획 0005 §2-c 가 정확히 그 모양으로 실패했다:
   계획이 설계한 감사가 **같은 계획의 다른 작업** 때문에 정상 코드에서 붉어졌고, 그것을 잡은 것은
   담당 에이전트였다(마감 B-1). "축을 바꾸면 무주공산은 없어지지 않고 자리를 옮긴다"(§6-3 9회차)가
   기계에도 걸린다.
3. **§6 자신이 비용이 되기 시작했다는 판정이 이미 있다** — 커밋별 실측 `f40e279` **54.0%·61.0%**
   (CLAUDE.md §6-5 압축 규칙). 새 절차를 더하는 방향은 그 판정과 반대다.

**대신 이 사이클이 하는 것**(새 기계 없이 비용 0): 이 문서의 모든 실측 칸에 **명령과 출력**을 그대로
실었고, §0 에 재현 방법과 HEAD 를 못박았다. 이것은 §6-5 가 이미 architect 에게 요구하는 것이고 새 규칙이
아니다.

**다시 여는 조건.** 다음 사이클에 문서의 사실성으로 죽은 반려가 **개수·열거가 아닌 형태**로 나오면 그때
연다 — 지금의 규칙 집합이 덮지 못하는 형태가 관측된 것이기 때문이다.

---

## 후속 — 다음 사이클로 넘기는 것

1. **§6-2·§6-4 압축**(architect). 계획 0005 §후속 1 이 그대로 남아 있다. §6-1 압축의 실측 이득이
   **줄 -17 / 문자 -141** 이었다는 상한을 알고 시작한다. 한 번에 한 절, 대조표와 함께.
2. **`"rejected"` 값 리터럴의 전수 감사**(qa). 계획 0005 가 `cause` 에 대해 만든
   `tests/invariants/test_identity_drift_cause_contract.py` 와 같은 모양을 이 값으로 넓힐지.
   §열린 질문 3.
3. **`apps/web/src/api/client.ts:12` 의 TODO**(수작업 code 동기화). 이번에 code 를 **둘** 더하면서 그
   목록이 두 줄 더 길어진다 — 계획 0005 §후속 4 가 그대로 살아 있고 이번 사이클이 그 부담을 키운다.
   qa 소유.
4. **검토요청 *승인*의 사유 요건**(ADR 0011 §Deferred 1 / ADR 0012 §Deferred 1 그대로). 실측이
   필요하다: 검측 승인 1건당 CM 이 실제로 note 를 남기는 비율.

---

## Deferred — 이 사이클이 보고 고치지 않는 것

1. **객체가 검측 루프를 떠난 뒤에도 닫히지 않는 inspection 요청**(§2-d). 실측:
   `INSPECTION_REQUESTED` → (system 스캔 `MISMATCH`) → cm `accept_rework` 뒤 그 요청이
   `('1a8f4718', 'open', '')` 로 남는다. 고치려면 ADR 0001 §6 의 시스템 `on_hold` 사유 집합을 셋째로
   넓혀야 한다.
2. **반려된 2D↔3D 매핑이 뷰어 계약에 계속 실린다**(§1-b). 실측 `N1-mapping-served`: 반려 직후에도
   `GET /api/drawings/{id}/mappings` 가 그 핸들을 그 객체로 돌려준다(`needs_review=True`,
   `reviewed_by=None`). 이것은 취소의 부재가 아니라 **반려가 아무 효과를 내지 않는 것**이다.
   sync-2d3d 소유이고 별도 ADR 이 필요하다.
3. **확정↔취소 반복의 누적**(§1-e). 반복할 때마다 그 쌍의 닫힌 `document_mapping` 요청 행이 하나씩
   쌓인다. 운영에서 문제가 되는지 실측이 없다 — 문제가 되면 카운터가 아니라 **큐의 누적 표시**로 연다.
4. **`confirm_mapping_row` 의 `.first()`**(§1-g). `EntityObjectMappingRow` PK 가
   `(drawing_id, entity_handle, global_id)` 셋이라 한 핸들에 여러 행이 저장될 수 있는데
   (`packages/core/models/orm.py:141-143`), `services/sync/review_queue.py:98-99` 는 그 조회의 첫 행만
   쓴다. 오늘 파이프라인은 그 상황을 만들지 않는다(실측 §1-g) — 그래서 지금은 무해하고, 그 파이프라인이
   바뀌는 날 조용히 틀린다. ADR 0007 §Deferred 의 `_drop_already_confirmed` 항목이 정확히 같은 모양으로
   시작해 실제로는 이미 누수였음이 드러났으므로(ADR 0008 §Context 2), "지금은 무해하다"를 근거로 쓰지
   않고 관측으로만 남긴다.
5. **`on_hold` 에 공백만 note 를 보내면 `"   "` 가 그대로 저장된다**(ADR 0012 §Deferred 2 그대로).
