import { applyMatrix, invert4, matrixFromSystem, modelToDrawingMatrix, multiply4, IDENTITY4 } from "./coordinate";

describe("coordinate", () => {
  it("matrixFromSystem 은 Python CoordinateTransform.from_system 과 같은 행렬을 만든다", () => {
    const m = matrixFromSystem({ source: "dxf_local", origin: [100, 200, 0], rotation_deg: 90, scale: 0.001 });
    const p = applyMatrix(m, [1000, 0]); // 도면 (1000,0) mm → 회전 90° → (0, 1) m + origin
    expect(p[0]).toBeCloseTo(100);
    expect(p[1]).toBeCloseTo(201);
  });
  it("modelToDrawingMatrix 는 역변환이다", () => {
    const cs = { source: "dxf_local" as const, origin: [5, -3, 0] as [number, number, number], rotation_deg: 30, scale: 0.01 };
    const fwd = matrixFromSystem(cs);
    const inv = modelToDrawingMatrix(cs);
    const id = multiply4(inv, fwd);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(id[i][j]).toBeCloseTo(IDENTITY4[i][j]);
  });
  it("특이행렬은 null", () => {
    expect(invert4([[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])).toBeNull();
  });
});
