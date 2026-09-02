# BuildTwin — CLAUDE.md

> 이 파일은 BuildTwin 프로젝트의 단일 진실 원천(Single Source of Truth)이다.
> 모든 에이전트(사람·Claude 서브에이전트)는 작업 전에 이 문서를 읽고 따른다.
> 이 문서와 충돌하는 결정은 반드시 `docs/adr/`에 ADR로 남겨야 유효하다.

---

## 0. 프로젝트 정의 (변경 금지)

BuildTwin은 건설 PM/CM 회사를 위한 AI PM 플랫폼이다. 핵심은 3D 뷰어가 아니라 **"계획 상태 / 실제 상태 / 전문가 판단 상태 / 승인 상태"를 객체 단위로 비교하는 데이터 구조**다.

MVP 범위(이 범위 밖은 구현하지 않는다):

1. **도면 업로드·인식**: IFC(1순위), DWG/DXF(2D), RVT(3순위 — 아래 제약 참고)를 업로드하면 객체(기둥·보·슬래브·벽·덕트·배관·케이블트레이·외장패널)를 추출해 DB에 저장한다.
2. **2D↔3D 상호작용**: 3D 객체를 클릭하면 대응하는 2D 도면 위치가 하이라이트되고, 2D 도면에서 영역/객체를 선택하면 3D가 해당 객체로 이동·하이라이트된다. 3D 모델에서 층별 평면 단면을 자동 생성해 2D와 겹쳐 볼 수 있어야 한다.
3. **현장 스캔 비교**: 포인트클라우드(E57/LAS/PLY)를 업로드하면 BIM 좌표계에 정합하고, 객체별로 `미시공 / 시공중 / 완료추정 / 위치불일치 / 확인불가(가림)`를 판정한다.
4. **후공정 확인**: 공정표(CSV/XML/P6·MS Project export)를 객체와 연결하고, 각 작업의 **Work Readiness Score**(선행공정·검측·자재·도면승인·간섭)를 계산해 다음 착수 가능 작업과 차단 원인을 제시한다.
5. **3중 검증**: 시공사 신고(작업일보 입력) / 물리적 증거(스캔) / 시스템 논리(BIM 수량·선후행·자재 입출고)가 불일치하면 자동 확정을 막고 CM 확인 요청을 생성한다.

핵심 원칙:

- 스캔 AI는 **"완료 추정"까지만** 판정한다. "확정 완료"는 반드시 사람(CM) 승인 액션을 거친다.
- 모든 객체는 IFC GlobalId를 1차 키로 쓰고, 2D 엔티티·공정 Activity·자재·스캔 판정은 이 키에 매달린다.
- 모든 판정에는 `confidence`(0~1)와 `evidence`(근거 파일·좌표·규칙 ID)를 남긴다.

기술 제약(반드시 지킬 것):

