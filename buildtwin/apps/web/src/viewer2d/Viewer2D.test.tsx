import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Viewer2D } from "./Viewer2D";
import { drawingToClient } from "./selection";
import type { CoordinateSystem, DrawingEntityView, PlanSection, Viewer2DHandle } from "./types";

const cs: CoordinateSystem = { source: "dxf_local", origin: [0, 0, 0], rotation_deg: 0, scale: 0.001, unit: "mm" };

const entities: DrawingEntityView[] = [
  { handle: "A", layer: "WALL", dxftype: "LINE", points: [[0, 0], [10, 10]] },
  { handle: "B", layer: "WALL", dxftype: "LINE", points: [[50, 50], [60, 60]] },
  { handle: "C", layer: "COL", dxftype: "CIRCLE", points: [[70, 70]], radius: 5 },
  { handle: "I", layer: "SYM", dxftype: "INSERT", block_name: "BLK", insert_point: [20, 60] },
];

const RECT = { left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };

function setup(extra: Partial<React.ComponentProps<typeof Viewer2D>> = {}) {
  const ref = createRef<Viewer2DHandle>();
  const onSelect = vi.fn();
  const onAreaSelect = vi.fn();
  const onHover = vi.fn();
  const utils = render(
    <Viewer2D
      ref={ref}
      drawingId="D1"
      entities={entities}
      coordinateSystem={cs}
      onSelect={onSelect}
      onAreaSelect={onAreaSelect}
      onHover={onHover}
      {...extra}
    />,
  );
  const svg = utils.container.querySelector("svg") as SVGSVGElement;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(RECT as DOMRect);
  return { ...utils, ref, svg, onSelect, onAreaSelect, onHover };
}

/** jsdom 에는 PointerEvent 가 없다. React 는 이벤트 이름으로 라우팅하므로 MouseEvent 로 대신 쏜다. */
function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX?: number; clientY?: number; shiftKey?: boolean; button?: number } = {},
) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0, ...init }),
    );
  });
}

