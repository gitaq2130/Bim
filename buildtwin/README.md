# BuildTwin

건설 PM/CM을 위한 AI PM 플랫폼 MVP. 핵심은 **계획(BIM) / 신고(작업일보) / 물리적 증거(스캔) / 전문가 판단(규칙) / 승인(CM)** 상태를 IFC 객체 단위로 비교하는 데이터 구조다. 상세 정의·규칙은 [CLAUDE.md](CLAUDE.md), 상태기계는 [ADR 0001](docs/adr/0001-object-identity-and-state-model.md).

## 구성

| 영역 | 위치 | 내용 |
|---|---|---|
| 공용 모델 | `packages/core/models` | IFC GlobalId 1차 키, 8단계 객체 상태기계(`CONFIRMED`는 `cm`만), Evidence/Confidence 계약, ORM |
| 도면 인식 | `services/ingest` | IFC(IfcOpenShell)·DXF(ezdxf) 파싱, RVT는 APS 변환 또는 IFC 내보내기 안내, 메시 번들(JSON/OBJ) 출력 |
| 2D↔3D 동기 | `services/sync`, `apps/web/src/sync` | 그리드 자동 정합 → 층·바운딩박스 IoU → 레이어 규칙 3단계 매핑, 0.7 미만은 검토 큐, 뷰어 간 선택 브로커 |
| 현장 스캔 | `services/scan` | 기준점/마커 초기 변환 + Open3D ICP, RMSE 게이트, 객체별 `NOT_BUILT/IN_PROGRESS/ESTIMATED_DONE/MISMATCH/UNVERIFIABLE` + 가림 추정 |
| 공정·상태 | `services/progress` | CSV/MS Project XML/P6 XER import, Activity↔객체 매핑, 상태기계, Work Readiness Score, 3중 검증 → ReviewRequest, CP-SAT 착수 가능 집합 |
| 지식 | `services/knowledge`, `rules/` | 안전 표현식 규칙 엔진(IF→위험등급·권고·필수자료), 사례 DB, 전문가 검토 diff 로그 |
| API | `services/api` | FastAPI + JWT(contractor/cm/client/admin), 업로드→Celery job→폴링, 객체 상세 단일 호출, 검토요청 처리 |
| 웹 | `apps/web` | React+Vite, three.js 3D 뷰어(단면·포인트클라우드), SVG 2D 뷰어(영역 선택·단면 오버레이), 6개 화면 |

## 빠른 시작

갈래가 둘이고 **DB·프록시·시드가 서로 다르다.** 섞으면 조용히 죽는다 — 호스트의 `make seed` 는 compose 의 DB(`db:5432`)에 닿지 못한다(호스트가 그 이름을 풀지 못한다).

### ① 호스트 — SQLite + Celery eager

```bash
cd buildtwin
make setup          # .venv + npm install
make fixtures       # 합성 샘플 IFC/DXF/PLY/공정표 생성 (결정적)
make api            # http://localhost:8000/api  (문서: /docs)
make web            # http://localhost:5173  (/api → http://localhost:8000 프록시)
make seed           # 데모 계정 — 이 셸의 DATABASE_URL 이 가리키는 DB(기본 ./buildtwin.db)
```

### ② 전체 스택(PostGIS·Redis·MinIO·워커) — docker compose, 걸음 다섯

```bash
cd buildtwin
make env            # 1. .env 가 없으면 만든다(JWT_SECRET 난수). 있으면 한 바이트도 바꾸지 않는다
make dev            # 2. docker compose up --build
make seed-compose   # 3. **다른 셸에서.** api 컨테이너 안에서 돌아 compose 의 DB 에 만든다
```

4. 브라우저로 <http://127.0.0.1:5173> — web 컨테이너의 vite 가 `/api` 를 `http://api:8000` 으로 프록시한다. 그 값은 `docker-compose.yml` 의 `web.environment` 가 `BUILDTWIN_API_PROXY_TARGET` 으로 준다(읽는 자리는 `apps/web/vite.proxy-target.ts`). **컨테이너 안에서 `localhost:8000` 은 api 가 아니라 자기 자신이다.**
5. 로그인. `.env` 의 `JWT_SECRET` 이 비어 있으면 **여기서** 죽는다 — 스택이 다 뜬 뒤다(`packages/core/settings.py` 의 `resolve_jwt_secret`).

