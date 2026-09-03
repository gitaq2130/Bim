# Plan 0002 — Activity 키를 프로젝트 범위로 (ADR 0008)

> 근거: `docs/adr/0008-project-scoped-activity-key.md`.
> 이 계획은 **한 사이클에 전부 끝내야 한다.** 데이터 모델은 이미 바뀌었고(architect 완료), 그 상태로는
> `make test` 가 빨갛다. 반쪽 커밋을 만들지 않는다 — ADR 0005 가 같은 이유로 같은 방식을 썼다.

## 목표

같은 공정표를 여러 프로젝트에 올려도 각 프로젝트의 Activity·매핑·검토요청·readiness 가
**서로 독립적**이도록 만든다. 부수적으로 ADR 0007 §Deferred 의 `_drop_already_confirmed` project 미검사를
같은 사이클에서 해소한다.

## 재현된 결함 (실측 — 계획의 근거)

TestClient 로 p1·p2 에 같은 `tests/fixtures/schedule.csv` 를 올린 결과:

```
[STEP 1] p1 업로드 직후 GET /projects/p1/activities -> 6 건: ['A100','A110','A120','A200','A300','A400']
[STEP 2] p2 업로드 후
  GET /projects/p1/activities -> 0 건: []          ← p1 의 공정표가 통째로 사라졌다
  GET /projects/p2/activities -> 6 건
[STEP 3] activities 6 행 전부 project_id=p2 / schedules 는 2 행 그대로
         activity_object_mappings 27 행, project_id 분포 {p2: 27}   ← 매핑도 옮겨갔다
[STEP 5] p1 startable n=0 / p2 startable n=1
```

같은 대장(`document_register.xlsx`)을 두 프로젝트에 올리고 p1 에서 2건 확정·1건 반려한 뒤:

```
[p1] mapping_count=6, 열린 검토요청 6건
[p2] mapping_count=3   ← 6 이어야 한다. p1 의 CM 판단이 p2 의 후보를 지웠다
[DB] A100/A110/A120 행은 project_id=p1, reviewed_by=cm — p1 에 Activity 가 없는데도 남아 p2 를 막는다
```

**어떤 API 도 오류를 내지 않았다.** (A) 계열 — 한 필드(`activity_id`)만 보고 Activity 를 식별한 결과다.

## 영향 범위

- 데이터 모델: `packages/core/models/orm.py` — **완료(architect)**. Pydantic 계약은 바꾸지 않는다.
- 서비스: `services/progress/` (persistence, document_mapper, readiness, scheduler, state_machine, tasks),
  `services/api/` (queries, usecases, routers/activities, routers/documents, docs/api.md)
- 화면: `apps/web/src/api/hooks.ts` (쿼리 키 + 무효화 범위)
- 테스트: 아래 §6

---

## 1. (A) 계열 방어 — `activity_id` 만 보고 Activity 를 식별하는 자리 **전수 목록**

이 사이클의 핵심이다. 한 곳이라도 빠지면 같은 사고가 반복된다.
**모두 고쳤는지 확인하는 명령**은 §5 에 있다.

### 1-a. 복합 PK 가 **터뜨려 주는** 자리 (10곳) — 빠뜨릴 수 없다

`session.get()` 의 키 길이가 PK 컬럼 수와 다르면 SQLAlchemy 가 `InvalidRequestError` 를 던진다.
실측 확인함(`Incorrect number of values in identifier to formulate primary key for session.get()`).

