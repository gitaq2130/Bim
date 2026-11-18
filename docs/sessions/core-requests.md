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

### [view3d] three 0.182 업그레이드 + ThatOpen(IFC) importmap 등록 — 2026-11-17
- 변경: `app/index.html` importmap을 아래로 교체 (three 0.170.0 → 0.182.0, 신규 6개)
  ```json
  "three": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/",
  "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.tsl.js",
  "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js",
  "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js",
  "three-gpu-pathtracer": "https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.23/build/index.module.js",
  "camera-controls": "https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/dist/camera-controls.module.js",
  "web-ifc": "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/web-ifc-api.js",
  "@thatopen/fragments": "https://cdn.jsdelivr.net/npm/@thatopen/fragments@3.6.1/dist/index.mjs",
  "@thatopen/fragments/inline": "https://cdn.jsdelivr.net/npm/@thatopen/fragments@3.6.1/dist/inline.mjs",
  "@thatopen/components": "https://cdn.jsdelivr.net/npm/@thatopen/components@3.6.0/dist/index.mjs"
  ```
  `docs/CORE.md` 1장 라이브러리 목록 갱신, CORE_VERSION minor +1
- 이유: 3D 뷰어 IFC 업로드·인식(ThatOpen components 3.6 / fragments 3.6). ThatOpen 3.x는 peer로 three ≥0.182 요구, 같은 three 인스턴스여야 빌더 모델과 한 장면에 겹쳐 그림. web-ifc는 `app/lib/web-ifc.wasm`과 같은 0.0.77로 고정(파일 해시 일치 확인). 폐기 패키지(web-ifc-three, web-ifc-viewer, openbim-components)는 쓰지 않음
- 검증(view3d 트랙, 테스트 하네스로 위 importmap 주입): 샘플 프로젝트로 3D(재질·조명·단면 축 2D 추출)·작도·구조·MEP·실내·현장 화면 열기 — 콘솔 오류 0. ThatOpen: IFC(빌더 내보내기 82KB) → fragments 변환 0.4초, 분류·공간구조·속성·GUID 조회 정상. 사진 렌더(pathtracer 0.0.23)는 GPU 없는 환경이라 미확인 → 허브에서 한 번 확인 필요
- 영향 트랙: 전 트랙(three 사용 전부: view3d, interior furn3d, struct·structsim, site 등) — r170→r182 사이 이 코드베이스에서 쓰는 API 변경으로 인한 오류는 위 검증에서 없었음

### [view3d] IFC 가져오기 객체에 GlobalId 저장 — 2026-11-17
- 변경: `js/ifc.js` `readIFC` 항목에 `guid`(IfcRoot.GlobalId) 추가, `ifcToProject`가 `el.guid`로 저장(현재는 `el.ifc`=expressID만 저장). `js/ifcout.js`는 `el.guid`가 있으면 새 GUID 대신 그 값을 씀(왕복 시 GUID 유지). CORE.md 5장 객체 공통 속성에 `guid` 추가
- 이유: 3D 뷰어의 IFC 모델 ↔ 빌더 객체(작도 2D) 연동을 파일이 바뀌어도 유지되는 GlobalId로 하기 위함. expressID는 같은 파일에서만 유효
- 영향 트랙: cad(가져오기 결과 객체에 속성 1개 추가, 표시 영향 없음). 반영 전에는 view3d가 expressID → 부호(Tag) → 위치 순으로 연결하므로 막히지 않음
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

