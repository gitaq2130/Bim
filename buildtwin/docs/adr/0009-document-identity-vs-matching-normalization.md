# ADR 0009 — 문서 정체성과 제목 대조의 분리: 식별 정규화 동결과 `doc_id` 스킴 버전

- 상태: Accepted (**개정 1**: 2026-09-04 — 사이클 막바지에 잡힌 blocker 반영. §5-2 의 검토요청 생성 조건이
  그 blocker 의 **원인**이었다(고아에만 걸어 병합을 경고로 강등했고, 병합을 "**새** `doc_id` 로 수렴"이라고
  좁게 적어 운영에서 실제로 일어나는 변종을 표 밖으로 밀어냈다). §3 표의 "병합 관측: 없음", §5-2 의 판정
  조건("고아"·"지문"), 요청 본문(`cause` 누락), §Deferred 2 의 판단을 함께 정정하고, 반복되는 방법론적
  실패는 **CLAUDE.md §6** 으로 뺐다 — 아래 §5-4 가 "무엇을 어떻게 틀렸는지"를 지우지 않고 남긴다)
- 작성: architect
- 날짜: 2026-09-04
- 관련: ADR 0007 §2-1(미해결 위험으로 기록됨 — **이 ADR 이 그것을 닫는다**), §2-2 규칙 2·4(재업로드·고아·rename),
  §4-2 규칙 6 ⑥(반려의 영구성), §5-1·5-2(`drawing_approval` 논리곱과 확정 매핑만 반영), §9(`UnsafeConfigOverrideError`),
  ADR 0001(확정은 사람만 / 상태 전이에 actor·evidence), ADR 0005·0008(프로젝트 범위 키), CLAUDE.md §0 핵심 원칙·§3 규칙 3·5·10·11

## Context

### 1. 하나의 문자열이 두 가지 일을 하고 있다

`Document.title_normalized` 는 두 역할을 겸한다.

- **식별**: `doc_id = "doc-" + sha256("{doc_type}|{sender_normalized}|{seq_normalized}|{title_normalized}")[:16]`
  (ADR 0007 §2-1)의 네 번째 재료.
- **대조**: 문서 제목 ↔ Activity 이름 유사도 매칭(§4-2 규칙 1)의 입력.

그리고 두 역할이 **같은 config 블록** 하나를 읽는다.

```
services/progress/importers/document_register.py:431
    title_normalize_cfg = cfg.get("title_matching", {}).get("normalize", {})
                               └─ 매칭 튜닝용 블록 ─┘
:311  title_normalized = _title_normalized(title_val, title_normalize_cfg)
:347  doc_id = _compute_doc_id(doc_type, sender_normalized, seq_normalized, title_normalized)
```

**이 튜닝은 반드시 일어난다.** `config/document_register.yaml` 의 `min_similarity: 0.22` 는 그 주석이 스스로
"합성 픽스처 6쌍으로만 잰 것이라 아직 보정되지 않았다. 실제 대장·공정표가 들어오면 반드시 다시 잰다"고
적어 두었고, 임계를 다시 재는 사람은 같은 블록의 `normalize` 도 함께 만진다(같은 절, 같은 화면, 같은 목적).

### 2. 실측 — TestClient 로 끝까지 태운 결과

`tests/fixtures/schedule.csv`(Activity 6) → `tests/fixtures/document_register.xlsx`(문서 10) 를 정상 순서로
올리고, **검토 큐 경로만 써서**(`POST /api/review-requests/{id}/resolve`) CM 이 A100 매핑을 확정하고 A400
매핑을 반려했다. 그 다음 `title_matching.normalize.strip_patterns` 에 `"승인요청"` 한 줄을 더하고
**같은 대장 파일을 한 바이트도 바꾸지 않은 채** 재업로드했다.

확정·반려 직후:

```
--- activity_document_mappings (확정·반려 후) ---
  act=A100  doc=doc-ca45b33c16825a28 needs_review=False reviewed_by=u-cm-56a  decision=None      '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)'
  act=A400  doc=doc-e2dfc7f22b37f1a9 needs_review=False reviewed_by=u-cm-56a  decision=rejected  '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)'

A100 readiness: 1.0 components: {"predecessor_completion": 1.0, ..., "drawing_approval": 1.0, ...}
A100 blockers: []
```

config 한 줄을 더하고 같은 파일 재업로드:

```
register job: done result: {"status": "ok", ..., "document_count": 10, "created": 6, "updated": 4,
  "orphaned": 6, "orphaned_doc_ids": ["doc-284c2190a831117f", "doc-39a82d0d1cf27a91", "doc-487325363443a1e9",
  "doc-6ba01a1e1c628fcf", "doc-ca45b33c16825a28", "doc-e2dfc7f22b37f1a9"], ...
  "mapping_count": 6, "created_review_count": 5, "closed_review_count": 3}
```

```
--- activity_document_mappings (재업로드 후) ---
  act=A100  doc=doc-6a0dd6596625abb1 needs_review=True  reviewed_by=None      decision=None      doc_orphaned=False '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)'
  act=A100  doc=doc-ca45b33c16825a28 needs_review=False reviewed_by=u-cm-56a  decision=None      doc_orphaned=True  '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)'
  ...
  act=A400  doc=doc-e2dfc7f22b37f1a9 needs_review=False reviewed_by=u-cm-56a  decision=rejected  doc_orphaned=True  '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)'
  act=A400  doc=doc-fa3357c8c57fd080 needs_review=True  reviewed_by=None      decision=None      doc_orphaned=False '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)'
```

```
A400 검토요청 상태:
   open      doc=doc-fa3357c8c57fd080 note=None
   rejected  doc=doc-e2dfc7f22b37f1a9 note='CM 반려: 이 문서는 이 작업과 무관하다'

A100 readiness: 1.0 → 0.9249999999999999
  components after : {..., "drawing_approval": 0.5, ...}
  blockers after   : [{"component": "drawing_approval", "reason": "문서 매핑 1건이 CM 검토 대기 — 확정 전까지
                       도면 승인 근거로 쓰지 않음", "related_ids": ["doc-6a0dd6596625abb1"], ...}]
```

네 가지가 동시에 일어났고, 넷 다 예상대로였다.

1. **적재된 문서 10건 중 6건이 새 문서가 되고 옛 6건은 고아가 됐다.** 대장은 바뀌지 않았다.
2. **CM 이 확정한 매핑(A100)이 고아 문서를 가리키게 됐다.** 확정 행 자체는 남지만
   `confirmed_required_documents` 가 `ignore_orphaned_documents`(§5-2 규칙 6)로 걸러내므로 **증거로서는 사라졌다.**
   같은 Activity 에 새 doc_id 로 미확정 후보가 다시 열렸다.
3. **반려의 영구성이 깨졌다(ADR 0007 §4-2 규칙 6 ⑥ 위반).** A400 에는 제목이 **글자 하나까지 똑같은**
   문서가 "CM 이 반려한 것"과 "새로 검토해 달라는 것" 두 개로 동시에 존재한다. `_drop_already_confirmed` 는
   옛 `(activity_id, doc_id)` 쌍을 보고 있는데 새 후보는 새 `doc_id` 라 그 필터를 그대로 통과한다.
4. **readiness 의 도면 승인 근거가 무너졌다.** `drawing_approval` 1.0 → 0.5, 총점 1.0 → 0.925.
   착수 가능 판단의 15%가 config 한 줄에 움직였다.

**그리고 이 전부가 조용하다.** job 은 `done`, 예외 없음, `/startable` 200, 화면 정상. 유일한 신호인
`document_possibly_renamed` 경고는 **사실과 다른 말을 한다** — 제목은 전혀 바뀌지 않았는데 메시지는
"제목만 다르고 (종류·발신·번호)가 같은 기존 문서가 있음"이라고 적는다.

