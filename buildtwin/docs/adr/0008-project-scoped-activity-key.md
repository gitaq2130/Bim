# ADR 0008 — Activity 키를 프로젝트 범위로: `(project_id, activity_id)` 복합 키

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-03
- 관련: ADR 0005(객체 키 프로젝트 범위화 — **이 ADR 은 그 결정의 같은 형태를 Activity 에 적용한다**),
  ADR 0006 규칙 6(대리키 라우트 인가), ADR 0007 §2-3(문서 대리키)·§Deferred(`_drop_already_confirmed` 의
  project 미검사), 14차 리뷰 실측

## Context

### 1. 증상 — 두 번째 프로젝트가 첫 번째 프로젝트의 공정표를 통째로 가져간다

`ActivityRow.activity_id` 가 **전역 기본키**다(`packages/core/models/orm.py:162`). `activity_id` 는 우리가
만드는 값이 아니라 공정표 파일에 적혀 오는 값(`A100`, `A110` …)이므로, 같은 공정표를 두 프로젝트에 올리면
반드시 충돌한다. `services/progress/persistence.py:save_schedule` 은 그 충돌을 이렇게 처리하고 있었다.

```python
for a in schedule.activities:
    existing = session.get(ActivityRow, a.activity_id)   # project_id 를 보지 않는다
    if existing is not None:
        session.delete(existing)                          # 남의 프로젝트 Activity 를 지운다
        session.flush()
    session.add(ActivityRow(activity_id=a.activity_id, ..., project_id=schedule.project_id, ...))
```

즉 **두 번째 업로드가 첫 번째 프로젝트의 Activity 를 삭제하고 자기 것으로 다시 만든다.** 실측했다
(TestClient 로 p1·p2 에 같은 `tests/fixtures/schedule.csv` 업로드):

```
[STEP 1] p1 업로드 직후 GET /projects/p1/activities -> 6 건: ['A100','A110','A120','A200','A300','A400']

[STEP 2] p2 에 같은 schedule.csv 업로드 후
  GET /projects/p-4a7f91f95841/activities -> 0 건: []
  GET /projects/p-e5ba38e7acee/activities -> 6 건: ['A100','A110','A120','A200','A300','A400']

[STEP 3] activities 테이블 전체 6 행:
    activity_id=A100 project_id=p-e5ba38e7acee schedule_id=p-e5ba38e7acee:f-3afa1673e60e_schedule
    ... (6행 모두 p2)
  schedules 테이블 2 행: p-4a7f91f958…/p-4a7f91f95841, p-e5ba38e7ac…/p-e5ba38e7acee
  activity_object_mappings 27 행, project_id 분포: {'p-e5ba38e7acee': 27}

[STEP 5] p1 startable=200 n=0   p2 startable=200 n=1
```

p1 의 `ScheduleRow` 는 남아 있는데 Activity 가 0건이다. **어떤 API 도 오류를 내지 않는다** — p1 은 그냥
"공정표를 올린 적 없는 프로젝트"처럼 조용히 보인다. `activity_object_mappings` 27행도 p2 로 넘어갔다.
이쪽은 삭제가 아니라 다른 경로다: 그 테이블의 PK 도 `(activity_id, global_id)` 로 전역이라
`save_mappings` 의 `session.get(...)` 이 p1 의 행을 찾아 `project_id` 를 p2 로 **덮어썼다**.

### 2. 파생 증상 — 문서 매핑 교차 프로젝트 누수 (ADR 0007 §Deferred)

ADR 0007 은 `_drop_already_confirmed` 가 `project_id` 를 검사하지 않는다는 것을 Deferred 로 남기며
"지금은 `activity_id` 가 전역 고유해 무해하지만 그 스키마가 고쳐지는 순간 교차 프로젝트 누수가 된다"고
적었다. 실측해 보면 **스키마를 고치기 전인 지금 이미 누수다** — 무해하지 않다:

