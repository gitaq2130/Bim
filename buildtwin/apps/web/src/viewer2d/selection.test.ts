import { describe, expect, it } from "vitest";
import { clientToDrawing, clientToSvg, drawingToClient, entitiesInBBox, hitTestHandle, normalizeBBox } from "./selection";
import type { DrawingEntityView, ViewBox } from "./types";

const entities: DrawingEntityView[] = [
  { handle: "A", layer: "L", dxftype: "LINE", points: [[0, 0], [10, 10]] },
  { handle: "B", layer: "L", dxftype: "LINE", points: [[50, 50], [60, 60]] },
  { handle: "C", layer: "L", dxftype: "CIRCLE", points: [[30, 30]], radius: 2 },
  { handle: "N", layer: "L", dxftype: "TEXT" }, // 기하 없음 → 제외
];

describe("entitiesInBBox", () => {
  it("returns handles whose bbox intersects", () => {
    expect(entitiesInBBox(entities, { min: [-5, -5], max: [5, 5] })).toEqual(["A"]);
    expect(entitiesInBBox(entities, { min: [9, 9], max: [31, 31] })).toEqual(["A", "C"]);
    expect(entitiesInBBox(entities, { min: [-100, -100], max: [100, 100] })).toEqual(["A", "B", "C"]);
    expect(entitiesInBBox(entities, { min: [70, 70], max: [80, 80] })).toEqual([]);
  });

  it("contain mode requires full containment", () => {
    expect(entitiesInBBox(entities, { min: [5, 5], max: [40, 40] }, { mode: "contain" })).toEqual(["C"]);
  });

  it("uses a precomputed bbox map when given", () => {
    const map = new Map([["A", { min: [500, 500] as [number, number], max: [501, 501] as [number, number] }]]);
    expect(entitiesInBBox(entities, { min: [499, 499], max: [502, 502] }, { bboxByHandle: map })).toEqual(["A"]);
  });
});

describe("hitTestHandle", () => {
  it("reads data-handle from the closest ancestor", () => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-handle", "H1");
    const child = document.createElementNS("http://www.w3.org/2000/svg", "line");
    g.appendChild(child);
    expect(hitTestHandle(child)).toBe("H1");
    expect(hitTestHandle(document.createElementNS("http://www.w3.org/2000/svg", "svg"))).toBeNull();
    expect(hitTestHandle(null)).toBeNull();
  });
});

describe("clientToDrawing", () => {
  const vb: ViewBox = { x: 0, y: -100, width: 200, height: 100 }; // 도면 bbox (0,0)-(200,100)
  const rect = { left: 10, top: 20, width: 400, height: 200 }; // 같은 종횡비

  it("maps client px through viewBox and flips y", () => {
    expect(clientToSvg(vb, rect, 10, 20)).toEqual([0, -100]);
    expect(clientToDrawing(vb, rect, 10, 20)).toEqual([0, 100]); // 좌상단 = 도면 (0, maxY)
    expect(clientToDrawing(vb, rect, 410, 220)).toEqual([200, 0]); // 우하단 = 도면 (maxX, 0)
    expect(clientToDrawing(vb, rect, 210, 120)).toEqual([100, 50]);
  });

  it("honours xMidYMid meet letterboxing when aspect ratios differ", () => {
    const tall = { left: 0, top: 0, width: 200, height: 200 }; // 세로가 남는다 → 위아래 50px 여백
    expect(clientToDrawing(vb, tall, 0, 50)).toEqual([0, 100]);
    expect(clientToDrawing(vb, tall, 200, 150)).toEqual([200, 0]);
  });

  it("drawingToClient is the inverse", () => {
    const [cx, cy] = drawingToClient(vb, rect, [123, 45]);
    const back = clientToDrawing(vb, rect, cx, cy);
    expect(back[0]).toBeCloseTo(123);
    expect(back[1]).toBeCloseTo(45);
  });

  it("normalizeBBox orders corners", () => {
    expect(normalizeBBox([5, 1], [-2, 9])).toEqual({ min: [-2, 1], max: [5, 9] });
  });
});