```
document_possibly_renamed [TFA#4]: 제목만 다르고 (종류·발신·번호)가 같은 기존 문서가 있음 — 자동 병합하지 않음
  (new_doc_id=doc-6a0dd6596625abb1, previous_doc_id=doc-ca45b33c16825a28,
   doc_number='동부-HG-TFA-구조-26-049', title='시공상세도 승인요청 - 1F 기둥 배근도 (Z1)')
```

### 2-1. 세 가지 튜닝의 폭발 반경(픽스처 10건 기준, 파서 직접 실측)

| 튜닝 | `doc_id` 변경 |
|---|---|
| baseline | 0/10 |
| `strip_patterns` 에 `"승인요청"` 추가 | **6/10** |
| `strip_chars` 에서 괄호 제거 | **7/10** |
| `lowercase: false` | **9/10** |
| `min_similarity` 0.22 → 0.30 (정규화는 안 건드림) | 0/10 |

마지막 줄이 함정이다. 임계값만 만지면 아무 일도 없으므로 "매칭 설정을 바꿔도 괜찮더라"는 잘못된 학습이
먼저 일어나고, 그 다음에 정규화를 만진다.

### 3. 두 실패 모드는 대칭이 아니다 (실측)

정체성 규칙이 틀리는 방향은 둘뿐이고, 결과가 전혀 다르다.

**(가) 분리(split) — 보수적으로 틀렸을 때.** 같은 문서가 두 `doc_id` 를 얻는다. 위 §2 가 그 모습이다.
행이 남고, 고아 표시가 붙고, 경고가 뜨고, 검토요청이 다시 열린다. **관측 가능하고 되돌릴 수 있다.**

**(나) 병합(merge) — 공격적으로 틀렸을 때.** 서로 다른 두 문서가 한 `doc_id` 를 갖는다. 재현했다.
반려 후 재제출이라 같은 `번호` 아래 1차·2차 두 행이 있는 대장(현장에서 흔하다)에, 매칭 담당자가
`strip_patterns` 에 `\d+\s*차` 를 추가한다 — `discriminative_tokens` 에 이미 `revision` 규칙이 있으니
"차수는 유사도 텍스트에서 지워도 판별에는 영향 없다"는 **매칭 관점에서는 옳은 튜닝**이다.

```
--- 현재 config (차수를 지우지 않음) ---
  문서 11건 → doc_id 유니크 11건 (충돌 0건)

--- 차수 제거 튜닝 후 (strip_patterns += '\d+\s*차') ---
  문서 11건 → doc_id 유니크 10건 (충돌 1건)
  *** 같은 doc_id doc-ca45b33c16825a28 를 공유하는 2건:
        '시공상세도 승인요청 - 1F 기둥 배근도 (Z1) 1차'  승인상태=REJECTED
        '시공상세도 승인요청 - 1F 기둥 배근도 (Z1) 2차'  승인상태=APPROVED
```

TestClient 로 끝까지 태우면(두 행의 `문서번호` 를 다르게 둬 `duplicate_doc_number` 경고가 뜨지 않게 했다):

```
job: done {"document_count": 11, "created": 1, "updated": 10, "orphaned": 2, ...}
warnings:
   - doc_number_mismatch [TFA#8]: ...
   - header_row_not_found [NCR]: ...
   - document_possibly_renamed [TFA#4]: ... (new_doc_id=doc-ca45b33c16825a28, previous_doc_id=doc-ab0aaac7becb0504 ...
   - document_possibly_renamed [TFA#4]: ... (new_doc_id=doc-ca45b33c16825a28, previous_doc_id=doc-d7a2fdd3ecf25706 ...

   doc-ca45b33c16825a28  '시공상세도 승인요청 - 1F 기둥 배근도 (Z1) 2차'  APPROVED  orphaned=False
```

**반려된 1차가 승인된 2차 뒤로 사라졌다.** `services/ingest/persistence.py` 의 upsert 루프는 같은 업로드
안에서 두 번째로 나온 같은 `doc_id` 를 "기존 행 갱신"으로 처리하므로(`existing` 딕셔너리에 방금 자기가
넣은 행이 있다), 마지막 시트 행이 이긴다. 남은 행의 `approval_status` 가 그대로 `drawing_approval`
논리곱(§5-1)의 입력이 된다. `document_count` 는 11 인데 실제 행은 10 이고, 그 차이를 보고하는 곳이 없다.
`created`/`updated` 합도 11 로 맞아떨어져 산술로도 드러나지 않는다.

유일하게 남은 흔적은 `document_possibly_renamed` 두 줄이 **같은 `new_doc_id`** 를 가리킨다는 것뿐이다 —
이 ADR 이 그 신호를 §5-2 의 탐지 규칙으로 승격한다.

정리하면:

| | 분리(보수적 실패) | 병합(공격적 실패) |
|---|---|---|
| 데이터 | 두 행 모두 남는다 | **한 행이 사라진다** |
| 관측 | 고아 표시 + `document_possibly_renamed` + 검토요청 재개 | ~~없음(경고 문구가 우연히 남을 뿐)~~ → **개정 1**: `DOCUMENT_IDENTITY_COLLISION` 경고 + `cause ∈ {merge_overwritten, merge_absorbed}` 로 **CM 큐**(§5-2) |
| 복구 | config 되돌리면 원래 `doc_id` 로 돌아온다 | **불가** — 덮어쓴 값은 없다 |
| readiness | 근거가 사라져 점수가 **내려간다**(보수적) | 잘못된 `approval_status` 가 근거로 **올라간다** |

마지막 줄이 결정적이다. 분리는 착수 가능을 과소평가하고, 병합은 **미승인 도면 위에서 착수 가능을 띄운다.**

**개정 1 정정 — "관측: 없음"은 이제 사실이 아니다.** 초판은 이 칸을 "없음"으로 적고, 그러면서도 §5-2 에서
병합을 **경고까지만** 배정했다. 그 두 문장이 한 ADR 안에 나란히 있는 것이 이 사이클의 blocker 를 만들었다.
지금은 §5-2 가 병합을 두 경위(`merge_overwritten`/`merge_absorbed`)로 나눠 사람의 판단이 걸린 경우 CM 큐에
올린다. **다만 "복구: 불가"와 "readiness: 올라간다"는 그대로다** — 덮어쓰기 자체는 여전히 일어나고(대장이
정본이라 마지막 행이 이긴다), 이 ADR 이 바꾼 것은 그것이 **조용하지 않다**는 점 하나뿐이다.
실측(개정 1, TestClient):

```
CM 이 "반려된 도면"임을 확인하고 A300 매핑을 확정해 차단  → drawing_approval 0.0, blocker document_unapproved
sender_aliases 별칭표 통합 한 줄(동부건설 ← 동부이앤씨) 후 같은 대장 재업로드
  created=0 updated=12 orphaned=1  identity_drift_moved=0 identity_drift_merged=1
  문서 doc-v1-2ab48f2b5f6b911e: REJECTED → APPROVED, doc_number 도 다른 행의 것, is_orphaned=False
  drawing_approval 0.0 → 1.0, blocker 사라짐, score 0.55 → 0.70
  identity_drift_lost_decisions=1  cause="merge_overwritten"  → document_identity_drift 검토요청 1건
```

개정 전 코드에서는 마지막 줄만 없었다 — **미승인 도면 위에서 착수 가능이 뜨고 아무도 몰랐다.**

### 4. 흔들리는 것은 제목만이 아니다 — 식별 표면 전수

**전수 목록을 만든 기준(반드시 함께 읽을 것).** `_compute_doc_id(doc_type, sender_normalized,
seq_normalized, title_normalized)` 의 **인자 네 개를 각각 뒤로 따라가** 그 값을 만드는 입력을 찾고,
그 입력을 실제로 바꿔 `doc_id` 를 다시 계산했다. 코드를 읽고 판단하지 않고 전부 실행으로 확인했다.

