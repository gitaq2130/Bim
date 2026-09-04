# 계획 0003 — 문서 정체성 동결과 식별 드리프트 탐지 (ADR 0009)

- 작성: architect
- 날짜: 2026-09-04
- **개정 1: 2026-09-04 — 실행이 잡아낸 이 계획의 오류 9건을 정정.** 이 계획은 이미 실행된 문서이지만
  다음 사이클이 참고 사례로 읽으므로 **틀린 문장을 지우지 않고 정정 블록과 함께 남긴다.** 정정 목록은
  §11. 가장 값진 것은 **§7 V3b 가 왜 blocker 를 못 보게 만들었는가**(양성 케이스에 사람 판단을 걸지 않아
  정답이 `None` 으로 고정됐다)이며, 그것을 포함한 반복 패턴은 CLAUDE.md §6 에 규칙으로 올렸다.
- 근거 ADR: **ADR 0009**(신규, 개정 1 — §5-2 전면 재작성·§5-4 신설), ADR 0007 §2-1 개정 4·§2-3·§4-2 규칙 6·§9
- 선행 상태: 저장소 녹색(pytest 633 / vitest 186 / lint 0). architect 변경분 반영 후에도 pytest 633 녹색.
  (개정 1 시점: pytest 703 녹색.)

---

## 목표

`title_normalized` 하나가 **식별**(`doc_id` 재료)과 **대조**(제목 유사도 매칭) 두 역할을 겸하고 있어,
매칭 튜닝 한 줄이 모든 문서의 정체성을 바꾸고 CM 이 확정·반려한 이력을 조용히 무효화한다.
실데이터(현장 문서관리대장) 적재 **전에** 둘을 분리한다.

성공 기준 한 줄: **`config/document_register.yaml` 의 `title_matching.*` 를 어떻게 바꿔도 `doc_id` 가
한 건도 움직이지 않는다.** 그리고 동결할 수 없는 나머지 식별 표면이 움직였을 때는 **CM 이 알게 된다.**

---

## 재현된 결함 (실측 — 이 계획의 근거)

TestClient 로 `POST /api/review-requests/{id}/resolve` 만 써서 CM 확정·반려를 만든 뒤,
`title_matching.normalize.strip_patterns` 에 `"승인요청"` 한 줄을 더하고 **같은 대장 파일을 재업로드**했다.

```
register job: done result: {"document_count": 10, "created": 6, "updated": 4, "orphaned": 6,
  "mapping_count": 6, "created_review_count": 5, "closed_review_count": 3}
```

```
--- activity_document_mappings (재업로드 후) ---
  act=A100  doc=doc-6a0dd6596625abb1 needs_review=True  reviewed_by=None      decision=None      doc_orphaned=False '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)'
  act=A100  doc=doc-ca45b33c16825a28 needs_review=False reviewed_by=u-cm-56a  decision=None      doc_orphaned=True  '시공상세도 승인요청 - 1F 기둥 배근도 (Z1)'
  act=A400  doc=doc-e2dfc7f22b37f1a9 needs_review=False reviewed_by=u-cm-56a  decision=rejected  doc_orphaned=True  '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)'
  act=A400  doc=doc-fa3357c8c57fd080 needs_review=True  reviewed_by=None      decision=None      doc_orphaned=False '시공상세도 승인요청 - 2F 기둥 배근도 (Z1)'

A100 readiness: 1.0 → 0.9249999999999999   (drawing_approval 1.0 → 0.5)
job status: done / 예외 없음 / GET /startable 200
```

A400 에는 **제목이 글자까지 동일한 문서**가 "CM 이 반려한 것"과 "새로 검토해 달라는 것"으로 동시에 있다.
전체 실측(폭발 반경, 병합 실패 모드, 제목 제거 시 충돌, 식별 표면 전수)은 ADR 0009 §2~§4.

---

## 영향 범위

| 영역 | 무엇이 바뀌나 |
|---|---|
| 데이터 모델 | `Document.title_identity` 신설(파생), `DocumentRow.title_identity`/`identity_fingerprint` 컬럼, `ReviewKind` += `document_identity_drift`, `compute_doc_id()`/`identity_title()`/`DOC_ID_SCHEME` — **architect 완료** |
| `services/progress` | 파서가 자체 해시 계산을 버리고 모델 함수를 부른다. config 로더에 동결 가드 2종. 드리프트 검토요청 생성 함수 |
| `services/ingest` | 재업로드 규칙(§2-2)에 드리프트 판정 추가, `title_identity`/`identity_fingerprint` 저장 |
| `services/api` | 잡 오케스트레이션에 드리프트 검토요청 호출 연결, `DocumentView` 노출, `docs/api.md` 재생성 |
| `config/` | `title_matching.normalize.affects_doc_id: false` 문서화 키, 새 경고 code 등록 |
| `apps/web` | 새 `ReviewKind` 라벨·문구(라벨 표가 `Record<ReviewKind, string>` 이라 누락 시 tsc 실패) |
| `tests/` | §7 검증 시나리오 6개 |
| **바뀌지 않는 것** | `title_normalized` 의 **계산**(한 글자도 안 바뀐다), `document_mapper._normalize_title`/`_build_mapping`(이미 `doc.title` 에서 매번 다시 정규화하므로 이 분리에 영향 없음), 매핑 가중치·임계값, readiness 계산식 |

---

## 1. `doc_id` 재료에 닿는 자리 — 전수 목록

### 1-a. 목록을 만든 기준 (그리고 그 기준이 놓치는 것)

**기준**: `_compute_doc_id(doc_type, sender_normalized, seq_normalized, title_normalized)` 의 **인자 네 개를
각각 뒤로 따라가** 그 값을 만드는 입력을 찾고, **그 입력을 실제로 바꿔 `doc_id` 를 다시 계산**했다.
코드를 읽고 "여기가 맞겠다"고 판단한 자리는 하나도 넣지 않았다 — 전부 실행 결과다.

**이 기준이 놓치는 것**(ADR 0008 계획이 `grep "session.get(...)"` 하나로 전수를 만들었다가 시그니처 변경
호출부와 Celery 잡 안에서 삼켜지는 경로를 통째로 놓친 전례를 되풀이하지 않기 위해 먼저 적는다):

