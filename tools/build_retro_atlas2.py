#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 复古图集（带衣服配色变体）

每个「体型 × 动画」生成 VARIANTS 套衣服配色：
  v0 = 原图
  v1..v3 = 衣服色相偏移（皮肤、描边、阴影不动）

输出：
  assets/retro/atlas.png
  assets/retro/atlas.json  → frames[key] = [ [rects_v0], [rects_v1], ... ]

运行时每个个体按哈希挑一套，街头上就是"不同衣服的人"。
"""
import os, json, glob, colorsys
import numpy as np
from PIL import Image

CELL, COLS = 64, 32
VARIANTS = 5                       # 0 = 原图，其余为换色
HUE_STEPS = [0.0, 0.12, -0.12, 0.26, -0.26]   # 每套的色相偏移（0..1）
SRC = "reference/sprites"
OUT = "assets/retro"
ANIMALS = "reference/sprites/animals"

# 皮肤参考色（与 upscale_sprites.py 一致）
SKIN_REF = np.array([0.94, 0.78, 0.62])


def recolor(arr, dh):
    """arr: (h,w,4) float 0..1；只改"衣服"像素的色相"""
    if abs(dh) < 1e-6:
        return arr
    rgb = arr[:, :, :3]
    a = arr[:, :, 3]
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 0.02, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    # 皮肤距离
    dist = np.linalg.norm(rgb - SKIN_REF[None, None, :], axis=2)
    is_skin = dist < 0.22
    # 只改有颜色、不太暗的像素
    mask = (sat > 0.12) & (lum > 0.14) & (a > 0.5) & (~is_skin)

    out = arr.copy()
    if not mask.any():
        return out
    idx = np.nonzero(mask)
    pix = rgb[idx]                       # (N,3)
    r, g, b = pix[:, 0], pix[:, 1], pix[:, 2]
    mxv = pix.max(1)
    mnv = pix.min(1)
    d2 = mxv - mnv
    nz = d2 > 1e-5
    h2 = np.zeros_like(mxv)
    rr, gg, bb = r[nz], g[nz], b[nz]
    m2 = mxv[nz]
    dd = d2[nz]
    h2[nz] = np.where(m2 == rr, ((gg - bb) / dd) % 6,
                      np.where(m2 == gg, (bb - rr) / dd + 2, (rr - gg) / dd + 4)) / 6.0
    hh = (h2 + dh) % 1.0
    ss = np.where(mxv > 1e-5, d2 / np.maximum(mxv, 1e-5), 0)
    vv = mxv
    ii = np.floor(hh * 6).astype(int) % 6
    f = hh * 6 - np.floor(hh * 6)
    p_ = vv * (1 - ss)
    q = vv * (1 - f * ss)
    t = vv * (1 - (1 - f) * ss)
    conds = [ii == 0, ii == 1, ii == 2, ii == 3, ii == 4, ii == 5]
    nr = np.select(conds, [vv, q, p_, p_, t, vv])
    ng = np.select(conds, [t, vv, vv, q, p_, p_])
    nb = np.select(conds, [p_, p_, t, vv, vv, q])
    r0, c0 = idx
    out[r0, c0, 0] = np.clip(nr, 0, 1)
    out[r0, c0, 1] = np.clip(ng, 0, 1)
    out[r0, c0, 2] = np.clip(nb, 0, 1)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    files = []
    for t in sorted(os.listdir(SRC)):
        tp = os.path.join(SRC, t)
        if not os.path.isdir(tp):
            continue
        for a in sorted(os.listdir(tp)):
            ap = os.path.join(tp, a)
            if not os.path.isdir(ap):
                continue
            fs = sorted(glob.glob(os.path.join(ap, "*.png")))
            if fs:
                files.append((t, a, fs))
    if os.path.isdir(ANIMALS):
        for t in sorted(os.listdir(ANIMALS)):
            for a in sorted(os.listdir(os.path.join(ANIMALS, t))):
                fs = sorted(glob.glob(os.path.join(ANIMALS, t, a, "*.png")))
                if fs:
                    files.append(("animals_" + t, a, fs))

    total = sum(len(f) for _, _, f in files) * VARIANTS
    rows = (total + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    frames, i, scaled = {}, 0, 0

    for t, a, fs in files:
        is_animal = t.startswith("animals_")
        # 动物只有 1 套；outline（X 光绿轮廓）必须是纯色，不能被换色变体染
        nv = 1 if (is_animal or a.endswith("_outline")) else VARIANTS
        variants = [[] for _ in range(nv)]
        for f in fs:
            base = Image.open(f).convert("RGBA")
            arr0 = np.asarray(base, dtype=np.float32) / 255.0
            for v in range(nv):
                arr = recolor(arr0, HUE_STEPS[v] if not is_animal else 0.0)
                im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA")
                if im.width > CELL or im.height > CELL:
                    k = min(CELL / im.width, CELL / im.height)
                    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
                    scaled += 1
                x = (i % COLS) * CELL + (CELL - im.width) // 2
                y = (i // COLS) * CELL + (CELL - im.height) // 2
                atlas.alpha_composite(im, (x, y))
                variants[v].append([x, y, im.width, im.height])
                i += 1
        frames[f"{t}/{a}"] = variants

    atlas.save(os.path.join(OUT, "atlas.png"))
    json.dump({"cell": CELL, "cols": COLS, "rows": rows, "w": atlas.width, "h": atlas.height,
               "count": total, "variants": VARIANTS, "frames": frames},
              open(os.path.join(OUT, "atlas.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"图集 {atlas.width}×{atlas.height}  {total} 帧  "
          f"{os.path.getsize(os.path.join(OUT,'atlas.png'))/1024:.0f} KB  变体 {VARIANTS}")


if __name__ == "__main__":
    main()
