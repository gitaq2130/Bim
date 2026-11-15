# 3D 뷰어 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v1 |
| 요구 Core | 1.0.0 |
| 브랜치 | `builder/view3d` |
| 포함 툴 | 3D 뷰어(view3d) |
| 소유 파일 | `app/tools/view3d.js`, `app/tools/render3d.js`, `app/js/sun.js` |

## 기능
기준점·층고로 도면을 3D로 올리고 재질·태양 위치를 바꿔 외관·실내를 검토합니다. 4D 공정 재생, 패스트레이싱 렌더를 포함합니다. 가구 3D 형상(furn3d)은 interior 트랙이 제공합니다.

## 데이터
- 읽기: P.content, P.levels, P.base, P.site, P.sched(4D), P.bill·P.boq(진척 색상), P.photos
- 쓰기: P.view
- 다른 트랙에 제공하는 함수: `tools/render3d.js` → interior(furn3d)


## 다음 작업 후보
- [ ] Core 1.1.0 신규 객체 3D 표시 (스프링클러·분전반·조명기구·천장, 조명기구는 광원으로)
- [ ] 렌더 품질 프리셋
- [ ] 모바일 성능(LOD)
- [ ] 단면 박스·측정 도구

## 변경 이력
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