```
[p1] 대장 업로드 result: mapping_count=6
[p1] 열린 document_mapping 검토요청 6건
  confirm A100/doc-ca45b33c16825a28 -> 200
  confirm A110/doc-39a82d0d1cf27a91 -> 200
  reject  A120/doc-284c2190a831117f -> 200

[p2] 대장 업로드 result: mapping_count=3   ← 6 이어야 한다
[p2] 열린 document_mapping 검토요청 3건

[DB] activity_document_mappings 총 6 행
    A100/doc-ca45b33c16825a28  project_id=p1  reviewed_by=u-cm-…  needs_review=False
    A110/doc-39a82d0d1cf27a91  project_id=p1  reviewed_by=u-cm-…  needs_review=False
    A120/doc-284c2190a831117f  project_id=p1  reviewed_by=u-cm-…  needs_review=False
    A200/doc-be162aaf4dfa86bf  project_id=p2  reviewed_by=None    needs_review=True
    A300/doc-6ba01a1e1c628fcf  project_id=p2  reviewed_by=None    needs_review=True
    A400/doc-e2dfc7f22b37f1a9  project_id=p2  reviewed_by=None    needs_review=True

[p1] 업로드 후 GET /projects/p1/activities -> 0 건
```

p1 에서 CM 이 판단한 3쌍이 p2 의 후보 생성을 막았다. p2 의 CM 은 **자기가 본 적도 없는 남의 판단 때문에**
문서 3건이 매핑 큐에 뜨지 않는 것을 겪는다. 그 3건은 `drawing_approval` readiness 근거로도 영원히 잡히지
않는다(고아가 된 p1 행은 `document_mappings_for_activities(project_id=p2, …)` 에 걸리지 않으므로). 14차
리뷰가 실측한 `mapping_count` 6→4 와 같은 현상이며, 확정/반려 개수에 따라 감소폭만 달라진다.

### 3. ADR 0005 와 같은 모양

ADR 0005 는 `bim_objects.global_id` 가 전역 PK 라 같은 IFC 를 두 프로젝트에 올릴 수 없던 문제를
`(project_id, global_id)` 복합 키로 풀었다. Activity 는 **같은 문제의 더 나쁜 판본**이다.

| | 객체(ADR 0005) | Activity(이 ADR) |
|---|---|---|
| 키의 출처 | IfcOpenShell 이 발급한 UUID 기반 GlobalId | 공정표 작성자가 적은 짧은 코드(`A100`) |
| 서로 다른 원본끼리 충돌할 확률 | 사실상 0 | **높다** — `A100`·`1.1.1` 은 관례적 명명이라 무관한 두 현장도 겹친다 |
| 같은 원본을 재사용할 때 | 충돌 | 충돌 |
| 충돌했을 때의 동작 | `GlobalIdConflictError` 로 **거부**(시끄러움) | 남의 행을 **삭제하고 가져감**(조용함) |

객체 쪽은 최소한 오류로 멈췄다. Activity 쪽은 조용히 데이터를 옮긴다 — 이번 사이클이 여덟 번 겪은
"모든 테스트가 통과하는데 기능이 조용히 죽어 있는" (A) 계열(한 필드만 보고 판별) 그대로다.

## Decision

### 1. 키

`activities` 의 기본키를 **`(project_id, activity_id)` 복합 키**로 바꾼다. Activity 를 키로 참조하는
테이블은 `project_id` 를 PK 구성요소로 함께 든다.

| 테이블 | 변경 전 | 변경 후 |
|---|---|---|
| `activities` | PK `activity_id`, `project_id` 는 평문 String | PK `(project_id, activity_id)`, `project_id` FK→`projects.project_id` |
| `activity_object_mappings` | PK `(activity_id, global_id)`, `project_id` 평문 | PK **`(project_id, activity_id, global_id)`**, FK `(project_id, global_id)`→`bim_objects` 유지 |
| `activity_document_mappings` | PK `(activity_id, doc_id)`, `project_id` 평문 | PK **`(project_id, activity_id, doc_id)`**, FK `(project_id, doc_id)`→`documents` 유지 |
| `activity_relations` | `schedule_id`+`predecessor_id`+`successor_id`, `project_id` 없음 | `project_id` 컬럼 추가(FK→`projects`, index). PK 는 그대로 대리키 `id` |

`review_requests.activity_id`, `material_movements.activity_id`, `rule_verdicts.activity_id` 는 스키마를
바꾸지 않는다 — 이미 `project_id` 를 갖고 `activity_id` 는 FK 가 아닌 평문 컬럼이다(ADR 0005 가
`global_id` 에 대해 내린 것과 같은 판단). 조회 시 `project_id` 를 함께 거는 것만 지킨다.