| # | 파일:줄 | 현재 | 고친 뒤 |
|---|---|---|---|
| 1 | `services/progress/persistence.py:141` | `session.get(ActivityRow, a.activity_id)` | `(schedule.project_id, a.activity_id)` |
| 2 | `services/progress/persistence.py:185` | `load_activity(session, activity_id)` | `load_activity(session, project_id, activity_id)` |
| 3 | `services/progress/persistence.py:209` | `session.get(ActivityRow, m.activity_id)` | `save_mappings` 가 `project_id` 를 인자로 받는다(§2-a) |
| 4 | `services/progress/persistence.py:214` | `session.get(ActivityObjectMappingRow, (m.activity_id, m.global_id))` | `(project_id, m.activity_id, m.global_id)` |
| 5 | `services/progress/persistence.py:314` | `session.get(ActivityRow, mapping.activity_id)` | `save_document_mapping` 이 `project_id` 를 받는다 |
| 6 | `services/progress/persistence.py:318` | `session.get(ActivityDocumentMappingRow, (a_id, doc_id))` | `(project_id, a_id, doc_id)` |
| 7 | `services/progress/document_mapper.py:296` | `session.get(ActivityDocumentMappingRow, (m.activity_id, m.doc_id))` — **`_drop_already_confirmed`** | `(project_id, …)` — **ADR 0007 §Deferred 해소 지점** |
| 8 | `services/progress/document_mapper.py:494` | `session.get(ActivityDocumentMappingRow, (activity_id, doc_id))` — `reject_document_mapping` | `(project_id, …)`. 뒤따르는 `row.project_id != project_id` 체크는 중복이 되므로 제거 |
| 9 | `services/api/usecases.py:347` | `session.get(ActivityDocumentMappingRow, (activity_id, doc_id))` — `confirm_document_mapping` | `(project_id, …)` — §3 라우트 변경과 함께 |
| 10 | `services/api/usecases.py:485` | `session.get(ActivityDocumentMappingRow, (row.activity_id, str(doc_id)))` — `resolve_review` | `(row.project_id, …)` — ReviewRequest 행에 `project_id` 가 있다 |

### 1-b. **조용히 틀릴 수 있는** 자리 (1곳) — 손으로 지켜야 한다

| # | 파일:줄 | 문제 |
|---|---|---|
| 11 | `services/progress/persistence.py:199` `predecessors_of` | `select(ActivityRelationRow).where(successor_id == activity_id)` — **프로젝트 필터가 없다.** 다른 프로젝트의 같은 `activity_id` 관계를 선행공정으로 끌어온다. `project_id` 를 필수 인자로 추가하고 `ActivityRelationRow.project_id == project_id` 를 함께 건다. 호출자: `readiness.py:77` |

**이것이 이 사이클에서 유일하게 시끄럽지 않은 자리다.** progress-engine 은 이 한 줄을 먼저 고쳐라.

### 1-c. 시그니처가 바뀌어 호출자가 컴파일/실행 단계에서 드러나는 자리

| 파일:줄 | 함수 | 새 시그니처 |
|---|---|---|
| `services/progress/readiness.py:219` | `compute_readiness(session, activity_id, weights=None)` | `compute_readiness(session, project_id, activity_id, weights=None)` |
| `services/progress/readiness.py:52` | `activity_progress` 안의 `db.load_activity(session, activity_id)` | `db.load_activity(session, project_id, activity_id)` |
| `services/progress/readiness.py:77` | `db.predecessors_of(session, activity_id)` | `db.predecessors_of(session, project_id, activity_id)` |
| `services/progress/scheduler.py:113` | `compute_readiness(session, a.activity_id)` | `compute_readiness(session, project_id, a.activity_id)` |
| `services/progress/tasks.py:52` | `compute_readiness(session, a.activity_id)` | `compute_readiness(session, project_id, a.activity_id)` |
| `services/progress/state_machine.py:224` | `db.load_activity(session, item.activity_id)` | `db.load_activity(session, project_id, item.activity_id)`. 뒤의 `activity.project_id != project_id` 검사는 **남겨라** — 이제 `None` 이면 "그 프로젝트에 없다"는 뜻이고 `skip_reason` 문구가 그대로 맞다 |
| `services/api/usecases.py:566` | `db.load_activity(session, logic["activity_ids"][0])` | `db.load_activity(session, project_id, …)` — 같은 블록의 `compute_readiness` 도 |
| `services/progress/persistence.py:203` | `save_mappings(session, mappings)` | `save_mappings(session, project_id, mappings)` (§2-a) |
| `services/progress/persistence.py:312` | `save_document_mapping(session, mapping)` / `save_document_mappings` | 둘 다 `project_id` 를 받는다 |

