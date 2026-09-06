# apps/web

React 18 + TypeScript 5 + Vite 5. Node 22 / npm 10.

| 디렉터리 | 담당 |
|---|---|
| `src/viewer3d/` | `viewer-3d` — three.js IFC 메시 번들 뷰어 (`Viewer3DHandle`) |
| `src/viewer2d/` | `viewer-2d` — DXF→SVG 도면 뷰어 (`Viewer2DHandle`) |
| `src/sync/` | `sync-2d3d` — 선택 이벤트 브로커(`broker.ts`), `selection` 스토어 슬라이스 |
| `src/pages/`, `src/components/`, `src/store/`, `src/api/`, `src/domain/`, `src/lib/`, `src/viewers/` | `frontend` |

## 실행

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173  (/api → http://localhost:8000 프록시)
npm test             # vitest run
npm run lint         # eslint (apps/web/.eslintrc.cjs)
npx tsc --noEmit     # 타입 검사
npm run build
```

## 라우트

| 경로 | 화면 |
|---|---|
| `/login` | JWT 로그인 (`POST /auth/login`) |
| `/projects` | 프로젝트 목록 / 생성(admin) |
| `/projects/:id/upload` | 드래그앤드롭 업로드 → `job_id` 폴링. RVT `needs_ifc_export` 안내, DWG "DXF 권장" |
| `/projects/:id/viewer` | 좌우 분할 2D\|3D 동기 뷰 + 객체 상세 패널(기본정보/상태/이력/다음행동) |
| `/projects/:id/daily-report` | 작업일보 입력 |
| `/projects/:id/reviews` | 검토요청 목록(신고/스캔/논리 나란히), CM 승인/반려/보류 |
| `/projects/:id/summary` | 주간 진도 요약 |

## 상태 관리

- 클라이언트 상태: 단일 Zustand 스토어 `src/store/index.ts` — `ui` / `auth`(localStorage 영속) / `selection`(`src/sync/selectionSlice.ts`).
- 서버 상태: TanStack Query 훅 `src/api/hooks.ts` 만 사용. 스토어에 복사하지 않는다.
- 뷰어는 `ref` 핸들로만 접근하고 `createBroker(useStore).attach({viewer2d, viewer3d})` 로 브로커에 등록한다.

## 표시 규칙

- 상태 라벨·색상은 `src/viewer3d/colors.ts`(`STATE_COLORS`, `STATE_LABELS_KO`) 를 import (`src/domain/labels.ts` 경유). `ESTIMATED_DONE` 은 항상 "완료추정".
- 모든 판정·매핑·readiness 에 `ConfidenceBadge`(% + "근거" 팝오버).
- "확정" 버튼은 `auth.role === "cm"` 일 때만 렌더, 확인 다이얼로그 후 `POST /objects/{gid}/transitions`; 403 은 화면에 표시.

## API 계약 (frontend 가 기대하는 응답)

`src/api/types.ts` 참고. 목록 응답은 `T[]` 또는 `{items, total}` 둘 다 허용.
