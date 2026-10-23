#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 卫星图分块

把一张巨大的 sat.jpg 切成规则瓦片，输出 tileset.json 供运行时按视野加载。
单张图片会被浏览器的解码上限（约 2^28 像素）和显卡 MAX_TEXTURE_SIZE 卡住，
切成 4096 的小块后每块只有 16.7 MP，随便加载。

用法：
    python pipeline/split_sat.py --size 4096 --quality 88
"""
import os, json, argparse
from PIL import Image

Image.MAX_IMAGE_PIXELS = None       # 我们自己控制，别让 PIL 报 decompression bomb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/sat.jpg")
    ap.add_argument("--meta", default="data/sat.json")
    ap.add_argument("--outdir", default="data/ground")
    ap.add_argument("--size", type=int, default=4096)
    ap.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()

    meta = json.load(open(args.meta, encoding="utf-8"))
    im = Image.open(args.src).convert("RGB")
    W, H = im.size
    n = args.size
    cols = (W + n - 1) // n
    rows = (H + n - 1) // n
    os.makedirs(args.outdir, exist_ok=True)

    w, s, e, nn = meta["bounds"]
    total = 0
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * n, r * n
            x1, y1 = min(W, x0 + n), min(H, y0 + n)
            tile = im.crop((x0, y0, x1, y1))
            fn = f"t_{c}_{r}.jpg"
            p = os.path.join(args.outdir, fn)
            tile.save(p, "JPEG", quality=args.quality, optimize=True)
            total += os.path.getsize(p)
        print(f"  行 {r+1}/{rows} 完成", flush=True)

    json.dump({
        "tileSize": n,
        "cols": cols, "rows": rows,
        "imageW": W, "imageH": H,
        "bounds": [w, s, e, nn],          # 整幅图的经纬度范围
        "dir": "data/ground",
        "pattern": "t_{c}_{r}.jpg",
        "provider": meta.get("provider", ""),
        "zoom": meta.get("zoom", 0),
        "mpp": ((e - w) * 111320 * 0.6084) / W,   # 粗略米/像素，仅作参考
    }, open(os.path.join(args.outdir, "tileset.json"), "w", encoding="utf-8"),
        ensure_ascii=False, indent=1)

    # 远景缩略图（长边 8192，约 52 MP，远景只画这一张）
    maxside = 8192
    k = min(1.0, maxside / max(W, H))
    if k < 1.0:
        ov = im.resize((int(W * k), int(H * k)), Image.LANCZOS)
    else:
        ov = im
    ov.save(os.path.join(args.outdir, "overview.jpg"), "JPEG", quality=86, optimize=True)
    print(f"  缩略图 {ov.size[0]}x{ov.size[1]}  {os.path.getsize(os.path.join(args.outdir,'overview.jpg'))/1024/1024:.0f} MB")

    print(f"\n{cols}x{rows} = {cols*rows} 块，每块 {n}px，共 {total/1024/1024:.1f} MB")
    print(f"原图 {W}x{H} = {W*H/1e6:.0f} MP  → 每块 {min(n,W)*min(n,H)/1e6:.1f} MP")
    print(f"输出 {args.outdir}/tileset.json")


if __name__ == "__main__":
    main()