### 1-d. 이미 `project_id` 로 범위가 잡혀 있어 **바꿀 필요 없는** 자리 (확인만)

`load_activities`(:189), `load_relations`(:192), `load_mappings`(:228), `mapped_global_ids`(:244),
`activity_ids_for_object`(:250), `document_mappings_for_activities`(:296), `document_mappings_for_project`(:306),
`open_document_mapping_review`(:370), `find_document_mapping_review`(:386), `material_totals`(:480),
`scheduler.py:99`(`load_relations(project_id)` 결과 위에서 필터), `queries.py:130`(project 로 거른 일보 안),
`document_mapper.py:342`(`load_activities(project_id)` 결과로 만든 dict).

**이 목록도 검증 대상이다.** progress-engine 은 각 함수가 정말 `project_id` 로 걸리는지 눈으로 확인하고,
확인했다는 사실을 PR 설명에 남겨라.

---

## 2. 작업 분배

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 (입출력 계약) | 완료 조건 |
|---|---|---|---|---|---|
| 0 | **architect** ✅ | `packages/core/models/orm.py`, `docs/adr/0008-*.md`, 이 계획 | 재현 결과 | 복합 PK 4테이블 | 완료 |
| 1 | **progress-engine** | `services/progress/persistence.py` | ADR 0008 §Decision 1·4 | §2-a 시그니처 | §1-a·1-b 전부 반영, `predecessors_of` 프로젝트 필터 |
| 2 | **progress-engine** | `services/progress/document_mapper.py` | ADR 0007 §Deferred | `_drop_already_confirmed(session, project_id, mappings)` | p1 확정이 p2 후보를 막지 않는다 |
| 3 | **progress-engine** | `readiness.py`, `scheduler.py`, `state_machine.py`, `tasks.py` | §1-c | `compute_readiness(session, project_id, activity_id, …)` | 단위 테스트 녹색 |
| 4 | **api** | `services/api/usecases.py`, `queries.py`, `routers/activities.py`, `routers/documents.py`, `docs/api.md` | ADR 0008 §5, ADR 0006 규칙 2·6 | §3 라우트 계약 | 비멤버 404 `project_not_found`, `project_id` 누락 시 422 |
| 5 | **frontend** | `apps/web/src/api/hooks.ts` | §4 | 프로젝트 범위 쿼리 키 + 맞춘 무효화 | vitest 녹색, §4 의 (B) 지뢰 해소 |
| 6 | **qa** | `tests/` (§6 목록) | §7 검증 시나리오 | 회귀 그물 | `make test` 녹색 + 새 회귀 테스트 통과 |
| 7 | **reviewer** | 전체 diff | — | APPROVE/REJECT | 5개 체크 + §5 확인 명령 재실행 |

### 2-a. `services/progress/persistence.py` 새 시그니처 (progress-engine 입출력 계약)

```python
def load_activity(session: Session, project_id: str, activity_id: str) -> ActivityRow | None: ...
    # ADR 0008 규칙 2: project_id 는 필수 위치 인자다(옵션으로 두면 생략을 허용해 규칙이 강제되지 않는다).

def predecessors_of(session: Session, project_id: str, activity_id: str) -> list[ActivityRelationRow]: ...
    # ActivityRelationRow.project_id == project_id 를 반드시 함께 건다 (§1-b)

def save_schedule(session: Session, schedule: Schedule) -> ScheduleRow: ...
    # 변경점 3개:
    #  1) session.get(ActivityRow, (schedule.project_id, a.activity_id))
    #  2) 교체 분기의 select(ActivityRow).where(schedule_id==...) 에
    #     ActivityRow.project_id == schedule.project_id 를 함께 건다
    #  3) ActivityRelationRow 를 만들 때 project_id=schedule.project_id 를 채운다(새 컬럼).
    #     교체 분기의 관계 삭제 select 에도 project_id 를 함께 건다.

def save_mappings(session: Session, project_id: str, mappings: list[ActivityObjectMapping]) -> int: ...
    # 규칙 1(부모에서 유도)은 유지: project_id 인자를 **검증에** 쓴다 —
    # load_activity(session, project_id, m.activity_id) 가 None 이면 LookupError.
    # 호출자가 임의 project_id 를 주입해 남의 프로젝트에 매핑을 만드는 것을 막는다.

def save_document_mapping(session: Session, project_id: str, mapping: ActivityDocumentMapping) -> ActivityDocumentMappingRow: ...
def save_document_mappings(session: Session, project_id: str, mappings: list[ActivityDocumentMapping]) -> int: ...
```

