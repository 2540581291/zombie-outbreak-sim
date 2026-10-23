#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 动物像素精灵生成器

原版没有动物，这些图是程序化"画"出来的：16×16 的俯视角四足动物，
6 帧走路循环（腿交替、身体轻微起伏）。

输出到 reference/sprites/animals/<名字>/{walk_solid,idle01_solid}/NN.png
格式和原版一致，后面打图集时自动收进去。
"""
import os, math
from PIL import Image, ImageDraw

OUT = "reference/sprites/animals"
S = 16          # 画布
FRAMES = 6


def put(d, x, y, c):
    if 0 <= x < S and 0 <= y < S:
        d.point((x, y), fill=c)


def ellipse(d, cx, cy, rx, ry, c):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                put(d, int(x), int(y), c)


def draw(quad, frame, walking=True):
    """
    quad: dict(名字/颜色/尺寸)
    朝向 +X（和原版小人一致）
    """
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    body_c = quad["body"]
    dark = quad["dark"]
    head_c = quad.get("head", body_c)
    accent = quad.get("accent")

    cx, cy = S / 2 + 0.5, S / 2 + 0.5
    L = quad["len"]        # 身体长度
    W = quad["wid"]        # 身体宽度
    leg = quad["leg"]      # 腿长

    t = frame / FRAMES * 2 * math.pi
    bob = -0.6 if walking and math.sin(t * 2) > 0 else 0.6 if walking else 0

    # 腿（4 条，交替前后摆动）
    for i, (lx, ly) in enumerate(((-L * 0.34, -W * 0.8), (-L * 0.34, W * 0.8),
                                  (L * 0.30, -W * 0.8), (L * 0.30, W * 0.8))):
        ph = math.sin(t + (0 if i % 2 == 0 else math.pi))
        off = ph * (1.6 if walking else 0)
        put(d, int(cx + lx + off), int(cy + ly), dark)
        put(d, int(cx + lx + off), int(cy + ly + (1 if ly > 0 else -1)), dark)
        if leg >= 2:
            put(d, int(cx + lx + off * 1.4), int(cy + ly * 1.25), dark)

    # 尾巴
    if quad.get("tail"):
        put(d, int(cx - L * 0.62), int(cy), dark)
        put(d, int(cx - L * 0.72), int(cy + (1 if frame % 4 < 2 else -1)), accent or dark)

    # 身体
    ellipse(d, cx, cy + bob, L * 0.55, W * 0.75, body_c)
    # 背部高光
    if accent:
        for i in range(-1, 2):
            put(d, int(cx + i), int(cy + bob - W * 0.35), accent)

    # 头
    hx = cx + L * 0.62
    ellipse(d, hx, cy + bob, quad["head_r"], quad["head_r"] * 0.9, head_c)
    # 耳朵
    if quad.get("ears"):
        put(d, int(hx - 1), int(cy + bob - quad["head_r"] - 1), head_c)
        put(d, int(hx - 1), int(cy + bob + quad["head_r"] + 1), head_c)

    # 感染后的红眼
    if quad.get("eyes"):
        put(d, int(hx + quad["head_r"] * 0.5), int(cy + bob - 1), quad["eyes"])
        put(d, int(hx + quad["head_r"] * 0.5), int(cy + bob + 1), quad["eyes"])
    return img


QUADS = {
    "dog": dict(len=9, wid=4.6, leg=3, head_r=2.0, tail=1, ears=1,
                body=(0.55, 0.38, 0.20), dark=(0.26, 0.17, 0.10),
                head=(0.60, 0.42, 0.22), accent=(0.72, 0.55, 0.32)),
    "dog_z": dict(len=9, wid=4.6, leg=3, head_r=2.0, tail=1, ears=1, eyes=(0.9, 0.15, 0.1),
                  body=(0.60, 0.26, 0.18), dark=(0.28, 0.09, 0.07),
                  head=(0.66, 0.30, 0.20), accent=(0.85, 0.35, 0.22)),
    "cat": dict(len=6.5, wid=3.4, leg=2, head_r=1.7, tail=1, ears=1,
                body=(0.46, 0.46, 0.50), dark=(0.24, 0.24, 0.28),
                head=(0.50, 0.50, 0.55), accent=(0.62, 0.62, 0.66)),
    "cat_z": dict(len=6.5, wid=3.4, leg=2, head_r=1.7, tail=1, ears=1, eyes=(0.9, 0.15, 0.1),
                  body=(0.58, 0.24, 0.16), dark=(0.26, 0.08, 0.06),
                  head=(0.64, 0.28, 0.18), accent=(0.85, 0.32, 0.20)),
    "bear": dict(len=13, wid=8.5, leg=4, head_r=3.2, tail=0, ears=1,
                 body=(0.26, 0.20, 0.15), dark=(0.14, 0.11, 0.08),
                 head=(0.30, 0.23, 0.17), accent=(0.38, 0.30, 0.22)),
    "bear_z": dict(len=13, wid=8.5, leg=4, head_r=3.2, tail=0, ears=1, eyes=(1.0, 0.2, 0.1),
                   body=(0.56, 0.20, 0.13), dark=(0.22, 0.07, 0.05),
                   head=(0.62, 0.24, 0.15), accent=(0.85, 0.30, 0.18)),
    "tiger": dict(len=13, wid=6.5, leg=4, head_r=2.8, tail=1, ears=1,
                  body=(0.82, 0.46, 0.12), dark=(0.14, 0.10, 0.06),
                  head=(0.86, 0.50, 0.14), accent=(0.25, 0.16, 0.08)),
    "tiger_z": dict(len=13, wid=6.5, leg=4, head_r=2.8, tail=1, ears=1, eyes=(1.0, 0.2, 0.1),
                    body=(0.66, 0.20, 0.12), dark=(0.12, 0.07, 0.05),
                    head=(0.72, 0.24, 0.14), accent=(0.95, 0.35, 0.18)),
}


def to_c(rgb):
    return (int(rgb[0] * 255), int(rgb[1] * 255), int(rgb[2] * 255), 255)


def main():
    total = 0
    for name, q in QUADS.items():
        qq = dict(q)
        for k in ("body", "dark", "head", "accent", "eyes"):
            if k in qq and qq[k]:
                qq[k] = to_c(qq[k])
        for anim, walking, n in (("walk_solid", True, FRAMES), ("idle01_solid", False, 2)):
            d = os.path.join(OUT, name, anim)
            os.makedirs(d, exist_ok=True)
            for f in range(n):
                draw(qq, f, walking).save(os.path.join(d, f"{f:02d}.png"))
                total += 1
        print(f"  {name}: {FRAMES + 2} 帧")
    print(f"共 {total} 帧 → {OUT}")


if __name__ == "__main__":
    main()
