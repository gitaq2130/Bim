# ADR 0007 — 문서관리대장(Document Register) 연동과 `drawing_approval` 근거화

- 상태: Accepted (개정 2: 2026-09-03 — 9차 리뷰: 코드가 앞서고 문서가 뒤따르지 못한 동작 4건 반영 — 문서 고아화 시
  `document_mapping` 검토요청의 `on_hold` 자동 종료·복귀[§4 규칙 6], 매핑 재계산 시점[§4-3 신설], `DOCUMENT_UNMAPPED`
  경고 등록[§8], `UnsafeConfigOverrideError`[§9 신설])
- 작성: architect
- 날짜: 2026-09-03
- 관련: CLAUDE.md §0(핵심 원칙 — "AI는 추정까지, 확정은 사람" / 모든 판정에 confidence·evidence), §3 규칙 3·5·7·8·10·11,
  ADR 0001 §4-1(역할→actor)·§5(Evidence)·§6(3중 검증), ADR 0005(프로젝트 범위 키), ADR 0006(프로젝트 멤버십과 인가),
  `config/readiness.yaml`, `services/progress/readiness.py`, `rules/verification.yaml`

## Context

Work Readiness Score의 여섯 구성요소 중 `drawing_approval`이 가중치 0.15를 차지한다. 그런데 이 값을 먹이는 것은
`services/progress/readiness.py`의 `drawing_component()`이고, 그 입력은 `ActivityRow.resources["drawing_approved"]`
— **어떤 파이프라인도 채우지 않는 수동 플래그**다. 실제로는 언제나 비어 있고, 비면
`component_defaults.drawing_approval_unknown: 0.5`로 대체된다. 즉 **착수 가능 판단의 15%가 오늘 추측이다.**

건설 PM/CM 실무에서 이 자리의 실제 데이터는 **문서관리대장**이다. 발주처(또는 CM단)가 시공상세도 승인 요청서(TFA)를
승인해야 그 부위를 착수할 수 있고, 승인 여부는 대장에 기록된다. 사용자는 매주 대장을 직접 갱신하고 있으며 **그 파일이
정본이다.** 우리가 할 일은 대장을 대체하는 것이 아니라 **읽어서** 착수 가능 판단에 넣는 것이다.

실제 현장(삼성전자 고창CDC 물류센터 신축공사) 대장의 형태는 다음과 같다 — 추정이 아니라 실물에서 확인된 것이다.

- 시트가 문서 종류다: **TFA**(승인/검토/참조 요청서), **TFR**(자료제출서), **FI**, **SCAR**, **NCR**, **DN**, **VE**, **RFI**.
- 컬럼: `문서발생일 / 발신 / 공종 / 번호 / 문서번호 / 제목 / 처리결과 / 처리완료일`.
- 헤더는 3행, 데이터는 4행부터. **컬럼 위치가 시트마다 다르다**(TFA는 제목이 H열, TFR은 G열).
- `문서번호`(F열)는 대장에서 **수식으로 자동 생성**되는 파생 컬럼이다. 형식은 `발신-HG-종류-공종-번호`
  (예: `동부-HG-TFA-전기-26-049`, `중원-HG-TFA-소방기계-26023`, `S1-HG-TFA-통신-품질-제26-07-09호`).

그리고 사용자의 실무 절차서에는 현장에서 데인 결과가 두 줄로 남아 있다. 이 ADR은 그 두 줄을 **설계 제약으로 승격**한다.

> **"문서번호(발신/공종/번호) 기준으로 대조하면 오탐이 매우 많이 발생한다. 협력사가 관리대장에 입력할 때 공종이나
> 번호를 원본과 다르게 매핑하는 경우가 흔하기 때문. 따라서 반드시 제목 텍스트 기준으로 대조한다."**

> **제목 유사도가 0.9 이상이어도 자동 확정하지 않는다.** ZONE 번호·구간 번호(ASRS-1구간 vs ASRS-4구간)·차수(1차 vs 2차)만
> 다른 별개 문서가 흔하기 때문이다.

두 번째 교훈은 BuildTwin이 이미 가진 원칙과 **같은 구조**다. 스캔 AI는 `ESTIMATED_DONE`까지만 가고 `CONFIRMED`는
`actor == cm`만 도달한다(ADR 0001 불변식 1). 문서 매핑도 같다 — 시스템은 후보를 제안(추정)하고, 그 후보가 착수 가능
판단을 움직이려면 **사람(cm)의 확정**을 거친다. 아래 §4 규칙 5가 이 대응 관계를 코드 수준으로 고정한다.

## Decision

### 1. 범위 원칙: 대장은 정본이고, BuildTwin은 읽기만 한다

1. **대장 파일이 정본(system of record)이다.** BuildTwin의 `documents` 테이블은 대장의 **사본이자 파생물**이며,
   충돌하면 언제나 대장이 이긴다. 재업로드는 사본을 갱신하는 행위다.
2. **write-back은 이번 범위가 아니다.** BuildTwin이 대장 파일에 쓰거나, 대장을 대체하는 문서 발행·회신 워크플로를
   제공하지 않는다(Deferred).
3. **처리결과는 판정 대상이 아니라 독해 대상이다.** 시스템은 "이 문서가 승인되어야 한다"를 판단하지 않는다.
   발주처가 대장에 적어 놓은 사실을 읽을 뿐이다. 다만 자유 텍스트를 정규화 상태값으로 옮기는 것 자체는 판정이므로
   confidence·evidence를 붙인다(§3).
4. **이번 ADR의 대상 문서는 대장에 시트로 존재하는 8종(TFA/TFR/FI/SCAR/NCR/DN/VE/RFI)뿐이다.**
   회의록·기성·하도급계약 검토·확인서는 대상이 아니다. 필요해지면 별도 ADR로 연다(Deferred).

### 2. `documents` 스키마와 키

#### 2-1. 키 결정: 대리키 `(project_id, doc_id)` 복합 PK, `doc_number` 유니크 제약 없음

ADR 0005대로 **문서는 프로젝트에 속한다.** 자연키 후보인 `doc_number`는 다음 이유로 PK가 될 수 없다.

- `doc_number`는 대장에서 **수식으로 생성되는 파생 컬럼**이고, 그 재료(`공종`·`번호`)가 협력사 입력이라 신뢰할 수 없다.
- 공란·중복이 실제로 발생한다. PK나 UNIQUE로 두면 **BuildTwin이 대장 적재를 거부**하게 되는데, 이는 §1 규칙 1
  (대장이 정본)을 정면으로 위반한다. 우리가 소유하지 않은 데이터에 무결성 제약을 거는 셈이다.
- 협력사가 나중에 공종을 고치면 `doc_number`가 바뀐다. 그것을 키로 삼으면 **같은 문서가 다른 문서가 되어** 매핑
  이력이 끊긴다(ADR 0001이 GlobalId 재발급에서 겪은 문제와 같은 형태).

따라서 PK는 **`(project_id, doc_id)` 복합 키**이며, `doc_id`는 아래 규칙으로 만든 **결정적 대리키**다.

```
doc_id = "doc-" + sha256("{doc_type}|{sender_normalized}|{seq_normalized}|{title_normalized}").hexdigest()[:16]
```

1. **`doc_id` 산출식에 `discipline`이 들어가지 않는다.** 공종은 신뢰할 수 없는 필드이므로(§4 규칙 2) 문서의 **정체성**에
   관여해서는 안 된다. 협력사가 공종을 고쳐 적어도 같은 문서로 남는다. 이 배제가 "공종을 믿지 마라"를 스키마 수준에서
   구현한 것이다.
2. 결정적이므로 **주간 재업로드가 그대로 upsert가 된다.** 자동증가 대리키였다면 매 업로드마다 별도의 조회 키가
   또 필요했을 것이다.
   **다만 미해결 위험이 하나 있다(개정 1에서 추가).** `title_normalized` 는 `doc_id` 의 재료이면서 동시에
   §4 제목 대조의 입력이다. 즉 **매칭을 튜닝하려고 `title_matching.normalize` 를 건드리면 모든 문서의 `doc_id` 가
   바뀐다.** 실측으로 확인했다 — `strip_chars` 에 괄호를 추가하자 픽스처 문서 10건 중 7건의 `doc_id` 가 달라졌다
   (최초 확인은 3건 중 3건으로 표본이 더 좁았다; 이후 표본을 넓혀 재확인한 값이 이 7/10이다 — 표본이 커져도
   결론은 바뀌지 않는다: 정규화 변경은 정체성을 흔든다). 운영 데이터에서 이 일이 벌어지면 기존 문서가 전부
   §2-2 규칙 2 에 따라 고아가 되고, `doc_id` 에 매달린
   `activity_document_mappings` 가 통째로 끊겨 **CM 이 확정한 매핑이 조용히 사라진다.** 이는 규칙 1 이 공종을
   해시에서 배제한 것과 정확히 같은 종류의 문제이며, 그때는 "신뢰할 수 없는 필드"가, 여기서는 "튜닝 대상 설정"이
   정체성에 관여한다.
   해결 방향(Deferred, 실데이터 적재 전에 처리할 것): 정규화를 두 갈래로 나눈다. **정체성용**은 공백 정리와
   소문자화만 하는 보수적·동결 규칙으로 두고 절대 튜닝하지 않으며, **대조용**은 지금처럼 자유롭게 조정한다.
   그때까지는 `title_matching.normalize` 변경을 스키마 마이그레이션과 같은 무게로 다뤄야 한다.
3. `doc_number`에는 **유니크 제약을 걸지 않고 인덱스만** 둔다. 같은 `(project_id, doc_number)`가 둘 이상이면 적재를
   막지 않고 import 경고 `duplicate_doc_number`로 보고한다.

#### 2-2. 재업로드 규칙 (ADR 0001 §1 · ADR 0005 규칙 5와 같은 형태)

