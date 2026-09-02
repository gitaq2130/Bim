import { describe, expect, it } from "vitest";
import { chainSegments, polylinesToSvg, slicePlan, sliceMeshSegments, type SliceableMesh } from "./section";

/** 축 정렬 박스 메시 (12 삼각형, 8 정점) */
function box(min: [number, number, number], max: [number, number, number]): SliceableMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, // 0..3 bottom
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, // 4..7 top
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6, 4, 6, 7, // top
    0, 1, 5, 0, 5, 4, // front (y0)
    1, 2, 6, 1, 6, 5, // right (x1)
    2, 3, 7, 2, 7, 6, // back (y1)
    3, 0, 4, 3, 4, 7, // left (x0)
  ]);
  return { positions, indices };
}

const sortPts = (pts: [number, number][]) =>
  [...pts].map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe("sliceMeshSegments", () => {
  it("unit cube at z=0.5 yields one segment per side triangle (8)", () => {
    const segs = sliceMeshSegments(box([0, 0, 0], [1, 1, 1]), 0.5);
    expect(segs).toHaveLength(8);
  });

  it("plane outside the mesh yields nothing", () => {
    expect(sliceMeshSegments(box([0, 0, 0], [1, 1, 1]), 2)).toHaveLength(0);
    expect(sliceMeshSegments(box([0, 0, 0], [1, 1, 1]), -1)).toHaveLength(0);
  });

  it("plane exactly through the bottom face does not double count (on-plane vertices are 'above')", () => {
    // z=0: bottom face vertices are on the plane → treated as >=0 side, same as top → no crossing
    expect(sliceMeshSegments(box([0, 0, 0], [1, 1, 1]), 0)).toHaveLength(0);
    // z=1: top vertices on plane (>=0), bottom below → sides differ → segments exist
    expect(sliceMeshSegments(box([0, 0, 0], [1, 1, 1]), 1).length).toBeGreaterThan(0);
  });

  it("works with non-indexed triangle soup", () => {
    const b = box([0, 0, 0], [1, 1, 1]);
    const idx = Array.from(b.indices as Uint32Array);
    const soup = new Float32Array(idx.length * 3);
    idx.forEach((vi, i) => {
      soup[i * 3] = b.positions[vi * 3];
      soup[i * 3 + 1] = b.positions[vi * 3 + 1];
      soup[i * 3 + 2] = b.positions[vi * 3 + 2];
    });
    expect(sliceMeshSegments({ positions: soup }, 0.5)).toHaveLength(8);
  });
});

describe("slicePlan", () => {
  it("unit cube sliced at z=0.5 → one closed polyline with 4 corners", () => {
    const meshes = new Map<string, SliceableMesh>([["CUBE", box([0, 0, 0], [1, 1, 1])]]);
    const result = slicePlan(meshes, 0.5);
    expect(result).toHaveLength(1);
    const pl = result[0];
    expect(pl.globalId).toBe("CUBE");
    expect(pl.closed).toBe(true);
    expect(pl.points).toHaveLength(4);
    expect(sortPts(pl.points)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it("two boxes → two polylines, one per globalId", () => {
    const meshes = new Map<string, SliceableMesh>([
      ["COL_A", box([0, 0, 0], [0.5, 0.5, 3])],
      ["COL_B", box([5, 5, 0], [5.6, 5.6, 3])],
    ]);
    const result = slicePlan(meshes, 1.2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.globalId).sort()).toEqual(["COL_A", "COL_B"]);
    for (const pl of result) {
      expect(pl.closed).toBe(true);
      expect(pl.points).toHaveLength(4);
    }
    const b = result.find((r) => r.globalId === "COL_B")!;
    expect(sortPts(b.points)).toEqual([
      [5, 5],
      [5, 5.6],
      [5.6, 5],
      [5.6, 5.6],
    ]);
  });

  it("only meshes intersecting the plane are returned", () => {
    const meshes = new Map<string, SliceableMesh>([
      ["LOW", box([0, 0, 0], [1, 1, 1])],
      ["HIGH", box([0, 0, 4], [1, 1, 5])],
    ]);
    const result = slicePlan(meshes, 4.5);
    expect(result.map((r) => r.globalId)).toEqual(["HIGH"]);
  });

  it("a box straddling floors is sliced in both floors at different elevations", () => {
    const meshes = new Map<string, SliceableMesh>([["WALL", box([0, 0, 0], [10, 0.2, 7])]]);
    expect(slicePlan(meshes, 1.2)).toHaveLength(1);
    expect(slicePlan(meshes, 4.7)).toHaveLength(1);
    expect(slicePlan(meshes, 8.2)).toHaveLength(0);
  });
});

describe("chainSegments", () => {
  it("chains an open L-shape into one open polyline", () => {
    const pls = chainSegments([
      [[0, 0], [1, 0]],
      [[1, 1], [1, 0]], // reversed direction on purpose
    ]);
    expect(pls).toHaveLength(1);
    expect(pls[0].closed).toBe(false);
    expect(pls[0].points).toHaveLength(3);
  });

  it("keeps disjoint chains separate", () => {
    const pls = chainSegments([
      [[0, 0], [1, 0]],
      [[5, 5], [6, 5]],
    ]);
    expect(pls).toHaveLength(2);
  });

  it("removes collinear midpoints on a closed square made of 8 segments", () => {
    const pts: [number, number][] = [
      [0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5],
    ];
    const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [[number, number], [number, number]]);
    const pls = chainSegments(segs);
    expect(pls).toHaveLength(1);
    expect(pls[0].closed).toBe(true);
    expect(pls[0].points).toHaveLength(4);
  });
});

describe("polylinesToSvg", () => {
  it("emits one path per polyline with data-global-id and flipped y", () => {
    const meshes = new Map<string, SliceableMesh>([["CUBE", box([0, 0, 0], [1, 1, 1])]]);
    const svg = polylinesToSvg(slicePlan(meshes, 0.5));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('data-global-id="CUBE"');
    expect(svg).toContain(" Z");
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  it("handles empty input", () => {
    expect(polylinesToSvg([])).toContain("<svg");
  });
});
