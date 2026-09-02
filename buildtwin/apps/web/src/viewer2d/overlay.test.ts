import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTransform2D, isIdentityTransform, overlayToSvg, projectSection } from "./overlay";
import type { CoordinateTransform, PlanSection } from "./types";

// 90° 회전 + (100, 50) 이동: (x, y) → (-y + 100, x + 50)
const rot90: CoordinateTransform = [
  [0, -1, 0, 100],
  [1, 0, 0, 50],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

const section: PlanSection = {
  level: "1F",
  elevation: 1.2,
  coordinateSystem: { source: "ifc_local", origin: [0, 0, 0], rotation_deg: 0, scale: 1, unit: "m" },
  polylines: [
    { globalId: "G1", points: [[10, 0], [0, 10], [0, 0], [10, 0]] },
    { globalId: "G2", points: [[1, 1], [2, 2]] },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("applyTransform2D", () => {
  it("applies a row-major 4x4 to [x, y, 0, 1]", () => {
    expect(applyTransform2D(rot90, [10, 0])).toEqual([100, 60]);
    expect(applyTransform2D(rot90, [0, 10])).toEqual([90, 50]);
    const scaled: CoordinateTransform = [[1000, 0, 0, 0], [0, 1000, 0, 0], [0, 0, 1000, 0], [0, 0, 0, 1]];
    expect(applyTransform2D(scaled, [1.5, -2])).toEqual([1500, -2000]);
  });
  it("detects identity", () => {
    expect(isIdentityTransform([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])).toBe(true);
    expect(isIdentityTransform(rot90)).toBe(false);
  });
});

describe("projectSection", () => {
  it("projects polylines through the transform", () => {
    const out = projectSection(section, { transform: rot90 });
    expect(out[0]!.globalId).toBe("G1");
    expect(out[0]!.points).toEqual([[100, 60], [90, 50], [100, 50], [100, 60]]);
  });

  it("accepts {matrix} shaped transforms (packages/core serialisation)", () => {
    const out = projectSection(section, { transform: { matrix: rot90 } });
    expect(out[1]!.points).toEqual([[99, 51], [98, 52]]);
  });

  it("falls back to identity with a console warning when no transform is given", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = projectSection(section);
    expect(out[1]!.points).toEqual([[1, 1], [2, 2]]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("identity");
  });
});

describe("overlayToSvg", () => {
  it("builds <g class=overlay> with polygon for closed loops and polyline otherwise", () => {
    const g = overlayToSvg(section, { transform: rot90, opacity: 0.4, color: "#123456" });
    expect(g.tag).toBe("g");
    expect(g.attrs.class).toBe("overlay");
    expect(g.attrs.opacity).toBe(0.4);
    expect(g.attrs.stroke).toBe("#123456");
    expect(g.attrs["data-level"]).toBe("1F");
    expect(g.children!.map((c) => c.tag)).toEqual(["polygon", "polyline"]);
    expect(g.children![0]!.attrs.points).toBe("100,60 90,50 100,50");
    expect(g.children![0]!.attrs["data-global-id"]).toBe("G1");
  });

  it("clamps opacity", () => {
    expect(overlayToSvg(section, { transform: rot90, opacity: 7 }).attrs.opacity).toBe(1);
    expect(overlayToSvg(section, { transform: rot90, opacity: -1 }).attrs.opacity).toBe(0);
  });
});
