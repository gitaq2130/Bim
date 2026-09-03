# services/api

- 담당 에이전트: `api`
- 입출력 계약: HTTP 요청 → 서비스 호출 → Pydantic 응답. 업로드 → `job_id` → `GET /api/jobs/{id}` 폴링. `GET /api/objects/{global_id}` → `ObjectDetail{basic, current_state, history, next_actions, linked}`
- 엔드포인트 문서: `docs/api.md` (`make docs` 로 OpenAPI 에서 생성)

## 구조

| 파일 | 역할 |
|---|---|
| `main.py` | `create_app()` / `app`. CORS, `/api` 프리픽스, startup `init_db()` + (sqlite) 데모 사용자·프로젝트 멤버십 시드 |
| `deps.py` | `get_session`, `get_current_user`(JWT Bearer), `require_role(*roles)`(비-프로젝트 라우트), `require_project_role(*roles)`/`project_role(...)`(ADR 0006, 프로젝트 범위 인가) |
| `auth/` | 로그인·등록(admin, 첫 사용자 부트스트랩), 비밀번호 해시(bcrypt → pbkdf2 폴백), JWT(settings.jwt_secret), 개발 시드(사용자 + 데모 프로젝트 멤버십) |
| `storage.py` | 업로드 저장 `settings.storage_root/<project_id>/<file_id>_<filename>`, sha256, MinIO 미러(선택) |
| `jobs.py` | 작업 본체: ingest(IFC→모델·객체 / DXF→도면·엔티티→자동 매핑) · registration(스캔 등록) · schedule · verdict |
| `tasks.py` | Celery 태스크 `api.run_job` (공용 앱, 개발·테스트는 eager) |
| `celery_app.py` | 워커 진입점 `celery -A services.api.celery_app worker` (모든 서비스 태스크 등록) |
| `usecases.py` | 엔드포인트별 오케스트레이션(서비스 호출 + 저장). 판정·전이 규칙은 services/* 에만 있다 |
| `queries.py` | 읽기 전용 조회 헬퍼 |
| `routers/`, `schemas/` | HTTP 계약(프론트 `apps/web/src/api/types.ts` 와 필드명 일치) |
| `scripts/gen_api_doc.py` | `docs/api.md` 생성 |

## 개발용 데모 사용자 (sqlite 전용)

startup 시 `settings.database_url` 이 `sqlite` 이고 `users` 테이블이 비어 있으면 `auth/seed.py` 가 아래 계정을 만든다
(비밀번호 모두 `buildtwin`). PostgreSQL 등 운영 DB 에서는 시드하지 않으며, 첫 사용자는 `POST /api/auth/register`
(users 가 비어 있으면 누구나 호출 가능, 첫 사용자는 admin) 로 만든다.

| email | role |
|---|---|
| contractor@buildtwin.local | contractor |
| cm@buildtwin.local | cm |
| client@buildtwin.local | client |
| admin@buildtwin.local | admin |

시드는 이 4계정에 더해 데모 프로젝트(`p-dev-demo`, "개발용 데모 현장")를 만들고 contractor/cm/client 에게
같은 이름의 프로젝트 역할로 멤버십을 준다(ADR 0006 — `auth/seed.py`의 `seed_dev_project`). `admin` 은
멤버십을 받지 않는다(아래 "프로젝트 멤버십과 인가" 참고). 기존 개발 플로우(로그인만 하면 바로 현장이
보이는 것)가 이 멤버십 덕에 그대로 동작한다.

## 프로젝트 멤버십과 인가 (ADR 0006)

**프로젝트 범위의 인가는 `project_members.role`(프로젝트 역할)로 하지 `users.role`(전역 역할)로 하지
않는다.** 한 사람이 현장마다 다른 역할일 수 있어서다(A현장 contractor가 B현장에서는 cm일 수 있다).

- `require_project_role(*roles)`(경로에 `project_id`가 있는 라우트) / `project_role(session, project_id, user, *roles)`
  (surrogate id 라우트 — 대상 행을 먼저 읽어 그 `project_id`로 검사, 예: `review-requests/{id}`,
  `activities/{id}/readiness`, `drawings/{id}`, `scans/{id}`, `models/{id}`, `files/{id}`, `jobs/{id}`)가
  `deps.py`의 인가 본체다.
- **멤버가 아니면 404**(`project_not_found`) — 403은 프로젝트의 존재를 흘리므로 쓰지 않는다.
- 멤버인데 역할이 요구 집합에 없으면 **403**(`forbidden_role`).
- `admin`은 멤버십 없이 모든 프로젝트를 **조회**만 할 수 있다(`role=None`). 행위(업로드·정합 입력·작업일보·
  검토요청 처리·상태 전이 등)가 필요한 라우트는 `admin`도 403 — 행위 역할이 필요하면 별도 cm/contractor
  계정을 발급한다. `read=True`로 표시한 몇몇 조회(예: 검토요청 열람, cm 전용)는 admin도 통과한다.
- `GET /api/projects` 는 멤버인 프로젝트만 돌려준다(admin은 전부). `ProjectView.my_role` 이 그 프로젝트에서의
  역할이다(admin=None) — 프론트는 이 값으로 버튼을 가려야 한다(전역 역할 아님).
- 상태 전이의 `actor`는 **프로젝트 역할**에서 나온다(`usecases.caller_project_role` → `actor_for_role`). 여전히
  `contractor→contractor`, `cm→cm` 뿐(ADR 0001 §4-1) — client/admin(프로젝트 역할이 없거나 client)은 403.
- `usecases.resolve_object`(`/api/objects/{global_id}`)의 후보 조회는 **호출자가 멤버인 프로젝트로 한정**한다
  (admin 제외). 명시 `?project_id=` 도 멤버십을 통과해야 한다(ADR 0005 §3의 인가 전제를 여기서 구현한다).
- 멤버십 관리: `GET/POST/DELETE /api/projects/{pid}/members` — admin 전용(MVP). `POST`는 `added_by`를 남기고
  `role`은 `contractor|cm|client`만(스키마가 `admin`을 거부한다). 프로젝트를 만든 admin에게 자동 멤버십을
  주지 않는다.
- 업로드·정합 입력(판단 아닌 입력)·매핑 확정·검토요청 처리·작업일보는 각 프로젝트의 contractor/cm(역할별
  세분은 `docs/api.md` 참고) — 모두 admin 제외.

## 작업(Job) 흐름

`POST /api/projects/{pid}/files` → `{job_id, file_id, kind}` → `GET /api/jobs/{job_id}` `{status, progress, result, warnings, error}`.
- IFC: `result.model_id`, 재업로드 시 같은 GlobalId 는 상태 유지·기하 갱신·`model_version` 증가, 사라진 객체 `is_orphaned`.
- DXF/DWG: `result.drawing_id`, 최신 모델과 자동 매핑(`level` 폼/쿼리 파라미터 또는 파일명 `1F` 휴리스틱), 저신뢰 매핑은 ReviewRequest(kind=mapping).
- E57/LAS/PLY (job kind `scan_upload`): `result.scan_id`, 정합 대기 → `POST /api/scans/{sid}/alignment` → verdict 작업.
- CSV/XML/XER: `result.schedule_id`, Activity↔객체 매핑.