1. 같은 `(project_id, doc_id)`는 같은 문서로 보고 값을 갱신한다(`doc_number`·`discipline_raw`·`result_raw`·날짜·
   `file_id`·`sheet_name`·`source_row`는 새 대장 값으로 덮어쓴다 — 대장이 정본이므로).
2. **행을 삭제하지 않는다.** 이번 업로드에 **존재한 doc_type**에 대해서만 판단해, 그 doc_type의 기존 문서 중 새
   파일에 없는 것을 `is_orphaned=True`로 표시한다. 업로드에 없던 doc_type의 문서는 건드리지 않는다
   (TFA 시트만 올렸다고 TFR 전체가 고아가 되면 안 된다).
3. 고아 문서는 readiness 계산에서 제외하되(§5 규칙 6) 매핑과 이력은 유지한다.
4. `title`이 미세하게 수정되면 `doc_id`가 바뀌어 새 행이 생긴다. 이때 `(doc_type, sender_normalized, seq_normalized)`가
   같은 기존 문서가 있으면 import 경고 `document_possibly_renamed`로 보고하고 **두 행을 모두 남긴다**. 병합은 사람이
   판단할 문제이므로 자동 병합하지 않는다.

#### 2-3. 컬럼

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `project_id` | String, PK, FK→`projects.project_id` | ADR 0005 규칙 1: 업로드된 파일 행(`FileRow.project_id`)에서 유도. 호출자가 주입하지 않는다 |
| `doc_id` | String, PK | §2-1 결정적 대리키 |
| `doc_type` | String, index | `TFA`/`TFR`/`FI`/`SCAR`/`NCR`/`DN`/`VE`/`RFI`/`other`. 시트명 → 종류 표는 `config/document_register.yaml` |
| `sender` | String | 대장 `발신` 원문 |
| `sender_normalized` | String | 공백 제거·대문자화 + `sender_aliases` 적용. `doc_id` 재료 |
| `discipline_raw` | String, nullable | 대장 `공종` 원문. **신뢰 불가 필드**(§4 규칙 2) |
| `discipline_normalized` | String, nullable | glossary `discipline` 값으로 정규화한 결과. 매핑에서 **가점으로만** 쓴다 |
| `seq_raw` | String, nullable | 대장 `번호` 원문 |
| `seq_normalized` | String, nullable | 숫자 이외 문자를 모두 제거해 이어붙인 값. `26-049`→`26049`, `제26-07-09호`→`260709`. **자릿수를 재해석하지 않는다**(연도 확장·0 제거 금지) |
| `doc_number` | String, index(비유니크), nullable | 대장 `문서번호` 원문. **표시·검색 전용**(§2-4) |
| `title` | Text | 대장 `제목` 원문 |
| `title_normalized` | Text | 대조용 정규화 텍스트(`config` `title_matching.normalize`). `doc_id` 재료 |
| `issued_on` | String(ISO date), nullable | `문서발생일` |
| `result_raw` | Text, nullable | **`처리결과` 원문 그대로.** 공란이면 `NULL`. 절대 지우거나 해석해 덮어쓰지 않는다 |
| `approval_status` | String, index | §3의 정규화 상태값. 기본 `UNKNOWN` |
| `approval_confidence` | Float | 정규화 판정의 확신도 0~1(CLAUDE.md §3 규칙 3) |
| `approval_evidence` | JSON | `Evidence`(§3 규칙 4). 빈 evidence 금지 |
| `completed_on` | String(ISO date), nullable | `처리완료일` |
| `file_id` | String, FK→`files.file_id` | 출처 대장 파일 |
| `sheet_name` | String | 출처 시트명 |
| `source_row` | Integer | 출처 행 번호(1-based, 대장 원본 기준) |
| `needs_review` | Boolean | 처리결과를 해석하지 못했을 때 `True`(§3 규칙 3) |
| `is_orphaned` | Boolean | §2-2 규칙 2 |
| `imported_at` | DateTime | 마지막 적재 시각 |

키·참조 관계를 ADR 0001 §1 표의 형식으로 적으면 다음과 같다.

| 테이블 | 키 | 참조 |
|---|---|---|
| `documents` | **`(project_id, doc_id)` PK** | `file_id` → `files.file_id`. 객체(`global_id`) 참조 없음 |
| `activity_document_mappings` | **`(activity_id, doc_id)` PK** | `project_id` 컬럼 보유, **복합 FK `(project_id, doc_id)` → `documents`** |

`activity_document_mappings`는 `ActivityObjectMappingRow`와 같은 모양이다 — `activity_id`는 (기존 매핑 테이블과
동일하게) FK 없는 평문 컬럼, `project_id`는 Activity에서 유도, `confidence`·`evidence`·`needs_review` 필수. 여기에
`reviewed_by`(String, nullable)를 더한다(`EntityObjectMappingRow`와 같은 용도 — 누가 확정했는지).

**ADR 0005 규칙 2와 같은 규칙을 문서에도 건다: `doc_id` 단독 조회 금지.** 서비스·API의 모든 문서 조회는
`(project_id, doc_id)`를 함께 건다.

#### 2-4. `doc_number`는 파싱하지 않는다

`문서번호`는 `발신-HG-종류-공종-번호` 형식이지만 **되파싱하지 않는다.** 근거:

- 그 값은 **대장의 `발신`·`공종`·`번호` 컬럼에서 수식으로 생성된 파생값**이다. 재료가 이미 별도 컬럼으로 있는데
  파생값을 되파싱하는 것은 얻는 것 없이 실패 지점만 늘린다.
- 실제로 모호하다: 공종이 두 토큰인 경우(`통신-품질`)와 번호에 하이픈이 있는 경우(`제26-07-09호`)가 동시에 있어
  구분자 `-` 만으로는 경계를 결정할 수 없다.

따라서 구조화된 값(`sender`/`discipline_raw`/`seq_raw`)은 **언제나 대장의 해당 컬럼에서 읽고**, `doc_number`는 원문
그대로 저장해 화면 표시·검색·blocker 문구에만 쓴다. `doc_number`가 컬럼 값들과 어긋나 보이면 경고
`doc_number_mismatch`만 남기고 **컬럼 값을 신뢰한다**.

#### 2-5. 컬럼 위치를 상수로 박지 않는다

CLAUDE.md §3 규칙 6(좌표계 하드코딩 금지)과 같은 이유로, 대장의 **열 위치를 코드 상수로 두지 않는다.**

1. 헤더 행은 `register_layout.header_row_search_range`(기본 1~10행) 안에서 **컬럼 별칭이 가장 많이 일치하는 행**을
   찾아 결정한다. "3행"을 상수로 두지 않는다 — 현장마다 다르다.
2. 각 논리 컬럼은 `register_layout.column_aliases`의 한국어 별칭 목록으로 찾는다. **코드에 한국어 문자열 리터럴을
   두지 않는다**(CLAUDE.md §3 규칙 5·10, `config/README.md`).
3. 필수 컬럼(`title`)을 못 찾으면 그 시트를 건너뛰고 경고를 남긴다. 시트 전체가 실패하면 422
   `document_register_invalid`.

### 3. 승인 상태(`처리결과`)의 정규화 — 이 ADR의 안전 규칙

#### 3-1. 상태 집합

```python
class DocumentApprovalStatus(str, Enum):
    APPROVED = "APPROVED"                              # 승인
    APPROVED_WITH_COMMENTS = "APPROVED_WITH_COMMENTS"  # 조건부승인 / 승인(코멘트)
    REJECTED = "REJECTED"                              # 반려 / 부적합
    RESUBMIT_REQUIRED = "RESUBMIT_REQUIRED"            # 재제출 / 보완 후 재제출
    IN_REVIEW = "IN_REVIEW"                            # 검토중 / 접수 / 진행중
    UNKNOWN = "UNKNOWN"                                # 공란이거나 해석 불가 — 기본값
```

이 enum은 **`ObjectState`와 아무 관계가 없다.** 문서 승인 상태는 객체 상태기계의 상태가 아니고, 어떤 상태 전이도
일으키지 않는다. `APPROVED`가 `CONFIRMED`로 이어지는 경로는 존재해서는 안 된다(ADR 0001 불변식 1). 문서 상태가
영향을 주는 곳은 **오직 두 군데**다: readiness의 `drawing_approval` 입력(§5), 3중 검증의 `logic` 축 입력(§6).

#### 3-2. 규칙

1. **공란은 `UNKNOWN`이다. 절대 `APPROVED`로 추측하지 않는다.** 처리결과 칸이 비어 있다는 것은 "아직 회신이 없다"
   또는 "대장에 아직 안 적었다"를 뜻하며, 두 경우 모두 승인이 아니다.
2. **`UNKNOWN`은 "승인됨"이 아니라 "모름"으로 readiness에 반영된다**(§5 규칙 4). 모름을 1.0으로 처리하면 미승인
   도면 위에서 착수 가능이 뜬다.
3. 정규화는 `config/document_register.yaml`의 `status_normalization` 규칙표(정규식 → 상태 + confidence)로만 한다.
   **코드에 한국어 문자열 리터럴을 두지 않는다.** 세 경우로 갈린다:

   | 원문 | 결과 | confidence | `evidence.method` | `needs_review` |
   |---|---|---|---|---|
   | 공란 / 공백만 | `UNKNOWN` | `1.0` | `register_status_blank` | `False` |
   | 규칙표에 일치 | 규칙의 상태 | 규칙의 `confidence` | `register_status_rule` (`evidence.rule_id` = 규칙 id) | `False` |
   | 비어 있지 않은데 어떤 규칙에도 불일치 | `UNKNOWN` | `0.0` | `register_status_unmatched` | **`True`** |

   공란의 confidence가 1.0인 이유: 판정 대상은 "이 칸이 무엇을 뜻하는가"이고, 빈 칸이 "적히지 않았다"를 뜻한다는 것은
   확실하다. 반대로 해석 못 한 텍스트는 우리가 정말 모르는 것이므로 0.0이고 사람이 봐야 한다(`needs_review`).
   두 경우 모두 **상태는 `UNKNOWN`이므로 readiness에서 승인으로 취급되지 않는다** — confidence 차이는 "규칙표를
   보강해야 한다"는 운영 신호일 뿐 안전성에 영향을 주지 않는다.