1. **파서 바깥에서 입력이 바뀌는 경로.** 사용자가 엑셀에서 시트명을 바꾸면 config 는 그대로인데
   `doc_type` 이 바뀐다. 이 기준은 config 만 흔들었으므로 그 경로를 직접 보지 못했다(효과는
   `sheet_doc_types` 변경과 동일하므로 폭발 반경만 대리 측정됐다). ~~→ §7 V4 의 음성 대조군이 이 구멍을 덮는다.~~

   > **개정 1 정정 — V4 음성 대조군에 시트명 변경은 없었다.** 이 화살표는 **확인하지 않은 커버리지를
   > 자기 참조로 약속**한 것이다(§11 #9). 실제로 태워 보니 폭발 반경만 같았을 뿐 **관측 가능성이 전혀
   > 달랐다**: `doc_type` 이 함께 바뀌어 옛 행이 고아가 되지 않고(`orphaned=0`, `moved=8`), config 가
   > 안 바뀌어 지문도 그대로다(`fingerprint_changed=False`). 초판 §5-2 는 판정을 "고아"로, 보완 신호를
   > "지문"으로 적었으므로 이 경로에서 **둘 다 침묵한다**. 보강: `test_v4_sheet_rename_is_detected_
   > even_though_nothing_is_orphaned`. **블라인드 스팟은 적는 것으로 끝나지 않고 태워 봐야 한다.**
2. **이미 만들어진 `doc_id` 를 붙들고 있는 자리.** 이 기준은 "누가 만드는가"만 본다. "누가 저장하는가"는
   §1-c 가 `grep doc_id` 로 따로 만들었고, 그 grep 은 **다른 키 이름으로 저장하거나 자유형 JSON 안에
   묻힌 자리를 놓친다.** 지금 저장소에서는 그런 자리를 찾지 못했지만 "없다"고 단정하지 않는다.
3. **미래에 추가되는 재료.** 이 표는 오늘의 네 인자다. ADR 0009 §5 규칙 4(`DOC_ID_SCHEME` 상향 의무)가
   재료를 늘리는 변경이 이 목록을 다시 만들도록 강제한다.
4. **`doc_id` 를 안 바꾸면서 문서 집합을 바꾸는 config**(`skip_sheets`, `required_columns`,
   `blank_row_stop_streak`). 고아를 만들지만 정체성 문제는 아니라 이 표에서 뺐다 — 다만 §5 드리프트
   판정이 "고아 + 같은 제목의 신규"를 볼 때 이들 때문에 생긴 고아는 짝이 없으므로 오탐이 되지 않는다.

### 1-b. 식별 재료와 그 입력 (실측)

| # | 재료 | 만드는 함수 | config 입력 | 실측 폭발 반경(픽스처 10건) | 조치 |
|---|---|---|---|---|---|
| 1 | `title_normalized` → `title_identity` | `_title_normalized` → **`identity_title`** | `title_matching.normalize` | `strip_patterns` +1줄 **6/10**, 괄호 제거 **7/10**, `lowercase:false` **9/10** | **동결**(§2) |
| 2 | `sender_normalized` | `_sender_normalized` + 별칭표 | `normalization.sender_aliases` | 표준명 표기 변경 **7/10**, 새 별칭 추가 **1/10** | 동결 불가 → **탐지**(§5) |
| 3 | `sender_normalized` | 컬럼 선택 | `register_layout.column_aliases.sender` | **10/10** | 동결 불가 → **탐지** |
| 4 | `doc_type` | `_sheet_doc_type` | `register_layout.sheet_doc_types`, `fallback_doc_type` | 별칭 변경 **8/10** | 동결 불가 → **탐지** |
| 5 | `seq_normalized` | `_seq_normalized`(코드 고정) | `register_layout.column_aliases.seq_raw` | 이 픽스처 0/10. **단, `번호` 컬럼이 없는 대장에서는 별칭 `"no"` 가 행번호 컬럼을 잡아 `doc_id` 가 대장 행 순서에 매달린다 — 행 하나 삽입에 8/10 변경** | ADR 0009 §Deferred 1 (이번 사이클 범위 밖). **탐지가 이 경로도 잡는다** |

### 1-c. 만들어진 `doc_id` 를 저장하는 자리 (`grep doc_id` 기준 — §1-a 블라인드 스팟 2 함께 읽을 것)

| # | 자리 | 성질 |
|---|---|---|
| 1 | `documents.doc_id` | PK 구성요소 |
| 2 | `activity_document_mappings.doc_id` | PK 구성요소 + 복합 FK `(project_id, doc_id)` |
| 3 | `activity_document_mappings.evidence` → `source_id` | JSON (`document_mapper._build_mapping:202`) |
| 4 | `review_requests.conflicting_sources["doc_id"]` | JSON (`document_mapper._document_mapping_review:261`) |
| 5 | `review_requests.evidence` → `source_id` | 4번이 매핑 evidence 를 그대로 실어 저장 |
| — | `ReadinessScore.blockers[].related_ids` (`readiness.py:177,186`) | **재계산** — 손댈 것 없음 |
| — | 프론트엔드 링크(`ReviewsPage.tsx`, `SummaryPage.tsx`, `documentBlocker.ts`) | ~~응답에서 받는다 — 손댈 것 없음~~ → **개정 1: 틀렸다.** `doc_id` **링크**는 응답에서 받는 게 맞지만, `conflicting_sources.lost_decisions` 는 화면이 **직접 해석**해야 했다(§3-g 정정) |

이 표는 지금은 쓰이지 않는다(§8 마이그레이션 판단: 폐기·재적재). **나중에 `DOC_ID_SCHEME` 를 올릴 때
써야 할 목록**이라 여기에 남긴다.

---

## 2. 작업 분배

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 (입출력 계약) | 완료 조건 |
|---|---|---|---|---|---|
| 0 | **architect** ✅ | `packages/core/models/document.py`, `orm.py`, `review.py`, `docs/adr/0009-*.md`, `docs/adr/0007-*.md`(개정 4), `docs/glossary.md`, 이 계획 | 재현 결과 | `DOC_ID_SCHEME`/`identity_title()`/`compute_doc_id()`, `Document.title_identity`(파생 검증기), `DocumentRow.title_identity`·`identity_fingerprint`, `ReviewKind` += `document_identity_drift` | **완료.** pytest 633 녹색 |
| 1 | **progress-engine** | `services/progress/importers/document_register.py` | ADR 0009 §2·§5 규칙 1 | §3-a | `_compute_doc_id` 삭제, `hashlib` import 제거, `doc_id`/`title_identity` 는 모델 함수 경유 |
| 2 | **progress-engine** | `services/progress/config_loader.py` | ADR 0009 §2(세 번째 강제 지점) | §3-b | 금지 키 존재 시 `UnsafeConfigOverrideError`, `affects_doc_id` 값 고정 |
| 3 | **progress-engine** | `config/document_register.yaml` | ADR 0009 §2·§5-2 | §3-c | `affects_doc_id: false` + 주석, 경고 code 2종 등록 |
| 4 | **progress-engine** | `services/progress/document_mapper.py` | ADR 0009 §5-2·§5-3 | §3-d | `open_identity_drift_review()` 신설. **`_drop_already_confirmed` 는 손대지 않는다** |
| 5 | **bim-ingest** | `services/ingest/persistence.py` | ADR 0009 §5-2, ADR 0007 §2-2 | §3-e | `title_identity`/`identity_fingerprint` 저장, 드리프트 판정 3분기, `PersistedDocumentImport` 확장 |
| 6 | **api** | `services/api/jobs.py`, `schemas/documents.py`, `docs/api.md` | ADR 0009 §5-2·§5-3 | §3-f | `run_document_register` 가 드리프트를 경고+검토요청으로 내보낸다. **`resolve_review` 에 새 kind 분기를 추가하지 않는다** |
| 7 | **frontend** | `apps/web/src/api/types.ts`, `domain/labels.ts`, `pages/ReviewsPage.tsx` | ADR 0009 §5-3 | §3-g | 새 kind 라벨·해소 문구, vitest·tsc 녹색 |
| 8 | **qa** | `tests/` (§7 목록) | §7 검증 시나리오 | 회귀 그물 | V1~V6 전부, `make test` 녹색 |
| 9 | **reviewer** | — | 전체 diff | 5체크 + §9 추가 체크 | 승인 |

---

## 3. 인터페이스 정의

### 3-a. `services/progress/importers/document_register.py` (progress-engine)

```python
from packages.core.models.document import compute_doc_id   # 추가

# 삭제: _compute_doc_id(...)  — 이 모듈에 해시 계산을 두지 않는다(ADR 0009 §5 규칙 1)
# 삭제: import hashlib

# _build_document 안 (:311, :347 자리)
title_normalized = _title_normalized(title_val, title_normalize_cfg)      # 대조용 — 그대로 둔다
doc_id = compute_doc_id(doc_type, sender_normalized, seq_normalized, title_val)   # 원문 제목을 넘긴다
```

`Document(...)` 생성 시 `title_identity` 는 **넘기지 않는다** — 모델 검증기가 `title` 에서 파생한다.
(넘겨도 무시되지만, 넘기는 코드는 "호출자가 재료를 고를 수 있다"는 오해를 남기므로 쓰지 않는다.)

식별 표면 지문:

```python
def identity_surface_fingerprint(cfg: dict[str, Any]) -> str:
    """ADR 0009 §5-2. doc_id 재료에 관여하는 config 부분집합만 해시한다(§1-b 표 2~5번).
    title_matching.* 는 들어가지 않는다 — 이제 정체성과 무관하기 때문이고, 넣으면 매칭 튜닝이
    드리프트 경고를 발화시켜 경고가 늑대소년이 된다."""
    layout, norm = cfg["register_layout"], cfg.get("normalization", {})
    material = json.dumps({
        "scheme": DOC_ID_SCHEME,
        "sender_aliases": norm.get("sender_aliases", {}),
        "sheet_doc_types": layout.get("sheet_doc_types", {}),
        "fallback_doc_type": layout.get("fallback_doc_type"),
        "column_aliases": {k: layout.get("column_aliases", {}).get(k)
                           for k in ("sender", "seq_raw", "title")},
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
```

> 지문 계산에는 `hashlib` 을 쓴다 — §5 규칙 1이 금지하는 것은 **`doc_id` 해시의 복제**이지 해시 사용 일반이 아니다.

> **개정 1 정정 — 이 절은 자기모순이었다.** 위 코드 블록은 `identity_surface_fingerprint` 를
> `services/progress/importers/document_register.py` 에 두고 `hashlib` 을 쓰라고 지시하는데, 같은 계획의
> §2 완료 조건("`hashlib` import 제거")과 §7 V5.6 소스 불변식("그 파일에 `hashlib` 도 없다")은 그 파일에
> `hashlib` 이 **없을 것**을 요구한다. 둘을 동시에 만족할 수 없다. 해소: 지문 계산은 별도 모듈
> **`services/progress/identity_surface.py`** 로 뺐고, 파서는 그것을 import 만 한다. 완료 조건과 V5.6 은
> 그대로 유효하다. **완료 조건이 지시 본문과 충돌하지 않는지는 계획을 쓸 때 확인해야 한다**(CLAUDE.md §6-3).

`DocumentRegisterImportResult` 에 `identity_fingerprint: str = ""` 필드를 더하고
`import_document_register` 가 채운다. `Document` 모델에는 넣지 않는다(적재 단위 값이지 행 단위 값이 아니다).

### 3-b. `services/progress/config_loader.py` (progress-engine)

```python
def _assert_absent(cfg, source, key_path, why) -> None:
    """`_assert_invariant` 의 짝. **키의 존재 자체**를 막는다(ADR 0009 §2).
    `_assert_invariant` 는 '코드가 읽지 않는 문서화 키가 다른 값으로 바뀌는 것'을 막지만, 여기서 막을 것은
    '동결된 규칙을 config 로 되돌리려는 시도' 자체다 — 어떤 값이든 존재하면 안 된다."""
```

`load_document_register_config()` 에 추가(기존 세 검사는 그대로):

| 검사 | 키 | 요구 | 이유 문구(요지) |
|---|---|---|---|
| `_assert_invariant` | `title_matching.normalize.affects_doc_id` | `False` | ADR 0009 §1 — 이 블록은 대조 전용이고 `doc_id` 를 움직이지 않는다. `true` 로 바꿔도 동작은 안 바뀐다 |
| `_assert_absent` | `title_matching.identity_normalization` | 없어야 함 | 식별 정규화는 `packages/core/models/document.identity_title()` 에 동결. config 로 되돌리는 경로는 없다 |
| `_assert_absent` | `normalization.title_identity` | 없어야 함 | 위와 같음 |

### 3-c. `config/document_register.yaml` (progress-engine)

```yaml
title_matching:
  normalize:
    # ADR 0009 §1: 이 블록은 **대조 전용**이다. doc_id 는 여기 값을 읽지 않는다
    # (packages/core/models/document.identity_title 이 식별용을 동결 소유).
    # 자유롭게 튜닝해도 문서 정체성은 움직이지 않는다 — 실측으로 고정돼 있다(V1).
    affects_doc_id: false        # 코드가 읽지 않는 문서화 키. 다른 값이면 로딩 실패(§9 와 같은 패턴)
    lowercase: true
    ...
import_warnings:
  DOCUMENT_IDENTITY_DRIFT: "대장 원문은 그대로인데 doc_id 가 이동했다 — 식별 규칙(sender_aliases·sheet_doc_types·column_aliases)이 바뀐 것이다. CM 이 확정·반려한 매핑이 걸려 있으면 document_identity_drift 검토요청이 함께 생성된다"
  DOCUMENT_IDENTITY_COLLISION: "서로 다른 대장 행이 같은 doc_id 로 병합됐다 — 뒤 행이 앞 행을 덮어써 한 행만 남는다. 식별 규칙이 지나치게 공격적이다"
```

### 3-d. `services/progress/document_mapper.py` (progress-engine)

```python
def open_identity_drift_review(session: Session, project_id: str,
                               drift: IdentityDriftReport) -> str | None:
    """ADR 0009 §5-2·§5-3. **적재당 최대 1건**. 사람이 잃어버린 판단이 실제로 있을 때만 만든다
    (drift.lost_decisions 가 비어 있으면 None 을 돌려주고 아무것도 만들지 않는다) — 새 협력사 별칭을
    추가한 주마다 CM 큐가 오염되면 운영자는 config 를 되돌리는 대신 탐지를 끈다.

    ReviewRequest(kind="document_identity_drift", assignee_role="cm", activity_id=None,
                  conflicting_sources={"previous_fingerprint": ..., "current_fingerprint": ...,
                                       "moved": [{"previous_doc_id":…, "new_doc_id":…, "title":…}],
                                       "lost_decisions": [{"activity_id":…, "doc_id":…,
                                                           "decision": "confirmed"|"rejected"}]},
                  confidence=1.0,  # 판정이 아니라 관측이다 — 확신도 1.0
                  evidence=Evidence(source_type="document", source_id=<file_id>,
                                    method="identity_drift_detection", ...))
    """
```

> **개정 1 정정 — 이 시그니처로는 위 evidence 를 만들 수 없다.** `Evidence.source_id` 는 공란을 허용하지
> 않는데(ADR 0001 §5) 인자에 `file_id` 가 없다. 해소: **`IdentityDriftReport.file_id`** 필드를 더해
> 판정 쪽(적재)이 채우고, 여기서 `source_id=drift.file_id or project_id` 로 쓴다(호출자가 못 넘겼을 때만
> 프로젝트로 떨어진다 — 근거 없는 요청을 만드느니 덜 정밀한 근거라도 남긴다).
>
> **`conflicting_sources.lost_decisions` 항목에 `cause` 가 빠져 있었다**(위 docstring 은
> `{"activity_id","doc_id","decision"}` 만 적었다). 실제 계약은 `{"activity_id","doc_id","decision","cause"}`
> 이고, 검토요청 제목·경고 문구·프론트 카드가 모두 그 값으로 갈린다(ADR 0009 §5-2 (다)).
>
> **제목은 경위마다 갈라 쓴다.** 이 계획은 제목 형식을 지시하지 않았고, 그래서 첫 구현의 제목이 병합
> 경로에서 세 군데 거짓이었다(ADR 0009 §5-4). 구현: `_identity_drift_review_title` +
> `_identity_drift_clause`.

**이 kind 의 해소에는 부수 효과가 없다.** `services/api/usecases.resolve_review` 에 분기를 **추가하지
않는다** — 공통 폴백이 `status`/`resolution_note`/`resolved_by` 만 기록한다. 매핑을 되살리는 액션을 붙이는
설계는 반려한다(시스템이 사람의 확정을 복원하는 것이라 ADR 0001 불변식과 충돌).

### 3-e. `services/ingest/persistence.py` (bim-ingest)

> **개정 1 정정 — 이 절에 오류가 셋 있었다.** ①`IdentityDriftReport` 의 **위치**(아래 박스),
> ②판정 3번의 **범위**(아래 3번), ③`file_id` 누락(§3-d 정정 참조). 정본은 ADR 0009 §5-2(개정 1)다.
>
> **①`IdentityDriftReport` 는 `services/progress/document_mapper.py` 에 둔다.** 이 계획이 적은
> `services/ingest/persistence.py` 를 그대로 따르면 **순환 의존**이 된다: `services/ingest/persistence.py`
> 는 이미 `services.progress.importers.document_register` 를 import 하고 있고(그리고
> `services.ingest.__init__` 가 IFC/DXF 파서를 끌고 오므로 매핑 모듈이 파서 의존성을 지게 된다),
> 반대 방향을 추가하면 두 서비스가 서로를 import 한다. **소비자(`open_identity_drift_review`)가 타입을
> 소유하고 생산자가 import 하는** 쪽이 기존 방향과 같다(`is_rejected_mapping` 을 ingest 가 import 해
> 쓰는 것과 같은 구조). 아래 §3-e 표를 그대로 읽고 import 하면 안 된다.

```python
class IdentityDriftReport(BaseModel):
    previous_fingerprint: str | None = None
    current_fingerprint: str = ""
    moved: list[dict[str, str]] = []       # {"previous_doc_id", "new_doc_id", "title"} — 제목 원문이 같은 쌍
    merged: list[dict[str, Any]] = []      # {"doc_id", "titles": [...]} — 한 doc_id 로 수렴한 서로 다른 행
    lost_decisions: list[dict[str, str]] = []   # {"activity_id","doc_id","decision"} — 고아가 된 쪽의 사람 판단

class PersistedDocumentImport(BaseModel):   # 기존 필드 유지 + 추가
    identity_drift: IdentityDriftReport | None = None
```

`_apply_document` 에 두 줄 추가: `row.title_identity = d.title_identity`,
`row.identity_fingerprint = <import_result.identity_fingerprint>`.

`persist_document_register_import` 판정 로직(ADR 0009 §5-2 표 그대로):

1. 기존 `rename_index` 를 그대로 쓰되, 짝을 찾았을 때 **`title` 원문을 비교**한다.
   - 다르다 → 지금까지대로 `document_possibly_renamed`(정상 rename).
   - **같다** → `drift.moved` 에 넣고 `DOCUMENT_IDENTITY_DRIFT` 경고. `document_possibly_renamed` 는 **내지 않는다**
     (지금 문구 "제목만 다르고 …"는 이 경우 사실과 다르다 — ADR 0009 §Deferred 2).
2. 같은 적재 안에서 두 개 이상의 파싱 결과가 **같은 `doc_id`** 를 가지면 `drift.merged` +
   `DOCUMENT_IDENTITY_COLLISION` 경고. **덮어쓰기 자체는 지금 동작을 유지한다**(대장이 정본 — 마지막 행이
   이긴다). 다만 더 이상 조용하지 않다.
3. ~~`drift.moved` 의 `previous_doc_id` 에 걸린~~ `ActivityDocumentMappingRow` 중 `reviewed_by is not None` 인
   것을 `lost_decisions` 로 모은다(확정/반려 구분은 `document_mapper.is_rejected_mapping()` 을 쓴다 —
   판정 키 문자열을 이 모듈이 직접 읽지 않는다, ADR 0007 §4-2 규칙 6 ⑥ 불변식).

   > **개정 1 정정 — 이 한 문장이 blocker 를 구조적으로 만들었다.** 범위를 `drift.moved` 의
   > `previous_doc_id` 로 좁혀 적었으므로, 이 문장을 그대로 옮긴 구현에서는 **병합 경로가
   > `lost_decisions` 에 들어갈 방법이 없다.** 병합은 판단을 *없애는* 게 아니라 판단의 **대상**을 바꾸므로
   > 이동 조건에 걸리지 않는다 — `lost_decisions` 는 언제나 비었고, `open_identity_drift_review` 는
   > 언제나 `None` 을 돌려주었으며, ADR 0009 §3 이 "복구 불가"로 분류한 쪽이 **CM 큐에 닿지 못했다.**
   > **구현은 계획대로 했고 계획이 틀렸다.**
   >
   > 올바른 범위는 **경위(`cause`) 셋 전부**다(ADR 0009 §5-2 (다) 표):
   > `orphaned`(=`moved[].previous_doc_id`) / `merge_overwritten`(①충돌 묶음 ②대장 행 지문 변화) /
   > `merge_absorbed`(충돌 묶음 구성원과 제목 원문 일치 + 이번 적재에 없음 + 이미 고아였던 행 제외).
   > 그리고 항목마다 **`cause` 를 실어야 한다** — 이 필드가 없으면 소비자가 셋을 뭉뚱그려 거짓 문구를 쓴다.
   > 구현: `_lost_decisions` / `_merge_overwritten_doc_ids` / `_merge_absorbed_doc_ids`.

4. 이전 지문은 이번 적재에 **없는** 기존 행들의 `identity_fingerprint` 중 가장 흔한 값으로 잡는다
   (첫 적재는 `None`).

   > **개정 1 정정 — 괄호 안의 "→ 드리프트 판정 안 함"이 틀렸다.** 지문은 **판정 조건이 아니라 보고
   > 값**이다(ADR 0009 §5-2). 시트명 변경 경로는 config 를 한 글자도 안 바꿔 지문이 그대로인데도 진짜
   > 드리프트다(실측 `fingerprint_changed=False`, `moved=8`). 첫 적재에서 판정을 안 하는 이유는 지문이
   > `None` 이라서가 아니라 **비교할 기존 행이 없어서**다. 또 병합만 관측된 적재에는 "이번 적재에 없는
   > 기존 행"이 아예 없어 최빈값 표본이 비므로, 구현은 그때 기존 행 전체로 넓힌다 — 보고 값이라 넓혀도
   > 오탐을 만들 수 없다(`_previous_fingerprint`).

### 3-f. `services/api` (api)

`run_document_register` 에 두 줄:

```python
if persisted.identity_drift is not None:
    warnings.append(_warning("DOCUMENT_IDENTITY_DRIFT", str(persisted.identity_drift)))   # ← 개정 1: 이 줄은 틀렸다
    drift_review_id = open_identity_drift_review(session, job.project_id, persisted.identity_drift)
    summary["identity_drift_review_id"] = drift_review_id
```

> **개정 1 정정 — 위 두 줄 중 경고 줄은 오라벨이고 중복이다.**
> ① **오라벨**: 병합만 관측된 적재(`moved=0`, `merged=1`)에도 `DOCUMENT_IDENTITY_DRIFT` 를 붙인다 —
> 그건 `DOCUMENT_IDENTITY_COLLISION` 이다. 두 code 를 나눠 등록해 놓고(§3-c) 라벨은 하나로 붙이면,
> 경고를 읽는 사람이 "이동이 있었다"고 잘못 읽는다.
> ② **중복**: 같은 사건을 `services/ingest/persistence.py` 가 이미 발화했고(§3-c 의 두 code 주석이 발화
> 주체를 그 모듈로 지정한다) 그 경고들은 `persisted.warnings` 를 타고 이미 job 경고가 된다.
> 해소: api 는 경고를 **다시 만들지 않고** 잇기만 한다(CLAUDE.md §3 규칙 11) — 요약 카운트
> (`identity_drift_moved`/`_merged`/`_lost_decisions`/`_review_id`)만 싣는다.

`summary` 에 `identity_drift_moved`/`identity_drift_lost_decisions` 카운트를 넣는다 — **잡 결과 숫자만
보고도 드리프트를 알 수 있어야 한다.** `DocumentView` 에 `identity_fingerprint: str | None = None` 을
`imported_at` 과 같은 방식으로 더한다(`title_identity` 는 `Document` 상속으로 이미 실린다).
`make docs` 로 `docs/api.md` 재생성.

**`run_schedule` 은 손대지 않는다** — 공정표 업로드의 `map_project_documents` 재동기화는 대장을 다시
파싱하지 않으므로 드리프트를 만들 수 없다.

### 3-g. `apps/web` (frontend)

```ts
export type ReviewKind = "mapping" | "verification" | "inspection" | "document_mapping" | "document_identity_drift";
// labels.ts — Record<ReviewKind, string> 이라 누락하면 tsc 가 잡는다
document_identity_drift: "문서 식별 드리프트",
// ReviewsPage.tsx reviewDecisionMessage — 이 kind 는 확인 전용이므로
// "확인 처리됩니다(매핑은 바뀌지 않습니다)" 로 문구를 분리한다. 매핑이 복구된다고 약속하지 않는다.
```

`DocumentView` 에 붙는 `title_identity`/`identity_fingerprint` 는 타입에 optional 로 추가만 하고 화면에는
문서 상세의 접힌 "식별 정보" 영역에만 노출한다(목록·카드에는 넣지 않는다 — 사용자 언어가 아니다).

> **개정 1 정정 — 이 절은 "새 kind 라벨 + 해소 문구"까지만 지시했고, 그 예시 문구를 그대로 따랐으면
> 이번 blocker 를 화면에서 재생산했을 것이다.** 계획은 근거 카드도 경위 구분도 예상하지 않았으므로,
> 화면은 검토요청 `title` 산문 하나만 보여 주게 된다 — 그리고 그 산문은 세 경위를 뭉뚱그린 거짓이었다
> (ADR 0009 §5-4). `merge_overwritten` 상황에서 CM 은 화면상 아무 이상도 보지 못한다: 행이 살아 있고
> 고아 표시도 없고 `reviewed_by` 도 그대로인데, 승인 상태만 다른 대장 행의 것이다.
>
> 실제 필요한 것은 셋이었다: ① `conflicting_sources.lost_decisions` 를 화면이 **직접 해석**해 근거 카드를
> 만든다 ② 카드를 **`cause` 별로** 갈라 문구와 배치 순서를 다르게 준다(위험 순서
> `merge_overwritten` → `merge_absorbed` → `orphaned`) ③ 분류는 서버가 보내는 **기계 판독 값**
> (`cause`)으로 하고 **산문을 부분 문자열로 되읽지 않는다**(이 저장소가 `Blocker.kind` 도입으로 이미
> 걷어낸 패턴이다). 모르는 `cause` 는 `unspecified` 로 두고 **`orphaned` 로 떨어뜨리지 않는다.**
> 구현: `apps/web/src/domain/identityDrift.ts`.

---

## 4. 규칙 (구현 에이전트가 반드시 지킬 것)

1. `doc_id` 를 만드는 코드는 `packages/core/models/document.compute_doc_id()` **하나뿐**이다.
   다른 모듈에서 `sha256` 으로 doc_id 를 만들면 reviewer 가 반려한다.
2. `identity_title()` 은 `config/` 를 읽지 않는다. 인자를 추가해 config 를 넘기는 변경도 금지다.
3. `title_normalized` 의 계산을 바꾸지 않는다. 이번 작업은 **역할 분리**이지 매칭 개선이 아니다.
   (매칭 튜닝은 이 계획이 끝난 **뒤에** 안전하게 할 수 있게 되는 것이 목표다.)
4. `_drop_already_confirmed` 를 손대지 않는다. 이 함수는 옳게 동작하고 있었고, 문제는 그 앞의 `doc_id` 였다.
5. `resolve_review` 에 `document_identity_drift` 분기를 추가하지 않는다(§3-d).
6. `DOC_ID_SCHEME` 값을 이 작업에서 올리지 않는다. 지금은 1 이고, 접두사 도입 자체가 §8 의 한 번뿐인 변경이다.

---

## 5. 이게 일어나면 어떻게 알아채는가

이 프로젝트의 지배적 실패 모드는 "조용히 죽는 것"이고(최근 사이클 8회), 이번 결함은 그 극단이다 —
**예외 없음, 테스트 전부 통과, 화면 정상, 이력만 사라짐.** 그래서 탐지를 세 층으로 둔다.

| 층 | 언제 | 무엇이 알려 주나 | 무엇을 놓치나 |
|---|---|---|---|
| **개발** | PR 시점 | §7 V1 계약 테스트 — 매칭 config 를 흔들었을 때 `doc_id` 집합이 기준과 다르면 실패. V5 소스 불변식 — 파서에 해시 계산이 되살아나면 실패 | V1 의 뮤테이션 목록에 없는 새로운 종류의 튜닝 |
| **로딩** | config 읽는 매 호출 | `_assert_absent`/`_assert_invariant` → `UnsafeConfigOverrideError`. 폭발 반경은 ADR 0007 §9-3 표 그대로(대장 업로드 잡 `failed`, 공정표 업로드는 `DOCUMENT_MAPPING_RESYNC_FAILED` 로 강등) | 동결 대상이 **아닌** 식별 표면(`sender_aliases` 등) 변경 — 그건 정당한 변경이라 막지 않는다 |
| **운영** | 대장 적재 시 | `DOCUMENT_IDENTITY_DRIFT` / `DOCUMENT_IDENTITY_COLLISION` 경고 + 잡 요약의 `identity_drift_*` 카운트 + **CM 검토 큐의 `document_identity_drift` 요청**(사람의 판단이 실제로 걸려 있을 때만) | 아래 |

**운영 탐지가 놓치는 것 — 숨기지 않고 적는다.**

1. **첫 적재.** 비교할 이전 지문·이전 문서가 없다. 프로젝트를 새로 만들어 대장을 처음 올리는 경로는
   드리프트를 판정할 수 없다(판정하지 않는 것이 옳다).
2. **드리프트와 진짜 제목 수정이 같은 주에 같은 문서에 겹치는 경우.** `title` 원문이 달라지므로
   `document_possibly_renamed` 로 분류되고 드리프트로 잡히지 않는다. 이 경우 CM 은 rename 경고를 통해
   같은 문서를 보게 되지만 **원인은 알 수 없다** — 지문 변화가 함께 보고되는 것이 유일한 단서다.
3. **사람의 판단이 하나도 없는 프로젝트.** 설계상 검토요청을 만들지 않는다(경고만). 아직 CM 이 아무것도
   확정하지 않은 프로젝트에서는 드리프트가 큐에 뜨지 않는다 — 잃을 것이 없기 때문이지만,
   "그래서 아무 일도 없었다"고 읽으면 안 된다. 다음 확정부터는 새 `doc_id` 위에서 이뤄진다.
4. **경고를 아무도 읽지 않는 경우.** 경고는 잡 응답에만 실린다. 그래서 §5-2 가 사람의 판단이 걸린
   경우를 **큐로** 올린다 — 8차 리뷰가 "만들어지지 않는 검토요청" 때문에 실패했던 것의 반대편 대비다.

> **개정 1 — 이 표에 다섯 번째 항목이 있었어야 했다: 운영 층이 놓치는 것 중 가장 큰 것은 병합이었다.**
> 초판 §5-2 가 병합을 **경고까지만** 배정했으므로, 운영 층의 "CM 검토 큐" 칸은 `orphaned` 경위에만
> 참이었다. 위 4번이 "경고는 아무도 읽지 않는다"고 정확히 진단해 놓고, 정작 **되돌릴 수 없는 쪽**을
> 그 아무도 안 읽는 경고에 남겨 둔 것이다. 지금은 세 경위 모두 큐에 오른다(ADR 0009 §5-2 (마)).
> 3번 항목도 개정 1에서 좁아진다 — "사람의 판단이 없는 프로젝트"는 **여전히 큐를 만들지 않는 것이
> 옳지만**(큐 오염 방지), 그것을 **양성 검증 시나리오의 조건으로 쓰면 안 된다**(§7 V3 개정 1).

---

## 6. 손대지 않는 것 (확인만 — 오해로 고치지 말 것)

| 자리 | 왜 그대로인가 |
|---|---|
| `document_mapper._normalize_title` / `_build_mapping` | 이미 `doc.title` 에서 **매번 다시** 정규화하고 저장된 `title_normalized` 를 읽지 않는다. 대조 경로는 이 분리에 무영향 |
| `document_mapper._activity_signature` 주석 | "doc_id 가 title/sender/seq 해시라 그 셋이 바뀌면 고아 처리가 이미 맡는다"는 설명은 여전히 옳다 |
| `_drop_already_confirmed` | 확정·반려 공통 필터로 옳게 동작한다(ADR 0007 §4-2 규칙 6). 이번 결함은 그 앞단 |
| `readiness.drawing_component` / `confirmed_required_documents` | 논리곱·고아 제외·반려 제외 전부 옳다 |
| `_seq_normalized` (숫자만) | ADR 0007 §2-3 + 기존 `seq_digits_only` 불변식 그대로 |

---

## 7. 검증 시나리오 (qa) — 그리고 각 시나리오가 정말 결함을 잡는지에 대한 반증

> ADR 0008 계획의 S4 는 같은 파일을 양쪽에 올려 누수가 나도 점수가 산술적으로 동일해 **결함이 있는데도
> 통과**했다. 아래 각 시나리오에 **"이 단언은 결함이 있어도 통과한다"** 목록을 함께 적는다.

> **개정 1 — 그 반증 목록을 붙이고도 레시피가 다섯 군데 틀렸다.** "반증을 적는다"는 습관 자체는 옳았고
> 실제로 여러 가짜 초록을 막았지만, **반증 목록도 실행으로 확인해야 한다.** 아래 다섯은 전부 실행으로
> 잡혔다(V3b 는 별도로 아래 V3 절에 크게 적는다 — 이 사이클 최대의 교훈이다).
>
> | # | 자리 | 무엇이 틀렸나 |
> |---|---|---|
> | 1 | **V1 자기검증** | "`compute_doc_id` 의 마지막 인자를 임시로 `title_normalized` 로 바꿔 **세 뮤테이션에서 실패**하는 것을 확인하라"고 적었다. `lowercase:false` 는 그렇게 해도 **0/10** 이다 — 넘긴 문자열에 `compute_doc_id` 가 다시 `identity_title()`(casefold 포함)을 적용해 대소문자 차이를 지우기 때문이다(실측: `승인요청` 2/3, 괄호 3/3, `lowercase:false` **0/3**). 결함 재현 방법이 결함의 **일부만** 재현한다. 자기검증에 쓸 뮤테이션은 `승인요청`·괄호 둘이다 |
> | 2 | **V2 반증 목록의 `mapping_count == 6`** | "결함 상태에서도 6"까지는 맞지만 **정상 코드에서는 4**다(사람이 판단한 2건을 `_drop_already_confirmed` 가 뺀다). 이 값을 단언하면 **고쳐진 코드에서 오히려 실패**한다. 반증 목록에 적힌 숫자가 그 자체로 틀릴 수 있다 |
> | 3 | **V3 (a)** | 동결 **이후** `strip_patterns += r"\d+\s*차"` 는 `doc_id` 를 못 움직이므로(실측 0/10) 이 시나리오에서는 **충돌이 생길 수 없다.** (a)는 "탐지가 동작한다"를 전혀 보지 못한다 — 계획 스스로 반증 문단에서 이 점을 적어 놓고도 (b)를 "추가"가 아니라 **대체**로 세우지 않았다 |
> | 4 | **V4 의 시트명 케이스 누락** | §1-a 블라인드 스팟 1이 "→ §7 V4 의 음성 대조군이 이 구멍을 덮는다"고 적었는데, **V4 음성 대조군(N1 삭제·N2 제목 수정·N3 판단 없음) 어디에도 시트명 변경이 없다.** 계획이 **있지도 않은 커버리지를 자기 참조로 약속**했다. 실제로 이 경로는 `orphaned=0`·`fingerprint_changed=False` 라 초판 §5-2 규칙으로는 전부 침묵한다 |
> | 5 | **V5 저장 검증 누락** | V5 는 동결(모델 검증기·config 가드·소스 불변식)만 본다. `title_identity`/`identity_fingerprint` 가 **실제로 DB 행에 채워지는지**를 아무도 보지 않는다 — 두 컬럼을 추가한 것이 §3-e 의 핵심 산출물인데도 그렇다. 비면 드리프트 판정의 좌변(이전 지문)이 통째로 죽는다. 보강: `tests/unit/ingest/test_document_identity_persistence.py` |
>
> 공통 원인은 하나다: **반증 목록을 "생각으로" 만들었다.** V1·V2 항목은 숫자를 실측 없이 적었고, V4 는
> 다른 절을 가리키는 것으로 확인을 갈음했다. 전수 목록과 마찬가지로 **반증 목록도 그 생성 기준이
> 곧 한계다**(CLAUDE.md §6-1).

### V1 — 계약: 매칭 튜닝은 `doc_id` 를 한 건도 움직이지 않는다 (단위)
`tests/unit/progress/test_document_identity_freeze.py`

기준 config 로 픽스처를 파싱해 `doc_id` 목록을 기록하고, 아래 **8가지 매칭 뮤테이션** 각각에 대해
파싱을 반복해 `doc_id` **목록이 순서까지 동일**함을 단언한다.

`strip_patterns += "승인요청"` / `strip_patterns += r"\d+\s*차"` / `strip_chars` 에서 괄호 제거 /
`lowercase: false` / `min_similarity` 0.22→0.30 / `seq_weight`·`token_weight` 재조정 /
`discriminative_tokens` 추가 / `mapping_weights` 재조정.

**반증 — 결함이 있어도 통과하는 단언(쓰지 말 것):**
- `len(set(doc_ids)) == 10`(유일성) — 결함 상태에서도 10/10 유일이다. **측정됨.**
- `len(docs) == 10`(건수) — 결함 상태에서도 10.
- `min_similarity` 뮤테이션 **하나만** 쓰는 것 — 결함 코드에서도 0/10 이라 무조건 통과한다. **측정됨.**
  → 그래서 목록에 **결함 코드에서 6/10 이상 움직이는 뮤테이션이 최소 3개**(`승인요청`·괄호·`lowercase`)
  들어가야 하고, 테스트 주석에 그 실측치를 적어 둔다.
- **자기검증**: 이 테스트가 진짜 잡는지 확인하려면 `compute_doc_id` 의 마지막 인자를 임시로
  `title_normalized` 로 바꿔 보고 세 뮤테이션에서 실패하는 것을 확인한 뒤 되돌린다(qa 가 손으로 1회).

### V2 — E2E: 확정·반려가 매칭 튜닝을 견딘다 (통합)
`tests/integration/test_17_document_identity_drift.py`

§재현 절차 그대로: 공정표 → 대장 → **검토 큐 경로로만** A100 확정·A400 반려 → 매칭 config 뮤테이션 →
같은 대장 재업로드. 단언:

1. `job["result"]["orphaned"] == 0`
2. A100 매핑은 여전히 정확히 1건, `needs_review=False`, `reviewed_by` 유지, 문서 `is_orphaned=False`
3. A400 매핑은 정확히 1건, `mapping_review_decision == "rejected"`, **A400 에 열린 검토요청이 없다**
4. `GET /activities/A100/readiness` 의 `components.drawing_approval == 1.0`, `score` 가 뮤테이션 전과 동일
5. `title_normalized` 는 **바뀌어 있다**(대조 정규화는 실제로 적용됐다 — 뮤테이션이 no-op 이 아님을 증명)

**반증 — 결함이 있어도 통과하는 단언(측정으로 확인함):**
- `job["status"] == "done"` — 결함 상태에서도 `done`.
- `job["result"]["mapping_count"] == 6` — 결함 상태에서도 **6**. 새 doc_id 로 6건이 다시 만들어지기 때문.
- `len(documents(include_orphaned=False)) == 10` — 결함 상태에서도 10.
- `GET /startable` 200 — 결함 상태에서도 200.
- 5번을 빼면 **뮤테이션이 아무 일도 안 해도 전부 통과**한다(가짜 초록). 5번이 그 반증을 막는다.

### V3 — 병합(공격적 실패) 탐지 (통합)
같은 파일. 같은 `번호` 아래 `1차`(반려)/`2차`(승인) 두 행이 있는 대장을 만들고
(a) `strip_patterns += r"\d+\s*차"` 뮤테이션 후에도 `doc_id` 가 11건 그대로 유일함,
(b) **강제 충돌**(두 행의 `제목`·`발신`·`번호`·시트를 전부 동일하게 만든 대장)에서
`DOCUMENT_IDENTITY_COLLISION` 경고가 뜨고 `identity_drift.merged` 가 비어 있지 않음을 단언한다.

**반증:** (a)만 두면 픽스처가 애초에 충돌하지 않으므로 **탐지 코드가 없어도 통과**한다. (b)가 반드시 필요하다.
또 (b)에서 `duplicate_doc_number` 경고에 기대면 안 된다 — 두 행의 `문서번호` 를 다르게 두면 그 경고는
뜨지 않는데도 병합은 일어난다(**측정됨**). 단언은 새 경고 code 로 건다.

> ### 개정 1 — **V3b 가 blocker 를 못 보게 만들었다. 이 사이클에서 가장 값진 교훈이다.**
>
> V3b 는 병합을 **탐지**한다. 그런데 충돌 케이스를 **"사람 판단이 없는 프로젝트"** 로 세웠다 — 강제 충돌
> 픽스처를 올리기만 하고 그 문서에 CM 확정·반려를 걸지 않았다. 그 결과:
>
> - `lost_decisions` 는 **정의상 언제나 비어 있다**(사람 판단이 없으므로).
> - 따라서 `identity_drift_review_id is None` 이 **정답으로 고정**됐다.
> - 그런데 그것은 §3-e 3(범위를 `moved` 로 좁힌 오류) 아래에서도 **똑같이 `None`** 이다.
>
> **결함 있는 코드와 옳은 코드가 이 시나리오에서 구별 불가능하다.** V3b 는 초록이었고, 초록인 채로
> "병합은 절대로 CM 큐에 올라가지 않는다"는 구멍을 덮고 있었다. 이 blocker 가 사이클 끝까지 살아남은
> 이유가 정확히 이것이다.
>
> **음성 대조군도 같은 병으로 기울어 있었다.** N1(진짜 삭제)·N2(진짜 제목 수정)·N3(판단 없는 드리프트)는
> 전부 ***moved* 쪽** 것이고 **병합 쪽 대조군은 한 건도 없다.** 그래서 "병합에는 아무 판정도 하지 않는다"는
> 구현이 양성에서도(V3b) 음성에서도 통과한다. 대조군이 한쪽 축에만 몰려 있으면 그 축만 검증된다.
>
> **일반화한 규칙**(CLAUDE.md §6-2): **양성 케이스는 "그 결함이 있으면 값이 달라지는" 상태로 세워야 한다.**
> "탐지가 발화하는가"를 물었으면 발화의 **결과**(여기서는 큐 등재)까지 값이 갈리도록 세운다. 판정 결과가
> 결함 유무와 무관하게 같은 값(`None`·0·빈 목록)으로 고정되는 시나리오는 **검증이 아니라 장식**이다.
> 시나리오를 쓸 때 스스로에게 물을 것: **"이 단언의 기대값을 결함 있는 코드가 그대로 만족하는가?"**
>
> **V5 가 이 구멍을 메운다**(qa 가 추가, `tests/integration/test_17_document_identity_drift.py`):
> 양성 2건은 사람 판단을 **병합의 양쪽 끝**에 각각 건다 — ①확정이 **살아남는 행**에 있고 병합이 그 행을
> 덮어쓴다(`merge_overwritten`) ②확정이 **삼켜지는 행**에 있다(`merge_absorbed`). ①은
> `drawing_approval` 0.0 → 1.0 뒤집힘과 CM 큐 등재를 **함께** 단언한다(하나만 고정하면 다른 하나가
> 사라져도 초록이다). 음성 3건은 병합 축에 세운다 — 충돌 없는 정상 결과 갱신, 충돌 묶음 **밖**의 결과
> 갱신, 병합 후 같은 config 재업로드(사건이 일어난 적재에서 한 번만 발화).

### V4 — 식별 표면 드리프트 탐지 + 음성 대조군 (통합)
같은 파일. A100 확정 상태에서 `normalization.sender_aliases` 의 표준명 표기를 바꾸고 재업로드.

1. `DOCUMENT_IDENTITY_DRIFT` 경고가 뜬다
2. `kind="document_identity_drift"` 검토요청이 **정확히 1건** 생기고 `conflicting_sources.lost_decisions`
   에 A100 확정이 들어 있다
3. 그 요청을 `resolve` 하면 `status="approved"` 로 닫히고 **매핑 행은 하나도 바뀌지 않는다**(§3-d)

**음성 대조군(같은 테스트에 반드시 포함):**
- (N1) 대장에서 문서 한 건을 **진짜로 지우고** 재업로드 → 고아는 생기지만 드리프트 경고는 **뜨지 않는다**
- (N2) 문서 제목을 **진짜로 고쳐** 재업로드 → `document_possibly_renamed` 만 뜨고 드리프트는 **뜨지 않는다**
- (N3) 사람의 판단이 하나도 없는 프로젝트에서 같은 뮤테이션 → 경고는 뜨지만 **검토요청은 안 생긴다**

**반증:** N1·N2 가 없으면 "고아가 생기면 드리프트"라는 잘못된 구현이 그대로 통과한다. N3 가 없으면
"항상 검토요청을 만든다"는 구현이 통과하고, 그러면 새 협력사를 추가한 주마다 큐가 오염되는 설계를
테스트가 승인해 버린다.

### V5 — 동결의 강제 (단위 + 불변식)
`tests/unit/progress/test_document_identity_freeze.py`, `tests/invariants/`

1. `Document(title="  A  B ", title_identity="LIES")` → `title_identity == "a b"` (호출자 값 무시)
2. `identity_title` 이 표기 변형에 불변: 전각 괄호·전각 영문·NBSP·중복 공백·앞뒤 공백·대소문자
3. `identity_title` 이 **내용 편집에는 변한다**: 하이픈 제거·괄호 제거 → 다른 값
   (이것이 없으면 "무조건 같은 값을 뱉는" 구현도 1·2를 통과한다)
4. `title_matching.identity_normalization` 키가 있는 config → `UnsafeConfigOverrideError`
5. `title_matching.normalize.affects_doc_id: true` → `UnsafeConfigOverrideError`
6. 소스 불변식: `services/progress/importers/document_register.py` 에 `_compute_doc_id` 도 `hashlib` 도
   없고, `compute_doc_id` 를 import 한다

**반증:** 6번은 문자열 검사라 우회가 쉽다(`import hashlib as h`). 그래도 두는 이유는 **되살아나는 사고를
막는 것이 목적이지 악의를 막는 것이 아니기** 때문이다 — 한계를 테스트 주석에 적는다. 진짜 방어는 V1 이다.

### V6 — 스킴 버전이 실제로 참여한다 (단위)
1. 모든 `doc_id` 가 `f"doc-v{DOC_ID_SCHEME}-"` 로 시작한다(리터럴 `"doc-v1-"` 로 쓰지 말 것 — 2번과 함께
   봐야 의미가 있다)
2. `DOC_ID_SCHEME` 를 monkeypatch 로 2로 바꾸면 같은 입력의 `doc_id` 가 **전부** 달라진다

**반증:** 1번만, 그것도 리터럴 `"doc-v1-"` 로 두면 **`compute_doc_id` 가 상수를 읽지 않고 `"doc-v1-"` 를
하드코딩한 구현이 그대로 통과한다** — 그러면 나중에 `DOC_ID_SCHEME` 를 올려도 `doc_id` 가 안 바뀌어
ADR 0009 §5 규칙 5(스킴 상향으로 재적재를 구분한다)가 무력해진다. 2번이 그것을 막는다.
`DOC_ID_SCHEME` 가 해시 **재료**가 아니라 접두사에만 들어가는 것은 의도한 설계다 — 접두사만으로도
`doc_id` 는 달라지고, 값이 문자열 표면에 보이는 편이 마이그레이션 조회(`WHERE doc_id NOT LIKE 'doc-v2-%'`)에
유리하다. 따라서 2번의 단언은 "재료에 들어갔는가"가 아니라 **"상수를 읽는가"** 를 잡는 것이다.

### 측정치 갱신
`tests/metrics.json` 의 `document_mapping_*` 기준치는 **바뀌지 않아야 한다** — 이 작업은 매칭 정확도를
건드리지 않는다. 값이 움직였다면 §4 규칙 3을 어긴 것이므로 원인을 찾아 되돌린다.

---

## 8. 마이그레이션 판단

**판단: 마이그레이션 코드를 쓰지 않는다. 문서 데이터를 폐기하고 대장을 다시 올린다.** (ADR 0009 §마이그레이션)

실측 근거: 저장소에 DB 파일이 없고(`ls *.db` → 없음), `init_db` 는 `create_all` 뿐이라 마이그레이션 도구가
아직 없으며, 문서 기능은 이번 사이클에 들어와 운영 대장이 적재된 적이 없다. **대장이 정본이므로**
`documents` 는 전부 재생성 가능하다.

- 폐기: `documents`, `activity_document_mappings`, `review_requests` 중 `kind="document_mapping"`
- 재생성: 대장 재업로드
- **복구되지 않는 것: CM 확정·반려.** 개발 중 만든 것이므로 감수한다. 이 계획을 적용하기 전에 현장 대장이
  이미 적재됐다면 이 판단은 무효이고 ADR 0009 §마이그레이션의 재계산 절차(§1-c 표 5자리)를 써야 한다.

**개발 환경 주의**: 기존 SQLite 파일이 로컬에 남아 있으면 `create_all` 이 새 컬럼(`title_identity`,
`identity_fingerprint`)을 추가하지 **않는다** — 그 파일은 지우고 다시 만든다. qa 가 `make dev` 안내에 반영.

---

## 9. reviewer 추가 체크 (기존 5체크에 더해)

1. `doc_id` 를 만드는 코드가 `compute_doc_id()` 밖에 새로 생기지 않았는가
2. `identity_title()` 이 config·환경변수·인자로 주입되는 값을 읽지 않는가
3. `title_normalized` 의 **계산**이 바뀌지 않았는가(역할만 바뀌어야 한다)
4. `resolve_review` 에 `document_identity_drift` 분기가 추가되지 않았는가(확인 전용이어야 한다)
5. `DOC_ID_SCHEME` 가 올라갔다면 §1-c 5자리를 고치는 마이그레이션이 같은 변경에 들어 있는가
6. V1 의 뮤테이션 목록에 **결함 코드에서 6/10 이상 움직이는 것이 3개 이상** 들어 있는가

---

## 10. 열린 질문 / 리스크

1. **`seq` 별칭 `"no"` 폴백**(ADR 0009 §Deferred 1). 오늘 `doc_id` 가 대장 행 순서에 매달릴 수 있다.
   고치는 것 자체가 식별 표면 변경이라 스킴 상향이 필요해 이번 범위 밖. 그때까지 드리프트 탐지가 덮는다.
2. **지문의 "이전 값"을 고르는 규칙**(§3-e 4). "이번 적재에 없는 기존 행들의 최빈 지문"은 근사다.
   프로젝트에 지문이 셋 이상 섞이면 부정확할 수 있다 — 실데이터에서 다시 본다.
3. **드리프트 검토요청의 중복 방지.** 같은 config 로 매주 재업로드하면 두 번째 주부터는 지문이 같아
   드리프트가 아니므로 자연히 1회로 끝난다. 다만 config 를 되돌렸다 다시 바꾸는 왕복에서는 두 번 뜬다 —
   의도한 동작이다(두 번 다 진짜 사건이다).
4. **`document_possibly_renamed` 문구 정정**(ADR 0009 §Deferred 2)은 §3-e 1의 분기로 자연히 좁아지지만,
   문구 자체("제목만 다르고 …")는 progress-engine 이 이 작업에서 함께 다듬는다.
   > **개정 1**: ADR 0009 §Deferred 2 는 이 항목을 Deferred 에서 내렸다 — "문구 정확도는 뒤로 미뤄도
   > 된다"는 판단이 **같은 사이클 안에서** 재발했기 때문이다(§5-2 가 만든 새 검토요청 제목이 똑같은
   > 종류의 거짓을 갖고 태어났다). 규칙은 CLAUDE.md §6-4.