`document_mapper.py`:

```python
def _drop_already_confirmed(session: Session, project_id: str,
                            mappings: Sequence[ActivityDocumentMapping]) -> list[ActivityDocumentMapping]: ...
    # session.get(ActivityDocumentMappingRow, (project_id, m.activity_id, m.doc_id))
    # 호출자 map_project_documents(:561) 가 이미 project_id 를 갖고 있다.

def reject_document_mapping(session, project_id, activity_id, doc_id, user_id, note=None): ...
    # 시그니처 그대로. 내부 session.get 만 3-튜플로. row.project_id != project_id 방어는 삭제(중복).
```

`readiness.py` / `scheduler.py` / `tasks.py` / `state_machine.py`: §1-c 표대로.

---

## 3. API 계약 (api 에이전트 입출력 계약)

ADR 0008 §5 — 두 대리키 라우트는 **`project_id` 를 쿼리 필수**로 받는다(409 방식이 아니다).

### 3-a. `GET /api/activities/{activity_id}/readiness`

```
GET /api/activities/{activity_id}/readiness?project_id={project_id}

project_id 누락            → 422 (FastAPI Query(...) 기본 동작)
project_id 의 비멤버       → 404 {"code": "project_not_found"}      (ADR 0006 규칙 2)
그 프로젝트에 없는 activity → 404 {"code": "activity_not_found"}
정상                       → 200 ReadinessScore (스키마 변경 없음)
```

구현 순서가 계약의 일부다 — **멤버십 먼저, 행 조회는 그 다음.**
현재 코드는 행을 먼저 읽어 `row.project_id` 로 멤버십을 봤다. 그러면 비멤버가 `activity_id` 의
존재 여부를 알아낼 수 있다. 새 순서는 존재를 흘리지 않는다.

```python
@router.get("/activities/{activity_id}/readiness", response_model=ReadinessScore)
def activity_readiness(activity_id: str, project_id: str = Query(...),
                       session: Session = Depends(get_session),
                       user: CurrentUser = Depends(get_current_user)) -> ReadinessScore:
    project_role(session, project_id, user)                     # 비멤버 404 project_not_found
    if db.load_activity(session, project_id, activity_id) is None:
        raise NotFound(..., code="activity_not_found")
    return compute_readiness(session, project_id, activity_id)
```

### 3-b. `POST /api/documents/mappings/{activity_id}/{doc_id}/confirm`

```
POST /api/documents/mappings/{activity_id}/{doc_id}/confirm?project_id={project_id}
body: {"note": string|null}

project_id 누락            → 422
비멤버                     → 404 project_not_found
cm 아님                    → 403 forbidden_role            (ADR 0007 §7)
매핑 없음                  → 404 document_mapping_not_found
이미 반려된 매핑           → 409 document_mapping_already_rejected   (기존 계약 유지)
정상                       → 200 ActivityDocumentMapping
```

`usecases.confirm_document_mapping(session, project_id, activity_id, doc_id, user, note)` 로
`project_id` 를 앞에 받고, 그것으로 멤버십·역할을 먼저 검사한 뒤 3-튜플로 행을 읽는다.
`resolve_review` 경로(`usecases.py:485`)는 ReviewRequest 행의 `project_id` 를 그대로 쓴다 — 라우트 변경 없음.

`docs/api.md` 를 두 라우트의 새 필수 쿼리로 갱신한다.

---

## 4. 화면 (frontend 입출력 계약) — **(B) 계열 지뢰**

`queryKeys.readiness(aid) = ["activities", aid, "readiness"]` 를 프로젝트 범위로 바꾼다.

