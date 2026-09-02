/**
 * jsdom 스모크 테스트. WebGL 은 없으므로 disableRenderer 로 헤드리스 마운트하고
 * 핸들 API(getPlanSection 등)가 동작하는지 본다. 렌더 결과는 검증하지 않는다(Playwright 담당).
 */
import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Viewer3D } from "./Viewer3D";
import type { MeshBundle, Viewer3DHandle } from "./types";

function boxEntry(min: [number, number, number], max: [number, number, number]) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    vertices: [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
    faces: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
  };
}

const bundle: MeshBundle = {
  COL_1: boxEntry([0, 0, 0], [0.5, 0.5, 3.5]),
  COL_2: boxEntry([6, 0, 0], [6.5, 0.5, 3.5]),
  COL_3: boxEntry([0, 6, 0], [0.5, 6.5, 3.5]),
  SLAB_2F: boxEntry([-1, -1, 3.5], [8, 8, 3.7]),
  COL_2F: boxEntry([0, 0, 3.7], [0.5, 0.5, 7]),
};

describe("Viewer3D (headless)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (url.includes("model") ? bundle : {}),
        text: async () => "0 0 0\n1 1 1\n",
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts without WebGL, loads the bundle and reports objectCount", async () => {
    const ref = createRef<Viewer3DHandle>();
    const onLoad = vi.fn();
    const { getByTestId, unmount } = render(
      <Viewer3D ref={ref} modelUrl="/model.json" onLoad={onLoad} disableRenderer />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0][0].objectCount).toBe(5);
    expect(getByTestId("viewer3d").getAttribute("data-object-count")).toBe("5");
    expect(ref.current!.getObjectIds().sort()).toEqual(["COL_1", "COL_2", "COL_2F", "COL_3", "SLAB_2F"]);
    unmount();
  });

  it("getPlanSection('1F') returns one polyline per column on that floor, using props.sectionOffset", async () => {
    const ref = createRef<Viewer3DHandle>();
    const onLoad = vi.fn();
    render(
      <Viewer3D
        ref={ref}
        modelUrl="/model.json"
        onLoad={onLoad}
        disableRenderer
        levels={[
          { name: "1F", elevation: 0 },
          { name: "2F", elevation: 3.7 },
        ]}
        sectionOffset={1.0}
        coordinateSystem={{ source: "ifc_local", origin: [100, 200, 0], rotation_deg: 15, scale: 1, unit: "m" }}
      />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalled());

    const s1 = await ref.current!.getPlanSection("1F");
    expect(s1.level).toBe("1F");
    expect(s1.elevation).toBe(1.0);
    expect(s1.polylines.map((p) => p.globalId).sort()).toEqual(["COL_1", "COL_2", "COL_3"]);
    expect(s1.polylines.every((p) => p.closed && p.points.length === 4)).toBe(true);
    expect(s1.coordinateSystem.origin).toEqual([100, 200, 0]);
    expect(s1.svg).toContain('data-global-id="COL_1"');

    const s2 = await ref.current!.getPlanSection("2F");
    expect(s2.elevation).toBe(4.7);
    expect(s2.polylines.map((p) => p.globalId)).toEqual(["COL_2F"]);

    // explicit offset overrides prop
    const slab = await ref.current!.getPlanSection("1F", 3.6);
    expect(slab.polylines.map((p) => p.globalId)).toEqual(["SLAB_2F"]);

    await expect(ref.current!.getPlanSection("B1")).rejects.toThrow(/unknown level/);
  });

  it("handle methods are safe before and after load", async () => {
    const ref = createRef<Viewer3DHandle>();
    const onLoad = vi.fn();
    render(<Viewer3D ref={ref} modelUrl="/model.json" onLoad={onLoad} disableRenderer />);
    // before load
    expect(ref.current!.getObjectIds()).toEqual([]);
    act(() => {
      ref.current!.setState("COL_1", "CONFIRMED");
      ref.current!.highlight(["COL_1"], { exclusive: true });
      ref.current!.isolate(["COL_1", "COL_2"]);
    });
    await expect(ref.current!.flyTo("COL_1")).resolves.toBeUndefined();
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    // after load
    act(() => {
      ref.current!.setStates({ COL_2: "MISMATCH", COL_3: "ESTIMATED_DONE" });
      ref.current!.clearHighlight();
      ref.current!.isolate(null);
      ref.current!.togglePointCloud(false);
    });
    await expect(ref.current!.flyTo("COL_2")).resolves.toBeUndefined();
    await expect(ref.current!.flyTo("NOPE")).resolves.toBeUndefined();
    await expect(
      ref.current!.loadPointCloud("/scan.xyz", {
        from_source: "scan_local",
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      }),
    ).resolves.toBeUndefined();
  });
});
