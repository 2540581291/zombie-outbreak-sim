#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 精灵重制器

把 2009 年那套 15×14 像素的俯视角小人，升级到高分辨率并生成配色变体。

三种放大路线：
  nearest  —— 最近邻，保留硬像素（基准）
  epx      —— Scale2x/EPX，识别斜边并平滑（保住像素风的手感）
  remaster —— 用 alpha 通道当准 SDF，做抗锯齿边缘 + 描边 + 顶部受光 + 底部阴影
              （最接近"高清重制"的观感）

变体：按色相/明度把调色板分成「描边 / 皮肤 / 服装主色 / 服装暗部 / 中性」，
      只对服装和皮肤做可控偏移，描边永远保持近黑。
"""
import os, sys, math, colorsys, random
import numpy as np
from PIL import Image

# ---------------------------------------------------------------- 基础

def load_frame(path):
    return Image.open(path).convert("RGBA")


def epx2(im):
    """Scale2x / EPX：单次 2 倍，靠邻域模式判断斜边。"""
    a = np.array(im, dtype=np.uint8)
    h, w = a.shape[:2]
    out = np.zeros((h * 2, w * 2, 4), dtype=np.uint8)

    # 以 4 通道为一组比较
    def eq(y1, x1, y2, x2):
        return np.all(a[y1, x1] == a[y2, x2])

    for y in range(h):
        for x in range(w):
            P = a[y, x]
            A = a[y - 1, x] if y > 0 else P       # 上
            B = a[y, x + 1] if x + 1 < w else P   # 右
            C = a[y, x - 1] if x > 0 else P       # 左
            D = a[y + 1, x] if y + 1 < h else P   # 下

            E0 = A if (eq(y, max(x - 1, 0), max(y - 1, 0), x)
                       and not eq(y, max(x - 1, 0), min(y + 1, h - 1), x)
                       and not eq(max(y - 1, 0), x, y, min(x + 1, w - 1))) else P
            E1 = B if (eq(max(y - 1, 0), x, y, min(x + 1, w - 1))
                       and not eq(y, max(x - 1, 0), min(y + 1, h - 1), x)
                       and not eq(max(y - 1, 0), x, min(y + 1, h - 1), x)) else P
            E2 = C if (eq(min(y + 1, h - 1), x, y, max(x - 1, 0))
                       and not eq(y, min(x + 1, w - 1), max(y - 1, 0), x)
                       and not eq(min(y + 1, h - 1), x, max(y - 1, 0), x)) else P
            E3 = D if (eq(y, min(x + 1, w - 1), min(y + 1, h - 1), x)
                       and not eq(min(y + 1, h - 1), x, max(y - 1, 0), x)
                       and not eq(y, min(x + 1, w - 1), y, max(x - 1, 0))) else P

            out[y * 2, x * 2] = E0
            out[y * 2, x * 2 + 1] = E1
            out[y * 2 + 1, x * 2] = E2
            out[y * 2 + 1, x * 2 + 1] = E3
    return Image.fromarray(out, "RGBA")


def upscale_epx(im, times=3):
    for _ in range(times):
        im = epx2(im)
    return im


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def remaster(im, scale=8, outline=(0.06, 0.05, 0.04)):
    """
    准 SDF 重制：
      1. alpha 双三次放大 → 当软距离场
      2. 边缘抗锯齿
      3. 边缘一圈压暗成描边
      4. 顶部受光 / 底部阴影（俯视角，光从左上来）
      5. RGB 用最近邻放大，保住原来的平涂色块
    """
    a = np.array(im, dtype=np.float32) / 255.0
    alpha = a[..., 3]
    rgb = a[..., :3]

    H, W = alpha.shape
    H2, W2 = H * scale, W * scale

    # --- 软距离场 ---
    af = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a_hi = np.array(af.resize((W2, H2), Image.BICUBIC), dtype=np.float32) / 255.0

    # 距离场近似：0=完全在内，1=完全在外
    sdf = 1.0 - a_hi                      # 边缘附近 ≈ 0.5
    out_alpha = 1.0 - smoothstep(0.42, 0.62, sdf)

    # --- 边缘带（越靠近轮廓越接近 1）---
    edge = np.clip(1.0 - np.abs(2.0 * a_hi - 1.0) * 3.0, 0, 1)

    # --- 颜色：最近邻放大 ---
    col = np.array(Image.fromarray((rgb * 255).astype(np.uint8), "RGB")
                   .resize((W2, H2), Image.NEAREST), dtype=np.float32) / 255.0

    # --- 俯视角打光：上方亮，下方暗 ---
    yy = np.linspace(0, 1, H2, dtype=np.float32)[:, None]
    yy = np.broadcast_to(yy, (H2, W2))
    # 只按人物自身的包围盒归一化，避免受透明区影响
    ys, xs = np.where(out_alpha > 0.4)
    if len(ys):
        y0, y1 = ys.min(), ys.max()
        yy = np.clip((yy - y0) / max(1, (y1 - y0)), 0, 1)
    shade = 1.10 - 0.28 * yy
    col = col * shade[..., None]

    # --- 描边 ---
    o = np.array(outline, dtype=np.float32)
    k = np.clip(edge * 1.35, 0, 1)[..., None] ** 0.8
    col = col * (1 - k) + o * k

    # --- 边缘轻微提亮（高光感）---
    rim = np.clip(edge - 0.55, 0, 1) * 0.6
    col = col + rim[..., None] * 0.10

    out = np.concatenate([np.clip(col, 0, 1), out_alpha[..., None]], axis=-1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- 调色板

def classify_colors(im):
    """把不透明像素的调色板按 HSL 分组。"""
    px = np.array(im, dtype=np.uint8).reshape(-1, 4)
    px = px[px[:, 3] > 128][:, :3]
    uniq, counts = np.unique(px, axis=0, return_counts=True)
    groups = {"outline": [], "skin": [], "cloth": [], "cloth_dark": [], "neutral": []}
    for c, n in zip(uniq, counts):
        r, g, b = (c / 255.0)
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        if l < 0.18:
            groups["outline"].append((tuple(c), n))
        elif s < 0.12:
            groups["neutral"].append((tuple(c), n))
        elif 0.02 < h < 0.14 and l > 0.45 and s < 0.55:
            groups["skin"].append((tuple(c), n))
        elif l < 0.34:
            groups["cloth_dark"].append((tuple(c), n))
        else:
            groups["cloth"].append((tuple(c), n))
    return groups


SKIN_REF = [(253, 206, 145), (254, 205, 146), (207, 163, 116), (240, 202, 160)]


def _is_skin(c):
    """肤色判定：离游戏里那几种固定肤色够近才算，避免把黄色裙子当皮肤。"""
    return min(sum((int(a) - b) ** 2 for a, b in zip(c, ref)) for ref in SKIN_REF) < 40 * 40


def recolor(im, hue_shift=0.0, sat_mul=1.0, light_mul=1.0,
            skin_shift=0.0, skin_light=1.0, dark_only=False, tint=0.22):
    """按分组重新上色：服装整体转色相，皮肤单独调，中性灰白染成淡彩。"""
    arr = np.array(im, dtype=np.uint8).copy()
    px = arr.reshape(-1, 4)
    out = px.astype(np.float32) / 255.0
    for i in range(len(px)):
        a = out[i, 3]
        if a < 0.02:
            continue
        r, g, b = out[i, :3]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        if l < 0.18:                       # 描边：几乎不动
            continue
        rgb255 = (out[i, 0] * 255, out[i, 1] * 255, out[i, 2] * 255)
        if s < 0.12:                       # 中性灰白：染成淡彩
            h2 = (h + hue_shift) % 1.0
            r2, g2, b2 = colorsys.hls_to_rgb(h2, min(1, l * light_mul), min(1, tint))
            out[i, :3] = (r2, g2, b2)
            continue
        is_skin = _is_skin(rgb255)
        if is_skin:
            h2 = (h + skin_shift) % 1.0
            r2, g2, b2 = colorsys.hls_to_rgb(h2, min(1, l * skin_light), s)
        else:
            h2 = (h + hue_shift) % 1.0
            l2 = min(1, max(0, l * light_mul))
            if dark_only and l > 0.5:
                l2 = l
            r2, g2, b2 = colorsys.hls_to_rgb(h2, l2, min(1, s * sat_mul))
        out[i, :3] = (r2, g2, b2)
    out = np.clip(out, 0, 1).reshape(arr.shape)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- 对比图

if __name__ == "__main__":
    import glob
    out_dir = "shots/sprites"
    os.makedirs(out_dir, exist_ok=True)

    frames = sorted(glob.glob("reference/sprites/guy01/walk_solid/*.png"))[:6]
    frames += sorted(glob.glob("reference/sprites/police01/walk_solid/*.png"))[:6]

    SC = 8
    CELL = 15 * SC + 10
    rows = []
    for f in frames:
        im = load_frame(f)
        rows.append((
            os.path.basename(os.path.dirname(os.path.dirname(f))) + "/" + os.path.basename(f),
            im.resize((im.width * SC, im.height * SC), Image.NEAREST),
            upscale_epx(im, 3),
            remaster(im, SC),
        ))

    CW = max(r[1].width for r in rows) + 8
    CH = max(r[1].height for r in rows) + 8
    W = CW * 3 + 130
    H = CH * len(rows) + 30
    canvas = Image.new("RGBA", (W, H), (16, 18, 22, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(canvas)
    d.text((130, 8), "nearest ×8", fill=(150, 160, 170, 255))
    d.text((130 + CW, 8), "epx ×8", fill=(150, 160, 170, 255))
    d.text((130 + CW * 2, 8), "remaster ×8", fill=(150, 160, 170, 255))
    y = 26
    for name, a, b, c in rows:
        d.text((6, y + CH // 2), name[:16], fill=(110, 120, 130, 255))
        canvas.alpha_composite(a, (130, y))
        canvas.alpha_composite(b, (130 + CW, y))
        canvas.alpha_composite(c, (130 + CW * 2, y))
        y += CH
    canvas.save(f"{out_dir}/upscale_compare.png")
    print("写出", f"{out_dir}/upscale_compare.png", canvas.size)
