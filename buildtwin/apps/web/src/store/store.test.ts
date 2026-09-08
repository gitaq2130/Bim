import { useStore } from "./index";

describe("store", () => {
  beforeEach(() => {
    useStore.getState().auth.logout();
    localStorage.clear();
  });

  it("auth 는 localStorage 에 저장/삭제된다", () => {
    useStore.getState().auth.login({ token: "t", role: "cm", userId: "u1" });
    expect(JSON.parse(localStorage.getItem("buildtwin.auth")!)).toEqual({ token: "t", role: "cm", userId: "u1" });
    useStore.getState().auth.logout();
    expect(localStorage.getItem("buildtwin.auth")).toBeNull();
  });

  it("ui 슬라이스 값은 범위로 클램프된다", () => {
    useStore.getState().ui.setOverlayOpacity(2);
    expect(useStore.getState().ui.overlayOpacity).toBe(1);
    useStore.getState().ui.setSplitRatio(0.01);
    expect(useStore.getState().ui.splitRatio).toBe(0.15);
  });

  it("selection 슬라이스는 source/globalIds/entityHandles 를 함께 갱신한다", () => {
    useStore.getState().selection.set("2d", ["G1"], ["H1"]);
    expect(useStore.getState().selection).toMatchObject({ source: "2d", globalIds: ["G1"], entityHandles: ["H1"] });
    useStore.getState().selection.clear();
    expect(useStore.getState().selection.source).toBeNull();
  });
});
