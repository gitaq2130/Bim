/**
 * 단일 Zustand 스토어. 슬라이스: ui / auth / selection(sync-2d3d).
 * 서버 데이터는 절대 여기에 넣지 않는다 (TanStack Query 전용).
 */
import { create } from "zustand";
import type { StateCreator } from "zustand";
import type { UserRole } from "../api/types";
import { createSelectionSlice, type SelectionRoot, type SelectionSlice } from "../sync/selectionSlice";

// ---------- ui ----------
export interface UiSlice {
  splitRatio: number; // 0~1, 2D 영역 비율
  currentLevel: string | null;
  overlayVisible: boolean;
  overlayOpacity: number; // 0~1
  pointCloudVisible: boolean;
  currentProjectId: string | null;
  currentModelId: string | null;
  currentDrawingId: string | null;
  currentScanId: string | null;
  setSplitRatio(r: number): void;
  setCurrentLevel(level: string | null): void;
  setOverlayVisible(v: boolean): void;
  setOverlayOpacity(o: number): void;
  setPointCloudVisible(v: boolean): void;
  setCurrentProjectId(id: string | null): void;
  setCurrentModelId(id: string | null): void;
  setCurrentDrawingId(id: string | null): void;
  setCurrentScanId(id: string | null): void;
}

// ---------- auth ----------
export interface AuthState {
  token: string | null;
  role: UserRole | null;
  userId: string | null;
}
export interface AuthSlice extends AuthState {
  login(a: { token: string; role: UserRole; userId: string }): void;
  logout(): void;
}

export interface RootState extends SelectionRoot {
  ui: UiSlice;
  auth: AuthSlice;
  selection: SelectionSlice;
}

const AUTH_KEY = "buildtwin.auth";

function loadAuth(): AuthState {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_KEY);
    if (!raw) return { token: null, role: null, userId: null };
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    return { token: parsed.token ?? null, role: parsed.role ?? null, userId: parsed.userId ?? null };
  } catch {
    return { token: null, role: null, userId: null };
  }
}

function saveAuth(a: AuthState) {
  try {
    if (a.token) globalThis.localStorage?.setItem(AUTH_KEY, JSON.stringify(a));
    else globalThis.localStorage?.removeItem(AUTH_KEY);
  } catch {
    /* 저장 불가 환경(프라이빗 모드 등)은 무시 */
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const createUiSlice: StateCreator<RootState, [], [], UiSlice> = (set) => {
  const patch = (p: Partial<UiSlice>) => set((s) => ({ ui: { ...s.ui, ...p } }));
  return {
    splitRatio: 0.5,
    currentLevel: null,
    overlayVisible: false,
    overlayOpacity: 0.5,
    pointCloudVisible: false,
    currentProjectId: null,
    currentModelId: null,
    currentDrawingId: null,
    currentScanId: null,
    setSplitRatio: (r) => patch({ splitRatio: Math.min(0.85, Math.max(0.15, r)) }),
    setCurrentLevel: (currentLevel) => patch({ currentLevel }),
    setOverlayVisible: (overlayVisible) => patch({ overlayVisible }),
    setOverlayOpacity: (o) => patch({ overlayOpacity: clamp01(o) }),
    setPointCloudVisible: (pointCloudVisible) => patch({ pointCloudVisible }),
    setCurrentProjectId: (currentProjectId) => patch({ currentProjectId }),
    setCurrentModelId: (currentModelId) => patch({ currentModelId }),
    setCurrentDrawingId: (currentDrawingId) => patch({ currentDrawingId }),
    setCurrentScanId: (currentScanId) => patch({ currentScanId }),
  };
};

const createAuthSlice: StateCreator<RootState, [], [], AuthSlice> = (set) => ({
  ...loadAuth(),
  login: ({ token, role, userId }) => {
    saveAuth({ token, role, userId });
    set((s) => ({ auth: { ...s.auth, token, role, userId } }));
  },
  logout: () => {
    saveAuth({ token: null, role: null, userId: null });
    set((s) => ({ auth: { ...s.auth, token: null, role: null, userId: null } }));
  },
});

export const useStore = create<RootState>()((...a) => ({
  ui: createUiSlice(...a),
  auth: createAuthSlice(...a),
  selection: createSelectionSlice(...(a as unknown as Parameters<typeof createSelectionSlice>)),
}));

export type AppStore = typeof useStore;

// 편의 셀렉터
export const useAuth = () => useStore((s) => s.auth);
export const useUi = () => useStore((s) => s.ui);
export const useSelection = () => useStore((s) => s.selection);