```ts
readiness: (pid: string, aid: string) => ["projects", pid, "activities", aid, "readiness"] as const,

export function useReadiness(projectId: string | null | undefined, activityId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.readiness(projectId ?? "", activityId ?? ""),
    queryFn: () => api.get<ReadinessScore>(
      `/activities/${encodeURIComponent(activityId!)}/readiness?project_id=${encodeURIComponent(projectId!)}`),
    enabled: !!projectId && !!activityId,
  });
}
```

`useConfirmDocumentMapping` 의 URL 에도 `?project_id=` 를 붙인다(훅이 이미 `projectId` 를 인자로 받는다).

**반드시 함께 고칠 것 — 이걸 빠뜨리면 조용히 죽는다.**
`hooks.ts:370`(`useResolveReview`)과 `hooks.ts:466`(`useConfirmDocumentMapping`)의

```ts
qc.invalidateQueries({ queryKey: ["activities"] });   // readiness 키가 ["activities", aid, "readiness"] 라 접두사로 건다
```

는 **새 키와 매치하지 않는다.** 새 접두사로 바꾼다:

```ts
qc.invalidateQueries({ queryKey: ["projects", projectId, "activities"] });
```

빠뜨리면 확정·반려 직후 readiness 가 낡은 값으로 남는다 — 12·13차 리뷰가 이 두 훅의 무효화 범위를
맞추라고 두 번 지적했던 바로 그 자리다.

`useReadiness` 는 **현재 호출하는 페이지가 없다**(정의만 존재). 화면 변경은 이 훅과 확정 훅 URL 뿐이다.

---

## 5. "다 고쳤는지" 확인하는 명령 (reviewer 가 재실행)

```bash
cd /home/user/Bim/buildtwin

# (1) Activity 를 키로 읽는데 project_id 를 안 넘긴 자리가 남았는가 — 결과가 0줄이어야 한다
grep -rn "session\.get(ActivityRow, [a-z]" --include=*.py services/ tests/
grep -rnE "session\.get\(Activity(Object|Document)MappingRow, \([^,]+, [^,]+\)\)" --include=*.py services/ tests/

# (2) 관계를 successor/predecessor 만으로 조회하는 자리 — project_id 필터가 함께 있는지 눈으로 확인
grep -rn "successor_id ==\|predecessor_id ==" --include=*.py services/

# (3) 프로젝트 범위가 아닌 readiness 캐시 키가 남았는가 — 0줄이어야 한다
grep -rn '\["activities"\]' apps/web/src

# (4) 테스트 전체
make test
```

---

## 6. 테스트 (qa 담당) — 지금 빨간 것 + 새로 필요한 것

architect 의 모델 변경만으로 아래가 **이미 실패한다**(전부 `InvalidRequestError` — 조용히 틀린 것은 하나도 없다).
각 담당이 코드를 고치면 대부분 저절로 녹색이 되지만, 시그니처가 바뀐 호출부는 qa 가 함께 고쳐야 한다.

| 파일 | 실패 수 | qa 조치 |
|---|---|---|
| `tests/integration/test_12_project_membership.py` | 20 | `_SURROGATE_ROUTES:250` 의 readiness 항목에 `?project_id=` 필수 계약 반영. **`project_id` 누락 422 / 비멤버 404 를 새로 검증** |
| `tests/integration/test_15_document_mapping_queue_resolve.py` | 12 | confirm URL 에 `project_id`, `session.get(...)`(:373) 3-튜플 |
| `tests/unit/progress/test_document_mapping_review_lifecycle.py` | 7 | `save_document_mapping`·`session.get` 시그니처 |
| `tests/unit/progress/test_verification.py` / `test_verification_document_safety.py` | 10 | `seeded` 픽스처 경유 — `save_mappings(session, PROJECT_ID, …)` |
| `tests/unit/progress/test_readiness.py` / `test_readiness_document_approval.py` | 10 | `compute_readiness(session, PROJECT_ID, "A100")`, `load_activity(session, PROJECT_ID, …)` |
| `tests/unit/progress/test_scheduler.py` | 5 | 픽스처 경유 |
| `tests/unit/progress/test_state_machine.py`, `test_tasks.py` | 2 | `save_mappings` 시그니처 |
| `tests/unit/sync/test_persistence.py` | — | `save_mappings(session, project_id, …)` |
| `tests/integration/test_05_schedule.py`, `test_09_summary_rules.py`, `test_13/14` | 6 | 잡 경유 — 서비스 수정으로 해소 |
| `tests/unit/progress/conftest.py:94`, `tests/helpers/*` | — | 픽스처 시그니처 |

