#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 补齐缺失的僵尸走路动画

原版只有 fat01 有 zwalk01/zwalk02，其余体型只有 zattack01。
这里从 fat01 的 zwalk 里提取「血迹模板」（归一化到精灵包围盒），
再套到其他体型的 walk 帧上 —— 衣服不变、肢体加血，和原版的设计一致。

输出：reference/sprites/<type>/zwalk0N_solid/NN.png
"""
import os, glob
import numpy as np
from PIL import Image

BASE = "reference/sprites"
TARGETS = ["guy01", "guy02", "girl01", "girl02"]
SRC_TYPE = "fat01"
BLOOD = np.array([0.72, 0.10, 0.09])       # 血迹主色


def load(p):
    return np.asarray(Image.open(p).convert("RGBA"), dtype=np.float32) / 255.0


def is_blood(arr):
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    return (a > 0.5) & (r > 0.35) & (r > g * 1.8) & (r > b * 1.8) & (g < 0.45)


def bbox_of(arr):
    a = arr[:, :, 3] > 0.3
    if not a.any():
        return None
    ys, xs = np.nonzero(a)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def blood_stencil():
    """把 fat01 所有 zwalk 帧的血迹位置，归一化到包围盒，取并集"""
    pts = []
    files = sorted(glob.glob(os.path.join(BASE, SRC_TYPE, "zwalk01_solid", "*.png")))
    files += sorted(glob.glob(os.path.join(BASE, SRC_TYPE, "zwalk02_solid", "*.png")))
    for f in files:
        arr = load(f)
        bb = bbox_of(arr)
        if not bb:
            continue
        x0, y0, x1, y1 = bb
        w, h = max(1, x1 - x0), max(1, y1 - y0)
        m = is_blood(arr)
        for y, x in zip(*np.nonzero(m)):
            # 归一化坐标（相对包围盒）
            pts.append(((x - x0) / w, (y - y0) / h))
    return np.array(pts)


def edge_mask(arr, thick=2):
    """轮廓边缘（肢体外侧）：离透明区不超过 thick 像素的不透明像素"""
    a = arr[:, :, 3] > 0.4
    m = np.zeros_like(a)
    h, w = a.shape
    for dy in range(-thick, thick + 1):
        for dx in range(-thick, thick + 1):
            if dx * dx + dy * dy > thick * thick:
                continue
            ys = slice(max(0, dy), h + min(0, dy))
            xs = slice(max(0, dx), w + min(0, dx))
            sy = slice(max(0, -dy), h + min(0, -dy))
            sx = slice(max(0, -dx), w + min(0, -dx))
            m[ys, xs] |= ~a[sy, sx]
    return a & m


def stamp(arr, stencil, density=0.55, seed=0):
    """把血斑点阵盖到目标帧的肢体上（只改不透明的非皮肤像素）"""
    bb = bbox_of(arr)
    if not bb:
        return arr
    x0, y0, x1, y1 = bb
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    out = arr.copy()
    em = edge_mask(arr, 2)
    rng = np.random.default_rng(seed)
    for (u, v) in stencil:
        if rng.random() > density:
            continue
        x = int(x0 + u * w)
        y = int(y0 + v * h)
        if not (0 <= y < out.shape[0] and 0 <= x < out.shape[1]):
            continue
        if out[y, x, 3] < 0.5:
            continue                      # 透明处不画
        if not em[y, x]:
            continue                      # 只染轮廓边缘（肢体），保留衣服主体
        # 皮肤不染（避免脸变红），只染衣服/肢体
        skin = np.linalg.norm(out[y, x, :3] - np.array([0.94, 0.78, 0.62]))
        if skin < 0.20:
            continue
        out[y, x, :3] = BLOOD
        out[y, x, 3] = 1.0
    return out


def main():
    st = blood_stencil()
    print(f"血迹模板：{len(st)} 个归一化点（来自 {SRC_TYPE} 的 zwalk 帧）")
    if len(st) == 0:
        print("模板为空，放弃")
        return
    made = 0
    for t in TARGETS:
        walk_dir = os.path.join(BASE, t, "walk_solid")
        if not os.path.isdir(walk_dir):
            continue
        frames = sorted(glob.glob(os.path.join(walk_dir, "*.png")))
        for which in range(2):
            out_dir = os.path.join(BASE, t, f"zwalk0{which + 1}_solid")
            os.makedirs(out_dir, exist_ok=True)
            for i, f in enumerate(frames):
                arr = load(f)
                r = stamp(arr, st, seed=i * 7 + which * 131)
                Image.fromarray((np.clip(r, 0, 1) * 255).astype(np.uint8), "RGBA") \
                     .save(os.path.join(out_dir, f"{i:02d}.png"))
                made += 1
        print(f"  {t}: zwalk01 + zwalk02，共 {len(frames) * 2} 帧")
    print(f"合计生成 {made} 帧")


if __name__ == "__main__":
    main()
