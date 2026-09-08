/**
 * 세션 경계에서 캐시를 폐기하는 가드 (ADR 0010 규칙 2·3).
 *
 * **트리거는 호출 지점이 아니라 `auth.userId` 의 변화다.** 이 저장소가 반복한 실패는
 * "로그아웃 호출 지점마다 캐시도 함께 지우기"를 기억에 맡긴 것이었다 — 셋째 호출 지점이 생기는 날
 * 같은 사고가 난다. 실제로 셋째 경로는 이미 있다(`LoginPage` 의 로그아웃 없는 계정 전환).
 * 신원이 바뀌는 것을 조건으로 잡으면 세 경로가 한 번에 덮인다:
 *   - 사용자가 누르는 로그아웃(`AppLayout`)      … "userA" → null
 *   - 401 자동 로그아웃(`api/client.ts`)          … "userA" → null
 *   - 로그아웃 없는 계정 전환(`LoginPage`)        … "userA" → "userB"
 *
 * 반대로 **같은 사용자가 토큰만 갱신**하면(`userId` 동일) 캐시는 유지된다. 조건을 `token` 으로 잡으면
 * 그 경우까지 캐시를 통째로 버리게 되고, 그때는 양성 조건과 음성 조건이 같은 값을 낸다(CLAUDE.md §6-2 3).
 *
 * `logout()` 본문은 건드리지 않는다 — Zustand 슬라이스가 React Query 에 의존하면 앱 싱글턴과
 * 테스트용 QueryClient 가 어긋나 **테스트가 진짜 경로를 타지 않는다**(ADR 0010 Alternatives 1).
 */
import type { QueryClient } from "@tanstack/react-query";
import { useStore } from "../store";

/**
 * `auth.userId` 가 바뀌면 서버 상태(QueryClient)와 **사용자에 매인** 클라이언트 상태를 폐기한다.
 * 반환값은 구독 해제 함수다.
 *
 * 폐기하는 것: 쿼리·뮤테이션 캐시 전부, `selection` 슬라이스, `ui` 의 현재 자원 id.
 * 폐기하지 않는 것: `ui.splitRatio`·`overlayOpacity` 같은 **화면 취향** — 사용자가 아니라 브라우저에
 * 매인 값이고, 지우면 UX 만 나빠진다(ADR 0010 규칙 3).
 */
export function installSessionCacheGuard(qc: QueryClient, store: typeof useStore = useStore): () => void {
  return store.subscribe((state, prev) => {
    if (state.auth.userId === prev.auth.userId) return;

    // clear(): 뮤테이션 캐시까지 비운다. resetQueries() 는 활성 관찰자를 **즉시 재요청**시켜
    // 토큰 없는 401 폭주를 만든다(ADR 0010 규칙 3). removeQueries() 는 뮤테이션 캐시를 남긴다.
    qc.clear();

    const s = store.getState();
    s.selection.clear();
    s.ui.setCurrentProjectId(null);
    s.ui.setCurrentModelId(null);
    s.ui.setCurrentDrawingId(null);
    s.ui.setCurrentScanId(null);
    s.ui.setCurrentLevel(null);
  });
}
