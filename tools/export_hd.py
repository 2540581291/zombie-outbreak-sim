#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量导出：原版精灵 → 高清重制 + 配色变体

产出：
  assets/sprites_hd/<类型>/<动作>_solid/01.png …     8× 高清（内部保像素、外轮廓抗锯齿+描边）
  assets/sprites_hd/<类型>/<动作>_outline/01.png …   同上，但保留绿色剪影版
  assets/sprites_var/<类型>/<变体名>/<动作>/01.png   配色变体（只导出走/待机/尸变三套）
  assets/sprites.json                                帧尺寸/数量清单
"""
import os, sys, json, glob, shutil
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import numpy as np
from PIL import Image
from upscale_sprites import load_frame, recolor

SCALE = 8


def dilate(mask, r=1):
    m = mask
    for _ in range(r):
        m = np.maximum.reduce([m, np.roll(m, 1, 0), np.roll(m, -1, 0),
                               np.roll(m, 1, 1), np.roll(m, -1, 1)])
    return m


def hd(im, S=SCALE, ring=2, outline=(0.05, 0.05, 0.06)):
    """内部最近邻保像素，外轮廓双三次抗锯齿，外加一圈描边（贴纸感）。"""
    w, h = im.size
    W, H = w * S, h * S
    base = im.resize((W, H), Image.NEAREST)
    a = np.array(base, dtype=np.float32) / 255.0

    al = Image.fromarray(np.array(im)[..., 3].astype(np.uint8), "L").resize((W, H), Image.BICUBIC)
    ah = np.clip((np.array(al, dtype=np.float32) / 255.0 - 0.35) / 0.30, 0, 1)
    mask = ah > 0.5
    ringm = dilate(mask, ring) & ~mask

    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = np.array(outline, np.float32)
    out[..., 3][ringm] = 1.0
    out[..., :3][mask] = a[..., :3][mask]
    out[..., 3][mask] = 1.0
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


def silhouette(im, S=SCALE, color=(0.16, 0.95, 0.35)):
    """绿色剪影（原版 _yc249 的用途：被建筑挡住时的透视轮廓），但做成高清 + 发光边。"""
    w, h = im.size
    W, H = w * S, h * S
    al = Image.fromarray(np.array(im)[..., 3].astype(np.uint8), "L").resize((W, H), Image.BICUBIC)
    ah = np.clip((np.array(al, dtype=np.float32) / 255.0 - 0.35) / 0.30, 0, 1)
    mask = ah > 0.5
    edge = dilate(mask, 1) & ~mask
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = np.array(color, np.float32)
    out[..., 3][mask] = 0.85
    out[..., 3][edge] = 1.0
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


VARIANTS = [
    ("orig",   dict(hue_shift=0.00)),
    ("warm",   dict(hue_shift=0.06, light_mul=1.06)),
    ("olive",  dict(hue_shift=0.13)),
    ("teal",   dict(hue_shift=0.30)),
    ("blue",   dict(hue_shift=0.55)),
    ("violet", dict(hue_shift=0.72)),
    ("crimson",dict(hue_shift=0.93)),
    ("pale",   dict(hue_shift=0.50, light_mul=1.25, sat_mul=0.55, tint=0.30)),
]
VAR_ANIMS = ["walk_solid", "idle01_solid", "zrise01_solid"]


def main():
    src_root = "reference/sprites"
    hd_root = "assets/sprites_hd"
    var_root = "assets/sprites_var"
    shutil.rmtree(hd_root, ignore_errors=True)
    shutil.rmtree(var_root, ignore_errors=True)

    manifest = {"scale": SCALE, "types": {}}
    n_hd = n_var = 0

    for type_dir in sorted(os.listdir(src_root)):
        tpath = os.path.join(src_root, type_dir)
        if not os.path.isdir(tpath):
            continue
        info = {}
        for anim_dir in sorted(os.listdir(tpath)):
            apath = os.path.join(tpath, anim_dir)
            if not os.path.isdir(apath):
                continue
            frames = sorted(glob.glob(os.path.join(apath, "*.png")))
            if not frames:
                continue
            is_outline = anim_dir.endswith("_outline")
            outdir = os.path.join(hd_root, type_dir, anim_dir)
            os.makedirs(outdir, exist_ok=True)
            for i, f in enumerate(frames):
                im = load_frame(f)
                img = silhouette(im) if is_outline else hd(im)
                img.save(os.path.join(outdir, f"{i:02d}.png"))
                n_hd += 1
            info[anim_dir] = {"frames": len(frames),
                              "size": [im.width * SCALE, im.height * SCALE]}

            # 配色变体（只做几套主要动作）
            if anim_dir in VAR_ANIMS:
                for vname, kw in VARIANTS:
                    if vname == "orig":
                        continue
                    vdir = os.path.join(var_root, type_dir, vname, anim_dir)
                    os.makedirs(vdir, exist_ok=True)
                    for i, f in enumerate(frames):
                        im = load_frame(f)
                        hd(recolor(im, **kw)).save(os.path.join(vdir, f"{i:02d}.png"))
                        n_var += 1
        manifest["types"][type_dir] = info

    with open("assets/sprites.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    print(f"高清帧 {n_hd}  变体帧 {n_var}  →  {hd_root} / {var_root}")


if __name__ == "__main__":
    main()