4. `approval_evidence`는 `Evidence(source_type="document", source_id=<file_id>, file_uri=<대장 uri>, method=위 표,
   rule_id=<일치 규칙 id | None>, note=<result_raw 원문>, extra={"sheet": ..., "row": ..., "doc_number": ...})`.
   출처 파일·시트·행이 남으므로 CM이 "대장 어디서 나온 값인가"를 되짚을 수 있다.
   **`Evidence.source_type`에 `document`를 추가한다** — 문서관리대장은 기존 축(scan·daily_report·rule·ingest·mapping·
   schedule·material·system_logic·user_input) 어디에도 속하지 않는 새 근거 출처이고, 감사 시 "이 판단은 대장에서 왔다"를
   구분할 수 있어야 한다.

#### 3-3. 조건부승인은 승인으로 보지 않는다 (기본값)

`APPROVED_WITH_COMMENTS`(조건부승인)를 **기본적으로 승인으로 취급하지 않는다.** 근거:

- 조건부승인은 "코멘트를 반영한다는 조건" 아래의 승인이고, **그 조건의 충족 여부는 대장에 없다.** 우리가 가진
  데이터로는 착수해도 되는지 알 수 없다. 모르는 것을 승인으로 읽는 것은 §3-2 규칙 1과 같은 종류의 잘못이다.
- 그렇다고 `REJECTED`도 아니다. 그래서 별도 상태로 남겨 화면과 blocker에 **있는 그대로** 보인다 — CM이 "조건부승인이니
  실무상 진행 가능"이라고 판단하면 그 판단은 사람이 한다.
- 다만 현장마다 운영이 다르므로, **무엇을 승인으로 볼지는 `config/readiness.yaml`의
  `document_approval.approved_statuses`로 바꿀 수 있다**(기본 `[APPROVED]`). 코드에 상태 목록을 박지 않는다.

### 4. 문서 ↔ Activity 매핑

#### 4-1. 대상

1. 매핑은 **문서 ↔ Activity**만 만든다. 문서 ↔ 객체(`global_id`) 직접 매핑은 만들지 않는다 — 대장에 객체를 식별할
   정보가 없어 근거가 없다. 객체 단위 문서 정보가 필요하면 `문서 → Activity → (기존 activity_object_mappings) → 객체`로
   파생한다.
2. 매핑은 판정이므로 `confidence`·`evidence`·`needs_review`가 필수다(CLAUDE.md §3 규칙 3). 기존
   `ActivityObjectMappingRow`가 쓰는 패턴을 그대로 따른다.

#### 4-2. 매핑 근거와 우선순위

`config/document_register.yaml`의 `mapping_weights`로 가중치를 준다(합 1.0). 규칙:

| 근거 | 키 | 기본 가중치 | 성질 |
|---|---|---|---|
| 제목 텍스트 유사도 | `title_similarity` | 0.60 | **필수**. 유사도 값을 곱해 가산 |
| 층 일치 | `level_match` | 0.15 | 가점. 판별 토큰 규칙(규칙 3)의 대상이기도 함 |
| 구역(ZONE) 일치 | `zone_match` | 0.10 | 가점. 위와 동일 |
| 공종 일치 | `discipline_match` | 0.10 | **가점만. 불일치 감점 없음** |
| 발생일 근접 | `date_window` | 0.05 | 문서발생일이 Activity `planned_start` 이전 `date_window_days` 이내면 가점 |

1. **제목 근거 없이는 어떤 조합으로도 매핑을 만들지 않는다.** `title_similarity < title_matching.min_similarity`
   (기본 0.55)면 공종·층·날짜가 모두 맞아도 후보가 아니다. 절차서의 "반드시 제목 텍스트 기준으로 대조한다"를
   그대로 옮긴 것이다.
2. **공종(`discipline`)은 신뢰할 수 없는 필드다.** 협력사가 대장에 원본과 다르게 적는 일이 흔하므로,
   (a) 공종 일치는 **단독으로 매핑 근거가 될 수 없고**(규칙 1이 이미 막는다), (b) 일치는 **가점만** 주며,
   (c) **불일치는 감점하지도, 후보에서 제외하지도 않는다.** 틀리게 적힌 공종 때문에 맞는 문서를 버리는 것이
   틀린 문서를 잡는 것만큼 나쁘기 때문이다. `doc_number` 안의 공종 토큰은 §2-4대로 아예 읽지 않는다.
3. **판별 토큰 하드 배제(discriminative tokens).** `title_matching.discriminative_tokens`에 정의된 토큰
   (ZONE·구간·차수·층)이 **문서 제목과 Activity 양쪽에 모두 존재하고 값이 다르면 후보에서 제외한다.**
   유사도 점수와 무관하다. "ASRS-1구간"과 "ASRS-4구간"은 유사도 0.97이지만 다른 문서다. 한쪽에만 있으면 제외하지
   않고 confidence만 낮춘다(양쪽에 다 있어야 "다르다"고 말할 수 있다).
4. **후보 생성 하한.** 합산 confidence가 `mapping.min_confidence_to_propose`(기본 0.5) 미만이면 매핑 행을 만들지
   않는다. 애매한 매핑을 만들어 두는 것보다 만들지 않는 편이 낫다 — **틀린 매핑은 착수 가능 판단을 오염시킨다.**
5. **자동 확정 금지 — 이 ADR의 두 번째 안전 규칙.** 시스템이 만든 문서 매핑은 confidence 값과 무관하게 **항상**
   `needs_review=True`로 저장된다. 유사도 0.99여도 그렇다. 이는 ADR 0001의
   "스캔 AI는 `ESTIMATED_DONE`까지, `CONFIRMED`는 `actor == cm`만"과 **같은 구조**다:

   | ADR 0001 (객체) | ADR 0007 (문서 매핑) |
   |---|---|
   | 스캔 AI 최대 판정 = `ESTIMATED_DONE` | 시스템 매핑 최대 상태 = `needs_review=True` |
   | `CONFIRMED`는 `actor == cm`만 | 매핑 확정(`needs_review=False`)은 `cm`만(§7) |
   | 미확정 상태는 공식 진도에 반영되지 않는다 | 미확정 매핑은 `drawing_approval` 점수에 반영되지 않는다(§5 규칙 3) |

   따라서 `MAPPING_REVIEW_THRESHOLD`(0.7)는 문서 매핑에 적용되지 않는다. confidence는 **검토 큐 정렬과 후보 하한**에만
   쓴다.
