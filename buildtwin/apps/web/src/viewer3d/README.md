# viewer3d — IFC 3D 뷰어 모듈 (`viewer-3d` 담당)

three.js 기반 순수 뷰어 컴포넌트 + 명령형 핸들. **IFC GlobalId 만 안다.** 스토어·2D handle·상태 전이 로직은 없다(props/콜백/ref 만).

```tsx
import { Viewer3D, type Viewer3DHandle } from "@/viewer3d"; // 또는 "./viewer3d"

const ref = useRef<Viewer3DHandle>(null);
<Viewer3D
  ref={ref}
  modelUrl="/api/models/123/mesh.json"
  levels={[{ name: "1F", elevation: 0 }, { name: "2F", elevation: 3.7 }]}
  sectionOffset={1.2}
  coordinateSystem={model.coordinate_system}      // DB 에서 온 값
  stateMap={statesFromStore}                       // frontend 가 스토어에서 읽어 넘김
  onSelect={(gid) => ...} onHover={(gid) => ...}
/>
```

## 메시 번들 입력 (`modelUrl`)

`services/ingest` 가 IFC 모델마다 내보내는 JSON:

```json
{ "<IfcGlobalId>": { "vertices": [x0,y0,z0, x1,y1,z1, ...], "faces": [a0,b0,c0, a1,b1,c1, ...] }, ... }
```

- `vertices`: flat xyz, **미터, 월드 좌표(Z-up)**. `faces`: flat 삼각형 인덱스.
- `MeshBundleLoader` 가 객체당 `THREE.Mesh` 하나(BufferGeometry + MeshStandardMaterial flatShading, 객체별 재질 인스턴스)를 만들고 객체별 bbox·모델 bbox 를 계산한다. 잘못된 항목은 `skipped` 에 모은다.
- OBJ(`o <globalId>`)·web-ifc 경로는 구현하지 않았다(JSON 번들이 필수 경로).

## 핸들 API (`Viewer3DHandle`)

| 메서드 | 동작 |
|---|---|
| `highlight(ids, {exclusive?})` | 파란 emissive + 외곽선(EdgesGeometry, `showEdges`). `exclusive` 면 나머지 반투명(0.15) |
| `clearHighlight()` | 하이라이트·반투명 해제 |
| `flyTo(id): Promise<void>` | 객체 bbox 에 맞춰 600ms 카메라 애니메이션(현재 시선 방향 유지). 없는 id 면 즉시 resolve |
| `setState(id, state)` / `setStates(map)` | 상태색만 칠한다(병합). 로드 전 호출도 기억했다가 로드 시 적용 |
| `getPlanSection(level, offset?)` | `props.levels` 에서 층을 찾아 `z = elevation + (offset ?? props.sectionOffset ?? 1.2)` 로 정밀 메시 슬라이스 → `PlanSection` (객체별 폴리라인 + `svg`). 좌표는 **모델 좌표계 그대로**, 변환은 sync-2d3d |
| `togglePointCloud(visible)` | 포인트클라우드 표시/숨김(로드 전 호출도 기억) |
| `loadPointCloud(url, transform)` | PLY(binary/ascii) 또는 ascii xyz. `transform.matrix`(4x4 행 우선, packages/core `CoordinateTransform`) 를 `Points.matrix` 에 적용. 하드코딩 없음 |
| `isolate(ids \| null)` | 지정 객체만 표시 / null 이면 전체 복원 |
| `getObjectIds()` | 로드된 GlobalId 목록(디버그·테스트) |

## Props (`Viewer3DProps`)

`modelUrl`(필수), `onSelect`, `onHover`(스로틀 `hoverThrottleMs` 기본 50ms), `initialStates`(로드 시 1회), `stateMap`(변경 시 **전체 교체**, 없는 id 는 PLANNED), `levels: {name, elevation}[]`, `sectionOffset`(기본 1.2), `coordinateSystem`(생략 시 `ifc_local` 항등 좌표계로 보고), `pointCloudUrl` + `pointCloudTransform`(둘 다 있으면 자동 로드), `pointSize`(기본 0.02), `showEdges`(기본 true), `background`(기본 `#F5F5F5`), `onLoad({objectCount, bbox})`, `onError`, `className`, `style`, `disableRenderer`(테스트용).

- 클릭: pointerdown→up 이동 5px 이하일 때만 raycast → `onSelect(globalId | null)`. 드래그(궤도 조작)는 선택하지 않는다.
- 컨테이너는 `width/height: 100%` 이므로 **부모가 높이를 줘야 한다**. `ResizeObserver` 로 리사이즈 대응. 언마운트 시 geometry/material/renderer/controls 해제.
- WebGL 이 없으면(jsdom·CI) 렌더러 생성만 건너뛰고(try/catch) 핸들·단면은 그대로 동작한다.
- 로드 완료 시 컨테이너에 `data-loaded="true"`, `data-object-count="N"` 속성이 붙는다(Playwright 대기용).

## 상태 색 (`colors.ts`)

PLANNED `#9E9E9E` · REPORTED/IN_PROGRESS `#FFD600` · ESTIMATED_DONE `#AEEA00` · INSPECTION_REQUESTED `#FF6D00` · CONFIRMED `#00C853` · MISMATCH `#D50000` · UNVERIFIABLE `#AA00FF`. 한국어 라벨은 `STATE_LABELS_KO`.

## 순수 함수 (WebGL 불필요)

- `section.ts`: `slicePlan(meshes, z)`, `sliceMeshSegments`, `chainSegments`(끝점 용접 + 공선점 제거), `polylinesToSvg`(y 뒤집음, `data-global-id` 부여).
- `pointcloud.ts`: `parseXyz`, `matrix4FromTransform`(행 우선 → `THREE.Matrix4`).

## 테스트

```
cd apps/web
npx vitest run --config src/viewer3d/vitest.config.ts   # 저장소 루트 postcss 설정 우회
npx tsc --noEmit
```

`npx vitest run src/viewer3d` 가 되려면 frontend 가 `vite.config.ts` 에 `css: { postcss: { plugins: [] } }` 를 넣거나 `apps/web/postcss.config.cjs` 를 두어야 한다(상위 디렉터리 `/home/user/Bim/postcss.config.mjs` 가 잡힘).
