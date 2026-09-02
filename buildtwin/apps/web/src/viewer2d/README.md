# viewer2d — DXF→SVG 2D 도면 뷰어

`apps/web/src/viewer2d/` (담당: `viewer-2d`). DXF 에서 추출된 엔티티(`DrawingEntityDraft` 의 TS 미러)를 SVG 로 렌더하고,
**엔티티 handle** 기반으로 선택·하이라이트·이동·3D 단면 오버레이를 제공한다. 이 모듈은 handle 만 안다.
globalId ↔ handle 매핑은 `sync-2d3d`, 화면 레이아웃·슬라이더·스토어는 `frontend` 몫이다.

## 사용

```tsx
import { useRef } from "react";
import { Viewer2D, type Viewer2DHandle } from "@/viewer2d";

const ref = useRef<Viewer2DHandle>(null);

<Viewer2D
  ref={ref}
  drawingId={drawing.id}
  entities={drawing.entities}            // DrawingEntityView[] (서버 JSON 그대로)
  coordinateSystem={drawing.coordinate_system}
  onSelect={(handle) => ...}             // 클릭. 빈 곳이면 null
  onAreaSelect={(handles, bbox) => ...}  // shift+드래그. bbox 는 도면 좌표(y-up)
  onHover={(handle) => ...}
  highlightColor="#ff3d00"
  selectedIds={selectedHandles}          // 옵션: 제어형 .selected 클래스
/>
```

컴포넌트는 부모 크기를 100% 채우는 `<svg>` 하나다. 부모에 명시적 높이를 줘야 한다.

## 명령형 API (`Viewer2DHandle`)

| 메서드 | 동작 |
|---|---|
| `highlight(handles, {exclusive?})` | `.highlighted` 클래스 토글. 모르는 handle 은 무시. `exclusive` 면 기존 하이라이트 제거 후 적용 |
| `clearHighlight()` | 전부 제거 |
| `panTo(handle, {zoom?})` | 엔티티 bbox 중심으로 viewBox 이동. `zoom` 은 현재 배율 대비 배수(2 = 두 배 확대) |
| `setOverlay(section, {opacity?, transform?, color?, strokeWidth?})` | `PlanSection` 폴리라인을 `transform`(모델→도면 4x4, 행 우선)으로 투영해 `<g class="overlay">` 에 그린다. `null` 이면 제거. transform 이 없으면 identity + `console.warn` |
| `setOverlayOpacity(0~1)` | 오버레이 투명도만 갱신 |
| `fitToView()` | 도면 전체 bbox 로 viewBox 복원 |
| `getViewport()` | `{viewBox(SVG,y-down), drawingBBox(도면,y-up), drawingExtent}` |

`transform` 은 `number[][]`(4x4) 또는 `{matrix: number[][]}`(packages/core `CoordinateTransform` 직렬화) 둘 다 받는다.
viewer3d 의 `PlanSection` 타입은 그대로 넘길 수 있다.

## 상호작용

- 드래그(좌/중 버튼): 팬. 휠: 커서 기준 줌. 3px 이내 이동 + 떼기 = 클릭 → `onSelect(handle | null)`.
- shift+드래그: 러버밴드. 교차하는 엔티티 handle 목록과 도면 좌표 bbox 를 `onAreaSelect` 로 내보낸다.
- 이동 중 hover 는 `onHover` (변경 시에만).

## 좌표 규칙

- 엔티티 좌표는 원본 도면 단위(y-up) 그대로 SVG 속성에 쓴다. y 반전은 루트 `<g transform="scale(1,-1)">` **하나**로만 하고,
  viewBox 는 엔티티 bbox 에서 유도한다(`viewBoxFromBBox`). 특정 도면에 묶인 상수는 없다.
- client px ↔ 도면 좌표 변환은 `clientToDrawing(viewBox, rect, clientX, clientY)` 한 함수(`preserveAspectRatio="xMidYMid meet"` 규칙 반영).
- 텍스트·블록 마커처럼 글리프 방향이 있는 요소만 자기 로컬 프레임에서 되돌린다(위치는 루트 변환).

## DOM 구조

```
svg.viewer2d[data-drawing-id][data-coordinate-source]
  g.v2d-root[transform=scale(1,-1)]
    g.v2d-entities
      g[data-layer=A][stroke=색]      ← 레이어당 하나, 팔레트는 레이어 인덱스 순
        line|polyline|polygon|circle|path|g.insert-marker|text [data-handle][data-layer]
    g.overlay[data-level][opacity]      ← setOverlay 시
      polyline|polygon[data-global-id]
  rect.rubber-band                      ← 드래그 중
```

엔티티 타입 매핑: LINE→line, LWPOLYLINE/POLYLINE→polyline(닫힘이면 polygon, `data-closed`), CIRCLE→circle,
ARC→path(attrs.start_angle/end_angle), INSERT→`g.insert-marker`(십자+원, `data-block`), TEXT/MTEXT→text(attrs.height),
HATCH→polygon(fill-opacity). 모르는 타입은 점이 있으면 polyline(`data-fallback`).

## 순수 함수

`dxfToSvg.ts`(`buildSvgModel`, `entityToSvg`, `entityBBox`, `viewBoxFromBBox`), `selection.ts`(`entitiesInBBox`, `hitTestHandle`, `clientToDrawing`),
`overlay.ts`(`projectSection`, `overlayToSvg`, `applyTransform2D`) 는 DOM/React 없이 테스트된다. 서버가 SVG 문자열을 만들 때는 `svgModelToString` 을 참고.

## 테스트

```
npx vitest run src/viewer2d
```