6. **`document_mapping` 검토요청은 다섯 단계의 생애주기를 가진다**(개정 2 — 이 항목을 확장한다.
   `services/progress/document_mapper.py`가 전체를 소유하며 API는 호출만 한다, CLAUDE.md §3 규칙 11):

   | 단계 | 트리거 | 구현 | 결과 |
   |---|---|---|---|
   | ① 생성 | `map_documents_to_activities`가 만든 후보 중 `needs_review=True`인 것에 아직 열린 요청이 없음 | `_sync_pending_document_mapping_reviews` | `ReviewRequest(kind="document_mapping", status="open", assignee_role="cm")` 신규 저장. **`ReviewKind`에 `document_mapping`을 추가한다** — 기존 `mapping`을 재사용하면 `services/sync/review_queue.resolve_mapping_review`가 `conflicting_sources`에서 `drawing_id`/`entity_handle`을 기대하므로 `mapping_review_data_corrupt`(500)로 깨진다 |
   | ② 중복 방지 | 같은 `(activity_id, doc_id)`에 이미 열린(`status="open"`) 요청이 있음 — 대장·공정표 재업로드마다 `map_project_documents`가 다시 돌므로(§4-3) 상시 발생 | 위와 동일 함수 | 새로 만들지 않고 기존 행의 `confidence`/`evidence`/`title`만 최신 값으로 갱신한다(재계산으로 근거가 바뀌었을 수 있으므로) |
   | ③ 확정 시 종료 | CM이 매핑을 확정(`needs_review=False`, `reviewed_by=<user_id>`) | `close_document_mapping_review`(`services/api/usecases.confirm_document_mapping`이 매핑 저장 직후 호출) | `status="approved"`, `resolved_by=<user_id>`, `resolution_note="mapping confirmed by <user_id>"` |
   | ④ 고아화 시 종료 | 매핑이 가리키는 문서가 `is_orphaned=True`가 되거나(대장 재업로드에서 그 doc_type 안에 더 이상 없음, §2-2 규칙 2) 문서 행 자체가 없어짐 | `_close_reviews_for_orphaned_documents` | `status="on_hold"`, **`resolved_by`는 채우지 않는다**, `resolution_note`에 고아화 사유를 남긴다(아래 판단 근거) |
   | ⑤ 복귀(재생성) | ④로 닫힌 문서가 이후 대장에 다시 나타나 `is_orphaned=False`가 되고, 매핑 후보 조건(제목 유사도 등, §4-2)을 다시 만족 | `map_documents_to_activities` → ①이 같은 파이프라인을 다시 돈다 | **새** `ReviewRequest(status="open")`가 생긴다(과거 `on_hold` 행을 재사용하지 않는다 — `open_document_mapping_review`는 `status="open"`만 조회하므로) |

   **④의 `on_hold`가 ADR 0001 §6과 맺는 관계 — architect 판단(개정 2).** ADR 0001 §6은 시스템이 만드는 `on_hold`를
   "대체된 요청(예: 도면 재정합으로 무의미해진 mapping 검토요청, `resolution_note`에 `superseded_by=<new id>`)"으로
   한정했다. 문서 고아화는 그 사유와 다르다 — 대체 요청이 새로 생기는 것이 아니라 **판단 대상 자체가 사라진다.**
   그럼에도 별도 `ReviewStatus` 값을 새로 만들지 않고 `on_hold`를 그대로 쓰기로 판단한다. 근거:

   - `ReviewStatus`(글로서리 "개정 1 추가 항목") 집합은 `open`/`approved`/`rejected`/`on_hold` 넷뿐이다.
     `approved`/`rejected`는 **사람의 판단 행위**를 뜻한다(CLAUDE.md §3 규칙 7 — 전이에는 actor·evidence가 필수이고,
     ADR 0001 §5가 `StateTransition`에 대해 세운 원칙을 검토요청의 상태 변경에도 같은 무게로 적용한다). 고아화는
     사람이 아무것도 판단하지 않았다 — 대장에서 그 행이 사라졌을 뿐이다. `resolved_by`를 채우지 않은 채
     `approved`/`rejected`로 두면 "CM이 이 매핑을 승인/반려했다"는 **거짓 감사 기록**이 생긴다.
   - 남는 선택지는 `open`(그대로 둠)뿐인데, 그러면 CM 검토 큐에 **판단 자체가 불가능한 항목**(가리키는 문서가
     이미 없다)이 영구히 남는다 — 이는 8차 리뷰가 지적한 "검토요청이 하나도 안 만들어지는" 실패의 반대쪽이다:
     이번엔 만들어지지만 절대 닫히지 않는 요청이 쌓인다.
   - `on_hold`의 두 사유(대체됨 / 판단 대상 소실)는 **"사람이 더 이상 판단할 필요가 없다는 시스템의 선언"이라는
     한 상위 개념의 서로 다른 하위 사례**다. 무효화된 경로는 다르지만 상태 자체가 다른 종류의 사건은 아니므로,
     새 `ReviewStatus` 값(예: `voided`)을 만들어 상태 집합을 늘리는 것보다 재사용이 낫다.
   - **다만 "대체"라는 기존 함의를 지키기 위해 `resolution_note`에 사유를 항상 구분해 남긴다.** 대체 종료는
     `superseded_by=<id>`(ADR 0001 §6 그대로), 고아화 종료는 `document {doc_id!r} is orphaned or no longer in the
     register — closed automatically, nothing for cm to confirm`(현재 구현 문구 그대로) — 화면·감사는
     `resolution_note`의 내용으로 두 사유를 구분한다.
   - **ADR 0001 §6은 시스템이 만드는 `on_hold`의 사유를 "대체된 요청" 하나에서 "대체된 요청 또는 판단 대상이
     소실된 요청" 둘로 확장한다(ADR 0001 개정 3).** 확장 자체는 ADR 0001 본문에 짧게 반영하고, 근거·구현
     세부사항은 이 ADR(§4-2 규칙 6)이 소유한다 — ADR 0001이 상태 모델의 정본이라는 원래 역할은 바뀌지 않는다.

   **⑤ 자동 재생성에 대한 주의.** 문서가 대장에 돌아오면(예: 이번 주 대장에서 실수로 빠졌다가 다음 주 다시 실림)
   같은 `(activity_id, doc_id)`에 새 검토요청이 자동으로 다시 열린다 — CM이 다시 확인해야 한다. 이는 의도한
   동작이다: 고아였던 동안 그 문서의 승인 상태가 바뀌었을 수 있어(예: 대장에서 빠진 사이 반려로 바뀜), 옛
   `on_hold` 요청을 그대로 되살리면 낡은 `evidence`를 신뢰하게 된다. 다만 **이미 사람이 확정한 매핑
   (`reviewed_by is not None`)은 고아화·복귀를 거쳐도 재생성되지 않는다** — `_drop_already_confirmed`가 확정된
   기존 매핑 행을 재계산 결과로 덮어쓰지 않기 때문이다(ADR 0001 불변식 2 "`CONFIRMED`에서 나가는 전이도 cm만"과
   같은 구조 — 확정 이후는 사람만 되돌릴 수 있다). 재생성 대상은 **확정된 적 없이** 고아가 된(고아가 되는 순간까지
   `needs_review=True`였던) 매핑뿐이다.

   새 kind의 해소는 `services/progress`가 소유한다(CLAUDE.md §3 규칙 11: API는 호출만).
7. 매핑 `evidence`: `Evidence(source_type="document", source_id=<doc_id>, method="document_title_match",
   note=<title 원문>, extra={"title_similarity": ..., "matched_rules": [...], "excluded_by": [...],
   "discipline_trusted": false})`.

   **확정(`needs_review=False`)은 evidence를 덮어쓰지 않고 보존한다(개정 1).** 확정 시 `source_type`/`method`는
   시스템이 제안했을 때의 값(`document`/`document_title_match`)을 그대로 두고, `note`만 확정 시 남긴 코멘트로
   갱신하며, 누가 확정했는지는 `reviewed_by`(§2-3)에 `user_id`로 기록한다
   (`services/api/usecases.confirm_document_mapping`이 구현, `services/sync/review_queue.confirm_mapping`과
   같은 기존 관례). 근거: `evidence`는 "이 매핑이 왜 제안됐는가"의 감사 기록이고, 확정 여부·확정자는 이미
   `reviewed_by`가 별도로 표현한다. 확정 시 evidence를 덮어써 제안 근거를 지우는 것은 감사 관점에서 오히려
   손해다 — 나중에 "어떤 근거로 제안된 매핑을 CM이 확정했는가"를 되짚을 수 없어진다.

   **초판이 적었던 `method="document_manual_mapping"`, `source_type="user_input"`은 채택하지 않는다
   (개정 1, 2026-09-03 architect 정정).** 어떤 코드도 이 값을 만들지 않으며, 이는 구현 누락이 아니라 위 근거에
   따른 **설계 정정**이다. `Evidence.source_type`/`.method` 어휘(glossary)에서도 제거한다.

#### 4-3. 매핑 재계산 시점 (개정 2 — 신설)

`map_project_documents`(순수 함수가 아니라 DB 읽기·쓰기 + 검토요청 동기화까지 하는 사이드이펙트 함수, §4-2 규칙 6)가
**언제 다시 도는지**는 지금까지 코드에만 있고 이 ADR 어디에도 없었다(9차 리뷰 지적). 세 지점에서 호출된다:

| 시점 | 호출부 | 목적 |
|---|---|---|
| 대장 업로드 시 | `services/api/jobs.run_document_register` | 정상 경로 — 새/갱신된 문서에 대해 매핑 후보를 만든다 |
| 공정표 업로드 시 | `services/api/jobs.run_schedule` | **회복 경로.** 대장이 공정표보다 먼저 올라오는 순서(현장에서 흔하다 — 대장은 매주, 공정표는 가끔 갱신)에서는 대장 적재 시점에 매핑할 Activity 가 하나도 없어 매핑이 0건으로 남는다. 공정표가 뒤늦게 들어오면 그 자리에서 한 번 더 돌려 회복시킨다 |
| 수동 요청 시 | `services/api/usecases.generate_document_mappings`(cm만, §7) | 운영자가 명시적으로 재계산을 트리거하는 경로. 자동 두 경로 중 아무것도 아직 안 돌았거나, 설정(`title_matching`·`mapping_weights`)을 바꾼 뒤 다시 확인하고 싶을 때 쓴다 |

세 경로 모두 **같은 함수를 그대로 호출**하므로 §4-2 규칙 6의 다섯 단계(생성/중복 방지/확정 시 종료/고아화 시
종료/복귀)는 호출 시점과 무관하게 동일하게 적용된다 — 대장 업로드가 만든 검토요청을 공정표 업로드가 다시 돌며
중복 생성하지 않는 것도, 공정표 업로드가 방금 고아 처리된 문서의 요청을 닫는 것도 같은 코드 경로다.

**부가 회복이 본 작업을 인질로 잡지 않는다.** `run_schedule`의 존재 이유는 공정표를
적재하는 것이고, 문서 매핑 재계산은 **그 김에 하는 부가 회복**이다. 따라서 문서 매핑 쪽에서 나는 실패(예:
`document_register.yaml` 오염으로 인한 `UnsafeConfigOverrideError`, §9)가 공정표 적재 자체를 롤백시켜서는
안 된다 — 공정표는 정상적으로 올라왔는데 부가 기능이 실패했다는 이유로 job 전체가 실패로 뒤집히는 것은
본말전도다. 이 원칙에 따라 `run_schedule`의 `map_project_documents` 호출은 예외를 잡아 `warnings`로 강등해야
한다(공정표 적재 결과는 `"done"`으로 남기고, 문서 매핑 실패는 경고로만 보고). **구현됨** — `run_schedule`은
`map_project_documents` 호출을 `try/except`로 감싸 실패를 `DOCUMENT_MAPPING_RESYNC_FAILED` 경고로 강등하고
job 을 `"done"`으로 끝낸다(`services/api/jobs.py`, `run_scan_upload`의 `POINT_CLOUD_LOAD_FAILED`와 같은 패턴).
이 처리 이전에는 문서 매핑 쪽 실패가 `run_job`의 최상위 `except Exception`에 잡혀 공정표 업로드 job 전체가
`failed`로 끝났고, `session_scope()` 롤백으로 이미 저장된 schedule·activities·relations·객체매핑까지 사라졌다. 같은 원칙이 `run_document_register`에는 적용되지 않는다 — 그 잡의 목적 자체가
"대장 적재 + 매핑 생성"이라 문서 매핑이 **본 작업의 일부**이므로(§2·§4), 그 잡에서는 실패를 경고로 강등하면
안 된다.

