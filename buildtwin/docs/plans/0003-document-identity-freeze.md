# 계획 0003 — 문서 정체성 동결과 식별 드리프트 탐지 (ADR 0009)

- 작성: architect
- 날짜: 2026-09-04
- 근거 ADR: **ADR 0009**(신규), ADR 0007 §2-1 개정 4·§2-3·§4-2 규칙 6·§9
- 선행 상태: 저장소 녹색(pytest 633 / vitest 186 / lint 0). architect 변경분 반영 후에도 pytest 633 녹색.

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
   `sheet_doc_types` 변경과 동일하므로 폭발 반경만 대리 측정됐다). → §7 V4 의 음성 대조군이 이 구멍을 덮는다.
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
| — | 프론트엔드 링크(`ReviewsPage.tsx`, `SummaryPage.tsx`, `documentBlocker.ts`) | 응답에서 받는다 — 손댈 것 없음 |

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

**이 kind 의 해소에는 부수 효과가 없다.** `services/api/usecases.resolve_review` 에 분기를 **추가하지
않는다** — 공통 폴백이 `status`/`resolution_note`/`resolved_by` 만 기록한다. 매핑을 되살리는 액션을 붙이는
설계는 반려한다(시스템이 사람의 확정을 복원하는 것이라 ADR 0001 불변식과 충돌).

### 3-e. `services/ingest/persistence.py` (bim-ingest)

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
3. `drift.moved` 의 `previous_doc_id` 에 걸린 `ActivityDocumentMappingRow` 중 `reviewed_by is not None` 인
   것을 `lost_decisions` 로 모은다(확정/반려 구분은 `document_mapper.is_rejected_mapping()` 을 쓴다 —
   판정 키 문자열을 이 모듈이 직접 읽지 않는다, ADR 0007 §4-2 규칙 6 ⑥ 불변식).
4. 이전 지문은 이번 적재에 **없는** 기존 행들의 `identity_fingerprint` 중 가장 흔한 값으로 잡는다
   (첫 적재는 `None` → 드리프트 판정 안 함).

### 3-f. `services/api` (api)

`run_document_register` 에 두 줄:

```python
if persisted.identity_drift is not None:
    warnings.append(_warning("DOCUMENT_IDENTITY_DRIFT", str(persisted.identity_drift)))
    drift_review_id = open_identity_drift_review(session, job.project_id, persisted.identity_drift)
    summary["identity_drift_review_id"] = drift_review_id
```

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
5. **실데이터 적재 후 첫 매칭 보정.** 이 계획이 끝나야 `min_similarity` 재측정이 안전해진다.
   그 작업은 별도 사이클이고, 이 계획의 V1 이 그 작업의 안전망이다.

---

## 다음 호출

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
