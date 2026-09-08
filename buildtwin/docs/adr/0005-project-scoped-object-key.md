# ADR 0005 — 객체 키를 프로젝트 범위로: `(project_id, global_id)` 복합 키

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-02
- 관련: ADR 0001 §1(키 전략), 리뷰 2차 추가 관찰

## Context

ADR 0001 §1은 "`BimObject.global_id`가 PK이며 **프로젝트 내에서 유일**하다고 가정한다"고 적었다. 그러나 구현은 `bim_objects.global_id`를 **전역** 기본키로 만들었다(`packages/core/models/orm.py`). 그래서 같은 IFC를 두 프로젝트에 올리면 두 번째 업로드가 `GlobalIdConflictError`로 거부된다.

이것은 가정과 구현의 불일치이며, 실제로 다음 상황에서 걸린다.

- 데모·검증용 프로젝트와 실제 프로젝트에 같은 모델을 올리는 경우(가장 흔함)
- 같은 건물의 단계별 프로젝트(1차 골조 / 2차 마감)를 나누어 관리하는 경우
- 표준 설계를 여러 현장에 재사용하는 경우(물류센터·데이터센터에서 흔함)

QA도 통합 테스트와 E2E가 한 SQLite 파일을 공유할 때 두 번째 프로젝트의 IFC 적재가 거부되는 것을 확인해, conftest에서 DB를 분리하는 우회를 넣어야 했다. 우회가 필요하다는 것 자체가 키 설계가 틀렸다는 신호다.

IFC GlobalId는 IfcOpenShell이 UUID 기반으로 발급하므로 서로 다른 모델 사이 충돌 확률은 낮지만, **같은 파일을 다시 올리는 경우는 충돌이 아니라 정상 사용**이다. 전역 유일성은 우리가 필요로 한 적이 없는 제약이다.

## Decision

`bim_objects`의 기본키를 **`(project_id, global_id)` 복합 키**로 바꾼다. 객체를 참조하는 모든 테이블은 `project_id`를 함께 들고 복합 외래키로 연결한다.

| 테이블 | 변경 전 | 변경 후 |
|---|---|---|
| `bim_objects` | PK `global_id` | PK `(project_id, global_id)` |
| `entity_object_mappings` | PK `(drawing_id, entity_handle, global_id)`, FK→`bim_objects.global_id` | `project_id` 컬럼 추가, PK 동일, FK `(project_id, global_id)` |
| `activity_object_mappings` | PK `(activity_id, global_id)`, FK→`global_id` | `project_id` 추가, FK `(project_id, global_id)` |
| `scan_verdicts` | PK `(scan_id, global_id)`, FK→`global_id` | `project_id` 추가, FK `(project_id, global_id)` |
| `state_transitions` | `global_id` FK→`global_id` | `project_id` 추가, FK `(project_id, global_id)` |

`review_requests`, `material_movements`, `rule_verdicts`는 이미 `project_id`를 갖고 `global_id`는 FK가 아닌 평문 컬럼이므로 스키마 변경이 없다(조회 시 `project_id`로 함께 필터링하는 것만 지킨다).

추가 규칙:

1. **`project_id`는 항상 부모에서 유도한다.** 매핑은 도면의 프로젝트, 판정은 스캔의 프로젝트, 전이는 객체의 프로젝트에서 가져오며, 호출자가 임의로 주입하지 않는다.
2. **`global_id` 단독 조회는 금지.** 서비스·API의 모든 객체 조회는 `(project_id, global_id)`를 함께 건다. `global_id`만 받는 공개 함수는 `project_id`를 필수 인자로 추가한다.
3. **API 경로는 그대로 `/api/objects/{global_id}`를 유지**하되, 핸들러는 요청자의 접근 가능 프로젝트로 범위를 좁혀 해석한다. 한 사용자가 같은 GlobalId를 가진 두 프로젝트에 접근 가능하면 `409`로 모호함을 알리고 `?project_id=`를 요구한다.
4. **ADR 0001 §1의 GlobalId 중복 접미사 규칙(`<gid>#n`)은 한 파일 안의 중복에만 적용**된다. 프로젝트 간 중복은 더 이상 충돌이 아니다.
5. 재업로드 시 상태 유지·`model_version` 증가·`is_orphaned` 표시(ADR 0001 §1)는 **같은 프로젝트 안에서만** 판단한다.