### 5. `drawing_approval` 구성요소의 재정의

가중치는 **바꾸지 않는다.** `drawing_approval: 0.15`, 여섯 구성요소 합 1.0 그대로다. 근거: 이번 변경은 같은 자리에
**더 나은 입력**을 꽂는 것이고, 가중치 재조정은 실제 현장 데이터로 검증하기 전에는 근거가 없다. 검증 후 필요하면
별도 ADR로 다룬다.

#### 5-1. 값 산출: 비율이 아니라 논리곱(AND)

**매핑·확정된 필수 문서가 전부 승인이면 1.0, 하나라도 아니면 0.0.** 비율을 쓰지 않는다.

근거: 도면 승인은 착수의 **AND 조건**이다. 10장 중 9장 승인은 "0.9만큼 착수 가능"이 아니라 착수 불가다. 비율을 쓰면
9/10 = 0.9가 되어 가중합에서 `start_threshold: 0.75`를 넘겨 **착수 가능으로 뜬다** — 실무적으로 틀린 답이다.
"부분적으로 착수 가능"이라는 상태는 존재하지 않는다.

다만 CM은 진척을 봐야 하므로 **비율은 점수가 아니라 정보로 보고한다**: `ComponentResult.note`(→ `evidence.note`)에
`approved=<n>/<total>`, `Blocker.reason`에 미승인 문서 목록(§5-3).

#### 5-2. 입력 우선순위 — 하위 호환

문서 데이터가 없는 프로젝트에서 지금 동작이 깨져서는 안 된다. 우선순위 사다리:

| 순위 | 조건 | `value` | `missing` | 비고 |
|---|---|---|---|---|
| 1 | **확정된**(`needs_review=False`) 매핑 중 `required_doc_types`에 속하고 `is_orphaned=False`인 문서가 1건 이상 | 전부 `approved_statuses`면 `1.0`, 아니면 `0.0` | 규칙 5 참조 | 문서 근거 |
| 2 | 위가 0건 & `resources.drawing_approved`가 존재 | `>= 1.0`이면 `1.0`, 아니면 `0.0` | `False` | **기존 동작 그대로** |
| 3 | 둘 다 없음 | `component_defaults.drawing_approval_unknown`(0.5) | `True` | **기존 동작 그대로** |

1. **문서 근거가 수동 플래그를 이긴다.** 대장의 처리결과는 발주처가 적은 **사실의 기록**이고, `drawing_approved`
   플래그는 누군가 넣은 **주장**이다. 사실이 주장을 이긴다.
2. 두 근거가 충돌할 때(문서=미승인인데 플래그=1) 값은 `0.0`이고 `evidence.extra`에
   `manual_flag_overridden: true`를 남긴다. 조용히 무시하지 않는다.
3. **미확정(`needs_review=True`) 매핑은 순위 1에 들어가지 않는다**(§4 규칙 5). 사람 확정 없이 AI 매핑이 착수 가능
   판단을 바꾸면 CLAUDE.md §0 핵심 원칙 위반이다.
4. **`UNKNOWN` 상태 문서는 "승인 아님"으로 계산된다**(§3-2 규칙 2). 값은 `0.0`이 되고, 그것이 "모른다"임을
   `missing`과 `reason`이 구분해 알린다 — 미승인(REJECTED)과 모름(UNKNOWN)은 blocker 문구에서 구분된다.
5. **`missing`(→ readiness `confidence` 감점) 규칙**:
   `missing = (순위 3에 해당) or (그 Activity에 needs_review=True인 문서 매핑이 1건 이상 존재)`.
   확정 문서가 전부 승인이어도 검토 대기 매핑이 남아 있으면 **우리는 아직 모르는 것**이므로 점수가 아니라
   **confidence**에 반영한다. 기존 `confidence = 1 - 결측 구성요소 비율` 식을 그대로 쓴다.
6. `is_orphaned=True` 문서(최근 대장에서 사라진 행)는 순위 1의 분모·분자 어디에도 넣지 않는다.
7. **어떤 문서를 "필수"로 볼지**는 `document_approval.required_doc_types`(기본 `[TFA]`)로 정한다. 필수는
   **"그 Activity에 확정 매핑된 문서 중 이 종류에 속하는 것"**이다 — 문서가 없는데 요구사항을 발명하지 않는다.
   TFR/FI/RFI 등은 저장·조회는 되지만 readiness를 움직이지 않는다.
8. `document_approval.enabled: false`면 순위 1을 건너뛰어 완전히 기존 동작으로 되돌린다(킬 스위치).

#### 5-3. Blocker 표현 — 기존 구조 안에서

`Blocker` 모델(`component`/`reason`/`related_ids`/`severity`)과 `ComponentResult`(`value`/`missing`/`reason`/
`related_ids`/`note`)는 **구조를 바꾸지 않는다 — 단, 선택 필드 가산은 예외다(개정 1, 아래).** 개정 1이 두 모델
모두에 `kind: str | None = None`을 더했고(`ComponentResult.kind`는 readiness 계산 중 값을 실어 나르는 중간
필드이고, 최종적으로 `Blocker.kind`에 담긴다), 값이 없으면 기존과 완전히 동일하게 동작하므로 하위 호환은 깨지지
않는다. CM이 "무슨 문서를 쫓아야 하는가"를 화면에서 바로 알도록 다음처럼 채운다.

| 필드 | 내용 |
|---|---|
| `component` | `"drawing_approval"` (기존 값 — glossary "차단 구성요소" 변경 없음) |
| `reason` | `"<n>건의 필수 문서가 미승인: <문서번호> «<제목>» (<상태>); …"` — **실제 문서번호와 제목**을 넣는다. 나열 개수는 `document_approval.blocker_document_limit`(기본 5)까지, 초과분은 `" 외 <k>건"` |
| `related_ids` | 해당 문서들의 `doc_id` 목록. 기존 구성요소들이 `activity_id`/`global_id`/`review_request_id`를 넣는 것과 같은 성격(안정 식별자). 프론트는 이 값으로 문서 상세를 연다 |
| `note`(→ `evidence.note`) | `"approved=<n>/<total>; pending_mappings=<k>"` |
| `severity` | 기존 `blocker_severity` 규칙 그대로(value 0.0 → `high`) |
| `kind` | **개정 1.** `document_unapproved` / `document_status_unknown` / `document_mapping_pending` / `None`(문서 근거가 아예 없어 이 컴포넌트가 관여하지 않은 경우). 값이 있으면 화면은 이것만 믿는다 — 아래 표 참고 |

`reason`은 **사람이 읽는 문구**이므로 문서번호를 그대로 노출한다(§2-4대로 파싱하지 않고 원문 표시). `related_ids`는
`doc_number`가 아니라 `doc_id`다 — `doc_number`는 중복·공란이 가능해 식별자로 쓸 수 없기 때문이다(§2-1).

**개정 1 — `Blocker.kind` / `ComponentResult.kind` 추가.** 초판은 이 예외를 두지 않고 "두 모델을 바꾸지 않는다"고만
적었다. 그 결과 화면이 세 갈래를 `reason` **산문의 부분 문자열**로 분류하게 됐다(위 표는 이미 정정된 결과다). 이는
이 저장소가 이미 한 번 걷어낸 패턴이다 — 409 가 다섯 원인에 쓰여 화면이 전부 같은 안내를 하던 문제를 기계 판독
오류 `code` 로 분기해 해소했었다. 문구는 사용자에게 보이는 글이라 다듬어지기 마련이고, 그 순간 분류가 조용히
`other` 로 떨어져 CM 이 "다음에 무엇을 할지"를 잃는다. 아무것도 실패하지 않은 채로.

따라서 `Blocker`와 `ComponentResult`에 **선택적** 필드 `kind: str | None`을 더한다(구조 변경이 아니라 가산이므로
초판의 취지를 지킨다. 값이 없으면 기존과 동일). `ComponentResult.kind`가 `drawing_component()`(§5-2) 안에서
채워지고, 그 값이 그대로 최종 `Blocker.kind`로 전달된다. `drawing_approval` 은 다음 셋 중 하나를 넣는다.

| `kind` | 갈래 | CM 이 할 일 |
|---|---|---|
| `document_unapproved` | 승인되지 않은 필수 문서가 있다 | 그 문서의 승인 진행을 쫓는다 |
| `document_status_unknown` | 필수 문서가 전부 처리결과 미기재(UNKNOWN) | 대장을 갱신한다 |
| `document_mapping_pending` | 확정 매핑은 없고 검토 대기 매핑만 있다 | 매핑을 확정한다 |

화면은 `kind` 가 있으면 **그것만 믿고**, 문구 매칭은 이 필드 이전 응답을 위한 폴백으로만 남긴다.

미확정 매핑만 있는 경우의 문구는 다르다: `"문서 매핑 <k>건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음"`.
`UNKNOWN`만 있는 경우: `"<문서번호> «<제목>» 처리결과 미기재(UNKNOWN)"` — 미승인과 구분된다.

**architect 승인 (2026-09-03).** 이 모델 변경(`packages/core/models/progress.py`의 `Blocker.kind`,
`services/progress/readiness.py`의 `ComponentResult.kind`)은 위 개정 1의 근거가 된 구현과 **같은 커밋에서
자기 인가로** 반영됐다 — `packages/core/models/`와 `docs/adr/`는 architect 소유이므로(CLAUDE.md §2, §2 소유
규칙 2: "구현 에이전트는 필드 추가를 **제안**할 수 있다(직접 수정 금지)") 절차 위반이다. architect로서 사후
검토한 결과 **설계 결론 자체는 승인**하며 되돌리지 않는다. 근거: (1) `kind`는 선택 필드(`str | None = None`)
가산이라 값이 없는 기존 소비자·저장된 데이터와 하위 호환이 전혀 깨지지 않는다. (2) `reason` 산문을 부분
문자열로 분류하는 패턴은 이 저장소가 오류 응답 `code`(glossary "오류 응답 code 어휘")로 이미 한 번 걷어낸
것과 정확히 같은 문제이므로 같은 해법(기계 판독 필드를 문구와 분리)이 타당하다. 절차 위반 자체는 기록으로
남기되 설계는 유지한다 — 앞으로 `packages/core/models/` 변경은 구현 전 architect 선행 승인을 거칠 것
(CLAUDE.md §2).