### 2. Activity 를 참조하는 테이블에 FK 를 걸지 **않는** 이유 (ADR 0005 와 다른 선택)

ADR 0005 는 자식 테이블에 복합 FK 를 걸어 "조회에서 `project_id` 필터를 빠뜨려도 FK 가 잡아준다"는
스키마 수준 안전망을 얻었다. Activity 에는 그 안전망을 **만들 수 없다.**

`bim_objects` 행은 재업로드에도 살아남는다(상태 유지·`model_version` 증가·`is_orphaned` 표시 — ADR 0001
§1, ADR 0005 규칙 5). 그러나 `activities` 행은 **공정표를 다시 올릴 때마다 삭제되고 다시 만들어진다**
(`save_schedule` 이 그렇게 설계돼 있고, 매핑은 그 삭제를 넘어 살아남아야 한다 — 함수 docstring
"같은 schedule_id 가 있으면 Activity·관계를 교체한다(매핑은 activity_id 기준이라 유지)"). 여기에
`activity_object_mappings → activities` FK 를 걸면 **정상적인 공정표 재업로드가 FK 위반으로 실패**하거나,
cascade 를 걸어 CM 이 확정한 매핑을 통째로 지우게 된다. 어느 쪽도 받을 수 없다.

`activity_relations → activities` 도 같은 이유로 걸지 않는다. 추가로, 같은 프로젝트 안에서 다른
`schedule_id` 가 같은 `activity_id` 를 가져가는 경로(현행 `save_schedule` 의 인계 동작)가 FK 위반이 된다.

**그래서 이 ADR 에는 스키마 안전망이 없다.** 이것을 숨기지 않고 명시한다 — 유일한 방어는
"`activity_id` 만 보고 Activity 를 식별하는 자리"를 **전수로 찾아 고치는 것**이다. 계획 문서가 그 전수
목록을 든다. 대신 복합 PK 자체가 **부분적인 시끄러움**은 준다(§3).

### 3. 복합 PK 는 낡은 호출부를 조용히 틀리게 하지 않고 **터뜨린다**

`session.get(Row, key)` 는 PK 컬럼 수와 키 튜플의 길이가 다르면 SQLAlchemy 가
`InvalidRequestError` 를 던진다. 따라서 이 변경 이후 다음 8개 호출부는 **전부 즉시 예외**가 된다 —
잘못된 행을 조용히 돌려주지 않는다.

```
services/progress/persistence.py:141   session.get(ActivityRow, a.activity_id)
services/progress/persistence.py:185   session.get(ActivityRow, activity_id)
services/progress/persistence.py:209   session.get(ActivityRow, m.activity_id)
services/progress/persistence.py:214   session.get(ActivityObjectMappingRow, (m.activity_id, m.global_id))
services/progress/persistence.py:314   session.get(ActivityRow, mapping.activity_id)
services/progress/persistence.py:318   session.get(ActivityDocumentMappingRow, (mapping.activity_id, mapping.doc_id))
services/progress/document_mapper.py:296  session.get(ActivityDocumentMappingRow, (m.activity_id, m.doc_id))   ← _drop_already_confirmed
services/progress/document_mapper.py:494  session.get(ActivityDocumentMappingRow, (activity_id, doc_id))
services/api/usecases.py:347           session.get(ActivityDocumentMappingRow, (activity_id, doc_id))
services/api/usecases.py:485           session.get(ActivityDocumentMappingRow, (row.activity_id, str(doc_id)))
```

ADR 0007 §Deferred 가 지목한 `_drop_already_confirmed` 가 이 목록에 들어 있다 — 즉 **이 스키마 변경은
그 항목을 잊을 수 없게 만든다.** 이것이 "같은 사이클에 함께 다뤄라"를 문서가 아니라 타입으로 강제하는
방법이며, 이 ADR 이 그 Deferred 항목을 해소한다.

조용히 틀릴 수 있는 자리는 `select().where()` 로 쓰인 곳뿐이고, 전수 조사 결과 **하나**다:

```
services/progress/persistence.py:199   predecessors_of(session, activity_id)
    select(ActivityRelationRow).where(ActivityRelationRow.successor_id == activity_id)
```

