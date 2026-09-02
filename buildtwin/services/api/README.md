# services/api

- 담당 에이전트: `api`
- 입출력 계약: HTTP 요청 → 서비스 호출 → Pydantic 응답. 업로드 → `job_id` → `GET /api/jobs/{id}` 폴링. `GET /api/objects/{global_id}` → `ObjectDetail{basic, current_state, history, next_actions, linked}`
- 엔드포인트 문서: `docs/api.md` (`make docs` 로 OpenAPI 에서 생성)

## 구조

| 파일 | 역할 |
|---|---|
| `main.py` | `create_app()` / `app`. CORS, `/api` 프리픽스, startup `init_db()` + (sqlite) 데모 사용자 시드 |
| `deps.py` | `get_session`, `get_current_user`(JWT Bearer), `require_role(*roles)` |
| `auth/` | 로그인·등록(admin, 첫 사용자 부트스트랩), 비밀번호 해시(bcrypt → pbkdf2 폴백), JWT(settings.jwt_secret) |
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

## 역할 규칙

- `CONFIRMED` 전이: 라우터(cm/admin) + 상태기계(actor=cm) 이중 검사. contractor/client 는 403.
- admin 은 상태 전이에서 cm 으로 행동한다. client 는 읽기 전용(전이 403).
- 업로드: contractor/cm/admin. 스캔 정합 입력·검토요청 처리·매핑 확정: cm/admin. 작업일보: contractor/admin. 프로젝트 생성: admin.

## 작업(Job) 흐름

`POST /api/projects/{pid}/files` → `{job_id, file_id, kind}` → `GET /api/jobs/{job_id}` `{status, progress, result, warnings, error}`.
- IFC: `result.model_id`, 재업로드 시 같은 GlobalId 는 상태 유지·기하 갱신·`model_version` 증가, 사라진 객체 `is_orphaned`.
- DXF/DWG: `result.drawing_id`, 최신 모델과 자동 매핑(`level` 폼/쿼리 파라미터 또는 파일명 `1F` 휴리스틱), 저신뢰 매핑은 ReviewRequest(kind=mapping).
- E57/LAS/PLY: `result.scan_id`, 정합 대기 → `POST /api/scans/{sid}/alignment` → verdict 작업.
- CSV/XML/XER: `result.schedule_id`, Activity↔객체 매핑.