### 6. 3중 검증(`rules/verification.yaml`)에 대한 제안

3중 검증은 신고(report) / 스캔(scan) / 시스템 논리(logic)의 3축이다(ADR 0001 §6). 문서 승인 상태는 **`logic` 축**에
속한다 — 신고도 물리 증거도 아니고, 시스템이 보유한 다른 사실과의 대조이기 때문이다.

**`rules/verification.yaml`은 `knowledge`가 소유하므로 이 ADR은 필요한 필드와 패턴을 제안만 한다.**

#### 6-1. `logic` 축에 추가로 필요한 필드 (`services/progress/verification.build_logic_context`)

| 필드 | 타입 | 의미 |
|---|---|---|
| `logic.document_evidence_available` | `bool` | 그 객체 귀속 Activity들에 **확정 매핑된 필수 문서**가 1건 이상 있는가 |
| `logic.drawing_approval_status` | `"approved" \| "not_approved" \| "unknown"` | 위가 `False`면 언제나 `"unknown"`. `True`면 전부 승인 시 `"approved"`, 아니면 `"not_approved"` |
| `logic.unapproved_document_count` | `int` | 미승인(승인 아님) 필수 문서 수. 근거가 없으면 `0` |
| `logic.unapproved_document_numbers` | `list[str]` | 위 문서들의 `doc_number`(표시용). 검토요청 문구에 쓴다 |
| `logic.pending_document_mappings` | `int` | `needs_review=True` 문서 매핑 수 |
| `logic.rejected_document_count` | `int` | 확정 매핑된 필수 문서 중 `approval_status == REJECTED`(반려)인 것의 수. `document_evidence_available`이 `False`면 언제나 `0`. **개정 1** — 아래 설명 참고 |

**개정 1 — `logic.rejected_document_count` 신설.** 초판 표에는 이 필드가 없었다. `knowledge`가
`rules/verification.yaml`을 구현하며 VER-008/009를 가르는 조건으로 신설했고(`services/progress/verification.py`
`build_logic_context`가 실제로 채운다), 이 ADR이 뒤늦게 등록한다(6·7차 반려와 같은 유형의 누락이었다). 필요한
이유: `drawing_approval_status == 'not_approved'` 하나만으로는 REJECTED(발주처가 명시적으로 거부한 것 — 확실)와
RESUBMIT_REQUIRED/IN_REVIEW/UNKNOWN(대장에 아직 반영되지 않았을 뿐일 수 있는 것 — 불확실)이 뭉뚱그려진다. 반려와
그 외 미승인은 심각도가 다르므로, 검증 패턴의 `confidence`도 달라야 한다 — 아래 §6-2가 그 구분을 반영한다.

#### 6-2. 패턴

**개정 1 — VER-008을 반려/그 외 미승인으로 분리.** 초판은 `drawing_approval_status == 'not_approved'`만으로
완료 신고 이상 패턴 하나(VER-008, confidence 0.8)를 제안했다. `knowledge`가 구현하며 위 `rejected_document_count`로
반려(확실)와 그 외 미승인(불확실)을 분리해 VER-008/009 두 패턴으로 나눴고, 초판 VER-009(스캔 축)는 VER-010으로
밀렸다. 아래는 `rules/verification.yaml`에 실제로 반영된 값이다.

```yaml
  - id: VER-008
    title: "반려된 도면 상태에서 완료 신고"
    when: "report.claimed_state == 'completed' and logic.rejected_document_count > 0"
    severity: high
    confidence: 0.9
  - id: VER-009
    title: "미승인(불확실) 도면 상태에서 완료 신고"
    when: "report.claimed_state == 'completed' and logic.drawing_approval_status == 'not_approved' and logic.rejected_document_count == 0"
    severity: high
    confidence: 0.6
  - id: VER-010
    title: "미승인 도면 상태에서 스캔 완료추정"
    when: "scan.state == 'ESTIMATED_DONE' and logic.drawing_approval_status == 'not_approved'"
    severity: medium
    confidence: 0.7
```

VER-008(반려, confidence 0.9)과 VER-009(그 외 미승인, confidence 0.6)를 가르는 것이 `rejected_document_count`다 —
반려는 발주처의 명시적 거부이므로 확실하고, 그 외(RESUBMIT_REQUIRED/IN_REVIEW/UNKNOWN)는 "대장 갱신이 늦었을
뿐일 수도 있다"는 불확실성이 남는다. VER-010(초판 VER-009)은 그대로 스캔 축을 담당하며, 실무적으로 값이 크다는
근거도 그대로다 — 도면이 승인되지 않았는데 물리적으로 지어져 있다는 것은 **재시공 리스크**의 조기 신호다.

**제약(반드시 지킬 것): `"unknown"`을 조건으로 삼는 패턴은 만들지 않는다.** 문서 데이터가 없는 프로젝트에서 모든
객체가 `unknown`이 되므로, 그것으로 검토요청을 만들면 **전 프로젝트가 검토요청으로 뒤덮인다**. 조건은 언제나
`== 'not_approved'`로 쓴다(§3-2 규칙 2가 readiness에서 unknown을 다루는 방식과 역할 분담: 점수는 unknown을 반영하고,
검토요청은 확실한 근거가 있을 때만 만든다).

### 7. 인가 (ADR 0006)

| 행위 | 요구 프로젝트 역할 | 근거 |
|---|---|---|
| 대장 업로드(`POST /projects/{pid}/documents` 또는 `xlsx` 파일 업로드) | **`cm`만** | 아래 규칙 1 |
| 문서 조회(목록·상세) | `contractor` / `cm` / `client` (= 모든 프로젝트 멤버). 전역 `admin`은 조회 가능 | ADR 0006 §2·규칙 1·3 |
| 문서 매핑 제안 생성(수동) | `cm` | 규칙 2 |
| 문서 매핑 확정(`needs_review=False`) / `document_mapping` 검토요청 해소 | **`cm`만** | ADR 0001 §4-1·§6, ADR 0006 규칙 7 |
| 전역 `admin` | 조회만. 위 행위 라우트는 403 `forbidden_role` | ADR 0006 §2-1 |

1. **대장 업로드를 `cm`으로 제한한다** — 기존 파일 업로드 라우트가 `contractor`/`cm`을 허용하는 것과 다르다.
   근거: 대장의 `처리결과`는 **발주처·CM 측 판단의 기록**이고, 그것이 이제 착수 가능 판단(readiness)을 움직인다.
   시공사가 대장을 올릴 수 있으면 **피검자가 자기 승인 상태를 스스로 기록**하는 구조가 되어, ADR 0001 불변식 1
   ("확정은 cm만")을 데이터 입력 경로로 우회하게 된다. 스캔 판정을 시공사가 제출할 수 없는 것과 같은 이유다.
   따라서 `services/api/routers/files.py`의 업로드 라우트는 **파일 종류가 대장일 때 `require_project_role("cm")`**로
   좁힌다(다른 종류는 기존대로 `contractor`/`cm`). 위반 시 403 `forbidden_role`이며 `detail`에 사유를 남긴다.
2. 매핑 제안 생성도 `cm`으로 둔다. 매핑은 어차피 `cm`만 확정할 수 있으므로(§4 규칙 5), 제안 권한을 넓혀도 얻는 것이
   없고 검토 큐만 오염된다.
3. 프로젝트 범위 검사는 ADR 0006 규칙 2·6을 그대로 따른다: 멤버가 아니면 404 `project_not_found`,
   다만 **문서에는 "행을 먼저 읽는" 방식을 쓸 수 없다.** ADR 0006 규칙 3이 `/files/{id}`·`/drawings/{id}`에
   대해 그렇게 하는 것은 그 id 들이 전역 유일하기 때문이다. `doc_id` 는 §2-1 대로 `(doc_type, sender_normalized,
   seq_normalized, title_normalized)` 해시이고 **재료에 `project_id` 가 없다** — 같은 대장을 두 프로젝트에 올리면
   `doc_id` 가 그대로 겹친다(실측: 10건 전부 충돌). 행을 먼저 읽으면 어느 프로젝트의 행인지 정할 수 없다.
   이것이 §2-3 이 "`doc_id` 단독 조회 금지"를 못박은 이유이며, 따라서 `GET /documents/{doc_id}` 는
   **`project_id` 를 필수 인자로 받아 멤버십을 먼저 검사한 뒤 `(project_id, doc_id)` 로 조회한다.**
   (개정 1: 초판은 여기서 다른 surrogate id 라우트와 같은 방식을 적어 §2-3 과 모순됐다.)

### 8. 파일 종류 · 작업 종류 · 오류 code

1. **`FileKind`에 `xlsx`를 추가한다.** `detect_file_kind`는 확장자(`.xlsx`) 우선, 확장자가 없으면 ZIP 시그니처
   (`PK\x03\x04`) + 아카이브 안에 `xl/workbook.xml` 존재로 확인한다(`.ifczip`과 구분하기 위해 필요).
2. **`JobRow.kind`에 `document_register`를 추가한다.** `job_kind_for("xlsx") -> "document_register"`.
   `services/ingest.ingest_file`은 `xlsx`를 처리하지 않는다 — 기존 `KIND_NOT_HANDLED_BY_INGEST` 경로 그대로다
   (ingest는 IFC/DXF/DWG/RVT만, 그 외는 scan/progress가 처리).