| 재료 | 만드는 함수 | 입력 | 실측(픽스처 10건) |
|---|---|---|---|
| `doc_type` | `_sheet_doc_type` | `register_layout.sheet_doc_types` + 워크북 **시트명** | 별칭 하나 바꾸면 **8/10** 변경 |
| `sender_normalized` | `_sender_normalized`→`_squash` + 별칭표 | `normalization.sender_aliases`, `column_aliases.sender` | 표준명 표기 변경 **7/10**, 새 별칭 추가 **1/10**, `column_aliases.sender` 변경 **10/10** |
| `seq_normalized` | `_seq_normalized` (숫자만, 코드 고정) | `column_aliases.seq_raw` | 아래 §4-1 |
| `title_normalized` | `_title_normalized` | `title_matching.normalize`, `column_aliases.title` | §2-1 표 |

**이 기준이 놓치는 것**(ADR 0008 계획이 `grep "session.get(...)"` 하나로 전수를 만들었다가 시그니처 변경
호출부와 Celery 잡 안에서 삼켜지는 경로를 통째로 놓친 전례를 그대로 되풀이하지 않기 위해 명시한다):

1. **파서 밖에서 입력이 바뀌는 경로.** 사용자가 엑셀에서 시트명을 `TFA` → `승인요청서` 로 바꾸면 config 는
   그대로인데 `doc_type` 이 바뀐다. 이 기준은 config 만 흔들어 봤으므로 그 경로를 직접 보지 못한다
   (효과는 `sheet_doc_types` 변경과 같으므로 폭발 반경은 대리 측정됐다).

   **개정 1 — 대리 측정으로는 부족했다.** 이 경로를 직접 태워 보니 폭발 반경(8/10)만 같았을 뿐 **관측
   가능성이 전혀 달랐다**: `doc_type` 이 함께 바뀌어 옛 행이 **고아가 되지 않고**(실측 `orphaned=0`,
   `moved=8`), config 를 한 글자도 안 바꿨으므로 **지문도 그대로다**(`fingerprint_changed=False`).
   초판 §5-2 는 판정 조건을 "고아"로, 보완 신호를 "지문"으로 적었으므로 이 경로에서 **둘 다 침묵한다.**
   블라인드 스팟을 적어 두는 것만으로는 부족하고, **적어 둔 스팟은 실제로 태워 봐야 한다**(CLAUDE.md §6-1).
2. **`doc_id` 를 `documents` 밖에 **저장**하는 자리.** 위 표는 "누가 `doc_id` 를 만드는가"만 본다.
   "누가 이미 만들어진 `doc_id` 를 붙들고 있는가"는 별도 조사가 필요하고, 그것이 §6 마이그레이션 표다.
   그 조사는 `grep doc_id` 로 만들었으므로 **다른 키 이름으로 저장하거나 자유형 JSON 안에 묻힌 자리는
   놓친다** — 지금 저장소에서는 그런 자리를 찾지 못했지만 "없다"고 단정하지 않는다.
3. **미래에 추가되는 재료.** 이 표는 오늘의 네 인자다. 재료를 늘리는 변경은 §5 규칙 4에 따라
   `DOC_ID_SCHEME` 를 올려야 하며, 그 규칙이 이 목록을 다시 만들도록 강제한다.

#### 4-1. 곁가지 실측 — `seq` 는 생각보다 약한 재료다

`column_aliases.seq_raw` 의 별칭 목록에 `"no."`/`"no"` 가 있다. 대장에 `번호` 컬럼이 없으면
**행번호 `No` 컬럼이 조용히 대신 채택된다**(실측: `seq_raw = ['1','2',...,'8','1','2']`).
그 상태에서 대장 맨 앞에 문서 한 건을 끼워 넣고 `No` 를 다시 매기면:

```
행 하나 삽입 후: 기존 문서 10건 중 doc_id 가 바뀐 것 8건
```

`required_columns` 는 `["title"]` 하나뿐이므로(§2-5 규칙 3) 이 대장은 정상 적재된다. 즉 **오늘의 `doc_id`
는 대장의 행 순서에 매달릴 수 있다.** 이 ADR 은 이 문제를 고치지 않고(§Deferred 1) 기록만 한다 —
`seq_raw` 별칭을 바꾸는 것 자체가 식별 표면 변경이므로 §5 규칙 4 절차를 밟아야 한다.

## Decision

### 1. `title_normalized` 를 두 개로 나눈다

| 필드 | 소유 | 용도 | 바꿔도 되나 |
|---|---|---|---|
| `title_identity` (신설) | **코드** — `packages/core/models/document.identity_title()` | `doc_id` 재료 | 아니오. 바꾸려면 §5 규칙 4 |
| `title_normalized` (기존, 의미 정정) | `config/document_register.yaml` `title_matching.normalize` | 제목 ↔ Activity 대조 | 예. 자유롭게 |

`title_normalized` 의 **계산은 한 글자도 바뀌지 않는다.** 바뀌는 것은 "이 값이 `doc_id` 재료다"라는 사실
하나뿐이다. ADR 0007 §2-3 컬럼 표는 이미 이 필드를 "대조용 정규화 텍스트"라고 적어 두었다 — 그 서술이
사실이 아니었고, 이 ADR 이 서술 쪽이 아니라 코드 쪽을 서술에 맞춘다.

`services/progress/document_mapper._build_mapping` 은 이미 `doc.title` 에서 매번 다시 정규화해 쓰고
저장된 `title_normalized` 를 읽지 않는다 — 즉 **대조 경로는 이 분리에 아무 영향을 받지 않는다.**

### 2. 식별용 정규화는 config 가 아니라 **코드**에 둔다

`config/` 에 `identity_normalization:` 블록을 만들고 `_assert_invariant` 로 지키는 안을 검토했고
**채택하지 않는다.** 근거:

- ADR 0007 §9 의 `UnsafeConfigOverrideError` 는 **코드가 읽지 않는 키**를 지키는 장치다. "값을 바꿔도
  아무 일도 안 일어나는 것"이 위험하므로 요란하게 실패시킨다는 논리다. 식별 정규화는 정반대로
  **코드가 반드시 읽어야 하는 값**이라 같은 장치가 성립하지 않는다.
- 정규화 규칙은 정규식 목록·문자 집합·불리언의 중첩 구조다. "요구값과 같은가"를 검사하려면 그 구조 전체를
  코드에 또 한 벌 적어 두고 깊은 비교를 해야 한다. 그러면 진실 원천이 두 개가 되고, 둘이 어긋나는 순간
  **어느 쪽이 진짜인지 아무도 모른다.**
- config 에 키가 **보이면** 만지게 된다. 안전 장치의 최선은 "만졌을 때 막는 것"이 아니라 "만질 손잡이가
  없는 것"이다.

따라서 `title_identity` 를 만드는 함수는 `packages/core/models/document.py`(architect 소유)에 있고
`config/` 를 읽지 않는다. `doc_id` 를 만드는 유일한 승인 경로도 같은 모듈의 `compute_doc_id()` 다.

```python
DOC_ID_SCHEME = 1

def identity_title(title: str) -> str:
    return _IDENTITY_WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", title)).strip().casefold()

def compute_doc_id(doc_type: str, sender_normalized: str, seq_normalized: str | None, title: str) -> str:
    material = f"{doc_type}|{sender_normalized}|{seq_normalized or ''}|{identity_title(title)}"
    return f"doc-v{DOC_ID_SCHEME}-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
```

**`compute_doc_id` 의 마지막 인자가 정규화된 제목이 아니라 원문 제목인 것이 설계다.** 호출자가 자기
나름대로 정규화한 문자열을 재료로 끼워 넣을 수 없다. 오늘의 사고는 정확히 "호출자가 재료를 골랐다"에서
비롯됐다.

