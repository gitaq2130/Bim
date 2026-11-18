# 공정·현장·일보 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v5 |
| 요구 Core | 1.6.0 |
| 브랜치 | `builder/field` |
| 포함 툴 | 공정 4D(sched), 현장 사진(site), 작업일보(daily) |
| 소유 파일 | `app/tools/sched.js`, `app/tools/site.js`, `app/tools/daily.js` |

## 기능
공정표를 모델 객체에 연결해 3D로 시공 순서를 재생하고 기성 계획률을 계산합니다. 현장 사진을 도면 위치·부재에 붙여 시공 단계를 판정하고, 날씨·인원·장비·이슈·사진으로 작업일보를 작성합니다.

## 데이터
- 읽기: P.content, P.levels, P.boq, P.bill, P.issues, P.sheets
- 쓰기: P.sched, P.photos, P.daily
- P.daily[날짜] 레코드(field 내부 구조): weather·tmin·tmax·rain, crew[], equip[], work[], next[], mat[](자재 반입·검수), test[](품질시험), order(지시·조치), safety, note, approval, form(출력 양식 id: std·gc·sup·cm), signs(결재란 직접 지정, 없으면 양식 기본)
- P.photos[] 레코드(field 내부 구조): id, name, date(촬영일·KST), sheet, level, pt, dir, el(연결 부재), stage, pct(판정 진척%), note, ai(AI 판정 여부), checked(false면 담당자 확인 전 — 기성 반영 버튼 숨김)
- P.sched(field 내부 구조): acts[]{…, trade(자원 공종, 없으면 자동), men(투입 인원)}, res{공종: 투입 가능 인원}, start, method(생성에 쓴 공법: bu·td·std·uu), cond{bear(지지층 GL- m), road(N·S·E·W), adj, fast, method(''=자동)}, site{items[{id,type,phase,p,w,d,rot,pts,onSlab,roadUse}], notes[]} — type은 `LOGI` 키, phase는 all·ew·fr·fn
- 다른 트랙에 제공하는 함수: `sched.autoGenerate(P,start[,plan])`·`statusAt(P,date)` → core·view3d·daily, `cpm(acts)`·`nextActs(P,date)`·`readiness(P,act,date,M)`·`actualOf`·`optimize(acts,cap)`·`tradeOf`, `planBasis(P,cond)`(공법·흙막이·기초·말뚝 배치 산정), `autoLayout(P,plan)`·`siteChecks(plan,items,phase)`·`craneReach`·`LOGI`·`METHODS`·`PHASES` → csim·view3d(요청 중), `site.js` → daily: `photoData`, `progressReport(P,date,tol)`(계획 대비 사진 실적), `photoProgress`, `stageSetOf`, `stagePct`, `gridAddr`


## 다음 작업 후보
- [ ] OR-Tools CP-SAT WASM(or-tools-wasm, Apache-2.0) 검증 후 `optimize()` 교체 — 멀티스레드는 COOP/COEP 필요
- [ ] 간트 끌어서 편집(frappe-gantt MIT — 코어 importmap 추가 필요)
- [ ] 실적 기반 재계획(지연 활동 후속 공정 재배치)
- [ ] 말뚝·흙막이·부지 배치를 3D 4D에 표시 (코어 `pile` 객체·view3d 요청 처리 후)
- [ ] 공법별 공정에 계측 관리·지하수 처리·램프(역타 반출구) 활동 추가
- [ ] 공정표 엑셀/MS Project 가져오기
- [x] 사진 기반 진척 판정 정확도 개선 — v3
- [ ] 일보 금일 작업 행에 활동별 사진 판정 실적 표시
- [ ] 진척 판정 현황을 기성 회차 입력으로 일괄 반영(확인된 판정만)
- [x] 일보 출력 양식(발주처별) — v2

## 변경 이력
- v5 (2026-11-17): 공정 최적화·다음 공정 — 주공정(CPM 총 여유) 간트 강조, 실적 진척(작업일보 금일 작업 → 확인된 현장 사진), 작업 준비도 WRS(선행 45·미결 이슈 15·자재 반입·검수 15·인원 10·양중·공간 15, 항목별 근거), 다음 공정 추천(준비 상태→주공정→여유→계획일)과 작업일보 추가, 자원 제약 최적화(RCPSP 직렬 일정 생성+개선, 공종별 투입 가능 인원·크레인 대수, 초과일·병목 한 조 추가 효과·일별 투입 그래프·공정표 적용), 활동별 공종·투입 인원, P6 XER 가져오기
- v4 (2026-11-15): 공법·기초·부지 동선 — 현장 수치(지지층 깊이·도로 방향·인접 건물·공기 우선)로 공법(순타·탑다운·세미탑다운·업업) 추천과 근거, 흙막이 형식·기간, 기초 형식(직접·PHC·현장타설·선시공 기둥)과 기초별 말뚝 본수·길이·장비 대수 자동 산정, 공법별 공정 생성(가설·흙막이·터파기·말뚝·기초·역타 하향 굴착·지상 동시 시공 한도)과 공법별 공기 비교, 바닥판 단위(슬래브+아래층 보) 순서로 개선 / 부지·동선 탭 — 게이트(차량·보행 분리)·세륜·하역·야적·크레인(작업 반경 자동)·사무소·차량 동선·보행 통로 자동 배치, 협소 부지 도로 점용·역타 1층 슬래브 작업장, 단계별 보기, 끌어서 편집, 안전 점검(동선 교차·근접, 크레인 반경 아래 보행·사무소, 굴착 영향 범위 내 장비·자재, 대지 밖·도로 점용, 반경 초과)
- v3 (2026-11-15): 사진 기반 진척 판정 개선 — 부재 종류별 시공 단계 기준(RC 골조·건축·마감·설비/전기/소방), 같은 날 여러 장은 중앙값·이전보다 5%p 넘게 낮으면 역행 표시, AI 판정은 단계 구간 안으로 보정하고 담당자 확인 전까지 기성 반영 보류, 사진 상세에 촬영일 계획 진척·차이 표시, 진척 판정 현황 패널(요약·확인 필요·지연·역행·촬영 필요·앞섬·층·부재별 표, 통심 위치 표기, 항목을 누르면 근거 사진·도면으로 이동, CSV 저장), 도면 진척 색, 작업일보 공정 현황에 사진 판정 실적 카드·출력 열 추가, 촬영일 KST 보정
- v2 (2026-11-15): 작업일보 출력 양식 4종(기본·시공사 내부 결재형·공공 감리 보고형·발주처·CM 보고형) — 양식별 섹션 순서·결재란·인원 표기(상세/전일누계·누계/공종 합계), 공정 현황(공기·경과·계획 공정률 금액 가중), 자재 반입·검수, 품질시험, 감리·감독 지시 섹션 추가, 결재란 직접 지정, 새 일보는 직전 양식 승계
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