3. **대장 CSV는 지원하지 않는다.** `csv`는 이미 공정표(`schedule`)로 예약되어 있어 같은 확장자로 두 파이프라인을
   구분할 수 없다. xlsx만 받는다(Deferred).
4. `openpyxl`을 런타임 의존성에 추가한다(`pyproject.toml`). 대장을 읽는 유일한 목적이며 쓰기는 하지 않는다(§1 규칙 2).
5. 새 오류 code(글로서리 "오류 응답 code 어휘"에 행 추가):

| code | HTTP | 발생 조건 |
|---|---|---|
| `document_not_found` | 404 | `(project_id, doc_id)`로 문서를 찾을 수 없음 |
| `document_register_invalid` | 422 | 업로드된 대장에서 헤더 행을 찾지 못했거나 필수 컬럼(`제목`)이 없어 어떤 시트도 읽을 수 없음 |
| `document_mapping_target_not_found` | 404 | 매핑 생성·확정이 가리키는 `doc_id` 또는 `activity_id`가 그 프로젝트에 없음 |

`forbidden_role`(403)의 조건이 확장된다: 대장 업로드는 그 프로젝트의 `cm`만(§7 규칙 1).

6. **적재 경고(warning) code — 실패가 아니라 신호(개정 2 — 신설).** 위 5번 표는 요청을 거부하는 HTTP 오류
   code다. 이와 별개로 **적재는 성공하되 사람이 봐야 하는 상태**를 `JobRow.warnings`에 `{code, message,
   context}`로 남기는 경고 code가 있다. 대장 파싱 고유 경고(`duplicate_doc_number`/`doc_number_mismatch`/
   `document_possibly_renamed`/`header_row_not_found`/`required_column_missing`/`document_status_unmatched`/
   `sheet_skipped`)는 이미 `config/document_register.yaml`의 `import_warnings` 카탈로그에 등록돼 있다(§2-1
   규칙 3, §2-5, §3-2 규칙 3). 다음 하나는 **그 카탈로그에도, 이 ADR에도 등록되지 않은 채** 코드에만 있었다
   (9차 리뷰 지적):

   | code | 발생 위치 | 의미 | 비고 |
   |---|---|---|---|
   | `DOCUMENT_UNMAPPED` | `services/progress/document_mapper._unmapped_document_warnings`(`map_project_documents`가 호출, §4-3) | 어떤 Activity 에도 매핑 후보가 없는 문서가 있음을 알린다 — 대장이 공정표보다 먼저 올라왔거나, 제목 유사도가 `title_matching.min_similarity` 미만이거나, Activity 이름에 공유 도메인 명사가 없는 경우 등 | `context`에 `unmapped_count`/`by_doc_type`/`doc_ids`(최대 50개)를 싣는다 |

   **코드 식별자 스타일이 다른 이유.** 대장 파싱 경고들은 `config/document_register.yaml`의 `import_warnings`
   카탈로그에 `snake_case`로 등록되고 메시지도 그 파일에서 관리된다. `DOCUMENT_UNMAPPED`는 지금
   `services/progress/document_mapper.py`에 `_UNMAPPED_WARNING_CODE = "DOCUMENT_UNMAPPED"`로 하드코딩돼 있어
   대문자 스타일이다 — `services/api/jobs.py`의 다른 경고 code(`SCHEDULE_WARNING`/`NO_MODEL`/`MAPPING_NOT_BUILT`
   등)와 같은 관례를 따른 것으로 보이나, 같은 파일(`document_register.yaml`) 안에서 두 대소문자 스타일이 섞이는
   것은 바람직하지 않다. 이 정리는 이번 ADR의 범위가 아니다(architect는 코드를 고치지 않는다) — 카탈로그 이관
   여부는 `progress-engine`이 판단할 문제로 남긴다.

   **발화 조건은 이 ADR이 아니라 config가 소유한다.** `progress-engine`이 현재 이 경고의 발화 조건을 고치고
   있다(정상 상태에서도 항상 뜨는 신호 대 잡음 문제 때문). 따라서 이 ADR은 "무엇을 알리는 경고인가"만 고정하고
   구체적 발화 임계값·조건은 명시하지 않는다 — 명시하면 이 ADR이 다음 개정을 기다리지 않고 바로 코드와
   어긋난다.

### 9. 설정 불변식 보호 — `UnsafeConfigOverrideError` (개정 2 — 신설)

#### 9-1. 무엇이고 왜 있는가

`services/progress/config_loader.py`가 두 로더(`load_readiness_config`/`load_document_register_config`)에
`_assert_invariant` 검사를 심어 두었다. 이 ADR이 코드에 하드코딩한 **안전 불변식**을, 같은 값으로 config에도
"문서화"해 둔 자리가 있다 — 예를 들어 `readiness.yaml`의 `document_approval.scoring: all_or_nothing`은
§5-1("도면 승인은 비율이 아니라 논리곱")을 config가 되풀이해 적어 둔 것일 뿐, `readiness.drawing_component()`는
이 값을 **읽어서 분기하지 않는다** — 논리곱 계산은 코드에 고정돼 있다. 검사는 이 값이 코드의 실제 불변식과
**다른 값**으로 바뀌면 로딩 시점에 `UnsafeConfigOverrideError`(`ValueError` 서브클래스)를 던진다.

**왜 조용히 무시하지 않는가.** 이 값들은 코드가 읽지 않으므로, 값을 바꿔도 아무 일도 일어나지 않는 것이
"안전한 무시"처럼 보인다. 그러나 그것이 정확히 위험한 지점이다 — 운영자가 `scoring: ratio`로 바꾸고 "이제
비율로 계산되겠지"라고 믿지만 실제로는 아무것도 바뀌지 않는다. 믿음과 실제 동작이 어긋난 채로 조용히
지나가면 그 어긋남을 알아차릴 방법이 없다. CLAUDE.md §0 핵심 원칙("AI는 추정까지, 확정은 사람")과 같은 구조의
문제다 — 안전 장치를 끄려는 시도가 겉보기에 성공한 것처럼 보이는 것이, 시도가 요란하게 실패하는 것보다
훨씬 위험하다. 이 검사는 **"끄는 스위치가 없다"는 사실을 강제로 드러내는 장치**다.

#### 9-2. 대상 키

| config 파일 | 키 | 요구값 | 문서화하는 불변식 |
|---|---|---|---|
| `readiness.yaml` | `document_approval.use_confirmed_mappings_only` | `true` | §5-2 규칙 3 — 미확정(`needs_review=True`) 매핑은 readiness 점수에 반영하지 않는다 |
| `readiness.yaml` | `document_approval.scoring` | `"all_or_nothing"` | §5-1 — 도면 승인은 비율이 아니라 논리곱(AND) |
| `document_register.yaml` | `title_matching.auto_confirm` | `false` | §4-2 규칙 5 — 문서 매핑은 유사도 값과 무관하게 항상 `needs_review=True` |
| `document_register.yaml` | `mapping.always_needs_review` | `true` | §4-2 규칙 5(위와 같은 불변식의 다른 표현) |