**동결의 두 번째 강제 지점**: `Document` 모델의 `model_validator` 가 `title_identity` 를 언제나
`title` 에서 다시 계산해 **호출자가 준 값을 버린다.** 파서든 DB 읽기든 테스트 헬퍼든 같은 `title` 이면
같은 `title_identity` 다. `doc_id` 는 파생시키지 **않는다** — DB 에서 읽을 때 `doc_id` 를 다시 계산하면
`DOC_ID_SCHEME` 가 올라간 순간 **읽기만 해도 키가 바뀌어** 이 ADR 이 막으려는 사고가 그대로 재현된다.

**세 번째 강제 지점**은 config 로더다. `load_document_register_config()` 가 `title_matching.normalize` 아래
`affects_doc_id` 키를 `false` 로 고정 검사하고(§9 의 기존 패턴), 식별 정규화를 config 로 되돌리려는
키(`title_matching.identity_normalization`, `normalization.title_identity`)가 **존재하기만 해도**
`UnsafeConfigOverrideError` 로 실패시킨다. 값이 아니라 **키의 존재**를 막는 것은 이 저장소에 없던 형태다 —
"안전 불변식을 문서화하는 키"와 "안전 불변식을 되돌리려는 키"는 다르게 다뤄야 하기 때문이다.

### 3. 식별 정규화는 **대조 정규화보다 보수적**이다

`identity_title` 이 하는 일은 셋뿐이다.

1. `unicodedata.normalize("NFKC", ...)`
2. 연속 공백 → 한 칸 + 앞뒤 공백 제거
3. `casefold()`

**하지 않는 일**: 괄호·하이픈 제거, 머리말·확장자·첨부 표기 제거, 잡음 토큰 삭제. 전부 대조용이 한다.

경계선은 **"표기 인코딩은 정규화하고, 내용은 절대 건드리지 않는다"** 이다. 전각/반각, 논브레이킹 스페이스,
중복 공백, 대소문자는 엑셀에서 IME 상태에 따라 저절로 섞여 들어오는 것이지 사람이 문서를 고쳐 쓴 것이
아니다. 반면 괄호나 하이픈이 사라진 것은 **누군가 제목을 편집한 것**이고, 그것은 정체성이 흔들릴 수도
있는 사건이므로 시스템이 대신 판단해서는 안 된다.

실측(픽스처 제목 1건에 대한 9가지 표기 변형):

```
  원문                     같음    '시공상세도 승인요청 - 1f 기둥 배근도 (z1)'
  공백 2칸                  같음
  앞뒤 공백                  같음
  전각 괄호 （Z1）             같음
  전각 영문 Ｚ                같음
  대문자 F→소문자              같음
  논브레이킹 스페이스             같음
  하이픈 제거                 다름 ***
  괄호 제거                  다름 ***
```

마지막 두 줄은 **의도한 동작**이다 — 그때는 §3 (가) 분리 경로로 들어가고, 고아 표시·경고·재검토가 붙는다.

보수 쪽을 고르는 근거를 한 줄로 적으면: **확신이 없을 때 정체성은 나누는 쪽으로 틀린다.** 이는
ADR 0001("스캔 AI 는 추정까지, 확정은 사람"), ADR 0007 §3-2("공란·해석 불가를 승인으로 추측하지 않는다"),
§4-2 규칙 4("애매한 매핑은 만들지 않는다")와 같은 방향이다. 셋 다 "모르면 사람에게 넘긴다"이고, 분리는
사람에게 넘기는 실패, 병합은 사람 몰래 답을 정하는 실패다.

### 4. 제목을 재료에서 빼지 않는다 — 실측 근거

`seq_normalized` 가 이미 있으니 제목을 빼면 정규화 문제 자체가 사라진다는 선택지를 검토했고,
**채택하지 않는다.** `번호` 가 비는 대장이 실제로 가능하기 때문이다(`required_columns: ["title"]`).

```
--- 번호·No 컬럼 모두 없는 대장 ---
  문서 10건 / seq 결측 10건
  현재 doc_id(제목 포함) 유니크: 10/10
  제목 뺀 doc_id 유니크        : 5/10  → 충돌 5건
    충돌 키 ('TFA', '동부건설', '') × 6
       TFA '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)' → 승인상태 APPROVED
       TFA '시공상세도 승인요청 - 1F 보 배근도 (Z1)'   → 승인상태 APPROVED_WITH_COMMENTS
       TFA '시공상세도 승인요청 - 1F 슬래브 배근도 (Z1)' → 승인상태 UNKNOWN
       TFA '자재승인원 - 외벽 조적 벽돌 (1F Z1)'       → 승인상태 REJECTED
       TFA '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)' → 승인상태 APPROVED
       TFA '시공상세도 승인요청 - 1F 기둥 배근도 (Z2)' → 승인상태 APPROVED

--- 일부 행만 번호가 빈 대장(현장에서 더 흔한 형태) ---
  문서 10건 / seq 결측 3건 → 제목 뺀 doc_id 충돌 2건
```

제목을 빼면 **승인·반려·미기재가 뒤섞인 6건이 한 행으로 붕괴**한다. 이는 §3 (나) 병합 실패를 설계
차원에서 상시화하는 것이다. 게다가 §4-1 이 보였듯 `seq` 자체가 행번호로 폴백될 수 있어 단독 재료로는
더 약하다. **제목은 이 대장에서 문서를 실제로 구별하는 유일한 필드다.** 재료에 남긴다.

### 5. 규칙 (이 저장소의 불변식)

1. **`doc_id` 는 `packages/core/models/document.compute_doc_id()` 로만 만든다.** 다른 모듈에 해시 계산을
   복제하지 않는다. `services/progress/importers/document_register._compute_doc_id` 는 삭제한다.
2. **`title_matching.*` 아래 어떤 값도 `doc_id` 를 움직이지 않는다.** 이것이 이 ADR 의 핵심 계약이며
   §7 검증 시나리오 V1 이 이 계약 자체를 테스트로 고정한다.
3. **식별 표면(§4 표)에 속하는 config 를 바꾸는 변경은 스키마 마이그레이션과 같은 무게로 다룬다.**
   `title` 은 §2 로 표면에서 빠졌지만 `sender_aliases`·`sheet_doc_types`·`column_aliases` 는 운영상
   반드시 바꿀 수 있어야 하므로 동결할 수 없다 — 대신 §5-2 가 **탐지**한다.
4. **재료·정규화·`identity_title` 이 바뀌면 `DOC_ID_SCHEME` 를 올린다.** 올리는 PR 은 §6 마이그레이션을
   함께 담아야 한다. 값만 올리고 끝내는 변경은 reviewer 가 반려한다.
5. **`doc_id` 문자열에 스킴 번호가 실린다**(`doc-v1-<16hex>`). 접두사가 없으면 재적재가 "새 문서가
   들어왔다"인지 "같은 문서의 키 규칙이 바뀌었다"인지 **데이터만 보고는 구분할 수 없다** — 오늘의 사고가
   조용했던 이유가 정확히 그것이다.

#### 5-1. 동결할 수 없는 식별 표면 — 무엇을 할 수 없는가

`normalization.sender_aliases`(새 협력사가 들어오면 반드시 추가해야 한다),
`register_layout.sheet_doc_types`·`column_aliases`(대장 서식이 현장마다 다르다, §2-5)는 운영 필수라
동결 대상이 아니다. 실측 폭발 반경은 각각 7/10, 8/10, 10/10 이다. 이들에 대해 이 ADR 이 하는 일은
**막는 것이 아니라 알아채는 것**이다.

#### 5-2. 탐지 — `document_identity_drift`

> **개정 1에서 전면 재작성된 절이다.** 초판의 표는 이 사이클 blocker 의 **원인**이었다. 무엇을 어떻게
> 틀렸는지는 지우지 않고 §5-4 에 그대로 남긴다 — 다음 사람이 같은 함정을 피하려면 그 기록이 필요하다.
> 아래 서술의 **정본은 구현**이다(`services/ingest/persistence.py` + `services/progress/document_mapper.py`).
> 개정 1의 모든 수치·문구는 실행으로 확인했다.

