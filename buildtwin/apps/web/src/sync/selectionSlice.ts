/**
 * 단일 Zustand 스토어의 `selection` 슬라이스 (sync-2d3d 계약).
 * 뷰어는 이 스토어를 모른다 — 브로커가 갱신하고 브로커가 뷰어에 명령한다.
 */
import type { StateCreator } from "zustand";

export type SelectionSource = "2d" | "3d" | "panel" | null;

export interface SelectionState {
  source: SelectionSource;
  globalIds: string[];
  entityHandles: string[];
}

export interface SelectionSlice extends SelectionState {
  set(source: SelectionSource, globalIds: string[], entityHandles: string[]): void;
  clear(): void;
}

export interface SelectionRoot {
  selection: SelectionSlice;
}

export const createSelectionSlice: StateCreator<SelectionRoot, [], [], SelectionSlice> = (set) => ({
  source: null,
  globalIds: [],
  entityHandles: [],
  set: (source, globalIds, entityHandles) =>
    set((s) => ({ selection: { ...s.selection, source, globalIds: [...globalIds], entityHandles: [...entityHandles] } })),
  clear: () => set((s) => ({ selection: { ...s.selection, source: null, globalIds: [], entityHandles: [] } })),
});
