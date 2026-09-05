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

## 빠른 시작 (로컬, SQLite + Celery eager)

```bash
cd buildtwin
make setup          # .venv + npm install
make fixtures       # 합성 샘플 IFC/DXF/PLY/공정표 생성 (결정적)
make api            # http://localhost:8000/api  (문서: /docs)
make web            # http://localhost:5173  (API 프록시 /api)
```

개발용 시드 계정(SQLite일 때 자동 생성): `cm@buildtwin.local`, `contractor@buildtwin.local`, `client@buildtwin.local`, `admin@buildtwin.local` / 비밀번호 `buildtwin` (`services/api/README.md`).

전체 스택(PostGIS·Redis·MinIO·워커)은 `make dev` (docker compose).

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
