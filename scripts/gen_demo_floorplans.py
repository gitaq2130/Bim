#!/usr/bin/env python3
"""
데모용 가상 평면도 생성기.

실제 프로젝트 도면을 저장소에 두지 않기 위해, 같은 픽셀 크기와 같은 그리드
좌표(floorN-calib.json)를 갖는 가상 도면을 그린다. 좌표계가 동일하므로
존 지정·작업 위치 렌더링 로직은 그대로 동작한다.

    python3 scripts/gen_demo_floorplans.py

산출물: components/site-detail/daily/assets/floorN.jpeg
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join("components", "site-detail", "daily", "assets")
SIZE = (1400, 1126)
FONT_DIR = os.path.join("node_modules", "pretendard", "dist", "public", "static")

INK = (38, 42, 50)
GRID = (198, 204, 214)
GRID_MINOR = (226, 230, 238)
SLAB = (243, 240, 232)
ROOM = (233, 237, 244)
CORE = (214, 221, 232)
RACK = (223, 228, 236)
PAPER = (252, 251, 248)


def font(weight: str, size: int):
    path = os.path.join(FONT_DIR, f"Pretendard-{weight}.otf")
    return ImageFont.truetype(path, size)


def load_axis(n: int):
    with open(os.path.join(ASSETS, f"floor{n}-calib.json"), encoding="utf-8") as fh:
        cal = json.load(fh)
    xs = sorted(((lbl, p["px"]) for lbl, p in cal["X"].items()), key=lambda t: t[1])
    ys = sorted(((lbl, p["py"]) for lbl, p in cal["Y"].items()), key=lambda t: t[1])
    return xs, ys


def bubble(d, cx, cy, label, f, r=11):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=1, fill=PAPER)
    box = d.textbbox((0, 0), label, font=f)
    d.text((cx - (box[2] - box[0]) / 2, cy - (box[3] - box[1]) / 2 - 1), label, font=f, fill=INK)


def draw_floor(n: int):
    xs, ys = load_axis(n)
    img = Image.new("RGB", SIZE, PAPER)
    d = ImageDraw.Draw(img)

    f_tiny, f_small, f_body, f_title = font("Regular", 11), font("Medium", 13), font("Medium", 16), font("Bold", 30)

    x0, x1 = xs[0][1], xs[-1][1]
    y0, y1 = ys[0][1], ys[-1][1]

    # 슬래브 외곽
    d.rectangle([x0, y0, x1, y1], fill=SLAB, outline=INK, width=3)

    # 그리드
    for lbl, px in xs:
        minor = lbl.endswith("a")
        d.line([(px, y0 - (32 if xs.index((lbl, px)) % 2 == 0 else 62)), (px, y1 + 18)],
               fill=GRID_MINOR if minor else GRID, width=1)
    for lbl, py in ys:
        d.line([(x0 - 34, py), (x1 + 18, py)], fill=GRID, width=1)

    span_x = (x1 - x0) / 4.0
    span_y = (y1 - y0) / 4.0

    if n == 1:
        # 하역 도크 + 사무동 + 보관존
        d.rectangle([x0, y0, x0 + span_x * 1.5, y1], fill=ROOM, outline=INK, width=2)
        d.text((x0 + 22, y0 + 20), "사무·관리동", font=f_body, fill=INK)
        for i in range(12):
            top = y0 + 30 + i * ((y1 - y0 - 60) / 12)
            d.rectangle([x1 - span_x * 0.55, top, x1, top + 22], fill=CORE, outline=INK, width=1)
        d.text((x1 - span_x * 0.55, y0 + 6), "하역 도크", font=f_small, fill=INK)
        d.rectangle([x0 + span_x * 1.7, y0 + 40, x1 - span_x * 0.7, y1 - 40], fill=RACK, outline=INK, width=2)
        d.text((x0 + span_x * 1.9, y0 + 60), "보관존 A", font=f_body, fill=INK)
    elif n == 2:
        d.rectangle([x0 + 40, y0 + 40, x1 - 40, y1 - 40], fill=RACK, outline=INK, width=2)
        cols, rows = 8, 5
        for c in range(cols):
            for r in range(rows):
                left = x0 + 80 + c * ((x1 - x0 - 200) / cols)
                top = y0 + 80 + r * ((y1 - y0 - 200) / rows)
                d.rectangle([left, top, left + (x1 - x0 - 200) / cols - 28, top + (y1 - y0 - 200) / rows - 34],
                            fill=ROOM, outline=INK, width=1)
        d.text((x0 + 70, y0 + 50), "랙 보관존 B", font=f_body, fill=INK)
    else:
        d.rectangle([x0 + 40, y0 + 40, x0 + span_x * 2.4, y1 - 40], fill=RACK, outline=INK, width=2)
        d.text((x0 + 70, y0 + 60), "보관존 C", font=f_body, fill=INK)
        d.rectangle([x0 + span_x * 2.7, y0 + 40, x1 - 40, y0 + span_y * 2], fill=CORE, outline=INK, width=2)
        d.text((x0 + span_x * 2.9, y0 + 60), "기계실 · 전기실", font=f_body, fill=INK)
        d.rectangle([x0 + span_x * 2.7, y0 + span_y * 2.3, x1 - 40, y1 - 40], fill=ROOM, outline=INK, width=2)
        d.text((x0 + span_x * 2.9, y0 + span_y * 2.5), "설비 예비존", font=f_body, fill=INK)

    # 그리드 부호 — X는 개수가 많아 2단으로 엇갈려 배치한다
    for i, (lbl, px) in enumerate(xs):
        bubble(d, px, y0 - (44 if i % 2 == 0 else 74), f"X{lbl}", f_tiny)
    for lbl, py in ys:
        bubble(d, x0 - 48, py, f"Y{lbl}", f_tiny)

    # 표제란
    d.rectangle([x1 - 330, y1 + 34, x1 + 18, y1 + 118], fill=PAPER, outline=INK, width=2)
    d.text((x1 - 312, y1 + 48), f"지상{n}층 평면도", font=f_title, fill=INK)
    d.text((x1 - 312, y1 + 88), "데모용 가상 도면 · 실제 프로젝트와 무관", font=f_small, fill=(150, 100, 100))

    d.text((x0, 18), "DEMO FLOOR PLAN — 가상 데이터", font=f_body, fill=(170, 120, 120))

    out = os.path.join(ASSETS, f"floor{n}.jpeg")
    img.save(out, "JPEG", quality=86)
    print(f"wrote {out} {img.size}")


if __name__ == "__main__":
    for i in (1, 2, 3):
        draw_floor(i)