대장 적재는 두 가지를 함께 계산한다.

- **식별 표면 지문(`identity_fingerprint`)**: 식별에 관여하는 config 부분집합(§4 표의 입력들)만 모아
  해시한 값(`services/progress/identity_surface.identity_surface_fingerprint`). **적재 단위** 값이며
  적재한 문서 행마다 함께 저장한다(`imported_at` 과 같은 형태 — 별도 테이블을 만들지 않는다).
- **드리프트 관측**: 아래 두 갈래. 어느 쪽도 **지문을 판정 조건으로 쓰지 않는다.**

**지문은 판정 조건이 아니라 보고 값이다(개정 1 정정).** 초판은 "판정이 '일어났다'를, 지문이 '무엇이
바뀌어서'를 답한다"고 적었는데, 그 문장은 지문이 언제나 함께 움직인다는 전제를 몰래 깔고 있었다.
사용자가 **엑셀 시트명을 바꾸는 경로**는 config 를 한 글자도 바꾸지 않으므로 지문이 그대로다
(실측: `fingerprint_changed=False` 인데 `moved=8`). 지문을 조건에 넣었으면 이 경로 전체가 조용히
지나간다. 지문이 답하는 것은 **"어디를 되돌려야 하는가"** 하나다 — 바뀌었으면 config(§4 표), 그대로면
대장 파일 쪽(시트명 등 config 밖 입력).

##### (가) 관측 1 — 이동(`moved`)

이번 적재에 **나타나지 않은 기존 행**과, 이번 적재에서 **새로 생긴 문서** 사이에서 `title` **원문이 글자
그대로 같고** `doc_number` 가 어긋나지 않는 쌍을 1:1 로 짝짓는다(`_pair_identity_moves`; `doc_number` 는
한쪽이 비면 통과 — 대장에 문서번호 열이 없는 현장이 있다). 대장은 그대로인데 우리 규칙이 움직인 것이다.

**후보를 "고아"로 좁히지 않는다(개정 1 정정).** 초판은 조건을 "고아 ↔ 신규 쌍"이라고 적었다. 그런데
시트명을 바꾸면 `doc_type` 이 함께 바뀌고, ADR 0007 §2-2 규칙 2 가 "이번 업로드에 등장한 `doc_type`"
에만 고아 처리를 하므로 옛 행은 **고아가 되지도 않는다** — 실측 `orphaned=0`, `moved=8`. "고아"로 좁힌
구현은 이 경로를 통째로 놓친다. 좌변은 `is_orphaned` 가 아니라 **이번 적재에 나타나지 않은 기존 행 전부**다.

`rename_index`(ADR 0007 §2-2 규칙 4)에 기대서도 안 된다. 그 키는 `(doc_type, sender_normalized,
seq_normalized)` 이고 `doc_id` 는 거기에 `title_identity` 를 더한 해시다 — 키가 같고 제목 원문도 같으면
재료 넷이 모두 같아 **애초에 같은 `doc_id`** 라서 그 분기는 발화할 수 없고, 반대로 `sender_aliases` 를
바꾸면 키가 어긋나 `document_possibly_renamed` 가 한 건도 뜨지 않는다(실측: 7건 이동, rename 경고 0건).

##### (나) 관측 2 — 병합(`merged`)

한 적재 안에서 **두 개 이상의 대장 행이 같은 `doc_id` 로 수렴**하면 병합이다(`_collision_groups`).
덮어쓰기 동작 자체는 유지한다(대장이 정본 — 마지막 행이 이긴다). 바뀌는 것은 더 이상 조용하지 않다는 점뿐.

**"새 `doc_id` 로 수렴"이라는 한정어를 뺀다(개정 1 정정 — 이것이 blocker 의 원인 절반이다).** 초판은
병합을 "두 개 이상의 `doc_id` 가 하나의 **새** `doc_id` 로 수렴"이라고 적었다. 운영에서 실제로 일어나는
병합은 **한쪽 표준명이 그대로인** 변경(별칭표 통합처럼)이라 **이미 있던** `doc_id` 로 수렴한다 — 새 행이
만들어지지 않는다. 이 ADR 자신의 §3 (나) 재현조차 기존 id(`doc-ca45b33c16825a28`)로 수렴했다.
한정어 하나가 **가장 위험한 변종을 표 밖으로 밀어냈다.**

##### (다) 사람의 판단이 오염되는 경위는 셋이다 — `lost_decisions[].cause`

관측(가)·(나)에 걸린 `doc_id` 를 가리키는 `activity_document_mappings` 중 `reviewed_by is not None` 인
것을 모아 `lost_decisions` 로 싣는다. 항목은 `{activity_id, doc_id, decision, cause}` 이고
**`cause` 는 생략할 수 없다.**

| `cause` | 언제 붙나 (구현) | 데이터가 어떤 모습인가 | CM 이 해야 할 일 |
|---|---|---|---|
| `orphaned` | `moved[].previous_doc_id` | 판단이 가리키던 행이 고아가 되고, 같은 문서가 **새 `doc_id`** 로 다시 들어와 있다 | 새 `doc_id` 위에서 같은 판단을 다시 내린다 |
| `merge_overwritten` | ① 그 `doc_id` 가 이번 적재의 **충돌 묶음**에 있고 ② 그 행의 **대장 행 지문**이 적재 전후로 달라졌다 (`_merge_overwritten_doc_ids`) | **행도 `reviewed_by` 도 살아 있고 고아 표시조차 없다.** 바뀐 것은 그 `doc_id` 가 담고 있는 **대장 행**이다 | 화면의 승인 상태를 믿지 않는다. **다시 확정할 새 `doc_id` 가 없다** |
| `merge_absorbed` | 충돌 묶음 구성원과 `title` 원문이 같고 `doc_number` 가 호환되는, 이번 적재에 나타나지 않은 기존 행 (`_merge_absorbed_doc_ids`) | 판단이 가리키던 행이 다른 `doc_id` 에 흡수돼 사라졌다(새 행이 생기지 않아 (가)로는 잡히지 않는다) | 그 문서는 더 이상 없다. **새 `doc_id` 가 없다** |

`merge_overwritten` 이 §3 이 스스로 최악이라 적은 경로다 — 판단이 **사라지는** 게 아니라 판단의
**대상**이 바뀐다. 그래서 고아·이동 조건 어디에도 걸리지 않는다. 나머지 둘은 근거가 사라져 점수가
내려가는 보수적 실패다. `cause` 를 안 실으면 소비자(검토요청 제목·화면 카드)가 셋을 하나로 뭉뚱그릴
수밖에 없고, **뭉뚱그리는 순간 반드시 거짓이 된다**(§5-4·§Deferred 2).

`decision`(확정/반려)의 구분은 `document_mapper.is_rejected_mapping()` 에 맡긴다 — 판정 키 문자열을
적재 모듈이 직접 읽지 않는다(ADR 0007 §4-2 규칙 6 ⑥ 불변식).

##### (라) 오탐 방지 — 두 조건이 왜 **둘 다** 필요한가

병합 두 경위에는 **"이번 적재의 충돌 묶음에 속한다"(①)** 가 언제나 붙는다. `merge_overwritten` 은 여기에
**"대장 행 지문이 달라졌다"(②)** 를 더한다. 대장 행 지문은 `(sender, doc_number, seq_raw, title,
result_raw, approval_status)` 이고, `doc_id` 재료 넷은 일부러 넣지 않는다(같은 `doc_id` 안에서는 정의상
언제나 같아 아무것도 구별하지 못한다). `sheet_name`/`source_row` 도 넣지 않는다(앞에 행이 끼면 전부
밀리는데 그것은 내용 변화가 아니다).