이 함수만은 손으로 확인해야 한다(계획 문서 §"전수 목록" 1-b 참조).

### 4. 규칙 (ADR 0005 규칙 1·2 의 Activity 판)

1. **`project_id` 는 항상 부모에서 유도한다.** Activity 는 `Schedule.project_id`, Activity↔객체 매핑과
   Activity↔문서 매핑은 그 Activity 의 프로젝트, 관계는 그 Schedule 의 프로젝트에서 가져온다. 호출자가
   임의로 주입하지 않는다.
2. **`activity_id` 단독 조회 금지.** 서비스·API 의 모든 Activity 조회는 `(project_id, activity_id)` 를
   함께 건다. `activity_id` 만 받던 공개 함수는 `project_id` 를 **필수 위치 인자**로 추가한다(옵션으로
   두면 생략을 허용해 규칙이 강제되지 않는다 — `open_reviews` 가 라운드4 에 겪은 것과 같다).
3. **`predecessors_of` 는 `project_id` 를 받는다.** 관계는 `schedule_id` 로 이미 사실상 프로젝트 범위지만
   `successor_id` 단독 조회는 그 범위를 통과하지 않는다.
4. `_drop_already_confirmed` 를 포함해 `ActivityDocumentMappingRow` 를 키로 읽는 모든 자리는
   `(project_id, activity_id, doc_id)` 로 읽는다.

### 5. 대리키 라우트 — ADR 0005 §3(409)이 아니라 ADR 0007 §2-3(필수 `project_id`)을 따른다

대상 라우트는 둘이다.

- `GET /api/activities/{activity_id}/readiness` (`services/api/routers/activities.py:33`)
- `POST /api/documents/mappings/{activity_id}/{doc_id}/confirm` (`services/api/routers/documents.py:119`)

저장소에는 이미 두 가지 선례가 있다.

- **ADR 0005 §3** — `GET /api/objects/{global_id}`: 경로는 그대로 두고, 호출자의 멤버 프로젝트 안에서
  후보를 찾아 0건 404 / 1건 통과 / 2건 이상 **409 + `?project_id=` 요구**.
- **ADR 0007 §2-3** — `GET /api/documents/{doc_id}`: `project_id` 를 **쿼리 필수**로 받고 멤버십부터 검사한
  뒤 `(project_id, doc_id)` 로 읽는다.

Activity 는 **ADR 0007 형태(필수 `project_id`)를 따른다.** 근거:

1. **409 는 "실행 시점에만 나타나는 계약"이다.** 그 라우트는 두 번째 프로젝트가 같은 `activity_id` 를
   가지기 전까지 잘 동작하다가, 그날부터 `project_id` 를 보낸 적 없는 클라이언트에게 409 를 돌려주기
   시작한다. 이번 사이클이 반복한 (C) 계열("화면이 API 에 없는 것을 약속")을 스스로 하나 더 만드는 셈이다.
2. **`activity_id` 의 충돌은 우발이 아니라 기본값이다.** GlobalId 는 UUID 기반이라 다른 모델끼리 겹치지
   않지만, `A100`·`1.1.1` 같은 코드는 무관한 두 현장도 겹친다(§Context 3 표). "유일하면 해소된다"는
   전략의 성공률이 실운영에서 0 으로 수렴한다. 즉 409 경로는 **예외가 아니라 정상 경로**가 된다.
3. **비용이 없다.** 두 라우트의 호출자는 각각 하나뿐이고 둘 다 이미 `projectId` 를 손에 쥐고 있다
   (`useConfirmDocumentMapping(projectId, docId)` 는 인자로 받고, `useReadiness` 는 현재 **호출자가
   아예 없다** — 정의만 있고 어떤 페이지도 쓰지 않는다). 지금 필수로 만드는 것이 가장 싸다.

두 라우트 모두 **`project_id` 를 쿼리 필수 인자로 받고, 그 프로젝트의 멤버십을 먼저 검사한 뒤
(비멤버는 404 `project_not_found` — ADR 0006 규칙 2) 복합 키로 행을 읽는다**(없으면 404). 이는 ADR 0006
규칙 6("대상 행의 `project_id` 로 멤버십을 검사한다")을 더 강하게 지킨다 — 행을 먼저 읽지 않으므로
**존재 여부를 흘리지 않는다.**

