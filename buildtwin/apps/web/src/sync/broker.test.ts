import { createStore } from "zustand/vanilla";
import { createBroker, type Viewer2DLike, type Viewer3DLike } from "./broker";
import { createSelectionSlice, type SelectionRoot } from "./selectionSlice";

function makeStore() {
  return createStore<SelectionRoot>()((...a) => ({ selection: createSelectionSlice(...a) }));
}

function fake3d(): Viewer3DLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    highlight: vi.fn((ids, opts) => calls.push(`highlight:${ids.join(",")}:${opts?.exclusive ? "x" : ""}`)),
    clearHighlight: vi.fn(() => calls.push("clear")),
    flyTo: vi.fn(async (id) => {
      calls.push(`flyTo:${id}`);
    }),
  };
}
function fake2d(): Viewer2DLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    highlight: vi.fn((ids, opts) => calls.push(`highlight:${ids.join(",")}:${opts?.exclusive ? "x" : ""}`)),
    clearHighlight: vi.fn(() => calls.push("clear")),
    panTo: vi.fn((id) => calls.push(`panTo:${id}`)),
  };
}

const mappings = [
  { entity_handle: "H1", global_id: "G1", confidence: 0.95 },
  { entity_handle: "H1b", global_id: "G1", confidence: 0.6 },
  { entity_handle: "H2", global_id: "G2", confidence: 0.9 },
  { entity_handle: "H3", global_id: "G3", confidence: 0.8 },
];

describe("selection broker", () => {
  it("3D 선택 → 2D highlight(매핑된 handle, exclusive) + panTo(첫 handle); 3D 는 다시 호출되지 않음", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    const v3 = fake3d();
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.select3d("G1");

    expect(store.getState().selection).toMatchObject({ source: "3d", globalIds: ["G1"], entityHandles: ["H1", "H1b"] });
    expect(v2.highlight).toHaveBeenCalledWith(["H1", "H1b"], { exclusive: true });
    expect(v2.panTo).toHaveBeenCalledWith("H1");
    expect(v3.highlight).not.toHaveBeenCalled();
    expect(v3.flyTo).not.toHaveBeenCalled();
  });

  it("2D 단일 선택 → 3D highlight + flyTo; 2D 는 다시 호출되지 않음", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    const v3 = fake3d();
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.select2d("H2");

    expect(store.getState().selection).toMatchObject({ source: "2d", globalIds: ["G2"], entityHandles: ["H2"] });
    expect(v3.highlight).toHaveBeenCalledWith(["G2"], { exclusive: true });
    expect(v3.flyTo).toHaveBeenCalledWith("G2");
    expect(v2.highlight).not.toHaveBeenCalled();
    expect(v2.panTo).not.toHaveBeenCalled();
  });

  it("2D 영역 선택이 객체 하나로 귀결되면 flyTo 한다", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v3 = fake3d();
    broker.attach({ viewer3d: v3 });
    broker.setMappings(mappings);
    broker.selectArea2d(["H1", "H1b"]);
    expect(v3.highlight).toHaveBeenCalledWith(["G1"], { exclusive: true });
    expect(v3.flyTo).toHaveBeenCalledWith("G1");
  });

  it("2D 영역 선택 → 3D highlight(globalIds 합집합, 중복 제거), 다중이면 flyTo 없음", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    const v3 = fake3d();
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.selectArea2d(["H1", "H1b", "H3", "UNKNOWN"]);

    expect(store.getState().selection).toMatchObject({ source: "2d", globalIds: ["G1", "G3"], entityHandles: ["H1", "H1b", "H3", "UNKNOWN"] });
    expect(v3.highlight).toHaveBeenCalledWith(["G1", "G3"], { exclusive: true });
    expect(v3.flyTo).not.toHaveBeenCalled();
    expect(v2.highlight).not.toHaveBeenCalled();
  });

  it("패널 선택 → 양쪽 뷰어 모두 하이라이트", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    const v3 = fake3d();
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.selectFromPanel("G3");

    expect(v3.highlight).toHaveBeenCalledWith(["G3"], { exclusive: true });
    expect(v2.highlight).toHaveBeenCalledWith(["H3"], { exclusive: true });
    expect(store.getState().selection.source).toBe("panel");
  });

  it("빈 선택(null) → 상대 뷰어 clearHighlight", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    const v3 = fake3d();
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.select3d("G1");
    broker.select3d(null);

    expect(v2.clearHighlight).toHaveBeenCalledTimes(1);
    expect(v3.clearHighlight).not.toHaveBeenCalled();
    expect(store.getState().selection.globalIds).toEqual([]);
  });

  it("루프 없음: 뷰어가 highlight 중 onSelect 를 되쏴도 재진입 호출이 원천 뷰어로 돌아가지 않는다", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v3 = fake3d();
    // 2D 뷰어가 highlight 를 받으면 마치 사용자가 클릭한 것처럼 select2d 를 되쏘는 악성 구현
    const v2 = fake2d();
    (v2.highlight as ReturnType<typeof vi.fn>).mockImplementation((ids: string[]) => {
      v2.calls.push(`highlight:${ids.join(",")}`);
      broker.select2d(ids[0]);
    });
    broker.attach({ viewer2d: v2, viewer3d: v3 });
    broker.setMappings(mappings);

    broker.select3d("G1");

    expect(v2.highlight).toHaveBeenCalledTimes(1);
    expect(v3.highlight).not.toHaveBeenCalled();
    expect(v3.flyTo).not.toHaveBeenCalled();
    expect(store.getState().selection.source).toBe("3d");
  });

  it("dispose 후에는 전파하지 않는다 / attach 로 뷰어 교체 가능", () => {
    const store = makeStore();
    const broker = createBroker(store);
    const v2 = fake2d();
    broker.attach({ viewer2d: v2 });
    broker.setMappings(mappings);
    broker.select3d("G2");
    expect(v2.highlight).toHaveBeenCalledTimes(1);

    broker.dispose();
    store.getState().selection.set("3d", ["G3"], ["H3"]);
    expect(v2.highlight).toHaveBeenCalledTimes(1);
  });
});
