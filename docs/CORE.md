# 빌더 코어 규격 (Core v1.5.0)

모든 툴이 공유하는 계약입니다. **이 문서와 코어 파일은 허브·코어 트랙만 수정합니다.**
툴 트랙은 이 규격을 읽기만 하고, 바꿔야 하면 아래 "코어 변경 요청" 절차를 따릅니다.

현재 코어 버전은 `CORE_VERSION` 파일이 기준입니다.

## 1. 실행 구조

- 정적 웹앱. `app/index.html` → `app/js/app.js`(ES 모듈) 진입. 빌드 단계 없음.
- 외부 라이브러리는 `index.html`의 importmap으로 CDN 로드 (three@0.170.0, three-mesh-bvh, three-gpu-pathtracer).
- `app/lib/`: pdf.js, web-ifc.wasm (벤더 파일, 수정 금지)
- 배포: `app/` 폴더 전체를 Claude 아티팩트 "빌더 — 건축물 생애주기 통합 플랫폼"에 게시.
- 해석·설계 계산은 브라우저 JS로만 수행 (AI 호출 없음).

## 2. 툴 등록 (`app/js/app.js` → `TOOLS`)

```js
{ id, phase, name, full, color, desc, load: () => import('../tools/<id>.js') }
```
- `phase`(1.2.0): 빌딩 생애주기 단계 — `PHASES` 순서대로 상단 탭(단계 구분선)과 허브 카드(단계별 묶음)가 그려집니다.

| 단계 | id | 툴 |
|---|---|---|
| 1. 기획·대지 | plan | 법규(code), 토목(civil) |
| 2. 설계 | design | 작도(cad), 3D(view3d), 구조(struct), MEP(mep), 실내(interior), 조경(landscape) |
| 3. 설계검토 | review | 간섭(clash), 정합(check) |
| 4. 적산·공정 | est | 물량(qto), 공정(sched), 시공 시뮬레이션(csim, 1.4.0) |
| 5. 시공·관리 | build | 현장(site), 일보(daily), 기성(bill), 이슈(issue) |

툴 추가·삭제·순서·단계 변경은 코어 변경입니다.

### 화면 구조 (1.5.0)
- 상단 "☰ 툴" 버튼(Alt+T)으로 단계별 툴 메뉴를 열고(검색·방향키·Enter), 고른 툴은 문서 탭으로 열립니다. 통합 탭은 고정.
- 탭은 끌어서 순서 변경, × 또는 가운데 클릭으로 닫기. 열린 탭과 순서는 프로젝트별로 브라우저에 저장(`localStorage bld:tabs:<pid>`).
- 한 번에 한 툴만 마운트됩니다(탭 전환 시 이전 툴 unmount). 툴 상태 유지가 필요하면 P나 ctx.state에 저장하세요.
- `ctx.go(id)`·`location.hash`로 열어도 탭이 자동 추가됩니다.

## 3. 툴 모듈 인터페이스

```js
export function mount(root, ctx) {
  // root: 툴 전용 DOM 컨테이너 (height:100%)
  return { unmount() { /* 리스너·애니메이션·three.js 리소스 해제 */ } };
}
```
- 툴은 다른 툴의 DOM을 건드리지 않습니다.
- 다른 툴 화면으로 이동: `ctx.go('<toolId>', { sheet, hi })`

## 4. ctx API

| 항목 | 용도 |
|---|---|
| `ctx.P` | 현재 프로젝트 객체 (아래 5장) |
| `ctx.touch(what='meta')` | 변경 알림 → 자동 저장 예약. **P를 수정하면 반드시 호출** |
| `ctx.go(route, opts)` | 라우팅 (`opts.sheet`, `opts.hi`) |
| `ctx.state` | `{ P, sheet, sel:Set, hi, tool, mounted, projects }` — `sheet`(현재 도면 id), `sel`(선택 객체), `hi`(강조 객체) |
| `ctx.bus` | 이벤트 버스: `emit/on` |
| `ctx.store` | 저장소 (직접 쓰기 금지, `touch` 사용) |
| `ctx.tools` | TOOLS 배열 |

### 버스 이벤트
| 이벤트 | 발신 | 의미 |
|---|---|---|
| `project` | 코어 | 프로젝트 열림/생성 (인자: P) |
| `model` | 모든 툴 | 객체(els) 변경 → 물량·3D·간섭 등 재계산 |
| `status` | store | 저장 상태 |

새 이벤트는 코어 변경 요청으로 이 표에 등록한 뒤 사용합니다.

## 5. 프로젝트 데이터 모델 (`P`)

단위: **mm**, 각도 도(°), 좌표는 도면 좌표 + `P.base` 기준점.

