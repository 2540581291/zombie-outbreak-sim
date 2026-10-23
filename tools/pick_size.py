#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 地图尺寸甜点计算器

给定「地面面积」和「图源分辨率」，算出单张贴图能用的最大像素尺寸，
以及缩放后的实际分辨率。这个结果就是本项目地图的通用尺寸标准。

    甜点 = 在硬上限之内，尽可能吃掉像素预算

用法：
    # 只计算
    python tools/pick_size.py --w-m 3162 --h-m 2401 --res 0.091

    # 计算并把 data/sat.jpg 缩放到该尺寸（同时更新 sat.json）
    python tools/pick_size.py --w-m 3162 --h-m 2401 --res 0.091 --apply

参数默认值就是柏林的当前情况，换城市时改 --w-m/--h-m/--res 即可。
"""
import argparse, json, math, os, sys

# ---- 三道上限 ----
P_MAX = int(2 ** 28 * 0.95)  # 非瓶颈：边长上限先触发，这里只作兜底
E_MAX = 16384              # 实测：ANGLE/D3D11 把单边锁在 16384（RTX 5090 硬件支持 32768 但浏览器不给）
B_TEX = 2 * 1024 ** 3      # 显存预算 2 GB（每像素 4 字节）


def sweet_spot(w_m, h_m, res, p_max=P_MAX, e_max=E_MAX, b_tex=B_TEX, verbose=True):
    """返回 (W_px, H_px, r_eff, 诊断信息)"""
    n_ideal = (w_m / res) * (h_m / res)
    n_cap = min(p_max, e_max * e_max, b_tex / 4)

    # 单边限制先作用到理想值上，再按像素上限收缩
    ratio = h_m / w_m
    n_edge = e_max * (e_max * ratio)          # 单边顶满时的像素数
    n_use = min(n_ideal, n_cap, n_edge)

    s = math.sqrt(n_use / n_ideal)
    r_eff = res / s
    W_px = int(round(w_m / r_eff))
    H_px = int(round(h_m / r_eff))
    # 取整后可能轻微越界，回收到上限以内
    guard = 0
    while W_px * H_px > n_use and guard < 200:
        W_px = int(W_px * 0.9995); H_px = int(H_px * 0.9995); guard += 1
    r_eff = w_m / W_px

    d = dict(n_ideal=n_ideal, n_cap=n_cap, n_edge=n_edge, n_use=n_use,
             scale=s, r_eff=r_eff, W=W_px, H=H_px,
             px=W_px * H_px, mem_gb=W_px * H_px * 4 / 1024 ** 3)
    if verbose:
        print(f"面积        {w_m:.0f} x {h_m:.0f} m")
        print(f"源分辨率    {res:.4f} m/px  → 理想 {n_ideal/1e6:.0f} MP")
        print(f"上限        P_MAX {p_max/1e6:.0f} MP | 单边 {e_max}px | 显存 {b_tex/1024**3:.1f} GB")
        print(f"采用        {d['px']/1e6:.0f} MP  ({W_px} x {H_px})")
        print(f"缩放        ×{s:.3f}  →  实际 {r_eff:.4f} m/px")
        print(f"显存        {d['mem_gb']:.2f} GB（不含 mipmap）")
        if s < 0.999:
            print(f"提示        想要 {res:.4f} m/px 需要 {n_ideal/1e6:.0f} MP，"
                  f"超出上限，因此降为 {r_eff:.4f}")
    return W_px, H_px, r_eff, d


def apply(w_px, h_px, sat_json="data/sat.json", sat_jpg="data/sat.jpg", quality=90):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    meta = json.load(open(sat_json, encoding="utf-8"))
    im = Image.open(sat_jpg)
    print(f"  源图 {im.size[0]}x{im.size[1]} → {w_px}x{h_px}")
    im = im.convert("RGB").resize((w_px, h_px), Image.LANCZOS)
    im.save(sat_jpg, "JPEG", quality=quality, optimize=True)
    meta["size"] = [w_px, h_px]
    meta["sweetSpot"] = {"formula": "min(ideal, P_MAX, E_MAX^2, B/4)", "r_eff": None}
    json.dump(meta, open(sat_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    mb = os.path.getsize(sat_jpg) / 1024 / 1024
    print(f"  写出 {sat_jpg}  {mb:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--w-m", type=float, default=3162)
    ap.add_argument("--h-m", type=float, default=2401)
    ap.add_argument("--res", type=float, default=0.1828, help="图源的地面分辨率 m/px")
    ap.add_argument("--apply", action="store_true", help="按结果缩放 data/sat.jpg")
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--citydir", default="data", help="城市数据目录，如 data/cities/tokyo")
    a = ap.parse_args()
    W, H, r, d = sweet_spot(a.w_m, a.h_m, a.res)
    if a.apply:
        sj = os.path.join(a.citydir, "sat.json")
        sg = os.path.join(a.citydir, "sat.jpg")
        apply(W, H, sat_json=sj, sat_jpg=sg, quality=a.quality)
        meta = json.load(open(sj, encoding="utf-8"))
        meta["sweetSpot"] = {"r_eff": round(r, 4), "px": d["px"], "scale": round(d["scale"], 4)}
        json.dump(meta, open(sj, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  sat.json 已更新  r_eff={r:.4f} m/px")


if __name__ == "__main__":
    main()
