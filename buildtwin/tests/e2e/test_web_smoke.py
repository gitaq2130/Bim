"""Playwright 스모크 — 담당: qa. 실제 uvicorn API + `vite preview`(빌드된 apps/web/dist, /api 프록시) 로 브라우저에서 확인한다.

- cm 로그인 → /projects (역할 표시) → /projects/:id/viewer
- 2D 도면 pane(svg.viewer2d, 엔티티 data-handle) 과 3D pane(data-testid=viewer3d, WebGL canvas) 이 모두 그려진다
- 2D 에서 매핑된 기둥 엔티티를 선택하면 객체 상세 패널이 4개 탭(기본정보·상태·이력·다음행동)으로 렌더된다
Chromium: 로컬은 /opt/pw-browsers(conftest 가 PLAYWRIGHT_BROWSERS_PATH 설정), CI 는 `playwright install chromium`.
"""
from __future__ import annotations

import httpx
from playwright.sync_api import Page, expect

from .conftest import DEV_PASSWORD, Api, user

TAB_LABELS = ["기본정보", "상태", "이력", "다음행동"]


def _mapped_column_handle(api_server: dict, seeded_project: dict) -> tuple[str, str]:
    """(entity_handle, global_id): A-COL 레이어이면서 매핑된 엔티티 하나."""
    with httpx.Client(timeout=60.0) as c:
        a = Api(c, prefix=api_server["base"])
        did = seeded_project["dxf_job"]["result"]["drawing_id"]
        entities = a.get(f"/drawings/{did}/entities", "cm").json()["entities"]
        mappings = {m["entity_handle"]: m["global_id"] for m in a.get(f"/drawings/{did}/mappings", "cm").json()}
        for e in entities:
            if e["layer"] == "A-COL" and e["handle"] in mappings:
                return e["handle"], mappings[e["handle"]]
    raise AssertionError("no mapped A-COL entity in seeded drawing")


def _login(page: Page, web_server: str, role: str) -> None:
    page.goto(f"{web_server}/login")
    page.get_by_label("아이디").fill(user(role))
    page.get_by_label("비밀번호").fill(DEV_PASSWORD)
    page.get_by_role("button", name="로그인").click()
    page.wait_for_url("**/projects", timeout=20_000)


def test_cm_login_shows_projects_and_role(page: Page, web_server: str, seeded_project: dict):
    _login(page, web_server, "cm")
    expect(page.get_by_test_id("current-role")).to_contain_text("CM")
    expect(page.get_by_text("E2E 스모크 현장")).to_be_visible()
    expect(page.get_by_role("link", name="뷰어").first).to_be_visible()
    # cm 은 프로젝트 생성 폼이 없다(admin 전용 — api 역할 행렬과 일치)
    expect(page.get_by_placeholder("새 프로젝트 이름")).to_have_count(0)


def test_viewer_renders_2d_3d_panes_and_object_detail_tabs(page: Page, web_server: str, api_server: dict, seeded_project: dict):
    _login(page, web_server, "cm")
    pid = seeded_project["project_id"]
    page.goto(f"{web_server}/projects/{pid}/viewer")
    expect(page.locator(".split-pane")).to_have_count(2)
    # 2D pane: 엔티티가 그려진 svg
    svg = page.locator("svg.viewer2d")
    expect(svg).to_be_visible(timeout=30_000)
    expect(svg.locator("[data-handle]").first).to_be_attached(timeout=30_000)
    # 3D pane: 뷰어 컨테이너 + WebGL 캔버스
    expect(page.get_by_test_id("viewer3d")).to_be_visible(timeout=30_000)
    expect(page.locator("[data-testid=viewer3d] canvas")).to_have_count(1, timeout=30_000)
    expect(page.locator(".viewer-empty")).to_have_count(0)
    expect(page.locator(".detail-panel")).to_contain_text("객체를 선택하세요")

    # 2D 엔티티 선택(pointerdown → pointerup, 이동 없음 = 클릭) → 매핑된 객체 상세 패널
    handle, gid = _mapped_column_handle(api_server, seeded_project)
    el = svg.locator(f'[data-handle="{handle}"]')
    expect(el).to_be_attached()
    box = el.bounding_box()
    assert box is not None and box["width"] > 0 and box["height"] > 0, box
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    init = {"pointerId": 1, "isPrimary": True, "button": 0, "buttons": 1, "clientX": x, "clientY": y, "bubbles": True, "cancelable": True}
    el.dispatch_event("pointerdown", init)
    el.dispatch_event("pointerup", {**init, "buttons": 0})

    panel = page.get_by_test_id("object-detail-panel")
    expect(panel).to_be_visible(timeout=20_000)
    tabs = panel.get_by_role("tab")
    expect(tabs).to_have_count(4)
    expect(tabs).to_have_text(TAB_LABELS)
    expect(panel).to_contain_text(gid)
    for label in TAB_LABELS:
        tabs.filter(has_text=label).click()
        expect(panel).to_be_visible()
    # 선택은 2D 엔티티에도 반영된다(선택 클래스/속성은 뷰어 구현이 정하므로 svg 안에 여전히 존재하는지만 본다)
    expect(el).to_be_attached()