객체 라우트(`/api/objects/{global_id}`)의 409 방식은 **이번에 바꾸지 않는다.** 바꾸면 파괴적 변경이고
`tests/integration/test_11_project_scoped_objects.py` 가 그 계약을 명시적으로 검증하고 있어 별개의 결정이
필요하다. 다만 저장소에 대리키 라우트 관례가 두 가지 남는다는 것을 인정하고 §Deferred 에 통합을 남긴다.

## Consequences

- 같은 공정표를 여러 프로젝트에 올릴 수 있다. 프로젝트별 Activity·매핑·검토요청이 서로 독립적이다.
- ADR 0007 §Deferred 의 `_drop_already_confirmed` 항목이 해소된다 — 그것도 "고치는 것을 잊을 수 없는"
  형태로(§3).
- **스키마 안전망이 없다**(§2). 한 호출부라도 빠지면 같은 사고가 반복된다. 복합 PK 가 `session.get`
  경로 10곳을 시끄럽게 만들어 주지만, `select().where()` 경로(`predecessors_of`)는 손으로 지켜야 한다.
- `compute_readiness`, `load_activity`, `predecessors_of`, `save_mappings`, `save_document_mapping`,
  `reject_document_mapping`, `confirm_document_mapping` 의 **시그니처가 바뀐다.** 이들을 호출하는
  `services/progress/*`, `services/api/*`, `tests/unit/progress/*`, `tests/unit/sync/*` 가 함께 바뀐다.
- **화면 캐시 키가 바뀐다 — (B) 계열 지뢰.** `queryKeys.readiness(aid) = ["activities", aid, "readiness"]`
  가 프로젝트 범위로 바뀌면, `useResolveReview`·`useConfirmDocumentMapping` 이 쓰는
  `qc.invalidateQueries({ queryKey: ["activities"] })` **접두사 무효화가 더 이상 매치하지 않는다.** 두
  훅을 새 키에 맞춰 같이 고치지 않으면 확정·반려 후 readiness 가 낡은 값으로 남는다. 이 두 곳은
  `ReviewsPage.test.tsx:414`·`DocumentDetailPage.test.tsx:377` 이 무효화 범위를 검증하고 있으므로
  테스트도 함께 갱신한다.
- Pydantic 계약(`packages/core/models/progress.py`·`document.py`)은 **바꾸지 않는다** — ADR 0005 단계 1과
  같은 판단이다. 규칙 1(부모에서 유도)이 이를 대체하며, `Schedule.project_id`·`ActivityView.project_id`·
  `StartableSet.project_id` 로 이미 프로젝트가 전달된다. `ReadinessScore` 에 `project_id` 를 넣지 않는다.
- API 응답 스키마는 바뀌지 않는다. 바뀌는 것은 **두 대리키 라우트가 `project_id` 쿼리를 필수로 요구**하는
  것뿐이다(`docs/api.md` 갱신 필요).

## 마이그레이션

**기존 행은 파기한다. 이행 경로를 만들지 않는다.** 근거:

1. 스키마는 Alembic 이 아니라 `Base.metadata.create_all` 로 만든다(`packages/core/db.py:init_db`).
   `create_all` 은 **이미 존재하는 테이블을 건드리지 않는다** — 즉 기존 DB 파일에서는 낡은 단일 PK 가
   그대로 남고, 코드는 §3 의 `InvalidRequestError` 로 즉시 멈춘다. **조용히 반쪽으로 동작하지 않는다.**
2. 운영 배포가 없다(MVP, ADR 0005 가 같은 판단을 이미 내렸고 그 이후로도 배포되지 않았다).
3. 저장소에 추적되는 DB 파일이 없고(`git status` 확인), 테스트는 전부 임시 SQLite 를 새로 만든다
   (`tests/integration/conftest.py` 는 `tempfile.mkdtemp`, `tests/e2e/conftest.py` 는 `tmp/srv.db`,
   `tests/unit/progress/conftest.py` 는 `sqlite:///:memory:`). **테스트 쪽 조치는 필요 없다.**