**새로 만들 것 — `tests/integration/test_16_project_scoped_activities.py`**
(`test_11_project_scoped_objects.py` 와 같은 자리·같은 결). §7 시나리오를 그대로 테스트로 옮긴다.

`tests/e2e/test_core_flow.py` 도 readiness 를 호출하면 쿼리를 붙인다.

---

## 7. 검증 시나리오 — 단위 테스트가 아니라 **시나리오로** 확인한다

> "이 변경이 제대로 됐는지"는 함수 하나가 맞는 값을 돌려주는 것으로 증명되지 않는다.
> 두 프로젝트에 같은 파일을 올리고 **양쪽이 끝까지 독립적인지**를 본다.
> `tests/integration/test_16_project_scoped_activities.py` 로 고정한다.

### S1 — 공정표 독립성 (핵심)
1. p1·p2 를 만들고 contractor/cm/client 를 **양쪽 모두**의 멤버로 넣는다.
2. p1 에 `sample.ifc` → `schedule.csv` 를 올린다. `GET /projects/p1/activities` == 6건.
3. p2 에 **같은 두 파일**을 올린다. 잡 둘 다 `done`, `activity_count == 6`.
4. **`GET /projects/p1/activities` 가 여전히 6건이다.** ← 재현된 결함이 죽었다는 증거
5. `GET /projects/p2/activities` 도 6건이고 `activity_id` 집합이 같다.
6. `activities` 테이블 총 12행, project 별 6/6.
7. p1·p2 각각 `startable` 이 자기 Activity 만 돌려준다(`related_ids` 에 남의 프로젝트 id 가 없다).

### S2 — Activity↔객체 매핑 독립성
8. `activity_object_mappings` 가 project 별로 27/27 (총 54). 3에서 p1 이 0이 되면 실패.
9. p1 에서 객체 하나를 CONFIRMED 로 전이해도 p2 의 같은 `(activity_id, global_id)` readiness 는 변하지 않는다.

### S3 — 문서 매핑 독립성 (ADR 0007 §Deferred 해소 증거)
10. p1·p2 에 같은 `document_register.xlsx` 를 올린다. 양쪽 `mapping_count == 6`.
11. p1 에서 2쌍 확정 + 1쌍 반려.
12. **p2 에 대장을 다시 올린다 → `mapping_count` 가 여전히 6이고 열린 검토요청도 6건.** ← 누수가 죽었다는 증거
13. p2 에서 같은 쌍을 확정하면 200(“이미 반려됨” 409 가 나오면 실패 — 그건 p1 의 반려가 샌 것).
14. p1 의 확정 2쌍은 그대로 `needs_review=False`, 반려 1쌍은 그대로 반려다.

### S4 — 선행공정 누수 (§1-b `predecessors_of`)
15. p1 의 `A110` readiness 의 `evidence.extra.predecessors` 가 `["A100"]` 이고,
    `components.predecessor` 가 **p1 의 A100 상태만** 반영한다.
16. p2 에서만 `A100` 매핑 객체를 전부 CONFIRMED 로 만든다 → **p1 의 `A110` readiness 는 변하지 않는다.**
    (`predecessors_of` 에 프로젝트 필터가 없으면 여기서 p2 의 관계를 끌어와 값이 흔들린다.)