- **② 없이 ①만** 두면 — 충돌이 상시화된 대장(같은 두 행이 매주 올라온다)에서 매 적재 같은 사건을 다시
  보고한다. 실측: 같은 config 로 재업로드하면 `merged` 는 그대로 관측되지만 `lost_decisions=[]`,
  `identity_drift_review_id=None`, 요청은 여전히 1건.
- **① 없이 ②만** 두면 — 대장이 다음 주에 같은 문서의 처리결과를 반려에서 승인으로 고쳐 오는 **정상 갱신**이
  전부 오염으로 잡힌다. 그것은 대장이 정본이라는 규칙 그대로다(ADR 0007 §1 규칙 1).

`merge_absorbed` 에도 같은 성질의 가드가 둘 있다: 이미 고아였던 행은 제외(사건이 일어난 적재에서 한 번만
발화), `moved` 가 이미 가져간 행은 제외(한 행은 한 경위에만 속한다 — `cause` 는 `setdefault` 로 처음 붙은
것이 유지되고 우선순위는 `orphaned` → `merge_overwritten` → `merge_absorbed` 순이다).

##### (마) 발화 규칙

| 조건 | 결과 |
|---|---|
| 이동 후보 쌍의 `title` 원문이 **다르다** | 지금까지대로 `document_possibly_renamed` 경고. 사람이 제목을 고친 정상 상황(§Deferred 2 가 이 문구를 정정한다) |
| (가) 이동이 1건 이상 | `DOCUMENT_IDENTITY_DRIFT` 경고. 메시지에 이전/새 `doc_id` 쌍, 이동 건수, 이전·현재 지문과 `fingerprint_changed`, 오염된 판단 수 |
| (나) 병합이 1건 이상 | `DOCUMENT_IDENTITY_COLLISION` 경고를 **병합 묶음마다** 발화. 메시지에 `doc_id`·행 수·제목들과 **이 병합 한 건이 건드린 판단 수**(`lost_decisions_in_merge`) |
| (다) `lost_decisions` 가 **비어 있지 않다** (경위 무관) | **`ReviewRequest(kind="document_identity_drift", assignee_role="cm")` 를 적재당 1건 생성.** 본문(`conflicting_sources`)에 이전·현재 지문, `moved`, `merged`, 그리고 **`cause` 가 실린 `lost_decisions`** 를 싣는다. 제목은 경위마다 다르게 쓴다 |
| `lost_decisions` 가 비었다 | 경고까지가 적절한 크기다. 요청을 만들지 않는다(큐 오염 방지 — 아래) |
| 같은 `current_fingerprint` 로 열린 요청이 이미 있다 | 새로 만들지 않고 최신 관찰로 갱신한다(적재당 1건 불변식) |

경고 두 개가 나뉜 것은 라벨이 사실이어야 하기 때문이다. **병합만 관측된 적재(`moved=0`, `merged=1`)에
`DOCUMENT_IDENTITY_DRIFT` 를 붙이면 오라벨이다** — 그것은 COLLISION 이다(계획 0003 §3-f 정정 참조).

**왜 job 을 실패시키지 않는가.** ADR 0007 §1 규칙 1(대장이 정본)은 "대장 데이터의 성질 때문에 적재를
거부하지 않는다"는 규칙이다. 여기 원인은 대장이 아니라 우리 config 이므로 거부해도 규칙 위반은 아니다.
그럼에도 거부하지 않는 이유는 다른 데 있다 — 새 협력사 별칭을 추가한 주에 현장의 주간 대장 업로드가
통째로 막히면, 운영자는 config 를 되돌리는 대신 **탐지를 끄는 방향**으로 움직인다. 대신 잃어버린 사람의
판단이 실제로 있을 때만 CM 검토 큐에 올린다.

**왜 job 경고가 아니라 검토요청인가.** 이 저장소의 8차 리뷰가 이미 같은 실패를 겪었다 —
`needs_review=True` 매핑이 쌓여도 검토요청을 만드는 코드가 없어 CM 큐가 영원히 비어 있었고 어떤
테스트도 실패하지 않았다. job 경고는 업로드 응답에만 실려 지나가고 아무도 되돌아보지 않는다.
**사람이 봐야 하는 일은 사람의 큐에 넣는다.**

#### 5-3. `document_identity_drift` 검토요청의 성질

`ReviewKind` 에 값을 추가하지만 **해소에 부수 효과가 없다.** `services/api/usecases.resolve_review` 의
공통 폴백이 `status`/`resolution_note`/`resolved_by` 만 기록한다 — `document_mapping` 처럼 매핑 행을
건드리는 분기를 추가하지 **않는다**. 이 요청은 "봤다"를 남기는 확인 전용이고, 무엇을 할지(config
되돌리기 / §6 마이그레이션)는 본문이 안내한다. 이 kind 에 매핑을 되살리는 액션을 붙이는 설계는
반려한다 — 그것은 사람의 확정을 시스템이 복원하는 것이라 ADR 0001 불변식과 충돌한다.

