# 공정·현장·일보 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v3 |
| 요구 Core | 1.2.0 |
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
- 다른 트랙에 제공하는 함수: `sched.autoGenerate(P,start)`·`statusAt(P,date)` → core·view3d·daily, `site.js` → daily: `photoData`, `progressReport(P,date,tol)`(계획 대비 사진 실적), `photoProgress`, `stageSetOf`, `stagePct`, `gridAddr`


## 다음 작업 후보
- [ ] 공정표 엑셀/MS Project 가져오기
- [x] 사진 기반 진척 판정 정확도 개선 — v3
- [ ] 일보 금일 작업 행에 활동별 사진 판정 실적 표시
- [ ] 진척 판정 현황을 기성 회차 입력으로 일괄 반영(확인된 판정만)
- [x] 일보 출력 양식(발주처별) — v2

## 변경 이력
- v3 (2026-11-15): 사진 기반 진척 판정 개선 — 부재 종류별 시공 단계 기준(RC 골조·건축·마감·설비/전기/소방), 같은 날 여러 장은 중앙값·이전보다 5%p 넘게 낮으면 역행 표시, AI 판정은 단계 구간 안으로 보정하고 담당자 확인 전까지 기성 반영 보류, 사진 상세에 촬영일 계획 진척·차이 표시, 진척 판정 현황 패널(요약·확인 필요·지연·역행·촬영 필요·앞섬·층·부재별 표, 통심 위치 표기, 항목을 누르면 근거 사진·도면으로 이동, CSV 저장), 도면 진척 색, 작업일보 공정 현황에 사진 판정 실적 카드·출력 열 추가, 촬영일 KST 보정
- v2 (2026-11-15): 작업일보 출력 양식 4종(기본·시공사 내부 결재형·공공 감리 보고형·발주처·CM 보고형) — 양식별 섹션 순서·결재란·인원 표기(상세/전일누계·누계/공종 합계), 공정 현황(공기·경과·계획 공정률 금액 가중), 자재 반입·검수, 품질시험, 감리·감독 지시 섹션 추가, 결재란 직접 지정, 새 일보는 직전 양식 승계
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