- **RVT 파일은 네이티브 파싱 불가.** Revit 없이 서버에서 열 수 없다. 선택지는 ① 사용자에게 IFC 내보내기 요구 ② Autodesk Platform Services(APS) Model Derivative API로 변환 ③ Revit 애드인(pyRevit/C#)으로 IFC+메타데이터 내보내기. MVP는 ①+②로 가고, ③은 ADR로 남긴다.
- DWG는 ODA(Open Design Alliance) 라이선스 없이 직접 파싱하기 어렵다. MVP는 **DXF 우선**, DWG는 ODA File Converter 또는 APS로 DXF 변환 후 처리한다.
- 포인트클라우드 정합은 자동 ICP만 믿지 않는다. 현장 기준점(최소 3점) 또는 마커(AprilTag/QR) 좌표를 사용자가 입력하는 경로를 반드시 둔다.

---

## 1. 기술 스택 (기본값 — `architect`가 ADR로 바꿀 수 있음)

| 영역 | 기본 선택 | 이유 |
|---|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy, PostgreSQL + PostGIS | 3D 공간 쿼리, IfcOpenShell·Open3D가 Python |
| BIM 파싱 | IfcOpenShell, ezdxf | IFC 기하·속성 추출, DXF 엔티티 추출 |
| 3D 뷰어 | xeokit-sdk 또는 web-ifc + three.js | 브라우저 IFC 렌더, 객체 ID 기반 선택 |
| 2D 뷰어 | SVG/Canvas (DXF→SVG 변환) | 엔티티 단위 이벤트 바인딩 |
| 포인트클라우드 | Open3D (정합), potree 또는 three.js PointsMaterial (뷰) | |
| 공정 최적화 | OR-Tools (CP-SAT) | 선후행 제약·자원 제약 |
| Frontend | React + TypeScript + Vite | |
| 작업큐 | Celery + Redis | 파싱·정합은 비동기 |
| 저장소 | MinIO(S3 호환) | 원본 파일·스캔 |
| 테스트 | pytest, Playwright | |

---

## 2. 디렉터리 구조와 소유 에이전트

```
buildtwin/
├── CLAUDE.md                      # (architect) 이 문서
├── Makefile                       # (qa) make dev / make test / make lint
├── .claude/agents/                # (architect) 서브에이전트 정의
├── apps/web/                      # (frontend) React+TS+Vite 앱
│   └── src/
│       ├── viewer3d/              # (viewer-3d) IFC 3D 뷰어 모듈
│       ├── viewer2d/              # (viewer-2d) DXF→SVG 2D 뷰어 모듈
│       ├── sync/                  # (sync-2d3d, 클라이언트 파트) 뷰어 이벤트 브로커·selection 슬라이스
│       └── ...                    # (frontend) 화면·스토어·API 클라이언트 — 뷰어는 index 재수출만 import
├── services/
│   ├── ingest/                    # (bim-ingest) IFC/DXF/RVT → 객체·엔티티 추출
│   ├── sync/                      # (sync-2d3d) 2D↔3D 매핑, 뷰어 이벤트 브로커
│   ├── scan/                      # (reality-capture) 포인트클라우드 정합·객체 판정
│   ├── progress/                  # (progress-engine) 공정표·상태기계·Readiness·3중 검증
│   ├── knowledge/                 # (knowledge) 규칙 엔진·사례 DB·전문가 검토 로그
│   ├── api/                       # (api) FastAPI 라우터·인증·업로드·작업 폴링 — 도메인 로직 금지(서비스 호출만)
│   └── common/                    # (architect) 공용 인프라: celery_app.py, safe_expr.py(knowledge가 구현·유지)
├── packages/core/
│   ├── models/                    # (architect) 공용 데이터 모델(SQLAlchemy/Pydantic)
│   ├── db.py                      # (architect) 엔진·세션
│   └── settings.py                # (architect) 환경 설정(.env)
├── rules/                         # (knowledge) 판단 규칙 YAML, verification.yaml
├── config/                        # (progress-engine) readiness.yaml 등 가중치·설정
├── docs/
│   ├── adr/                       # (architect) Architecture Decision Records
│   ├── glossary.md                # (모두 등록 / architect 승인) 도메인 용어집
│   └── api.md                     # (api) OpenAPI에서 자동 생성
└── tests/                         # (qa) 단위·통합·E2E, fixtures/, metrics.json
    └── fixtures/                  # (qa) 샘플 IFC/DXF/E57
```

소유 규칙:

- 각 에이전트는 **자기 담당 디렉터리만** 수정한다. 밖을 고쳐야 하면 `architect`에게 먼저 제안하고, `architect`가 계획에 명시한 경우에만 수정한다.
- `packages/core/models/`는 `architect`가 소유하되, 구현 에이전트는 필드 추가를 **제안**할 수 있다(직접 수정 금지).
- `docs/glossary.md`는 누구나 항목을 **추가**할 수 있으나 기존 항목 변경은 `architect` 승인이 필요하다.

---

## 3. 공통 규칙

1. **커밋 전 `make test` 통과.** 실패하는 테스트가 있으면 커밋하지 않는다. 테스트를 skip/disable해서 통과시키는 것은 금지.
2. **새 도메인 개념은 `docs/glossary.md`에 한국어+영어로 등록**한다. 코드 식별자·API 필드명·UI 라벨은 glossary의 영어 표기를 그대로 쓴다.
3. **판정 로직에는 항상 `confidence`(float 0~1)와 `evidence`(근거) 필드**가 있어야 한다. 스캔 판정, 2D↔3D 매핑, Activity↔객체 매핑, 규칙 엔진 판정, 3중 검증 모두 해당. `evidence`는 최소 `{source_file, coordinates | bbox, rule_id | method}` 구조.
4. **외부 API 키·시크릿은 `.env`에만** 둔다. 코드·YAML·테스트 픽스처에 하드코딩 금지. `.env.example`에 키 이름만 나열한다.
5. **한국어 주석 허용, 식별자는 영어.** 변수·함수·클래스·테이블·컬럼·API 경로는 모두 영어. 주석·docstring·커밋 메시지·문서는 한국어 가능.
6. **좌표계 변환은 하드코딩 금지.** 원점·회전·스케일·EPSG는 항상 `CoordinateSystem` 객체(`packages/core/models/`)로 전달하고, 값은 DB 또는 사용자 입력에서 온다.
7. **상태 전이는 반드시 `actor`(system/contractor/cm)와 `evidence`를 기록**한다. ADR 0001의 상태기계 밖 전이는 코드로 존재해서는 안 된다.
8. **"확정(CONFIRMED)" 상태는 `actor == cm`인 전이로만 도달**한다. `system` actor가 CONFIRMED로 전이하는 코드 경로가 있으면 `reviewer`가 즉시 반려한다. **역할→actor 매핑은 `contractor→contractor`, `cm→cm`뿐이다.** `admin`은 프로젝트·사용자 관리 역할이며 확정·검측 승인·검토요청 처리 권한이 없다(ADR 0001 §4-1). `client`는 조회 전용.
11. **API 계층(`services/api`)에는 도메인 규칙을 두지 않는다.** 재업로드·orphan 규칙은 `services/ingest/persistence.py`, 매핑 생명주기·검토요청 해소는 `services/sync`, 검측 ReviewRequest 생성·종료는 `services/progress/state_machine.py`가 소유한다. API는 이를 호출만 한다.
12. **API 필드명은 snake_case(glossary 영어 표기 그대로)**. 뷰어 TS 타입도 서버 계약 필드는 같은 표기를 쓴다(`global_id`, `coordinate_system`).
9. **비동기 작업(파싱·정합·판정)은 Celery 태스크**로 발행하고, API는 `job_id`를 돌려준 뒤 상태 폴링 엔드포인트로 진행률을 제공한다.
10. **MVP 범위 밖 기능은 구현하지 않는다.** 필요하면 `docs/adr/`에 "Deferred" ADR을 남기고 끝낸다.

---

## 4. 에이전트 호출 규약

기능 요청은 항상 다음 순서로 흐른다:

```
architect  →  담당 에이전트(1개 이상)  →  qa  →  reviewer
```

- **architect**: 요청을 받으면 "어느 에이전트가, 어떤 인터페이스(입출력 계약)로, 어떤 순서로" 구현할지 계획을 쓴다. 데이터 모델 변경이 필요하면 `packages/core/models/`와 ADR을 먼저 고친다. 직접 구현 코드는 쓰지 않는다.
- **담당 에이전트**: architect의 계획과 자기 파일의 입출력 계약대로 구현한다. 담당 디렉터리 밖은 건드리지 않는다.
- **qa**: 담당 에이전트의 "완료 조건"을 테스트로 강제한다. 픽스처가 없으면 만든다. `tests/metrics.json` 기준치를 갱신하거나 하락을 잡는다.
- **reviewer**: 5가지 체크(무승인 확정 경로 / confidence·evidence 누락 / 디렉터리 밖 수정 / 좌표계 하드코딩 / glossary 불일치)를 수행하고, 하나라도 걸리면 승인하지 않고 담당 에이전트에게 돌려보낸다. 직접 수정하지 않는다.

에이전트 목록(`.claude/agents/`):

| 에이전트 | 모델 | 담당 |
|---|---|---|
| `architect` | opus | 설계·ADR·데이터 모델·작업 분배 |
| `bim-ingest` | sonnet | `services/ingest/` |
| `viewer-3d` | sonnet | `apps/web/src/viewer3d/` |
| `viewer-2d` | sonnet | `apps/web/src/viewer2d/` |
| `sync-2d3d` | sonnet | `services/sync/` |
| `reality-capture` | sonnet | `services/scan/` |
| `progress-engine` | sonnet | `services/progress/`, `config/` |
| `knowledge` | sonnet | `services/knowledge/`, `rules/` |
| `api` | sonnet | `services/api/`, `docs/api.md` |
| `frontend` | sonnet | `apps/web/` (뷰어 디렉터리 제외) |
| `qa` | sonnet | `tests/`, `.github/workflows/`, `Makefile` |
| `reviewer` | opus | 머지 전 리뷰(수정 권한 없음) |

호출 예시:

```
@architect 스캔 판정 결과를 객체 상세 API에 노출하려고 해. 계획 세워줘.
@bim-ingest architect 계획대로 IFC 파서 구현해줘.
@qa bim-ingest 완료 조건을 pytest로 붙여줘.
@reviewer services/ingest 변경분 리뷰해줘.
```

---

## 5. 개발 명령

```
make dev    # API + Celery worker + web dev server (docker compose)
make test   # pytest + vitest + (선택) playwright
make lint   # ruff + mypy + eslint + tsc --noEmit
```

Claude Code는 `buildtwin/` 디렉터리에서 실행한다(`.claude/agents/`가 이 위치 기준으로 로드됨).