| 키 | 내용 | 쓰기 소유 트랙 |
|---|---|---|
| `id, name, updated` | 메타 | core |
| `sheets[]` | 도면 시트 `{id, name, level, disc, ...}` | cad |
| `content[sheetId]` | `{ ents:[], els:[] }` — ents=선·문자 등 작도요소, els=객체 | cad (els 스키마는 core) |
| `levels[]` | 층 정보 (층고·레벨) | cad |
| `layers[], blocks, underlays` | 레이어·블록·밑그림 | cad |
| `base {x,y}`, `site {lat,lng,tz,north}` | 기준점·대지 위치 | core |
| `prevs` | 리비전 기록 (`js/rev.js`) | core |
| `view {mats}` | 3D 재질·뷰 설정 | view3d |
| `struct` | 구조 해석 모델·결과 | struct |
| `boq, takeoffs, rebarSchedule, changeOrders` | 내역·물량·배근표·설계변경 | cost |
| `bill {periods[]}` | 기성 회차 | cost |
| `clash {status,tol,clearance}`, `check {status}` | 간섭·정합 결과 상태 | review |
| `sched {acts[],start}`, `photos[]`, `daily` | 공정·현장사진·일보 | field |
| `mep {systems[], calc{}}` | MEP 계통 정의·계산 결과 (덕트 사이즈·전기 부하·헤드 배치) | mep |
| `interior {finishes{}, lighting{uf,mf}}` | 마감 기준·조명 계산 조건 | interior |
| `issues[]`, `code` | 이슈·RFI, 법규 검토 | admin |
| `civil {pts[[x,y,z]], mode, pad, cell, I, slope, last}` (1.2.0) | 측점(mm, EL m)·정지 계획·강우강도·결과 요약 | civil |
| `csim {start, week, region, climate, zones, target, actual{taskId:{s,f,pct}}, dataDate, events[], checks{}, baseline, last}` (1.4.0) | 시공 시뮬레이션 설정·실적·지연 상황·체크리스트·기준 공정 | csim |
| `landscape {areas[], plan[], auto, last}` (1.2.0) | 그린 녹지(지상·옥상)·식재 계획·결과 요약 | landscape |

- 다른 트랙 소유 키는 **읽기만** 합니다.
- 새 최상위 키 추가, 기존 키의 구조 변경은 코어 변경입니다 (`app.js`의 `migrate()` 갱신 필요).

### 객체 종류 (`js/model.js` → `KINDS`)

| 객체 | 공종 | 형상 | 만드는 트랙 | 비고 |
|---|---|---|---|---|
| wall, opening, fin | A | line / host / point | cad | |
| column, beam, slab, footing | S | point / line / poly | cad | 구조 해석은 struct |
| duct, riser | M | line / point | cad → mep | |
| pipe | P | line | cad → mep | 계통명이 소화·SP·FP면 MEP 툴에서 소방으로 분류 |
| tray | E | line | cad → mep | |
| sprinkler (1.1.0) | F | point | mep | `type, kf, z` |
| panel (1.1.0) | E | point | mep | `sys, kw, h` |
| light (1.1.0) | I | point | interior | `watt, lm, z, circuit` — mep가 watt를 읽어 전기 부하 계산 |
| ceiling (1.1.0) | I | poly | interior | `z, t, fin` |
| room (1.1.0) | I | poly | interior | `name, use, lux, h` — 공간 정의라 3D 박스·간섭 대상 아님 |
| furn | A | point | interior | 조경 툴이 L 시트에 `tree`·`shrub`(`landscape:true, sp, cnt`)을 배치 → 물량 LTR·LSH(1.3.0) |

- 공종(`DISC`): A 건축, S 구조, M 기계, E 전기, P 배관(위생), F 소방(1.1.0), I 인테리어(1.1.0), C 토목(1.2.0), L 조경(1.2.0). 재질은 `MATS`.
- 내역 코드(`DEFAULT_BOQ`) 1.3.0 추가: FLR 바닥 마감, WLF 벽 마감, BSE 걸레받이, LTR 교목 식재, LSH 관목 식재 (`BOQ_ADDED` → migrate가 기존 P.boq에 보충)
- 1.1.0 객체는 `elBoxes`·`elOutline`·`elName`·`qtyOf`(SPK·PNL·LGT·CLG 내역 코드)를 지원합니다. 따라서 물량·간섭에는 자동으로 포함됩니다. 작도 2D 표시와 3D 표시는 각각 cad·view3d 트랙의 후속 작업입니다.
- 객체 종류·기본 속성 추가는 코어 변경입니다.

## 6. 공용 모듈 (core 소유, 툴은 import만)

