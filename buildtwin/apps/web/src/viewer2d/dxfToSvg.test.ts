import { describe, expect, it } from "vitest";
import {
  arcPath,
  buildSvgModel,
  computeDrawingBBox,
  entityBBox,
  entityToSvg,
  svgModelToString,
  viewBoxFromBBox,
  viewBoxToDrawingBBox,
} from "./dxfToSvg";
import type { DrawingEntityView } from "./types";

const line: DrawingEntityView = { handle: "L1", layer: "WALL", dxftype: "LINE", points: [[0, 0], [100, 50]] };
const poly: DrawingEntityView = {
  handle: "P1", layer: "COL", dxftype: "LWPOLYLINE",
  points: [[10, 10], [20, 10], [20, 20], [10, 20]], attrs: { closed: true },
};
const circle: DrawingEntityView = { handle: "C1", layer: "COL", dxftype: "CIRCLE", points: [[50, 50]], radius: 5 };
const insert: DrawingEntityView = {
  handle: "I1", layer: "SYM", dxftype: "INSERT", block_name: "COL_600",
  insert_point: [30, 40], rotation_deg: 90, scale: [2, 2],
};
const text: DrawingEntityView = {
  handle: "T1", layer: "TXT", dxftype: "TEXT", insert_point: [5, 5], text: "C1", attrs: { height: 2.5 },
};

describe("entityToSvg", () => {
  it("LINE → line", () => {
    const d = entityToSvg(line)!;
    expect(d.tag).toBe("line");
    expect(d.attrs).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 50 });
    expect(d.handle).toBe("L1");
    expect(d.layer).toBe("WALL");
  });

  it("closed LWPOLYLINE → polygon, open → polyline", () => {
    const closed = entityToSvg(poly)!;
    expect(closed.tag).toBe("polygon");
    expect(closed.attrs.points).toBe("10,10 20,10 20,20 10,20");
    expect(closed.attrs["data-closed"]).toBe("true");
    const open = entityToSvg({ ...poly, attrs: {} })!;
    expect(open.tag).toBe("polyline");
    // flags 비트 1 도 닫힘으로 본다
    expect(entityToSvg({ ...poly, attrs: { flags: 1 } })!.tag).toBe("polygon");
  });

  it("CIRCLE → circle", () => {
    const d = entityToSvg(circle)!;
    expect(d.tag).toBe("circle");
    expect(d.attrs).toMatchObject({ cx: 50, cy: 50, r: 5, fill: "none" });
  });

  it("ARC → path with CCW sweep", () => {
    const d = entityToSvg({
      handle: "A1", layer: "X", dxftype: "ARC", points: [[0, 0]], radius: 10, attrs: { start_angle: 0, end_angle: 90 },
    })!;
    expect(d.tag).toBe("path");
    expect(d.attrs.d).toBe("M 10 0 A 10 10 0 0 1 0 10");
    expect(arcPath([0, 0], 10, 0, 270)).toBe("M 10 0 A 10 10 0 1 1 0 -10");
  });

  it("INSERT → g marker with transform and data-block", () => {
    const d = entityToSvg(insert, { markerSize: 4 })!;
    expect(d.tag).toBe("g");
    expect(d.attrs["data-block"]).toBe("COL_600");
    expect(d.attrs.transform).toBe("translate(30,40) rotate(90) scale(2,2)");
    expect(d.children!.map((c) => c.tag)).toEqual(["line", "line", "circle"]);
    expect(d.children![0]!.attrs).toMatchObject({ x1: -2, x2: 2 });
  });

  it("TEXT → text with height and local un-flip", () => {
    const d = entityToSvg(text)!;
    expect(d.tag).toBe("text");
    expect(d.text).toBe("C1");
    expect(d.attrs["font-size"]).toBe(2.5);
    expect(d.attrs.transform).toBe("translate(5,5) scale(1,-1) rotate(0)");
  });

  it("HATCH → filled polygon", () => {
    const d = entityToSvg({ handle: "H1", layer: "H", dxftype: "HATCH", points: [[0, 0], [1, 0], [1, 1]] })!;
    expect(d.tag).toBe("polygon");
    expect(d.attrs["fill-opacity"]).toBe(0.25);
  });

  it("returns null for entities without geometry", () => {
    expect(entityToSvg({ handle: "E", layer: "X", dxftype: "LINE", points: [[0, 0]] })).toBeNull();
    expect(entityToSvg({ handle: "E", layer: "X", dxftype: "UNKNOWN" })).toBeNull();
  });
});

describe("bbox / viewBox", () => {
  it("entityBBox prefers server bbox, else derives from geometry", () => {
    expect(entityBBox(line)).toEqual({ min: [0, 0], max: [100, 50] });
    expect(entityBBox(circle)).toEqual({ min: [45, 45], max: [55, 55] });
    expect(entityBBox(insert)).toEqual({ min: [30, 40], max: [30, 40] });
    expect(entityBBox({ ...line, bbox: { min: [-1, -1], max: [1, 1] } })).toEqual({ min: [-1, -1], max: [1, 1] });
  });

  it("computeDrawingBBox unions all entities", () => {
    expect(computeDrawingBBox([line, poly, circle, insert, text])).toEqual({ min: [0, 0], max: [100, 55] });
  });

  it("viewBox is derived from bbox with the y axis flipped and padding relative to the extent", () => {
    const vb = viewBoxFromBBox({ min: [0, 0], max: [100, 50] }, 0);
    expect(vb).toEqual({ x: 0, y: -50, width: 100, height: 50 });
    const padded = viewBoxFromBBox({ min: [0, 0], max: [100, 50] }, 0.1);
    expect(padded).toEqual({ x: -10, y: -60, width: 120, height: 70 });
    expect(viewBoxToDrawingBBox(padded)).toEqual({ min: [-10, -10], max: [110, 60] });
  });

  it("buildSvgModel groups by layer, assigns palette colours and a single root flip", () => {
    const model = buildSvgModel([line, poly, circle, insert, text], { paddingRatio: 0 });
    expect(model.rootTransform).toBe("scale(1,-1)");
    expect(model.viewBox).toEqual({ x: 0, y: -55, width: 100, height: 55 });
    expect(model.layers.map((l) => l.layer)).toEqual(["WALL", "COL", "SYM", "TXT"]);
    expect(model.layers[1]!.elements.map((e) => e.handle)).toEqual(["P1", "C1"]);
    expect(new Set(model.layers.map((l) => l.color)).size).toBe(4);
    expect(model.bboxByHandle.get("C1")).toEqual({ min: [45, 45], max: [55, 55] });
    // INSERT 마커 크기는 도면 extent 에서 유도(상수 아님)
    const marker = model.layers[2]!.elements[0]!;
    expect(marker.children![0]!.attrs.x2).toBeCloseTo(0.5);
    const s = svgModelToString(model);
    expect(s).toContain('viewBox="0 -55 100 55"');
    expect(s).toContain('<g transform="scale(1,-1)">');
    expect(s).toContain('data-handle="L1"');
  });
});
