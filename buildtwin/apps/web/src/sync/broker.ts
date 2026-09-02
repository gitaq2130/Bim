/**
 * 2D↔3D 선택 이벤트 브로커 (클라이언트, sync-2d3d 계약).
 *
 * 흐름: viewer.onSelect → broker.selectXX → 매핑 조회(캐시) → store.selection 갱신
 *      → 구독자가 "원천이 아닌" 뷰어에만 highlight/flyTo/panTo.
 * 루프 방지: selection.source 로 원천 뷰어를 건너뛰고, 푸시 중 재진입 호출은 무시한다.
 */
import type { StoreApi } from "zustand";
import type { SelectionRoot, SelectionSource } from "./selectionSlice";
import type { Viewer2DHandle, Viewer3DHandle } from "./viewerTypes";

/** 브로커가 실제로 호출하는 최소 핸들 표면 (테스트 가짜 핸들도 이것만 구현하면 된다) */
export type Viewer3DLike = Pick<Viewer3DHandle, "highlight" | "clearHighlight" | "flyTo">;
export type Viewer2DLike = Pick<Viewer2DHandle, "highlight" | "clearHighlight" | "panTo">;

export interface MappingLike {
  entity_handle: string;
  global_id: string;
  confidence: number;
}

export interface BrokerViewers {
  viewer2d?: Viewer2DLike | null;
  viewer3d?: Viewer3DLike | null;
}

export interface SelectionBroker {
  attach(viewers: BrokerViewers): void;
  setMappings(mappings: MappingLike[]): void;
  select3d(globalId: string | null): void;
  select2d(handle: string | null): void;
  selectArea2d(handles: string[]): void;
  selectFromPanel(globalId: string | null): void;
  clear(): void;
  handlesFor(globalId: string): string[];
  globalIdsFor(handle: string): string[];
  dispose(): void;
}

type SelectionStore = Pick<StoreApi<SelectionRoot>, "getState" | "subscribe">;

const uniq = (xs: string[]) => Array.from(new Set(xs));

export function createBroker(store: SelectionStore): SelectionBroker {
  let viewer2d: Viewer2DLike | null = null;
  let viewer3d: Viewer3DLike | null = null;
  const handleToGids = new Map<string, string[]>();
  const gidToHandles = new Map<string, string[]>();
  let pushing = false;

  const handlesFor = (gid: string) => gidToHandles.get(gid) ?? [];
  const globalIdsFor = (h: string) => handleToGids.get(h) ?? [];

  const swallow = (p: unknown) => {
    if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => {});
  };

  const pushTo2d = (handles: string[]) => {
    if (!viewer2d) return;
    if (handles.length === 0) {
      viewer2d.clearHighlight();
      return;
    }
    viewer2d.highlight(handles, { exclusive: true });
    if (handles.length === 1) viewer2d.panTo(handles[0]);
  };

  const pushTo3d = (globalIds: string[]) => {
    if (!viewer3d) return;
    if (globalIds.length === 0) {
      viewer3d.clearHighlight();
      return;
    }
    viewer3d.highlight(globalIds, { exclusive: true });
    if (globalIds.length === 1) swallow(viewer3d.flyTo(globalIds[0]));
  };

  /** 구독자: 원천(source)이 아닌 쪽에만 전파 */
  const propagate = (source: SelectionSource, globalIds: string[], entityHandles: string[]) => {
    if (pushing) return;
    pushing = true;
    try {
      if (source !== "3d") pushTo3d(globalIds);
      if (source !== "2d") pushTo2d(entityHandles);
    } finally {
      pushing = false;
    }
  };

  const unsubscribe = store.subscribe((state, prev) => {
    const cur = state.selection;
    if (cur === prev.selection) return;
    const p = prev.selection;
    const same =
      cur.source === p.source &&
      cur.globalIds.length === p.globalIds.length &&
      cur.entityHandles.length === p.entityHandles.length &&
      cur.globalIds.every((g, i) => g === p.globalIds[i]) &&
      cur.entityHandles.every((h, i) => h === p.entityHandles[i]);
    if (same) return;
    propagate(cur.source, cur.globalIds, cur.entityHandles);
  });

  const setSelection = (source: SelectionSource, gids: string[], handles: string[]) => {
    if (pushing) return; // 뷰어가 highlight 중 onSelect 를 되쏘는 경우: 루프 차단
    store.getState().selection.set(source, uniq(gids), uniq(handles));
  };

  return {
    attach(v) {
      if (v.viewer2d !== undefined) viewer2d = v.viewer2d;
      if (v.viewer3d !== undefined) viewer3d = v.viewer3d;
    },
    setMappings(mappings) {
      handleToGids.clear();
      gidToHandles.clear();
      for (const m of mappings) {
        if (!m.entity_handle || !m.global_id) continue;
        const a = handleToGids.get(m.entity_handle) ?? [];
        if (!a.includes(m.global_id)) a.push(m.global_id);
        handleToGids.set(m.entity_handle, a);
        const b = gidToHandles.get(m.global_id) ?? [];
        if (!b.includes(m.entity_handle)) b.push(m.entity_handle);
        gidToHandles.set(m.global_id, b);
      }
    },
    select3d(globalId) {
      if (globalId == null) return setSelection("3d", [], []);
      setSelection("3d", [globalId], handlesFor(globalId));
    },
    select2d(handle) {
      if (handle == null) return setSelection("2d", [], []);
      setSelection("2d", globalIdsFor(handle), [handle]);
    },
    selectArea2d(handles) {
      const gids = handles.flatMap(globalIdsFor);
      setSelection("2d", gids, handles);
    },
    selectFromPanel(globalId) {
      if (globalId == null) return setSelection("panel", [], []);
      setSelection("panel", [globalId], handlesFor(globalId));
    },
    clear() {
      setSelection(null, [], []);
    },
    handlesFor,
    globalIdsFor,
    dispose() {
      unsubscribe();
      viewer2d = null;
      viewer3d = null;
    },
  };
}
