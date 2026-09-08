import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { matrix4FromTransform, parseXyz } from "./pointcloud";
import type { CoordinateTransform } from "./types";

describe("parseXyz", () => {
  it("parses whitespace/comma separated xyz and skips comments/headers", () => {
    const text = ["# comment", "x y z", "0 0 0", "1,2,3", "", "4 5 6 extra"].join("\n");
    const { positions, colors } = parseXyz(text);
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6]);
    expect(colors).toBeNull();
  });

  it("reads rgb 0-255 when every row has 6 values", () => {
    const { positions, colors } = parseXyz("0 0 0 255 0 0\n1 1 1 0 255 0");
    expect(positions).toHaveLength(6);
    expect(colors).not.toBeNull();
    expect(Array.from(colors!).map((v) => Number(v.toFixed(3)))).toEqual([1, 0, 0, 0, 1, 0]);
  });
});

describe("matrix4FromTransform", () => {
  it("interprets the row-major matrix like packages/core CoordinateTransform.apply", () => {
    // translate (10, 20, 30) + scale 2
    const transform: CoordinateTransform = {
      from_source: "scan_local",
      to_source: "ifc_local",
      matrix: [
        [2, 0, 0, 10],
        [0, 2, 0, 20],
        [0, 0, 2, 30],
        [0, 0, 0, 1],
      ],
    };
    const m = matrix4FromTransform(transform);
    const p = new THREE.Vector3(1, 1, 1).applyMatrix4(m);
    expect([p.x, p.y, p.z]).toEqual([12, 22, 32]);
  });

  it("rejects non-4x4", () => {
    expect(() => matrix4FromTransform({ from_source: "scan_local", matrix: [[1]] })).toThrow();
  });
});