5. **실데이터 적재 후 첫 매칭 보정.** 이 계획이 끝나야 `min_similarity` 재측정이 안전해진다.
   그 작업은 별도 사이클이고, 이 계획의 V1 이 그 작업의 안전망이다.

---

## 11. 개정 1 — 실행이 잡아낸 이 계획의 오류 (전수)

이 계획은 이미 실행됐다. 이 절은 되돌리기 위한 것이 아니라 **다음 사이클이 참고 사례로 읽기 위한** 것이다.
아홉 건 전부 하류(구현·qa)가 **실행으로** 잡았고, 그중 하나(#1)는 사이클 막바지 blocker 의 직접 원인이다.

| # | 자리 | 오류 | 정정 |
|---|---|---|---|
| 1 | §3-e 3 | `lost_decisions` 범위를 `drift.moved` 의 `previous_doc_id` 로 좁혔다 — 이 문장대로면 **병합 경로가 구조적으로 큐에 닿을 수 없다** | 경위 셋 전부 + 항목마다 `cause`(ADR 0009 §5-2 (다)) |
| 2 | §7 V3b | 충돌 케이스에 **사람 판단을 걸지 않아** `identity_drift_review_id is None` 이 정답으로 고정 — 결함 코드와 옳은 코드가 구별 불가 | V5 양성 2 + 병합 축 음성 3(§7 V3 개정 1) |
| 3 | §3-e 표 | `IdentityDriftReport` 위치를 `services/ingest` 로 적었다 — 그대로 import 하면 **순환 의존** | `services/progress/document_mapper.py`(소비자 소유) |
| 4 | §3-g | "새 kind 라벨 + 해소 문구"까지만 지시 — 근거 카드도 경위 구분도 예상하지 않았다. 예시 문구대로 갔으면 **blocker 를 화면에서 재생산** | `lost_decisions` 를 화면이 직접 해석 + `cause` 별 카드(§3-g 개정 1) |
| 5 | §6·§1-c | "프론트엔드 링크 — 응답에서 받는다, 손댈 것 없음" | 링크는 맞지만 **`lost_decisions` 해석**은 화면 몫이었다 |
| 6 | §3-a | **자기모순** — 지문 계산을 파서에 두고 `hashlib` 을 쓰라면서, §2 완료 조건·§7 V5.6 은 그 파일에 `hashlib` 이 없을 것을 요구 | `services/progress/identity_surface.py` 분리 |
| 7 | §3-d | 시그니처에 `file_id` 가 없는데 `Evidence.source_id` 는 공란 불가 | `IdentityDriftReport.file_id` 추가 |
| 8 | §3-f | api 두 줄이 **오라벨**(병합만 관측된 적재에도 DRIFT) + 중복 발화 | api 는 잇기만 하고 요약 카운트만 싣는다 |
| 9 | §7 레시피 5건 | V1 자기검증·V2 `mapping_count`·V3(a)·V4 시트명 커버리지 자기 참조·V5 저장 검증 | §7 개정 1 표 |

**이 목록에서 뽑아 낼 것.** 개별 오류보다 모양이 중요하다. #1·#4 는 **조건을 좁게 적어** 가장 위험한
변종을 밖으로 밀어낸 것이고, #2·#9 는 **검증이 결함을 못 잡도록** 세워진 것이며, #5·#9-4 는 **확인하지
않은 커버리지를 문서가 스스로 약속**한 것이다. 셋 다 최근 세 사이클(0007·0008·0009)에서 반복됐다 —
그래서 이 계획 안에 묻지 않고 **CLAUDE.md §6** 에 규칙으로 올렸다.

---

## 12. 개정 2 — 병합 판정을 **행-정체 / 행-내용** 분리로 다시 세운다 (ADR 0009 개정 2)

### 12-a. 왜 (요약 — 전모는 ADR 0009 §5-5)

개정 1 이 병합을 "**한 적재 안에서** 두 개 이상의 대장 행이 같은 `doc_id` 로 수렴"이라고 적었고, 그
한정어가 구현의 조건 ①(충돌 묶음)이 됐다. 사명 변경 주의 정상 운영(별칭표 통합 한 줄 + 대장에서 옛
법인명 행이 빠짐)은 두 행을 **한 적재에 함께 두지 않으므로** 조건 ①이 거짓이고, 그래서
`drawing_approval` 0.0 → 1.0(미승인 도면 위 착수 가능)이 **경고 0건·검토요청 0건**으로 지나간다.
`a8c89bb` 가 고친 blocker 와 데이터 모양·결과가 같다. 대칭 짝(판단이 사라지는 쪽)도 같다.

같은 조건절에 딸린 오탐 둘(상시 충돌 안의 정상 갱신 / 문서번호 열 없는 현장의 "제목만 같으면 통과")도
이 변경이 함께 없앤다. **네 사실 모두 실행으로 확인했다** — ADR 0009 §5-2 (바) 표가 개정 1 코드와 개정 2
조건의 결과를 나란히 싣는다.

### 12-b. 작업 분배

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 (입출력 계약) | 완료 조건 |
|---|---|---|---|---|---|
| 0 | **architect** ✅ | `docs/adr/0009-*.md`(개정 2), `CLAUDE.md` §6-3, 이 절 | 리뷰어 REJECT + 재현 | ADR 0009 §5-2 (나)~(사), §5-5 | **완료.** 재현·역방향 확인 전부 실행(§12-e), `pytest tests -q` 703 녹색 유지 |
| 1 | **bim-ingest** | `services/ingest/persistence.py` | ADR 0009 §5-2 (나)·(다)·(라)·(마)·(사) | §12-c | 아래 6개 완료 조건 |
| 2 | **bim-ingest** | `config/document_register.yaml` | ADR 0009 §5-2 (사), §5-3 | 경고 문구 2종 정정 | `DOCUMENT_IDENTITY_DRIFT` 문구가 "이동"을 전제하지 않는다. 두 문구의 `cause` 이름이 새 값이다 |
| 3 | **progress-engine** | `services/progress/document_mapper.py` | ADR 0009 §5-2 (마), §5-3 | §12-d | `_CAUSE_*` 새 값, `IdentityDriftReport.lost_decisions` 항목 계약 확장, 문구 3종 재작성 |
| 4 | **api** | `services/api/jobs.py`, `docs/api.md` | ADR 0009 §5-2 (사) | 변경 최소 — 요약 카운트 3종 유지 | **`resolve_review` 에 분기를 추가하지 않는다**(§5-3 불변). `docs/api.md` 재생성 |
| 5 | **frontend** | `apps/web/src/api/types.ts`, `domain/identityDrift.ts`, `pages/ReviewsPage.tsx` | ADR 0009 §5-2 (마), §5-3 | §12-d 의 타입 그대로 | `IdentityDriftCause` 새 값 3종, 카드가 `new_doc_id`/`changed_fields`/`approval_flipped` 를 쓴다. 모르는 `cause` 는 `unspecified` — **`row_moved` 로 떨어뜨리지 않는다** |
| 6 | **qa** | `tests/integration/test_17_document_identity_drift.py`, `tests/unit/ingest/test_document_identity_persistence.py` | §12-e | 회귀 그물 확장 | §12-e 의 R1·R2·P11·P9·P4·P5·P13 이 테스트로 남는다 + 블라인드 스팟 1건 실측 |
| 7 | **reviewer** | — | 전체 diff | §9 + §12-f | 승인 |

### 12-c. `services/ingest/persistence.py` (bim-ingest)

```python
def _row_identity(row: DocumentRow) -> tuple[str | None, ...]:
    """이 `doc_id` 가 대장의 **어느 행**을 담고 있는가(대장 원문)."""
    return (row.sender, row.doc_number, row.seq_raw, row.title)

def _row_content(row: DocumentRow) -> tuple[str | None, ...]:
    """그 행이 지금 **무엇이라고 말하는가**."""
    return (row.result_raw, row.approval_status)
```

`_register_row_signature` 는 삭제한다(여섯 필드를 한 덩어리로 쓴 것이 개정 1 오류의 원인이다).

1. **(나) `replaced`** — 이번 적재에 나타난 기존 `doc_id` 중 **(i)** 적재 전후로 `_row_identity` 가 다른
   것, **또는 (ii)** `absorbed_into` 의 **값**에 있으면서(= 다른 `doc_id` 를 흡수했다) `_row_content` 가
   다른 것. **`_collision_groups` 를 조건으로 쓰지 않는다.** (ii)를 빼면 ADR 0009 §5-2 (바) P13 이
   침묵한다(개정 1 이 잡던 경로다 — 반드시 합집합).
2. **(다) `absorbed`** — 이번 적재에 나타나지 않은 기존 행 중, 그 행의 `_row_identity` 가 이번 적재의
   **다른** `doc_id` 아래에 그대로 있는 것. `_doc_number_compatible` 도 제목 비교도 쓰지 않는다(행-정체
   전체 일치). 기존 가드 둘은 유지: (가)가 이미 짝지은 행 제외, 이미 고아였던 행 제외.
   반환은 `{옛 doc_id: 지금 그 행을 담고 있는 doc_id}` — (나-ii)와 `new_doc_id` 가 이 값을 쓴다.
3. **`merged`(충돌 묶음)는 남긴다.** `DOCUMENT_IDENTITY_COLLISION` 경고와 `lost_decisions_in_merge`
   계산에만 쓰고, **판정 조건에서는 뺀다**.
4. **`cause` 상수 개명**: `orphaned`→`row_moved`, `merge_overwritten`→`row_replaced`,
   `merge_absorbed`→`row_absorbed`. 우선순위는 그대로(`setdefault`, (가)→(나)→(다)).
5. **`lost_decisions` 항목 확장**: `{activity_id, doc_id, decision, cause, new_doc_id, changed_fields,
   approval_flipped}`. `new_doc_id` 는 `row_replaced` 에서 `None`(다시 판단할 곳이 **없다**는 사실이다 —
   "모른다"가 아니다). `changed_fields` 는 달라진 행-정체 필드명 목록((나-ii)로만 걸렸으면 `[]`).
   `approval_flipped` 는 `row_moved`/`row_absorbed` 에서 언제나 `False`.
6. **게이트를 넓힌다**: `if moved or merged or lost_decisions:`. **이 한 줄이 빠지면 1~5 가 전부
   무효다** — 실측으로 확인했다(새 조건 + 옛 게이트 = `identity_drift=None`, 요청 0건, 고치기 전과 동일).
   그리고 `moved` 도 `merged` 도 비었는데 `lost_decisions` 가 찬 적재에서는 `DOCUMENT_IDENTITY_DRIFT`
   경고를 **이동 쌍 없이**(경위별 건수만) 발화한다 — 경고 0건인 채 검토요청만 생기는 적재를 만들지 않는다.

**모델은 바꾸지 않는다(검토하고 기각한 대안).** (나-ii)를 "이번 적재에서 충돌 묶음에 **새로** 들어왔다"로
쓰려면 지난 적재의 충돌 여부를 알아야 하고, 그러려면 `DocumentRow` 에 컬럼(예: `register_row_count`)이
필요하다. 그런데 **(다)의 결과가 이미 같은 사실을 준다** — 어떤 `doc_id` 가 다른 `doc_id` 를 흡수했다는
것은 그 `doc_id` 가 이번에 새로 뭉쳐졌다는 뜻이다. 상시 충돌(같은 두 행이 매주 올라온다)에서는 사라지는
옛 `doc_id` 가 없어 흡수가 잡히지 않으므로 MINOR-1 오탐도 함께 막힌다. 컬럼과 마이그레이션 없이
같은 판별이 되므로 `packages/core/models/` 는 이 개정에서 손대지 않는다.

### 12-d. `services/progress/document_mapper.py` (progress-engine) + `apps/web` (frontend)

```python
IdentityDriftCause = Literal["row_moved", "row_replaced", "row_absorbed"]   # 정본은 ingest 의 상수
class LostDecision(TypedDict):      # IdentityDriftReport.lost_decisions[] 의 계약
    activity_id: str
    doc_id: str
    decision: Literal["confirmed", "rejected"]
    cause: str                      # 모르는 값은 그대로 두고 `unspecified` 로 표시 — 폴백 금지
    new_doc_id: str | None          # None = 다시 판단할 곳이 없다(row_replaced)
    changed_fields: list[str]       # sender | doc_number | seq_raw | title
    approval_flipped: bool
```

문구(§5-3): **경위 이름이 아니라 관측한 값으로 쓴다.**

- `row_moved` — "대장 행은 그대로인데 우리 식별 규칙이 그 행을 새 doc_id(`new_doc_id`)로 옮겼습니다."
  **"고아"라고 쓰지 않는다** — 시트명 변경 경로에서 `is_orphaned=False` 다(실측).
- `row_replaced` — "이 문서가 담고 있던 대장 행이 바뀌었습니다(`changed_fields` 를 값으로 나열)."
  **"병합"이라고 쓰지 않는다** — 그 `doc_id` 가 실제로 `merged` 묶음에 있을 때만 쓴다(주 경로는 `merged=0`).
  `approval_flipped` 가 참일 때만 "도면 승인 근거가 뒤집혔습니다"를 덧붙인다.
- `row_absorbed` — "판단이 가리키던 대장 행이 지금은 다른 문서(`new_doc_id`) 아래에 있습니다."

`_CAUSE_ORDER` 는 위험 순서 그대로 `(row_replaced, row_absorbed, row_moved)`.

### 12-e. 검증 시나리오 (qa) — 그리고 반증

**전부 이미 실행으로 확인된 값이다(ADR 0009 §5-2 (바)).** 각 줄은 개정 1 코드에서 어떤 값이 나오는지도
함께 적었다 — 그것이 이 시나리오가 결함을 잡는다는 증거다(CLAUDE.md §6-2).

| ID | 시나리오 | 개정 1 코드에서 | 고정할 단언 |
|---|---|---|---|
| V7a | 별칭 통합 + 옛 법인명 행 삭제, 판단은 **살아남는** 쪽 | 침묵(review_id None) | `cause="row_replaced"` **그리고** `drawing_approval` 0.0→1.0 **그리고** 검토요청 1건 — **셋을 함께**(§6-2 규칙 4) |
| V7b | 같은 삭제, config 만 안 바꿈(음성 대조군) | 동일 | `identity_drift is None`, `is_orphaned=True`, 0.0→0.5 |
| V7c | 같은 사건, 판단이 **사라지는** 쪽 | 침묵 | `cause="row_absorbed"`, `new_doc_id` 가 살아남은 doc_id |
| V7d | V7a 를 **문서번호 열이 없는** 대장에서 | 침묵 | 발화 유지(행-정체가 3필드로 줄어도) |
| V7e | 상시 충돌 묶음 **안**의 정상 처리결과 갱신(MINOR-1) | 오탐 1건 | `lost_decisions == []`, 요청 0건. **COLLISION 경고는 그대로 뜬다** |
| V7f | 무관한 충돌 + 제목 같고 문서번호 빈 행을 진짜 삭제(MINOR-2) | 오탐 1건 | `lost_decisions == []`, 고아 표시만 |
| V7g | 문서번호 열 없음 + 행-정체까지 같은 두 행이 시트 둘에 있고 `sheet_doc_types` 로 병합 | **발화(1건)** | 발화 유지 — **(나-ii)가 빠지면 실패해야 하는 시나리오다** |
| V7h | 게이트 회귀 — V7a 에서 `moved`·`merged` 가 둘 다 0인지 | — | `identity_drift_moved == identity_drift_merged == 0` **이면서** `identity_drift_review_id is not None` |
| V7i | 블라인드 스팟 실측(§6-1) — `column_aliases.sender` 를 바꿔 열 자체를 옮긴다 | 미실측 | **결과를 먼저 관측하고 그 값을 단언으로 적는다.** ADR 0009 §5-2 (바) "놓치는 것" 3 에 실측값을 채워 넣는다 |

**반증(이 단언들만으로는 결함을 못 잡는 것).**

- `identity_drift_review_id is not None` **하나만** 걸면 오탐 코드(P6·P7 을 포함해 무엇이든 발화하는 코드)도
  통과한다. 그래서 V7e·V7f 음성이 **같은 PR 에** 있어야 한다.
- `cause` 문자열만 걸면 **문구가 거짓인 채로** 통과한다. 제목 단언은 문장을 베끼지 말고 "그 상황에서 참일
  수 없는 말이 없다"로 건다(§6-4 규칙 3) — `row_replaced` 인데 "고아"·"병합"·"이동"이 제목에 있으면 실패.
- V7a 에서 `drawing_approval` 만 걸면 **탐지가 사라져도 초록**이다(뒤집힘 자체는 의도된 동작이다).

### 12-f. reviewer 추가 체크

1. `services/ingest/persistence.py` 의 병합 판정에서 **`_collision_groups` 가 조건으로 쓰이지 않는가**
   (경고·`lost_decisions_in_merge` 계산에만 쓰여야 한다).
2. 게이트가 `moved or merged or lost_decisions` 인가. 셋 중 하나라도 빠지면 반려.
3. `cause` 값 셋이 세 자리(ingest·document_mapper·web)에서 **같은 문자열**인가(ADR 0009 §Deferred 5).
4. 새 문구에 그 경위에서 **참일 수 없는 말**(고아·병합·이동)이 없는가(§6-4).
5. §12-e 표의 음성 대조군 V7e·V7f 가 같은 PR 에 있는가(§6-2 규칙 3).

### 12-g. 다음 호출

```
@bim-ingest      계획 0003 §12-c 대로 services/ingest/persistence.py 의 병합 판정을 행-정체/행-내용
                 분리로 바꾸고 게이트를 넓혀줘. config/document_register.yaml 경고 문구 2종도 함께.
@progress-engine 계획 0003 §12-d 대로 document_mapper.py 의 _CAUSE_* 와 문구 3종을 고쳐줘.
@api             계획 0003 §12-b 4번 — jobs.py 요약은 그대로 두고 docs/api.md 만 재생성해줘.
@frontend        계획 0003 §12-d 타입대로 identityDrift.ts·types.ts·ReviewsPage.tsx 를 맞춰줘.
@qa              계획 0003 §12-e 의 V7a~V7i 를 붙여줘. 각 줄의 "개정 1 코드에서" 값을 주석에 남겨.
@reviewer        계획 0003 §12-f 추가 체크 포함해서 리뷰해줘.
```

---

## 다음 호출 (개정 1까지)

```
@progress-engine 계획 0003 §2 순서 1~4 (importers/document_register.py, config_loader.py,
                config/document_register.yaml, document_mapper.py) 구현해줘. §4 규칙 6개 지켜.
@bim-ingest    계획 0003 §3-e 대로 services/ingest/persistence.py 에 title_identity·
                identity_fingerprint 저장과 드리프트 판정 3분기 붙여줘.
@api           계획 0003 §3-f 대로 run_document_register 에 드리프트 경고·검토요청 연결하고
                docs/api.md 재생성해줘. resolve_review 에는 분기를 추가하지 마.
@frontend      계획 0003 §3-g 대로 새 ReviewKind 라벨·해소 문구 붙여줘.
@qa            계획 0003 §7 의 V1~V6 을 붙여줘. 각 시나리오의 "반증" 목록을 테스트 주석에 그대로 남겨.
@reviewer      계획 0003 §9 추가 체크 포함해서 전체 리뷰해줘.
```
