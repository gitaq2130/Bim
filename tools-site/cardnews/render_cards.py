#!/usr/bin/env python3
"""
카드뉴스 이미지 생성기.

    node export_cards.mjs        # cards.config.mjs -> cards.json
    python3 render_cards.py      # cards.json -> out/<slug>/1..3.png

인스타그램 세로 규격(1080x1350)으로 도구마다 3장을 만든다.
문구는 cards.config.mjs 에만 있고 여기서는 배치만 한다.
"""
import json
import os
import textwrap

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
OUT = "out"

# 사이트와 같은 색을 쓴다.
INK = (20, 24, 26)
PAPER = (246, 248, 247)
BRAND = (14, 110, 110)
BRAND_BG = (227, 240, 239)
MUTED = (124, 139, 142)
WHITE = (255, 255, 255)

FONT_DIR = os.environ.get(
    "CARD_FONT_DIR", os.path.join("..", "..", "node_modules", "pretendard", "dist", "public", "static")
)
SITE_LABEL = os.environ.get("CARD_SITE_LABEL", "현장 실무 계산기")


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, f"Pretendard-{weight}.otf"), size)


def wrap_lines(d, text, f, max_w=None):
    """줄바꿈을 존중하고, max_w 를 넘는 줄만 접어서 줄 목록을 돌려준다."""
    lines = []
    for raw in text.split("\n"):
        if max_w is None or not raw.strip():
            lines.append(raw)
            continue
        cur = ""
        for ch in raw:
            trial = cur + ch
            if d.textlength(trial, font=f) > max_w and cur:
                lines.append(cur)
                cur = ch
            else:
                cur = trial
        lines.append(cur)
    return lines


def line_height(f, gap):
    bbox = f.getbbox("가")
    return (bbox[3] - bbox[1]) + gap


def block_height(lines, f, gap):
    return len(lines) * line_height(f, gap) - gap


def draw_block(d, x, top, lines, f, fill, gap=18, align="left"):
    y = top
    lh = line_height(f, gap)
    for line in lines:
        if align == "center":
            d.text((x - d.textlength(line, font=f) / 2, y), line, font=f, fill=fill)
        else:
            d.text((x, y), line, font=f, fill=fill)
        y += lh
    return y


def base_card(bg=PAPER):
    img = Image.new("RGB", (W, H), bg)
    return img, ImageDraw.Draw(img)


def footer(d, fill=MUTED):
    f = font("Medium", 30)
    d.text((80, H - 110), SITE_LABEL, font=f, fill=fill)


def card_hook(item):
    img, d = base_card(INK)
    d.rectangle([0, 0, W, 14], fill=BRAND)
    d.text((80, 150), item["title"], font=font("Bold", 32), fill=BRAND)

    f = font("ExtraBold", 78)
    lines = wrap_lines(d, item["hook"], f, W - 160)
    top = (H - block_height(lines, f, 26)) // 2 - 40
    draw_block(d, 80, top, lines, f, WHITE, gap=26)

    d.text((80, H - 190), "넘겨보세요 →", font=font("Medium", 34), fill=BRAND)
    footer(d, fill=(120, 135, 138))
    return img


def card_point(item):
    img, d = base_card(PAPER)
    d.rectangle([0, 0, W, 14], fill=BRAND)
    d.text((80, 150), item["title"], font=font("Bold", 30), fill=BRAND)

    f = font("Bold", 60)
    lines = wrap_lines(d, item["point"], f, W - 160)
    top = (H - block_height(lines, f, 26)) // 2 - 40
    draw_block(d, 80, top, lines, f, INK, gap=26)

    footer(d)
    return img


def card_example(item):
    img, d = base_card(PAPER)
    d.rectangle([0, 0, W, 14], fill=BRAND)
    d.text((80, 150), item["title"], font=font("Bold", 30), fill=BRAND)

    f = font("Bold", 62)
    lines = wrap_lines(d, item["example"], f, W - 260)
    bh = block_height(lines, f, 30)
    pad = 90
    box_h = bh + pad * 2
    box_top = (H - box_h) // 2 - 30
    d.rounded_rectangle([80, box_top, W - 80, box_top + box_h], radius=10, fill=BRAND_BG)
    draw_block(d, W // 2, box_top + pad, lines, f, INK, gap=30, align="center")

    d.text((80, H - 180), "계산기로 바로 확인", font=font("SemiBold", 36), fill=BRAND)
    footer(d)
    return img


def check_glyphs(cards):
    """Pretendard 에 없는 글자를 미리 잡는다.

    없는 글자는 검은 블록으로 렌더되는데, 이미지라서 눈으로 열어보기 전까지
    드러나지 않는다. 실제로 ✕ 와 金/整 이 이렇게 깨졌다.
    """
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("  (fonttools 없음 — 글리프 검사를 건너뜁니다)")
        return
    tt = TTFont(os.path.join(FONT_DIR, "Pretendard-Bold.otf"))
    cmap = set()
    for t in tt["cmap"].tables:
        cmap |= set(t.cmap.keys())
    bad = {}
    for item in cards:
        for key in ("title", "hook", "point", "example"):
            for ch in item.get(key, ""):
                if ch in "\n ":
                    continue
                if ord(ch) not in cmap:
                    bad.setdefault(ch, []).append(f"{item['slug']}.{key}")
    if bad:
        print("\n글꼴에 없는 글자가 있습니다. 그대로 두면 검은 블록으로 나옵니다:")
        for ch, where in bad.items():
            print(f"  {ch}  U+{ord(ch):04X}  ← {', '.join(sorted(set(where)))}")
        raise SystemExit(1)


def main():
    with open("cards.json", encoding="utf-8") as fh:
        cards = json.load(fh)

    check_glyphs(cards)

    made = 0
    for item in cards:
        folder = os.path.join(OUT, item["slug"])
        os.makedirs(folder, exist_ok=True)
        for i, fn in enumerate((card_hook, card_point, card_example), start=1):
            fn(item).save(os.path.join(folder, f"{i}.png"), "PNG", optimize=True)
            made += 1
        print(f"  {item['slug']}/  3장")
    print(f"\n{made}장 생성 → {OUT}/")


if __name__ == "__main__":
    main()
