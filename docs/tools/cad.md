# 작도(CAD) — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v1 |
| 요구 Core | 1.0.0 |
| 브랜치 | `builder/cad` |
| 포함 툴 | 작도(cad) |
| 소유 파일 | `app/tools/cad.js`, `app/tools/cad-geom.js`, `app/tools/pdf.js`, `app/js/wand.js`, `app/js/section.js` |

## 기능
AutoCAD식 명령·단축키로 작도하고 치수를 잽니다. 벽·기둥·보 등을 객체로 그려 다른 툴과 연결합니다. DXF/PDF 밑그림, 블록, 단면, 마법봉 선택을 포함합니다.

## 데이터
- 읽기: KINDS·DISC·MATS(model.js), P.prevs(리비전), P.boq(내역 연결 표시)
- 쓰기: P.sheets, P.content[*].ents/els, P.levels, P.layers, P.blocks, P.underlays
- 다른 트랙에 제공하는 함수: `tools/cad-geom.js` 기하 함수 → field(site)에서 사용


## 다음 작업 후보
- [ ] Core 1.1.0 신규 객체(sprinkler·panel·light·ceiling·room) 2D 표시·선택 — 현재 작도 화면에 그려지지 않음
- [ ] 명령어 커버리지 점검 (AutoCAD 주요 명령 대비 표)
- [ ] 대용량 도면 성능 (객체 1만 개 이상)
- [ ] 치수·문자 스타일 관리

## 변경 이력
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