로컬 개발자 조치는 하나뿐이다 — `DATABASE_URL` 이 가리키는 파일(기본 `./buildtwin.db`)을 지우고 다시
올린다. `create_all` 이 새 스키마로 만든다. 이 문장을 릴리스 노트가 아니라 **여기**에 남기는 이유는,
지우지 않으면 나는 오류가 스키마 오류가 아니라 `session.get()` 호출부의 `InvalidRequestError` 라서
원인을 찾기 어렵기 때문이다.

## Alternatives considered

- **`save_schedule` 만 고친다(`session.get(ActivityRow, ...)` 대신 `(project_id, activity_id)` 로 조회).**
  가장 싸고, 재현한 삭제 증상은 사라진다. 그러나 PK 가 여전히 전역이라 **두 번째 프로젝트의 `INSERT` 가
  IntegrityError 로 실패**한다 — ADR 0005 이전의 `GlobalIdConflictError` 와 같은 상태로 되돌아갈 뿐이다.
  게다가 `activity_object_mappings`·`activity_document_mappings` 의 PK 도 전역이라 §Context 2 의 문서 매핑
  누수는 그대로 남는다. 기각.
- **`activity_id` 를 `{project_id}:{activity_id}` 문자열로 합성.** 스키마 변경을 피하지만 ADR 0005 가
  같은 대안을 기각한 이유가 그대로 적용된다 — 모든 로그·응답·화면에서 다시 분해해야 하고, 공정표 파일에
  적힌 값과 DB 값이 달라져 `source_ref` 추적이 끊긴다. 기각.
- **`activities` 에 자동증가 대리키(`id`)를 두고 `(project_id, activity_id)` 는 UNIQUE 로.**
  FK 가 한 컬럼이 되어 관계·매핑 테이블이 단순해진다. 그러나 (a) 공정표 재업로드마다 대리키가 재발급되어
  ADR 0007 §2-1 이 `doc_id` 를 결정적으로 만든 이유(재업로드가 그대로 upsert 가 되어야 한다)를 정면으로
  어기고, (b) API 경로·화면·`Blocker.related_ids`·`Evidence.source_id` 가 모두 사람이 읽는 `activity_id` 를
  쓰고 있어 두 식별자를 평생 병행해야 한다. 기각.
- **Activity 를 참조하는 테이블에 복합 FK 를 건다(ADR 0005 와 완전히 같게).** 스키마 안전망을 얻지만
  §Decision 2 대로 정상적인 공정표 재업로드가 FK 위반이 되거나 확정된 매핑이 cascade 로 사라진다. 기각.
- **`/api/activities/{activity_id}/readiness` 를 ADR 0005 §3 처럼 409 로.** 저장소의 대리키 라우트 관례가
  하나로 통일된다는 장점이 있다. 그러나 §Decision 5 의 세 근거(특히 `activity_id` 충돌이 기본값이라는
  점)로 기각. 통일은 반대 방향으로 — 객체 라우트를 필수 `project_id` 로 — 가는 것이 맞고, 그것은 별건이다.

## Deferred

- **대리키 라우트 관례 통일.** `/api/objects/{global_id}` 의 409 방식(ADR 0005 §3)과 문서·Activity 의 필수
  `project_id` 방식(ADR 0007 §2-3, 이 ADR §5)이 공존한다. 객체 쪽을 필수 `project_id` 로 옮기는 것이
  일관되지만 파괴적 변경이고 `test_11_project_scoped_objects.py` 를 다시 써야 한다. 별도 사이클.
- **재업로드에서 사라진 Activity 의 고아 매핑.** 공정표를 다시 올려 `A500` 이 없어지면
  `activity_object_mappings`·`activity_document_mappings` 의 `A500` 행이 참조 대상 없이 남는다. 이 ADR
  이전부터 있던 동작이고 이 변경으로 나빠지지 않는다. `bim_objects` 의 `is_orphaned` 와 같은 표시를
  Activity 매핑에도 둘지는 별도로 판단한다.
- **같은 프로젝트 안에서 두 공정표가 같은 `activity_id` 를 쓰는 경우.** 복합 PK 이후에도 나중 업로드가
  앞 `schedule_id` 의 Activity 를 인계한다(현행 동작 유지). 한 프로젝트에 공정표가 둘 이상 올라오는
  운용이 실제로 생기면 그때 결정한다.
