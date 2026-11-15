# 설비·전기·소방(MEP) — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v2 |
| 요구 Core | 1.1.0 |
| 브랜치 | `builder/mep` |
| 포함 툴 | 설비·전기·소방(mep) |
| 소유 파일 | `app/tools/mep.js`, `app/js/mep.js` |

## 기능
화면 탭: **계통 집계 / 스프링클러 / 전기 부하**
- 계통 집계: 덕트·배관·트레이·라이저·스프링클러·분전반을 계통으로 묶어 집계하고, 층별 천장 속 높이 배분을 점검 (공종 탭: 기계·배관(위생)·전기·소방).
- 스프링클러 (v2, NFTC 103): 건물 용도·내화구조 여부만 입력 → 수평거리 R(2.7.3) → 정방형 간격 S=R√2 격자로 실마다 헤드 자동 배치(비정형 실은 미경계점 보충), 실 내부 250mm 시험점 경계율 검증, 헤드 높이는 실 안 천장 객체(없으면 실 천장고). 설치 제외 장소(2.12: 계단·화장실·욕실·전기실·통신실·피트·테라스 등)는 실명·용도로 판정. 기준개수(표 2.1.1.1)·수원량(N×80L/min×20/40/60분)·펌프 토출량 산정. 층별 평면 미리보기(R 원·미경계 지점).
- 전기 부하 (v2, KEC·내선규정): 실별 전등 W(배치 조명 합, 미배치 실은 목표 조도로 추정)·전열 VA(용도별 VA/m²) 집계 → 층별 부하 가중 중심에 분전반 자동 배치(가장 가까운 벽면 부착, 공급 반경 30m 초과 시 분할) → 실을 가장 가까운 분전반에 배정 → 분기회로 수(20A·80%=3,520VA/회로, 예비 20%)·최대수요(수용률 전등 100%·전열 50%)·주차단기·간선(F-CV 참고치) 산정, `panel.kw` 기록. 사용자가 직접 놓은 분전반이 있는 층은 유지하고 배정만 함.

## 데이터
- 읽기: P.content(els), P.levels, light 객체의 watt(조명 부하), P.interior
- 쓰기: P.mep, MEP 객체(duct·pipe·tray·riser·sprinkler·panel)
  - `P.mep.calc.input {bldg, fireproof}` — 사용자 입력(건물 용도·내화구조)
  - `P.mep.calc.fire {R, S, heads, base, N, min, flow, Q, at}` — 스프링클러 계산 결과
  - `P.mep.calc.elec {panels[{id,level,lightW,outletVA,kVA,circuits,brk,cable}], kVA, main{brk,cable}, at}` — 전기 부하 결과
  - 자동 배치 객체 표시: sprinkler `auto=<실 id>`, panel `auto='elec'` (재배치 시 자동분만 교체)
- 다른 트랙에 제공하는 함수: `js/mep.js`(SYS·sysColor·mepNetwork) → cad·check·view3d·section, `tools/mep.js`(mepRows·systemSummary·heightBands)
- v2 추가 공개 함수(외부 사용처 없음): `js/mep.js` FIRE_BLDG·fireExempt·headSpacing·headCoverage·placeHeads·fireDemand·OUTLET_VA·ELEC·circuitVA·feeder·panelLoad·panelSpots·snapToWall / `tools/mep.js` sprinklerPlan·elecPlan
- 사용하는 타 트랙 함수: interior `tools/interior.js` roomLighting (실별 조명 W·목표 조도)

### 설계 원칙
- 빌더 구조 툴과 같은 원칙: 사용자는 건물 용도·현장 조건만 입력하고, 덕트·배관 사이즈, 전기 부하·간선, 스프링클러 헤드 간격은 툴이 기준(KDS·NFTC·KEC)으로 산정해서 근거와 함께 제안한다.
- 공종 내부 모듈은 공종별로 나누고(공조·위생·전기·소방), 한 공종이 커지면 트랙 분리를 검토한다.

## 다음 작업 후보
- [x] 스프링클러 헤드 자동 배치 (실·천장 기준, 수평거리 기준) — v2
- [x] 분전반 배치와 조명·콘센트 부하 집계 → 간선 산정 — v2
- [ ] 스프링클러 가지·교차배관 자동 경로와 관경(헤드 수 기준표) → 수리계산
- [ ] 간선 전압강하 검토, 조명 회로 번호 부여(light.circuit은 interior 객체라 협의 필요)
- [ ] 덕트 사이즈 산정 (풍량 → 등마찰법)
- [ ] 배관 사이즈 산정 (급수 부하단위)
- [ ] 계통별 경로 편집 (천장 속 높이 자동 배분)

## 변경 이력
- v2 (2026-11-15): 스프링클러 헤드 자동 배치·경계율 검증·기준개수/수원량(NFTC 103), 분전반 자동 배치·조명/전열 부하 집계·회로수·간선 산정(KEC), 탭 전환(계통 집계/스프링클러/전기 부하)·층 평면 미리보기
- v1 (2026-11-15): 트랙 신설 (Core 1.1.0) — 계통 집계·높이 배분 / 실·광속법 조도·조명 자동 배치 기본 기능
