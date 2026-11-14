# 공정·현장·일보 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v1 |
| 요구 Core | 1.0.0 |
| 브랜치 | `builder/field` |
| 포함 툴 | 공정 4D(sched), 현장 사진(site), 작업일보(daily) |
| 소유 파일 | `app/tools/sched.js`, `app/tools/site.js`, `app/tools/daily.js` |

## 기능
공정표를 모델 객체에 연결해 3D로 시공 순서를 재생하고 기성 계획률을 계산합니다. 현장 사진을 도면 위치·부재에 붙여 시공 단계를 판정하고, 날씨·인원·장비·이슈·사진으로 작업일보를 작성합니다.

## 데이터
- 읽기: P.content, P.levels, P.boq, P.bill, P.issues, P.sheets
- 쓰기: P.sched, P.photos, P.daily
- 다른 트랙에 제공하는 함수: `sched.autoGenerate(P,start)` → core·view3d·daily, `site.js` 함수 → daily


## 다음 작업 후보
- [ ] 공정표 엑셀/MS Project 가져오기
- [ ] 사진 기반 진척 판정 정확도 개선
- [ ] 일보 출력 양식(발주처별)

## 변경 이력
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