키가 아예 없으면 검사하지 않는다(하위 호환 — 옛 config 파일에 이 키들이 없어도 로딩은 통과한다). **키가 있는데
다른 값이면** 실패시킨다. `document_approval` 섹션 전체가 없어도 마찬가지로 통과한다(§5-2 규칙 8의 킬 스위치
`document_approval.enabled: false`와는 다른 이야기다 — 그건 기능 자체를 끄는 것이고, 이 검사는 "켜져 있는데
불변식만 몰래 바뀌는 것"을 막는다).

#### 9-3. 폭발 반경(reviewer 실측) — 왜 이 절이 중요한가

설정 오타 하나가 무엇을 멈추는지 운영자가 알아야 한다는 것이 이 ADR이 폭발 반경을 명시하는 이유다.

| 오염된 파일 | 실패 시점 | 관측되는 증상 | 범위 |
|---|---|---|---|
| `readiness.yaml` | `load_readiness_config()`를 호출하는 모든 경로 — ① API 요청 경로: `services/progress/readiness.py` readiness 계산, `services/progress/scheduler.py` startable 목록 ② **job 경로(개정 2 정정)**: `services/progress/verification.build_logic_context`가 3중 검증 `logic` 축을 만들 때마다(§6-1) 무조건 호출하고, 이 함수는 `services/api/jobs.run_verdict`가 스캔 verdict 하나마다 부른다 | ①은 그 **요청**이 500으로 실패한다 — `UnsafeConfigOverrideError`가 `services/api/errors.py`에 등록된 전용 핸들러(`ApiError`/`HTTPException`/`InvalidTransitionError`/`TransitionBlockedByReviewError`/`ObjectNotFoundError`) 중 어느 것에도 걸리지 않으므로 FastAPI 기본 처리로 떨어진다. ②는 그 **verdict job 전체**가 `failed`로 끝난다 — `run_verdict`가 예외를 잡지 않으므로 `run_job`의 최상위 `except Exception`에 걸린다(정합·판정 결과 자체가 저장되지 않는다) | ①은 **요청 단위**, ②는 **job 단위**. 어느 쪽도 프로세스/워커를 죽이지 않는다 — 다음 요청·다음 job은 (같은 config를 다시 읽으므로) 똑같이 실패하지만 서버·워커 자체는 살아 있다. reviewer 9차가 실측한 것은 ①(readiness·startable API)뿐이었다 — ②는 이 개정에서 코드를 따라가며 추가로 확인한 것이다 |
| `document_register.yaml` | `map_project_documents`를 호출하는 모든 경로 — §4-3의 세 지점(대장 업로드 job, 공정표 업로드 job, 수동 재생성 API) | **대장 업로드 job**은 그 job이 `failed`로 끝난다(대장 자체가 못 들어온다). **공정표 업로드 job**은 §4-3의 원칙대로 **`"done"`으로 끝나고 실패는 `DOCUMENT_MAPPING_RESYNC_FAILED` 경고로만 보고된다** — 공정표·activities·relations·객체매핑은 정상 저장된다. 이 처리 이전에는 부가 회복의 예외가 `run_job`의 최상위 `except Exception`에 잡혀 job 전체가 실패로 덮어써지고 롤백으로 공정표까지 사라졌다. 수동 재생성 API는 그 호출이 500 | job 단위. 프로세스는 죽지 않는다. 대장 업로드 job 이 함께 강등되지 않는 것은 의도적이다 — 그 잡에서는 매핑이 부가 효과가 아니라 목적이므로, 실패했는데 `done` 이라고 보고하면 실패를 숨기는 것이 된다 |

**두 파일 모두 프로세스 전체를 죽이지 않는다** — Celery 워커든 API 프로세스든, 다음 요청/다음 job은 다시
독립적으로 시도되고 다시 같은 이유로 실패할 뿐이다(config 파일이 디스크에서 고쳐지기 전까지). "프로세스가
죽는다"는 오해를 막기 위해 이 표에 명시한다.

#### 9-4. 무엇을 하면 안 되는가

이 검사가 존재하는 한, §9-2의 네 키를 요구값과 다르게 바꾸는 config 변경은 **설계 자체가 반려 대상**이다.
같은 불변식을 진짜로 바꾸고 싶다면 이 키의 값을 바꾸는 것이 아니라 **코드의 불변식 자체를 바꾸는 ADR**을
새로 써야 한다(예: "도면 승인을 비율로 바꾼다"는 §5-1을 대체하는 개정) — 그때는 `_assert_invariant`의 요구값도
함께 바뀌어야 한다.

## Consequences

- **(개정 2) 문서 고아화가 검토 큐를 스스로 청소하지만, config 오타 하나가 넓은 반경을 멈출 수 있다.**
  `document_mapping` 검토요청은 문서가 고아가 되면 자동으로 `on_hold`로 닫히고 문서가 돌아오면 자동으로 다시
  열린다(§4-2 규칙 6) — CM이 죽은 요청을 손으로 정리할 필요가 없다. 그 대가로 `readiness.yaml`/
  `document_register.yaml`의 네 안전 불변식 키(§9-2)를 건드리면 로딩이 요란하게 실패한다 — 운영자가 이 ADR을
  몰라도 실패 메시지 자체가 사유와 요구값을 담고 있지만, **폭발 반경**(readiness·startable 조회는 요청 단위
  500, 3중 검증을 만드는 verdict job·대장/공정표 업로드 job은 job 단위 `failed`, §9-3)은 실패 메시지만으로는
  짐작하기 어려워 여기 명시해 둔다.
- **착수 가능 판단의 15%가 추측에서 근거로 바뀐다.** `drawing_approval`이 발주처가 대장에 적은 사실에서 나오고,
  차단 사유에 **실제 문서번호와 제목**이 실려 CM이 무엇을 쫓아야 하는지 화면에서 바로 안다.
- **문서 데이터가 없는 프로젝트는 아무것도 바뀌지 않는다.** §5-2 순위 2·3이 기존 동작을 그대로 보존하고,
  `document_approval.enabled: false` 킬 스위치가 있다. 가중치 합 1.0도 불변이다.
- **비용: 사람의 확정 작업이 새로 생긴다.** 모든 문서 매핑이 CM 검토 큐를 거친다(§4 규칙 5). 이것은 부작용이 아니라
  의도한 설계다 — 절차서가 "0.9 이상이어도 자동 확정 금지"라고 못 박은 이유이고, ADR 0001이 스캔 AI에 건 제약과
  같은 것이다. 검토 부담이 실제로 과하면 완화 수단은 임계값 조정이 아니라 **후보 수를 줄이는 것**이어야 하되,
  문서 **정체성**(`doc_id`)에 영향이 없는 수단으로 한정한다 — 판별 토큰 추가(§4 규칙 3), `mapping.min_confidence_to_propose`
  상향(§4 규칙 4 — 후보 하한만 올리며 `doc_id` 산출에는 관여하지 않는다). **제목 정규화(`title_matching.normalize`)
  보강은 이 완화 수단에서 제외한다** — §2-1 개정 1이 실측으로 확인했듯 그 규칙을 건드리면 `doc_id`가 바뀌어 CM이
  확정한 매핑이 조용히 끊긴다(픽스처 10건 중 7건). 정규화 보강은 §2-1 개정 1이 제안한 **정체성용/대조용 정규화
  분리** 이후로 미룬다.
- **초기에는 `drawing_approval`의 confidence가 낮게 나온다.** 검토 대기 매핑이 쌓여 있는 동안 `missing=True`이므로
  readiness `confidence`가 떨어진다. 이는 정확한 신호다 — "점수는 이렇지만 우리는 아직 모른다".
- 처리결과 규칙표(`status_normalization`)는 **현장마다 보강해야 하는 운영 자산**이다. `register_status_unmatched`가
  많이 나오면 규칙표를 늘리라는 신호이며, 그때까지도 안전한 쪽(`UNKNOWN`)으로 떨어진다.
- 문서 상태는 객체 상태기계와 완전히 분리되어 있다(§3-1). `APPROVED`가 어떤 객체도 `CONFIRMED`로 만들지 않는다.
- 대장은 여전히 사용자의 xlsx 파일이다. BuildTwin이 대장을 갱신해 주지 않으므로 **주간 재업로드가 운영 절차에
  포함**되어야 한다. 마지막 적재 시각(`imported_at`)과 대장 파일명을 화면에 노출해 "언제 기준 데이터인가"를 알린다.

## Alternatives considered

- **`(project_id, doc_number)`를 자연 복합키로**: 대장에 이미 있는 값이라 매력적이지만, 공란·중복·수식 파생·협력사
  오기입이 모두 실재하므로 유니크 제약이 곧 **대장 적재 거부**가 된다. 우리가 소유하지 않은 데이터에 무결성 제약을
  거는 설계라 기각(§2-1).
- **자동증가 정수 대리키**: 재업로드마다 별도의 자연 조회 키가 또 필요해 결국 §2-1의 해시 키를 만들게 된다. 결정적
  키가 그 일을 한 번에 하므로 기각.
- **`drawing_approval`을 승인 비율(0~1)로**: 진척이 보이는 장점이 있으나 9/10 = 0.9가 `start_threshold` 0.75를 넘겨
  **미승인 도면 위에서 착수 가능**을 띄운다. 비율은 점수가 아니라 blocker 문구로 보고하기로 하고 기각(§5-1).
- **가중치 재조정(예: `drawing_approval`을 0.25로 올리고 다른 항목을 깎기)**: 입력이 근거 있는 값으로 바뀌었으니
  비중을 올릴 만하다는 주장은 가능하나, **실제 현장 데이터로 검증하기 전에는 어떤 숫자도 근거가 없다.** 이번에는
  입력만 교체하고 가중치는 그대로 둔다. 데이터가 쌓이면 별도 ADR.
- **유사도가 매우 높으면(≥0.95) 자동 확정**: 검토 부담을 크게 줄이지만, 절차서가 정확히 이 경우(ZONE·구간·차수만
  다른 문서)를 위험으로 지목했다. 판별 토큰 배제(§4 규칙 3)로 상당 부분 걸러지지만 **걸러진다는 보장이 없고**,
  틀린 매핑 하나가 착수 가능 판단을 오염시킨다. 기각.
- **`doc_number`를 파싱해 발신/공종/번호를 복원**: 재료가 이미 별도 컬럼으로 존재하고, 공종 두 토큰 + 번호 내 하이픈이
  겹쳐 구분자만으로 경계를 결정할 수 없다. 얻는 것 없이 실패 지점만 늘어 기각(§2-4).
- **공종 불일치를 감점 또는 배제 사유로**: 직관적이지만 절차서의 교훈과 정반대다. 협력사가 공종을 틀리게 적는 것이
  흔하므로, 불일치를 근거로 쓰면 **맞는 문서를 버린다.** 가점만 주기로 결정(§4 규칙 2).
- **대장을 BuildTwin이 대체(문서 발행·회신 워크플로 내장)**: 사용자가 매주 갱신하는 대장이 정본이고 발주처·협력사가
  그것을 본다. 대체는 MVP 범위 밖이며 채택 장벽만 높인다. 기각(§1).

## Deferred (별도 ADR 또는 후속 사이클)

- **대장 write-back**: BuildTwin의 판단(누락 문서·매핑 상태)을 대장 파일로 되쓰기. 이번 범위 밖(§1 규칙 2).
- **문서 ↔ 객체 직접 매핑**: 대장에 객체 식별 정보가 없어 현재는 근거가 없다. 도면 첨부 원본에서 부재 정보를 뽑을 수
  있게 되면 다시 본다.
- **다른 실무 문서 연동**(회의록·기성·하도급계약 검토·확인서): 각각 데이터 형태와 소비처가 달라 별도 ADR로 연다.
- **문서 차수(revision) 체인**: `1차/2차` 관계를 명시적 링크로 관리(현재는 판별 토큰으로 **구분만** 한다).
- **대장 CSV 입력**: `csv`가 공정표로 예약되어 있어 구분 수단이 생긴 뒤에.
- **첨부 원본(PDF) 파싱으로 제목 대조 보강**: 대장 제목이 원본과 다를 때 원본에서 제목을 읽는 경로.
- **문서 SLA·회신 지연 지표**: `issued_on` ↔ `completed_on` 차이를 위험 신호로 쓰는 규칙(knowledge 영역).