function el(svg: SVGSVGElement, handle: string): Element {
  const e = svg.querySelector(`[data-handle="${handle}"]`);
  if (!e) throw new Error(`no element for ${handle}`);
  return e;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Viewer2D rendering", () => {
  it("renders one element per entity with data-handle / data-layer inside layer groups", () => {
    const { svg } = setup();
    expect(svg.getAttribute("data-drawing-id")).toBe("D1");
    expect(svg.getAttribute("data-coordinate-source")).toBe("dxf_local");
    expect(svg.querySelectorAll(".v2d-entities [data-handle]").length).toBe(4);
    expect(el(svg, "A").tagName).toBe("line");
    expect(el(svg, "A").getAttribute("data-layer")).toBe("WALL");
    expect(el(svg, "C").tagName).toBe("circle");
    expect(el(svg, "I").getAttribute("data-block")).toBe("BLK");
    expect(svg.querySelectorAll("g[data-layer]").length).toBe(3);
    expect(svg.querySelector(".v2d-root")!.getAttribute("transform")).toBe("scale(1,-1)");
    // viewBox 는 bbox (0,0)-(75,75) 에서 유도, y 반전
    const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(vb[0]).toBeLessThan(0);
    expect(vb[1]).toBeLessThan(-75);
    expect(vb[2]).toBeGreaterThan(75);
  });

  it("click on an entity calls onSelect(handle); click on empty space calls onSelect(null)", () => {
    const { svg, onSelect } = setup();
    pointer(el(svg, "B"), "pointerdown", { clientX: 100, clientY: 100 });
    pointer(el(svg, "B"), "pointerup", { clientX: 101, clientY: 100 });
    expect(onSelect).toHaveBeenLastCalledWith("B");
    pointer(svg, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(svg, "pointerup", { clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("drag (pan) does not fire onSelect but moves the viewBox", () => {
    const { svg, onSelect, ref } = setup();
    const before = ref.current!.getViewport().viewBox;
    pointer(el(svg, "A"), "pointerdown", { clientX: 100, clientY: 100 });
    pointer(svg, "pointermove", { clientX: 140, clientY: 100 });
    pointer(svg, "pointerup", { clientX: 140, clientY: 100 });
    expect(onSelect).not.toHaveBeenCalled();
    const after = ref.current!.getViewport().viewBox;
    expect(after.x).toBeLessThan(before.x);
    expect(after.width).toBe(before.width);
  });

  it("pointermove over an entity calls onHover, only on change", () => {
    const { svg, onHover } = setup();
    pointer(el(svg, "C"), "pointermove", { clientX: 5, clientY: 5 });
    pointer(el(svg, "C"), "pointermove", { clientX: 6, clientY: 6 });
    pointer(svg, "pointermove", { clientX: 7, clientY: 7 });
    expect(onHover.mock.calls.map((c) => c[0])).toEqual(["C", null]);
  });
});

describe("Viewer2D imperative handle", () => {
  it("highlight() toggles the class, ignores unknown handles, exclusive replaces", () => {
    const { svg, ref } = setup();
    act(() => ref.current!.highlight(["A", "NOPE"]));
    expect(el(svg, "A").classList.contains("highlighted")).toBe(true);
    expect(el(svg, "B").classList.contains("highlighted")).toBe(false);
    act(() => ref.current!.highlight(["B"]));
    expect(el(svg, "A").classList.contains("highlighted")).toBe(true);
    act(() => ref.current!.highlight(["C"], { exclusive: true }));
    expect(el(svg, "A").classList.contains("highlighted")).toBe(false);
    expect(el(svg, "B").classList.contains("highlighted")).toBe(false);
    expect(el(svg, "C").classList.contains("highlighted")).toBe(true);
    act(() => ref.current!.clearHighlight());
    expect(svg.querySelectorAll(".highlighted").length).toBe(0);
  });

  it("selectedIds prop applies .selected", () => {
    const { svg, rerender, ref } = setup({ selectedIds: ["A"] });
    expect(el(svg, "A").classList.contains("selected")).toBe(true);
    rerender(<Viewer2D ref={ref} drawingId="D1" entities={entities} coordinateSystem={cs} selectedIds={["B"]} />);
    expect(el(svg, "A").classList.contains("selected")).toBe(false);
    expect(el(svg, "B").classList.contains("selected")).toBe(true);
  });

  it("panTo centres the viewBox on the entity bbox and zoom scales it; fitToView restores", () => {
    const { ref } = setup();
    const initial = ref.current!.getViewport().viewBox;
    act(() => ref.current!.panTo("C", { zoom: 2 }));
    const vb = ref.current!.getViewport().viewBox;
    expect(vb.width).toBeCloseTo(initial.width / 2);
    expect(vb.x + vb.width / 2).toBeCloseTo(70);
    expect(vb.y + vb.height / 2).toBeCloseTo(-70); // SVG y-down
    const dv = ref.current!.getViewport().drawingBBox;
    expect((dv.min[1] + dv.max[1]) / 2).toBeCloseTo(70); // 도면 y-up
    act(() => ref.current!.panTo("UNKNOWN"));
    expect(ref.current!.getViewport().viewBox).toEqual(vb);
    act(() => ref.current!.fitToView());
    expect(ref.current!.getViewport().viewBox).toEqual(initial);
    expect(ref.current!.getViewport().drawingExtent).toEqual({ min: [0, 0], max: [75, 75] });
  });

  it("setOverlay projects the section through the transform; setOverlayOpacity updates; null removes", () => {
    const { svg, ref } = setup();
    const section: PlanSection = {
      level: "1F", elevation: 1.2,
      coordinateSystem: { source: "ifc_local", origin: [0, 0, 0], rotation_deg: 0, scale: 1, unit: "m" },
      polylines: [{ globalId: "G1", points: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] }],
    };
    // 모델(m) → 도면(mm): 1000배 + 이동 (5, 5)
    const t = [[1000, 0, 0, 5], [0, 1000, 0, 5], [0, 0, 1000, 0], [0, 0, 0, 1]];
    act(() => ref.current!.setOverlay(section, { opacity: 0.3, transform: t }));
    const g = svg.querySelector("g.overlay")!;
    expect(g).not.toBeNull();
    expect(g.getAttribute("opacity")).toBe("0.3");
    expect(g.getAttribute("data-level")).toBe("1F");
    const poly = g.querySelector("[data-global-id='G1']")!;
    expect(poly.tagName).toBe("polygon");
    expect(poly.getAttribute("points")).toBe("5,5 1005,5 1005,1005 5,1005");
    // 오버레이는 루트 flip 아래에 있어 엔티티와 같은 좌표계
    expect(g.parentElement!.getAttribute("transform")).toBe("scale(1,-1)");
    act(() => ref.current!.setOverlayOpacity(0.9));
    expect(svg.querySelector("g.overlay")!.getAttribute("opacity")).toBe("0.9");
    act(() => ref.current!.setOverlay(null));
    expect(svg.querySelector("g.overlay")).toBeNull();
  });
});

describe("Viewer2D area selection", () => {
  it("shift+drag calls onAreaSelect with intersecting handles and the drawing bbox", () => {
    const { svg, ref, onAreaSelect, onSelect } = setup();
    const vb = ref.current!.getViewport().viewBox;
    const p0 = drawingToClient(vb, RECT, [-1, -1]);
    const p1 = drawingToClient(vb, RECT, [12, 12]);
    pointer(svg, "pointerdown", { clientX: p0[0], clientY: p0[1], shiftKey: true });
    pointer(svg, "pointermove", { clientX: p1[0], clientY: p1[1], shiftKey: true });
    expect(svg.querySelector("rect.rubber-band")).not.toBeNull();
    pointer(svg, "pointerup", { clientX: p1[0], clientY: p1[1], shiftKey: true });
    expect(svg.querySelector("rect.rubber-band")).toBeNull();
    expect(onAreaSelect).toHaveBeenCalledTimes(1);
    const [handles, bbox] = onAreaSelect.mock.calls[0]!;
    expect(handles).toEqual(["A"]);
    expect(bbox.min[0]).toBeCloseTo(-1);
    expect(bbox.min[1]).toBeCloseTo(-1);
    expect(bbox.max[0]).toBeCloseTo(12);
    expect(bbox.max[1]).toBeCloseTo(12);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("area covering B and C (bottom-right drag, reversed corners) returns both", () => {
    const { svg, ref, onAreaSelect } = setup();
    const vb = ref.current!.getViewport().viewBox;
    const p0 = drawingToClient(vb, RECT, [80, 80]);
    const p1 = drawingToClient(vb, RECT, [48, 48]);
    pointer(svg, "pointerdown", { clientX: p0[0], clientY: p0[1], shiftKey: true });
    pointer(svg, "pointerup", { clientX: p1[0], clientY: p1[1], shiftKey: true });
    expect(onAreaSelect.mock.calls[0]![0]).toEqual(["B", "C"]);
  });
});