마이그레이션은 Alembic 없이 `create_all` 기반이므로, 스키마 변경 자체는 새 DB 생성으로 충분하다. 기존 데이터가 있는 배포는 아직 없다(MVP, 운영 배포 전).

## Consequences

- 장점: 같은 모델을 여러 프로젝트에서 쓸 수 있다. 테스트가 DB를 분리하는 우회를 버릴 수 있다. 프로젝트 간 데이터 격리가 스키마로 보장되어, 조회에서 `project_id` 필터를 빠뜨려도 FK가 잡아준다.
- 비용: 객체를 참조하는 모든 서비스의 영속화·조회 코드가 바뀐다(ingest·sync·progress·scan·api). 한 번에 바꾸지 않으면 반쪽 상태에서 FK 오류가 난다 — 아래 순서대로 한 사이클에 끝낸다.
- API 응답 스키마는 바뀌지 않는다(`global_id`는 그대로 노출). 다만 **클라이언트는 객체별 요청에 `project_id`를 실어야 한다** — 같은 GlobalId가 두 프로젝트에 있으면 서버가 409를 돌려주기 때문이다.
- **인가 전제**: §3의 "요청자의 접근 가능 프로젝트로 범위를 좁혀 해석한다"는 현재 프로젝트 멤버십이 없어 "모든 프로젝트"로 동작한다. 멤버십이 도입되는 시점에 `resolve_object`의 후보 조회와 명시 `project_id` 경로 **양쪽**에 인가 필터를 넣어야 한다.

## 구현 순서 (한 사이클)

1. `architect`: `packages/core/models/orm.py` 복합 키·FK. **Pydantic 계약(`identity.py`/`mapping.py`/`scan.py`)은 바꾸지 않기로 했다** — 규칙 1(부모에서 유도)이 이를 대체하므로 파급을 줄이는 쪽을 택했다. 또한 `services/ingest/persistence.py`의 `GlobalIdConflictError` 제거는 복합 PK 도입과 분리하면 그 사이 커밋이 반드시 깨지므로 이 단계에서 architect가 함께 수행한다(담당 디렉터리 예외를 여기 명시해 둔다).
2. `bim-ingest`: `persist_ingest_result`/`persist_drawing`가 `project_id`를 자식 행에 기록
3. `sync-2d3d`·`progress-engine`·`reality-capture`: 각 `persistence`·조회 함수에 `project_id` 전달
4. `api`: `queries.py`·`usecases.py`의 객체 조회를 `(project_id, global_id)`로, 모호성 409 처리
5. `qa`: 통합 conftest의 DB 분리 우회 제거, "같은 IFC를 두 프로젝트에 업로드" 회귀 테스트 추가
6. `reviewer`: 5개 체크 재심사

## Alternatives considered

- **현행 유지 + 명확한 오류 메시지**: 비용은 0이지만, 사용자가 흔히 하는 조작을 계속 막는다. 근본 원인이 아니라 증상만 다룬다.
- **`global_id`를 `{project_id}:{global_id}` 문자열로 합성**: 스키마 변경은 피하지만 ADR 0001의 "IFC GlobalId가 1차 키" 원칙을 문자열 조작으로 흐리고, 모든 로그·응답에서 다시 분해해야 한다. 기각.
- **프로젝트별 스키마/DB 분리(멀티테넌시)**: 격리는 가장 강하지만 MVP 규모에 과하고, 프로젝트 간 집계(포트폴리오 뷰)를 막는다. 나중에 필요해지면 별도 ADR.
