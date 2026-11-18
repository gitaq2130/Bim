# 코어 변경 요청

툴 트랙은 코어(데이터 모델·ctx·이벤트·공용 모듈·TOOLS 등록) 변경이 필요할 때 여기에 추가합니다.
허브·코어 트랙이 반영한 뒤 "처리됨"으로 옮깁니다.

형식:
```
### [트랙] 제목 — YYYY-MM-DD
- 변경: 무엇을 (파일·키·함수)
- 이유:
- 영향 트랙:
```

## 대기

### [field] IFC 4D 공정 내보내기·공정 라이브러리 — 2026-11-17
- 변경:
  1. `js/ifcout.js`: `P.sched.acts`를 IFC4 `IfcWorkSchedule` / `IfcTask`(+`IfcTaskTime` 시작·종료·기간) / `IfcRelSequence`(FS + 지연일) / `IfcRelAssignsToProduct`(활동↔부재: `matchAct` 결과)로 내보내기. ifc4d(IfcOpenShell, LGPL·Python)는 브라우저에서 쓸 수 없어 스키마 매핑만 참고.
  2. (선택) `index.html` importmap에 `frappe-gantt@1.2.2`(MIT) 추가 — 간트 끌어서 일정 편집용. 현재 SVG 간트로 동작 중이라 급하지 않음.
  3. (검토) OR-Tools CP-SAT 브라우저 실행: 공식 WASM 배포 없음, 커뮤니티 `or-tools-wasm`(Apache-2.0)은 멀티스레드라 COOP/COEP 헤더가 필요 — 아티팩트 호스팅에서 가능한지 확인 부탁. 가능하면 field `optimize()`를 CP-SAT로 교체.
- 이유: 사용자 요청 — 공정 최적화(OR-Tools), IFC↔P6/MS Project 변환(ifc4d), 웹 간트(frappe-gantt). field v5에서 최적화는 JS 휴리스틱, P6 XER·MS Project XML 가져오기는 JS로 구현.
- 영향 트랙: core(ifcout·importmap), field


## 처리됨

### [field] 말뚝 객체(pile) 신설과 공법·부지 계획 데이터 등록 — 2026-11-15
- 변경:
  1. `js/model.js` KINDS에 `pile`(공종 S, geom point) 추가 — 속성 `D`(직경 mm), `L`(길이 mm), `type`(PHC·RCD·PRD), `cap`(연결 기초 id). `elBoxes`는 기초 하단(E − 기초 두께)에서 아래로 L만큼 원형 근사 박스, `qtyOf`는 본수·길이(m) 코드 `PIL`. 말뚝 배치는 field의 `planBasis(P,cond).found.piles`(위치·연결 기초)를 struct/cad가 객체로 만들 때 쓰면 됩니다.
  2. CORE.md 5장 `sched` 행에 field 내부 구조 등록: `P.sched.method`, `P.sched.cond`, `P.sched.site.items[]` (docs/tools/field.md 데이터 절 참조). 6장 공개 함수에 field `planBasis`, `autoLayout`, `siteChecks`, `craneReach`, `LOGI`, `METHODS` 추가. `autoGenerate(P,start)`는 세 번째 인자 `plan`(선택)만 추가 — 기존 호출 그대로 동작.
- 이유: 사용자 요청 — 시뮬레이션에 기초·말뚝이 보이지 않고, 공정에 탑다운·업업·세미탑다운 공법과 부지 동선(차량·보행 분리, 크레인·하역·야적 구역)이 반영되어야 함. field v4가 공정·산정·배치를 만들었지만 3D 표시와 시공 시뮬레이션 반영은 다른 트랙 파일임.
- 영향 트랙:
  - core: pile KIND·elBoxes·qtyOf, CORE.md 등록
  - view3d: 4D 재생 때 `P.sched.site.items`(단계 phase별)와 흙막이 선(`planBasis().fpb` + 1 m) 표시, pile 객체 3D 표시
  - csim: `P.sched.method`(공법)로 작업 순서(역타 하향 굴착·지상 동시 시공), `planBasis().found`로 말뚝 작업, `P.sched.site`로 크레인·하역 위치를 반영
  - struct: 선시공 기둥 축력(탑다운 지상 동시 시공 한도 `upLimit`)과 말뚝 지지력 검토 연계
- **처리 (Core 1.6.0, csim v4)**:
  - core: `pile` KIND·elName·elBoxes(원형 등가)·qtyOf(PIL)·DEFAULT_BOQ PIL, CORE.md 5장 sched 키·6장 field 공개 함수 등록
  - csim: `planBasis`로 공법(bu·td·std·uu)·흙막이 형식·말뚝(본수·길이·장비·기간) 반영. 역타는 1층 바닥 → 하향 굴착 → 지하 슬래브 → 역타 벽체 → 최하층 기초 순, 탑다운은 1층 바닥 후 지상 동시, 세미탑다운·업업은 기초 후 지상 착수. 말뚝 3D 표시. 시뮬레이션에서 공법을 따로 지정 가능(P.csim.method)
  - 남음: view3d(4D에 site.items·흙막이 선·pile 표시), struct(선시공 기둥 축력·말뚝 지지력), csim의 크레인·하역 위치 반영(P.sched.site) — 각 트랙에서 진행

### [interior] 실 마감 물량을 내역(BOQ)에 연동 — 2026-11-15
- 변경: `js/model.js` DEFAULT_BOQ에 코드 추가 — `FLR 바닥 마감 m²`, `WLF 벽 마감 m²`, `BSE 걸레받이 m`. `takeoff(P)`가 실(room)별로 `tools/interior.js`의 `roomFinishes(P)` 결과(`q.floor·q.wall·q.base`, 마감명 `fin.*`)를 물량 행으로 추가. 천장은 ceiling 객체가 이미 CLG로 들어가므로 제외.
  - 순환 import(model → tools/interior → model)가 걱정되면, 대안으로 `app/js/finish.js`를 interior 소유로 신설해 계산부를 옮기는 방식도 가능 (owners.mjs 등록 필요).
- 이유: 인테리어 v2에서 실별 마감표·물량을 산정하지만 내역·기성에는 천장(CLG)만 반영됨. 바닥·벽·걸레받이 물량이 물량·기성 화면에 나와야 함.
- 영향 트랙: cost(물량·기성 표시), core(model.js)
- **처리 (Core 1.3.0)**: `model.js`가 `tools/interior.js`의 `roomFinishes(P)`를 직접 import(순환이지만 함수 안에서만 사용). FLR·WLF·BSE 코드 추가, 기존 프로젝트는 migrate가 내역 코드 보충.