| 파일 | 내용 |
|---|---|
| `js/model.js` | KINDS·DISC·MATS, allElements, takeoff, billReview, levelOf, elName |
| `js/store.js` | 저장 (Claude db → localStorage → 메모리) |
| `js/ui.js` | h, $, toast, dialog, confirmBox, table, pickFile, saveFile |
| `js/util.js` | uid, deep, createBus, 벡터·면적 함수, fmt |
| `js/rev.js` | 리비전 생성·복원 |
| `js/rebar.js` | 철근 규격·BBS |
| `js/blocks.js`, `js/icons.js` | 블록·아이콘 정의 |
| `js/dxf.js`, `js/ifc.js`, `js/ifcout.js`, `js/excel.js`, `js/zip.js` | 입출력 |
| `js/house.js`, `js/tower.js` | 샘플 프로젝트 |
| `js/sitegeo.js` (1.2.0) | 대지경계(SITE 레이어 닫힌 폴리선)·건물 외곽·포장, 들로네 TIN·등고선 — 토목·조경·법규 공용 |

### 툴 간 공개 함수 (바꾸면 사용하는 트랙에 영향)
| 제공 | 함수 | 사용처 |
|---|---|---|
| field `tools/sched.js` | `autoGenerate(P, start)` 등 | core(샘플 생성), view3d(4D), daily |
| field `tools/site.js` | 사진·위치 함수 | daily |
| cad `tools/cad-geom.js` | 기하 함수 | site |
| view3d `tools/render3d.js` | 렌더러 | interior(furn3d) |
| mep `js/mep.js` | `SYS`, `sysKey`, `sysColor`, `mepNetwork` (계통 연결 해석) | cad, check, view3d, section |
| mep `tools/mep.js` | `mepRows`, `systemSummary`, `heightBands` | — |
| interior `js/furn.js` | `FURN`, `FURN_CATS`, `furnName`, `furnPlan`, `furnXf` | model(core), cad, ifcout |
| interior `tools/furn3d.js` | 가구 3D 형상 | view3d |
| interior `tools/interior.js` | `roomLighting`, `LUX_BY_USE`, `roomFinishes` | mep(조명 부하), core `takeoff`(1.3.0) |
| civil `tools/civil.js` | `civilCalc(P)` | — |
| csim `js/csim.js` | `buildTasks(P)`, `schedule(P,G,opt)`, `stateAt(S,G,day)`, `progressAt`, `recoveryOptions` | — (daily·bill이 계획값으로 쓸 수 있음) |
| landscape `tools/landscape.js` | `SPECIES`, `landCalc`, `autoPlant`, `applyToModel`, `legalRatio` | — |

### 툴 간 데이터 연동 (1.2.0~)
- 물량(`takeoff`)은 인테리어 `roomFinishes(P)`로 실별 바닥·벽·걸레받이(FLR·WLF·BSE)를 포함합니다 (1.3.0). 이 함수의 반환 구조(`q.floor·q.wall·q.base`, `fin.*`, `r`)를 바꾸려면 코어 변경 요청이 필요합니다.
- 토목 우수 계산은 `P.landscape.last.green`(조경 녹지 면적)이 있으면 그 값을 녹지로 씁니다.

공개 함수의 이름·인자·반환을 바꾸려면 코어 변경 요청으로 등록합니다.

## 7. 버전 규칙

- **Core**: `CORE_VERSION` (SemVer). 데이터 모델·ctx·이벤트를 깨뜨리는 변경은 major, 추가는 minor, 수정은 patch.
- **툴**: 각 `docs/tools/<track>.md` 머리의 `Rev`. 기능 추가 시 +1 (예: 구조 v14 → v15).
- 커밋 메시지: `[track] vN: 요약` (예: `[struct] v15: 철골 접합부 검토 추가`, `[core] 1.1.0: P.energy 키 추가`)
- 각 툴 문서에 "요구 Core 버전"을 적습니다.

## 8. 코어 변경 요청 절차

1. 툴 트랙에서 `docs/sessions/core-requests.md`에 요청을 추가합니다 (무엇을, 왜, 어떤 트랙에 영향).
2. 허브·코어 트랙이 반영하고 `CORE_VERSION`을 올린 뒤 `builder/main`에 병합합니다.
3. 툴 트랙은 `builder/main`을 자기 브랜치에 병합(rebase)한 후 이어서 작업합니다.

## 9. 브랜치

- `builder/main`: 통합본 (배포 기준). 직접 커밋하지 않고 PR로 병합합니다.
- `builder/<track>`: 트랙별 작업 브랜치. 트랙 목록과 소유 파일은 `scripts/owners.mjs`에 있습니다.
- CI(`.github/workflows/builder-ci.yml`): 문법 검사와 트랙 소유 범위 검사를 수행합니다.