**제목은 경위마다 갈라 쓴다(개정 1).** 하나로 뭉뚱그린 초판 제목("doc_id 가 N건 이동했고 … 고아 문서에
남았습니다 … 새 doc_id 위에서 다시 확정하십시오")은 병합 경로에서 세 군데가 거짓이었다 — 자세한 것은
§5-4. 경위가 섞이면 각 경위를 건수와 함께 **나란히** 적는다. 요청 본문의 `lost_decisions[].cause` 가
그것을 가능하게 하는 유일한 필드이고, 화면도 그 값(산문이 아니라 기계 판독 값)으로 카드를 가른다.

#### 5-4. 개정 1 — 초판 §5-2 가 어떻게 틀렸나 (지우지 않고 남긴다)

이 사이클 막바지에 잡힌 blocker 는 구현 실수가 아니었다. **담당들은 초판 §5-2 표대로 구현했고, 그 표가
틀렸다.** 초판 표의 세 행을 그대로 옮긴다:

| 초판 조건 | 초판 결과 | 무엇이 틀렸나 |
|---|---|---|
| `title` 원문이 **같다** | `DOCUMENT_IDENTITY_DRIFT` 경고 | 조건의 좌변을 "**고아** ↔ 신규"로 적었다. 시트명 변경 경로는 고아를 만들지 않는다(실측 `orphaned=0`, `moved=8`) |
| 위에 더해, **고아가 된 문서**에 `reviewed_by is not None` 인 매핑이 있다 | 검토요청 1건 생성 | **이것이 blocker 의 원인이다.** `merge_overwritten` 은 고아가 아니므로 이 규칙대로면 **영원히 큐에 닿지 못한다** |
| 두 개 이상의 `doc_id` 가 하나의 **새** `doc_id` 로 수렴 | 같은 경고를 **병합 사유로 발화**(경고까지만) | ① "**새**"라는 한정어가 운영에서 실제로 일어나는 변종(이미 있던 id 로 수렴)을 표 밖으로 밀어냈다 ② 가장 위험한 경로를 **경고 쪽**에 배정했다 |

세 번째 행이 특히 뼈아프다. **같은 절이 스스로** "job 경고는 업로드 응답에만 실려 지나가고 아무도
되돌아보지 않는다. 사람이 봐야 하는 일은 사람의 큐에 넣는다"고 적어 놓고, 바로 그 문장 위의 표에서
**가장 위험한 경로를 경고 쪽에 뒀다.** §3 은 이미 병합을 "복구 불가 / 미승인 도면 위에서 착수 가능"으로
분류해 두었으므로, 근거는 ADR 안에 전부 있었는데 결론이 그것을 따라가지 못했다.

그리고 초판 §5-2 는 요청 본문을 **"잃어버린 확정·반려 건수와 doc_id 목록"** 으로만 적었다. `cause` 가
없으면 소비자는 세 경위를 하나로 뭉뚱그릴 수밖에 없고, 그 결과 §5-2 가 만든 **새** 검토요청 제목이
병합 경로에서 세 군데 거짓을 갖고 태어났다: ① 고아가 아닌 것을 고아라 하고 ② 존재하지 않는 새 `doc_id`
위에서 "다시 확정하라"고 하고 ③ `moved == 0` 인 적재에 "0건 이동했고"라고 적었다.

이 절이 이 ADR 에 남는 이유: **조건을 좁게 적으면 가장 위험한 변종이 표 밖으로 나간다.** 이 사이클의
다른 반복 패턴들과 함께 **CLAUDE.md §6** 에 규칙으로 올렸다.

## Consequences

- **매칭 임계값 보정이 안전해졌다.** ADR 0007 이 예고한 "실데이터가 들어오면 `min_similarity` 를 다시
  잰다"는 작업이 이제 정체성을 건드리지 않고 진행된다. 실측으로 확인했다 — 매칭 설정 8가지를 흔들었을 때
  새 `compute_doc_id` 기준 `doc_id` 변경은 전부 0/10:

  ```
  OK  strip_patterns += '승인요청'         doc_id 변경 0/10
  OK  strip_chars 에서 괄호 제거             doc_id 변경 0/10
  OK  lowercase: false                 doc_id 변경 0/10
  OK  strip_patterns += 차수제거           doc_id 변경 0/10
  OK  min_similarity 0.22→0.30         doc_id 변경 0/10
  OK  seq_weight/token_weight 재조정      doc_id 변경 0/10
  OK  discriminative_tokens 추가         doc_id 변경 0/10
  OK  mapping_weights 재조정              doc_id 변경 0/10
  ```

- **위험이 없어진 것이 아니라 좁아졌다.** 같은 실측의 나머지 절반:

  ```
  변동   normalization.sender_aliases (표준명 변경)        doc_id 변경 7/10
  변동   register_layout.sheet_doc_types (별칭 변경)      doc_id 변경 8/10
  변동   register_layout.column_aliases.sender        doc_id 변경 10/10
  ```

  가장 자주 만지는 손잡이(매칭 튜닝)를 표면에서 뺐을 뿐, 표면 자체는 남아 있다. 남은 것에 대한 답은
  동결이 아니라 §5-2 탐지다. **이 문단을 지우고 "정체성 문제는 해결됐다"고 적는 후속 개정은 틀렸다.**

- **`doc_id` 형식이 `doc-<16hex>` 에서 `doc-v1-<16hex>` 로 바뀐다.** 오늘 존재하는 모든 `doc_id` 가 한 번
  바뀐다(§6). 이 변경 자체가 이 ADR 이 막으려는 사고와 같은 모양이라는 점을 숨기지 않는다 — 차이는
  **의도했고, 한 번뿐이고, 마이그레이션 판단을 명시했다**는 것이다.

- **`ReviewKind` 가 다섯 개가 되어 프론트엔드의 라벨 표(`REVIEW_KIND_LABELS: Record<ReviewKind, string>`)가
  누락을 컴파일 단계에서 잡아 준다.** TS 타입에 값을 추가하지 않으면 새 kind 가 화면에서 `undefined`
  라벨로 뜬다 — 계획의 frontend 항목이 이를 처리한다.

- **`title_identity` 가 API 응답(`DocumentView`)에 노출된다.** 의도한 것이다: "이 문서가 어떤 문자열로
  해시됐는가"가 화면·로그에서 보여야 드리프트를 사람이 눈으로 확인할 수 있다.

- **(개정 1) 병합이 CM 큐에 오르지만, 뒤집힘 자체는 막지 않는다.** 살아남은 행은 대장의 다른 행이고
  대장이 정본이다(ADR 0007 §1 규칙 1). `drawing_approval` 이 0.0 → 1.0 으로 뒤집히는 것은 그대로 일어나고,
  이 ADR 이 바꾼 것은 같은 적재가 그 사건을 사람의 큐에 올린다는 점뿐이다. **이 문단을 지우고 "병합은
  이제 안전하다"고 적는 후속 개정은 틀렸다.**

- **(개정 1) `lost_decisions[].cause` 는 화면·문구의 계약이다.** 검토요청 제목, `DOCUMENT_IDENTITY_*`
  경고 문구, 프론트엔드 카드가 모두 이 값으로 갈린다. 소비자는 **산문을 부분 문자열로 되읽어 분류하지
  않는다**(이 저장소가 `Blocker.kind` 도입으로 이미 걷어낸 패턴이다). 새 경위를 추가하는 변경은 세
  소비자를 함께 고쳐야 하며, 모르는 `cause` 를 `orphaned` 로 떨어뜨리는 폴백은 금지다 — 모르는 것을
  고아라고 적으면 §5-4 가 고치려는 바로 그 거짓이 된다.

## Alternatives considered

1. **`identity_normalization` 을 config 에 두고 `_assert_invariant` 로 지킨다.** 기각 — §2. 코드가 읽어야
   하는 값이라 §9 패턴이 성립하지 않고, 진실 원천이 둘로 늘어난다.
2. **`title_matching.normalize` 를 그대로 두고 "바꾸지 마라"고 문서에만 적는다.** 기각 — ADR 0007 §2-1 이
   이미 그렇게 적어 두었고(개정 1), 그럼에도 이 ADR 의 §2 재현이 성립한다. 문서는 손잡이를 없애지 못한다.
3. **제목을 `doc_id` 재료에서 뺀다.** 기각 — §4. 승인·반려가 뒤섞인 6건이 한 행으로 붕괴한다.
4. **`doc_number` 를 자연키로 쓴다.** 기각 — ADR 0007 §2-1 이 이미 기각했다(수식 파생·공란·중복).
   §3 (나) 재현에서 두 재제출 행의 `문서번호` 를 다르게 두자 `duplicate_doc_number` 경고가 사라진 것이
   이 필드의 신뢰도를 그대로 보여 준다.
5. **드리프트를 감지하면 대장 적재 job 을 실패시킨다.** 기각 — §5-2. 탐지를 끄는 방향으로 운영이 움직인다.
6. **`doc_id` 대신 `(project_id, doc_type, sender_normalized, seq_normalized)` 자연 복합키.** 기각 —
   §4 의 충돌 실측이 그대로 적용되고, 게다가 §4-1 대로 `seq` 가 행번호로 폴백될 수 있다.
7. **버전 접두사 대신 `documents.doc_id_scheme` 컬럼.** 기각 — 컬럼은 `documents` 안에서만 유효하다.
   `doc_id` 는 `activity_document_mappings`·`review_requests.conflicting_sources`·`Evidence.source_id`·
   프론트 URL 로 흘러 나가며, 그 자리에서도 스킴을 알아야 한다. 문자열 자체에 실어야 한다.

## 마이그레이션

**판단: 마이그레이션 코드를 쓰지 않는다. 문서 데이터를 폐기하고 대장을 다시 올린다.**

근거 — 실측:

- 저장소에 DB 파일이 없다(`ls *.db` → 없음, `.gitignore` 처리). 테스트는 매번 임시 SQLite 를 새로 만든다.
- `packages/core/db.init_db` 는 `Base.metadata.create_all` 뿐이라 마이그레이션 도구 자체가 아직 없다.
- 문서 기능은 이번 사이클에 들어온 것이고 아직 운영 현장 대장이 적재된 적이 없다 — 이 ADR 이 존재하는
  이유가 "실데이터 적재 **전**"이다.
- **대장이 정본이다**(ADR 0007 §1 규칙 1). `documents` 는 전부 대장에서 재생성 가능하다.

폐기 대상과 재생성 방법:

| 대상 | 처리 |
|---|---|
| `documents` | 전량 삭제 → 대장 재업로드로 재생성 |
| `activity_document_mappings` | 전량 삭제 → 재업로드가 후보를 다시 만든다. **CM 확정·반려는 복구되지 않는다** |
| `review_requests` 중 `kind in ("document_mapping",)` | 전량 삭제 |

**확정·반려가 복구되지 않는다는 점을 숨기지 않는다.** 오늘 저장소에 그런 행이 있다면 개발 중 만든 것이고,
현장 데이터가 아니다. 만약 이 ADR 을 적용하기 전에 현장 대장이 이미 적재됐다면 이 판단은 **무효**이고
아래 재계산 마이그레이션을 써야 한다.

**나중에 `DOC_ID_SCHEME` 를 올릴 때(그때는 데이터가 있다) 써야 할 마이그레이션의 형태**를 지금 적어 둔다 —
§5 규칙 4가 "값만 올리는 PR 은 반려"라고 말할 때 그 PR 이 무엇을 담아야 하는지가 여기다.
`documents` 가 재료(`doc_type`/`sender_normalized`/`seq_normalized`/`title`)를 원문 그대로 보관하므로
**옛 `doc_id` → 새 `doc_id` 사상은 계산 가능하다.** 그 사상으로 다음 **여섯** 자리를 한 트랜잭션에서
고친다(`grep doc_id` 로 만든 목록이며, 그 기준이 놓칠 수 있는 것은 §4 블라인드 스팟 2에 적었다):

| # | 자리 | 형태 |
|---|---|---|
| 1 | `documents.doc_id` | PK 구성요소 |
| 2 | `activity_document_mappings.doc_id` | PK 구성요소 + 복합 FK `(project_id, doc_id)` |
| 3 | `activity_document_mappings.evidence` → `source_id` | JSON 안의 문자열 (`document_mapper._build_mapping`) |
| 4 | `review_requests.conflicting_sources["doc_id"]` | JSON 안의 문자열 (`document_mapper._document_mapping_review`) |
| 5 | `review_requests.evidence` → `source_id` | 4번 요청이 매핑 evidence 를 그대로 실어 저장한다 |
| 6 | **(개정 1 추가)** `review_requests.conflicting_sources` 의 `moved[].previous_doc_id`/`new_doc_id`, `merged[].doc_id`, `lost_decisions[].doc_id` | `kind="document_identity_drift"` 요청 본문. **JSON 배열 안에 묻힌 자리라 `conflicting_sources["doc_id"]` 만 보는 4번 규칙으로는 잡히지 않는다** — §4 블라인드 스팟 2("다른 키 이름으로 저장하거나 자유형 JSON 안에 묻힌 자리는 놓친다")가 초판 이후에 실제로 실현된 사례다. 다만 이 요청은 **확인 전용 기록**이므로(§5-3) 옛 `doc_id` 를 그대로 두는 선택도 가능하다 — 그때는 "그 시점의 관측"임을 요청 본문이 말해야 한다. 어느 쪽이든 **판단해서 적어야 하고, 목록에서 빠져서는 안 된다** |

재계산되는 값이라 손대지 않는 자리: `ReadinessScore.blockers[].related_ids`(`readiness.py:177,186` — 매 요청
계산), 프론트엔드의 `doc_id` **링크**(응답에서 받는다 — 다만 화면이 응답 JSON 을 **해석**하는 자리는 별개다,
계획 0003 §6 개정 1 정정).

## Deferred

1. **`column_aliases.seq_raw` 의 `"no"`/`"no."` 별칭.** §4-1 대로 행번호 컬럼이 조용히 `seq` 가 되고,
   그러면 `doc_id` 가 대장 행 순서에 매달린다. 고치는 것 자체가 식별 표면 변경이라 §5 규칙 4 절차(스킴 상향 +
   마이그레이션)를 밟아야 하므로, 실제 대장 서식을 한 번 더 본 뒤 별도 사이클에서 다룬다. 그때까지
   §5-2 탐지가 이 경로도 함께 잡는다(고아 ↔ 신규 쌍의 `title` 이 같으므로 드리프트로 분류된다).
2. ~~**`document_possibly_renamed` 메시지 정정.** 지금 문구("제목만 다르고 …")는 드리프트 상황에서 사실과
   다르다. §5-2 가 두 경우를 분리하면서 이 문구는 진짜 rename 에만 붙게 되지만, 문구 자체의 정확도는
   `progress-engine` 이 계획 0003 에서 함께 손본다.~~

   **개정 1 — 이 항목은 Deferred 에서 내린다. 미룬 판단 자체가 틀렸고, 같은 사이클 안에서 재발했다.**
   초판은 "§5-2 가 두 경우를 분리하면 이 문구는 진짜 rename 에만 붙는다"는 근거로 문구 정확도를 뒤로
   미뤘다. 그런데 **그 §5-2 가 만든 새 검토요청 제목이 똑같은 종류의 거짓을 갖고 태어났다**(§5-4:
   고아가 아닌 것을 고아라 하고, 없는 새 `doc_id` 위에서 다시 확정하라 하고, 0건 이동을 보고했다).
   즉 "문구 정확도는 뒤로 미뤄도 된다"는 판단은 **한 사이클도 버티지 못했다.**

   왜 버티지 못하는가: 이 저장소에서 문구는 장식이 아니라 **CM 이 다음 행동을 고르는 유일한 입력**이다.
   "고아가 됐으니 새 doc_id 에서 다시 확정하라"를 읽은 CM 은 `merge_overwritten` 상황에서 **존재하지 않는
   행을 찾다가 결국 아무것도 하지 않는다** — 그동안 미승인 도면 위의 착수 가능은 그대로 서 있다.
   부정확한 문구는 "나중에 다듬을 표현"이 아니라 **작동하지 않는 안전 장치**다.

   그래서 규칙으로 바꾼다(CLAUDE.md §6-4): **사실과 다른 문구는 그것을 만든 사이클이 고친다.** 다음
   사이클로 넘기면 다음 문구가 같은 거짓을 물려받는다. 지금 `document_possibly_renamed` 는 §5-2 (가)가
   제목 원문이 같은 쌍을 걸러 내므로 진짜 rename 에만 붙지만, 문구 자체("제목만 다르고 …")를 이 규칙에
   따라 정정하는 것은 `progress-engine` 의 남은 일이며 **Deferred 가 아니라 미결 항목**이다.
3. **문서 매핑 확정을 사람이 되돌리는 경로.** ADR 0007 §4-2 규칙 6 의 Deferred 가 그대로 남는다 —
   이 ADR 은 "정체성이 흔들려 확정이 무효가 되는" 경로만 다루고, "CM 이 확정을 취소하고 싶다"는 다루지 않는다.
4. **식별 표면 지문의 사람이 읽을 수 있는 diff.** §5-2 는 지문이 달라졌다는 사실까지만 보고한다.
   "어느 키가 어떻게 바뀌었는가"를 보여 주는 것은 운영 편의이지 안전 장치가 아니므로 뒤로 미룬다.
5. **(개정 1) `cause` 값의 정본이 세 곳에 복제돼 있다.** 지금 `orphaned`/`merge_overwritten`/
   `merge_absorbed` 문자열은 `services/ingest/persistence.py`(생산), `services/progress/document_mapper.py`
   (소비·문구), `apps/web/src/domain/identityDrift.ts`(화면)에 각각 상수로 적혀 있다. 값을 `packages/core/
   models/` 로 올려 한 곳에서 정의하는 것이 옳지만, 그것은 세 서비스를 동시에 고치는 변경이라 이 개정의
   범위 밖이다. **그때까지의 방어는 폴백 규칙이다**: 세 소비자 모두 모르는 `cause` 를 `unspecified` 로
   두고 **`orphaned` 로 떨어뜨리지 않는다**(모르는 것을 고아라고 적으면 §5-4 가 고치려는 바로 그 거짓이
   된다). 새 경위를 추가하는 변경은 세 자리를 함께 고쳐야 하며, 그 사실을 여기 적어 둔 것이 지금의
   유일한 강제 장치다.
