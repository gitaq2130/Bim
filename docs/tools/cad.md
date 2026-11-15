# 작도(CAD) — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v2 |
| 요구 Core | 1.1.0 |
| 브랜치 | `builder/cad` |
| 포함 툴 | 작도(cad) |
| 소유 파일 | `app/tools/cad.js`, `app/tools/cad-geom.js`, `app/tools/pdf.js`, `app/js/wand.js`, `app/js/section.js` |

## 기능
AutoCAD식 명령·단축키로 작도하고 치수를 잽니다. 벽·기둥·보 등을 객체로 그려 다른 툴과 연결합니다. DXF/PDF 밑그림, 블록, 단면, 마법봉 선택을 포함합니다.

## 데이터
- 읽기: KINDS·DISC·MATS(model.js), P.prevs(리비전), P.boq(내역 연결 표시), `LUX_BY_USE`(interior `tools/interior.js` — 실 용도별 목표 조도)
- 쓰기: P.sheets, P.content[*].ents/els, P.levels, P.layers, P.blocks, P.underlays
- 다른 트랙에 제공하는 함수: `tools/cad-geom.js` 기하 함수 → field(site)에서 사용


## 다음 작업 후보
- [ ] 1.1.0 객체 DXF 입출력 레이어 매핑 (실·천장·조명·SP·분전반)
- [ ] 명령어 커버리지 점검 (AutoCAD 주요 명령 대비 표)
- [ ] 대용량 도면 성능 (객체 1만 개 이상)
- [ ] 치수·문자 스타일 관리

## 변경 이력
- v2 (2026-11-15): Core 1.1.0 객체 2D 표시·선택·편집 — 실(이름·용도·면적·목표 조도 라벨, 테두리·라벨 선택), 천장(점선+CH 라벨, 테두리 선택), 조명(박스+X·회로), 스프링클러(원+십자, 유형별 기호), 분전반(계통·부하 라벨). 속성 팔레트: 실 용도→목표 조도 자동, 헤드 유형→K-factor 자동, 분전반 kW는 MEP 산정값 읽기 전용. 그리기·선택 우선순위·PDF 색 지정, 분전반·조명·외장핀 회전 변환 반영
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
