# 공정·현장·일보 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v2 |
| 요구 Core | 1.0.0 |
| 브랜치 | `builder/field` |
| 포함 툴 | 공정 4D(sched), 현장 사진(site), 작업일보(daily) |
| 소유 파일 | `app/tools/sched.js`, `app/tools/site.js`, `app/tools/daily.js` |

## 기능
공정표를 모델 객체에 연결해 3D로 시공 순서를 재생하고 기성 계획률을 계산합니다. 현장 사진을 도면 위치·부재에 붙여 시공 단계를 판정하고, 날씨·인원·장비·이슈·사진으로 작업일보를 작성합니다.

## 데이터
- 읽기: P.content, P.levels, P.boq, P.bill, P.issues, P.sheets
- 쓰기: P.sched, P.photos, P.daily
- P.daily[날짜] 레코드(field 내부 구조): weather·tmin·tmax·rain, crew[], equip[], work[], next[], mat[](자재 반입·검수), test[](품질시험), order(지시·조치), safety, note, approval, form(출력 양식 id: std·gc·sup·cm), signs(결재란 직접 지정, 없으면 양식 기본)
- 다른 트랙에 제공하는 함수: `sched.autoGenerate(P,start)` → core·view3d·daily, `site.js` 함수 → daily


## 다음 작업 후보
- [ ] 공정표 엑셀/MS Project 가져오기
- [ ] 사진 기반 진척 판정 정확도 개선
- [x] 일보 출력 양식(발주처별) — v2

## 변경 이력
- v2 (2026-11-15): 작업일보 출력 양식 4종(기본·시공사 내부 결재형·공공 감리 보고형·발주처·CM 보고형) — 양식별 섹션 순서·결재란·인원 표기(상세/전일누계·누계/공종 합계), 공정 현황(공기·경과·계획 공정률 금액 가중), 자재 반입·검수, 품질시험, 감리·감독 지시 섹션 추가, 결재란 직접 지정, 새 일보는 직전 양식 승계
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
