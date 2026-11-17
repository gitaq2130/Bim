# 3D 뷰어 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v4 |
| 요구 Core | 1.1.0 |
| 브랜치 | `builder/view3d` |
| 포함 툴 | 3D 뷰어(view3d) |
| 소유 파일 | `app/tools/view3d.js`, `app/tools/render3d.js`, `app/js/sun.js` |

## 기능
기준점·층고로 도면을 3D로 올리고 재질·태양 위치를 바꿔 외관·실내를 검토합니다. 4D 공정 재생, 패스트레이싱 렌더를 포함합니다. 가구 3D 형상(furn3d)은 interior 트랙이 제공합니다.

## 데이터
- 읽기: P.content(1.1.0 객체 sprinkler·panel·light·ceiling 포함), P.levels, P.base, P.site, P.sched(4D), P.bill·P.boq(진척 색상), P.photos
- 쓰기: P.view (v3부터 `P.view.sec` 단면 축 상태 포함)
- 다른 트랙에 제공하는 함수: `tools/render3d.js` → interior(furn3d)


## 다음 작업 후보
- [ ] 렌더 품질 프리셋
- [ ] 모바일 성능(LOD)
- [ ] 추출 단면을 작도 시트로 바로 보내기 (cad 데이터 — 코어/cad 요청 필요)
- [ ] 단면 치수선 자동(층고·스팬)
- [ ] IFC 모델 단면 2D 추출(fragments getSection) — 지금은 빌더 객체 기준으로 추출
- [ ] IFC 창·문 ↔ 빌더 개구부(opening) 연결(호스트 벽 기준)

## 1.1.0 객체 3D 표시 규칙 (v2)
- 스프링클러: `z`=천장면(헤드 상단), `hh` 높이 안에 몸체·감열체·디플렉터. `type`으로 하향식(pendent)·상향식(upright)·측벽형·은폐형 구분
- 분전반: `z0`부터 `h` 높이 함체 + 전면(평면 -y쪽) 문짝, `rot` 반영
- 조명기구: `z`=천장면, 평판은 w×d 사각, 다운라이트(종류명에 다운·원형·매입·펜던트, 또는 w≤250)는 원형. 하부 발광면은 조명 켜짐과 연동
- 천장: 외곽 폴리곤, 하단 `z` ~ 상단 `z+t`. 마감명 낱말로 재질 자동 매핑(목재·금속·노출콘크리트는 질감, 도장·텍스는 무광 단색)
- 공종 표시: 1.1.0 객체는 도면 공종이 아니라 객체 공종(F 소방·E 전기·I 인테리어)으로 켜고 끔
- 광원: 조명기구가 있는 층은 기구 위치·정격 광속(lm, 인테리어 트랙 배치값)을 광원으로 사용. 실시간 한도 32개를 넘으면 인접 기구를 묶어 광속 합산(총 광속 보존). 기구가 없는 층만 천장 격자 자동 조명. 광속→장면 세기 환산 `LM_SCALE`(render3d.js)

## 단면 축 · 2D 추출 (v3)
- 축: X(three x), Y(평면 y, 북+), Z(표고, 내려봄=평면·올려봄=천장 평면), 자유(평면 회전각+오프셋, 또는 3D에서 두 점 클릭). `P.view.sec = {on, axis, pos{x,y,z}, ang, off, flip, depth, plane}`
- 3D: 단면 평면·법선 화살표 표시, 앞쪽은 클리핑(clipPlanes[6]), 절단선(빨강) 실시간 계산
- 2D 추출(`render3d.js`): `sectionCut`(삼각형∩평면 → 절단 선분, 객체별 고리로 연결·맞붙은 경계 제거) + `sectionProject`(직교 깊이 버퍼를 렌더해 평면 너머 모서리(25° 이상 꺾인 모서리)의 가려진 부분 제거) → `sectionSVG`/`sectionDXF`
- 표현: RC 부재(기둥·보·슬래브·기초·RC벽)는 사선 해치, 일반 벽 회색 채움, 그 외 절단선만. 수직 단면은 층 레벨선(FL±), 축척은 A3에 맞는 표준 축척 자동, 축척 막대
- 투영 깊이 자동: 평면 단면은 그 층 바닥 바로 위까지, 천장 평면은 윗층 바닥까지, 수직 단면은 모델 끝까지
- 숨김·분리·공종 표시·X/Y/Z 클리핑·단면 상자가 추출에 그대로 반영. 원통(배관)은 측면 윤곽선이 없어 끝단만 투영됨(알려진 한계)

## IFC 모델 (v4) — ThatOpen components 3.6 / fragments 3.6 / web-ifc 0.0.77
- **요구**: 코어 importmap에 three ≥0.182와 `@thatopen/components`·`@thatopen/fragments`·`web-ifc`·`camera-controls` 등록(코어 요청 2026-11-17). 반영 전에는 IFC 버튼이 "코어 업데이트 필요" 안내만 하고 나머지 3D 기능은 그대로 동작
- 폐기 패키지(web-ifc-three, web-ifc-viewer, openbim-components) 사용 금지. `components.init()`은 엔진 준비 시, `components.dispose()`는 unmount 시
- 업로드: .ifc(IfcLoader로 fragments 변환) · .frag. .rvt는 공개 파서가 없어 "Revit에서 IFC로 내보내 업로드" 안내
- 좌표: fragments coordination 이동을 되돌려 IFC 원좌표에 놓고 P.base만큼 이동, 연결 객체가 3개 이상이면 중심 차이 중앙값으로 보정. 업로드 직후 빌더 모델은 숨김(겹침 방지, 연동용으로 유지)
- 저장: `P.view.ifc = {files[{id,name,size,date,items,cats}], show, builder, hidCats, hidStoreys}`. 변환본은 IndexedDB `builder-ifc`(키 `P.id:파일id`)에 캐시 — 다른 브라우저·기기에서는 다시 올려야 함
- 인식: 형상 있는 분류별 개수(한글명)·표시 토글·"만 보기", IfcBuildingStorey별 표시, 클릭 시 속성·Pset(GlobalId·expressID 포함)
- 2D/3D 연동: IFC 객체 ↔ 빌더 객체를 expressID(`el.ifc`, 종류 70% 이상 일치 시) → GlobalId(`el.guid`, 코어 요청) → 부호(Tag=빌더 id 또는 고유 부호) → 같은 종류·중심 300mm 이내 순으로 연결. IFC 선택 → 연결 빌더 객체 선택·"작도(2D)에서 보기", 빌더 선택 → IFC 강조
- 단면 축·클리핑: fragments 타일 재질에 clipPlanes를 연결해 IFC도 같이 잘림

## 변경 이력
- v4 (2026-11-17): IFC 모델(ThatOpen) — 업로드·fragments 변환·캐시, 분류·층 인식과 속성, 빌더 객체 자동 연동(ID·GUID·부호·위치)과 작도 이동, 단면 클리핑 적용. 코어 importmap 반영 후 활성
- v3 (2026-11-15): 단면 축(X·Y·Z·자유·두 점 절단선)과 2D 도면 추출(절단선·해치·숨은선 제거 투영선·레벨선, SVG·DXF·PNG)
- v2 (2026-11-15): Core 1.1.0 객체(스프링클러·분전반·조명기구·천장) 3D 표시, 조명기구 광원화(정격 광속, 32개 초과 시 군집 합산), 공종 F·I 표시 토글 수정
- v1 (2026-11-15): Git 저장소 기준선 — 아티팩트 버전 1794697024-befc에서 가져옴