걸음을 건너뛰면: **1** 이 없으면 compose 가 컨테이너가 뜨기 전 **파일 해석 단계에서** 죽고(`env file …/.env not found`), **3** 을 호스트의 `make seed` 로 대신하면 그 시드는 **다른 DB**(기본 로컬 sqlite)에 들어가 스택은 계정이 없는 채로 선다. `.env.example` 을 그대로 복사하는 것은 **1 의 대용이 아니다** — 그 파일의 머리말이 그 이유를 실측으로 적는다.

### 시드 계정

개발용 시드 계정은 **기동이 만들지 않는다 — 명령으로 만든다**(ADR 0018 §2-1·§2-2, `python -m services.api.seed`): 호스트 갈래는 `make seed`, compose 갈래는 `make seed-compose`.
만들어지는 것: `cm@buildtwin.local`, `contractor@buildtwin.local`, `client@buildtwin.local`, `admin@buildtwin.local` / 비밀번호 `buildtwin` (`services/api/README.md`).
멱등이고, 만들지 못했으면 **종료 코드 1** 과 무엇이 없는지를 낸다. 시드는 `DATABASE_URL` 이 가리키는 DB 에 만든다 — 어떤 DB 인지 가리지 않는다(ADR 0018 §2-4 ㉠).
시드하지 않은 빈 DB 로 API 를 띄우면 계정이 하나도 없고 **아무도 로그인할 수 없다 — 그것이 의도된 상태다**(ADR 0019 §2-1). `POST /api/auth/register` 는 `users` 가 비어 있어도 admin 인증을 요구하므로, 인증 없는 호출은 **403 `forbidden_role`** 이고 그 뒤에도 `users` 는 0행이다(`services/api/auth/router.py`). 빈 DB 에 첫 계정을 만드는 경로는 위 명령(`make seed` / `make seed-compose`)뿐이고, 그 명령은 프로세스·파일시스템 접근을 요구하므로 네트워크에서 부를 수 없다(ADR 0019 §2-2).

## 검증

```bash
make test    # fixtures → pytest(unit·invariants·regression·integration) → vitest
make lint    # ruff · mypy · eslint · tsc
make e2e     # 핵심 시나리오 E2E + Playwright 스모크
```

회귀 기준은 `tests/metrics.json`(매핑 정확도·판정 정확도·정합 RMSE)이며 측정값은 `tests/metrics.measured.json`에 기록된다.

## 데모 시나리오

1. `tests/fixtures/sample.ifc` 업로드 → 객체 42개(기둥 12·보 16·슬래브 2·벽 8·덕트 4) 추출
2. `sample.dxf` 업로드 → 그리드 자동 정합(15°, 원점 100/50m 복원) → 기둥 매핑 100%
3. 3D 클릭 ↔ 2D 하이라이트, 층별 단면 오버레이
4. `sample.ply` + `alignment.json` 기준점 → 정합 RMSE 1.5cm → 객체별 판정(완료추정 3, 시공중 1, 위치불일치 1, 확인불가 1)
5. `schedule.csv` 업로드 → Readiness 계산 → 착수 가능 작업
6. 작업일보 "완료" 신고 vs 스캔 미시공 → 검토요청 자동 생성, 자동 확정 차단 → CM 승인 시에만 `CONFIRMED`

## 제약·미구현 (CLAUDE.md §0 준수)

- RVT 직접 파싱 없음(APS 자격증명 없으면 IFC 내보내기 안내). DWG는 ODA File Converter 경로가 설정된 경우만.
- E57은 `pye57` 선택 설치. LLM 추론은 인터페이스만(`NullReasoningProvider`).
- 만회 시나리오(CP-SAT 목적함수 확장), GlobalId 재연결, PostGIS 공간 인덱스는 Deferred ADR.