### S5 — 대리키 라우트 인가 (ADR 0006 규칙 2·6, ADR 0008 §5)
17. `GET /api/activities/A100/readiness` (쿼리 없음) → **422**.
18. `?project_id=p1` 로 p1 멤버가 호출 → 200, p1 기준 점수.
19. 같은 `activity_id` 를 `?project_id=p2` 로 → 200, **p2 기준 점수**(18과 다를 수 있다).
20. p2 의 비멤버가 `?project_id=p2` → **404 `project_not_found`**, 그리고
    **존재하지 않는 `activity_id` 로 같은 호출을 해도 응답이 동일하다**(존재를 흘리지 않는다).
21. confirm 라우트도 17~20 과 같은 표를 만족한다.

### S6 — 화면 (frontend/qa, vitest)
22. `useReadiness` 가 `?project_id=` 를 붙여 호출한다.
23. `useConfirmDocumentMapping`·`useResolveReview` 성공 후 무효화된 키에
    `["projects", pid, "activities"]` 가 **포함된다**(`ReviewsPage.test.tsx:414`,
    `DocumentDetailPage.test.tsx:377` 갱신). 낡은 `["activities"]` 가 남아 있으면 실패로 잡는다.

### 수동 확인 (qa 가 아니라 사람이 한 번)
`make dev` → 두 프로젝트에 같은 공정표를 올리고 **화면에서** 양쪽 공정 목록·착수가능·주간요약이
각자 6건인지 본다. 이번 사이클의 사고 여덟 건 중 세 건은 API 는 맞는데 화면이 틀린 경우였다.

---

## 8. 마이그레이션

**기존 행은 파기한다. 이행 경로를 만들지 않는다.** (ADR 0008 §마이그레이션 전문)

- 스키마는 `Base.metadata.create_all` 로 만든다(Alembic 없음). `create_all` 은 **이미 있는 테이블을
  건드리지 않으므로**, 낡은 DB 파일에서는 단일 PK 가 남고 코드가 `InvalidRequestError` 로 즉시 멈춘다.
  **조용히 반쪽으로 동작하지 않는다** — 이것이 이행 경로를 만들지 않아도 되는 결정적 이유다.
- 운영 배포가 없다(MVP). 저장소에 추적되는 DB 파일이 없다(`git status` 확인).
- 테스트는 전부 임시 DB 를 새로 만든다(`tempfile.mkdtemp` / `tmp/srv.db` / `sqlite:///:memory:`) —
  **테스트 쪽 마이그레이션 조치는 없다.**
- 로컬 개발자 조치는 하나: `DATABASE_URL` 이 가리키는 파일(기본 `./buildtwin.db`)을 지우고 다시 올린다.

## 9. 리스크 / 열린 질문

- **가장 큰 리스크는 §1-b 한 줄이다.** `predecessors_of` 는 이 사이클에서 유일하게 스키마가 잡아주지
  않는 자리다. S4 시나리오가 이것만 노린다.
- Activity 를 참조하는 테이블에 FK 가 없다(ADR 0008 §Decision 2). 재업로드로 사라진 Activity 의
  고아 매핑은 이 ADR 이전부터 있던 동작이며 여기서 나빠지지 않는다 — ADR 0008 §Deferred.
- 대리키 라우트 관례가 둘로 남는다(객체=409, 문서·Activity=필수 `project_id`). ADR 0008 §Deferred.
- 이 사이클은 **한 번에 커밋**해야 한다. 단계별로 커밋하면 중간 커밋이 반드시 빨갛다(CLAUDE.md §3 규칙 1).

## 10. 다음 호출

```
@progress-engine Plan 0002 §1·§2-a 대로 services/progress 를 고쳐줘. §1-b(predecessors_of)를 먼저 해라.
@api Plan 0002 §3 대로 두 대리키 라우트를 필수 project_id 로 바꾸고 docs/api.md 를 갱신해줘.
@frontend Plan 0002 §4 대로 readiness 쿼리 키를 프로젝트 범위로 바꾸고 두 훅의 무효화 접두사를 맞춰줘.
@qa Plan 0002 §6·§7 대로 회귀 그물을 붙여줘 — test_16_project_scoped_activities.py 가 핵심이다.
@reviewer Plan 0002 §5 의 확인 명령을 재실행하고 5개 체크를 해줘.
```
