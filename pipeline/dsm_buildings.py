#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从航测 DSM 里提取建筑轮廓 + 高度，输出成 baker 能吃的 buildings JSON。

思路：
  1. DSM 是地表高程（含屋顶、树冠），按窗口从 BigTIFF 里懒读（zarr 切片）；
  2. 用"局部最低值"近似地面（30m 窗口的 minimum filter）；
  3. 高于地面 threshold 米以上的连通块 = 建筑候选；
  4. 面积/形状过滤，轮廓简化，高度取块内 90 分位；
  5. 像素坐标 → UTM(32649) → WGS84 经纬度。
"""
import argparse, json, math, os, time
import numpy as np
import cv2
from pyproj import Transformer
import tifffile, zarr


def read_pgw(path):
    v = [float(x) for x in open(path).read().split()]
    return v[0], v[4], v[5]          # A(像素宽), C(左上中心X), F(左上中心Y)


def block_reduce(a, k):
    if k <= 1:
        return a
    h, w = a.shape
    h2, w2 = (h // k) * k, (w // k) * k
    a = a[:h2, :w2]
    return a.reshape(h2 // k, k, w2 // k, k).mean(axis=(1, 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dsm', required=True)
    ap.add_argument('--tfw', required=True)
    ap.add_argument('--minlon', type=float, required=True)
    ap.add_argument('--minlat', type=float, required=True)
    ap.add_argument('--maxlon', type=float, required=True)
    ap.add_argument('--maxlat', type=float, required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--scale', type=float, default=0.5, help='处理分辨率 m/px')
    ap.add_argument('--min-h', type=float, default=4.0, help='高于地面多少米算建筑')
    ap.add_argument('--min-area', type=float, default=25.0, help='最小占地 m²')
    ap.add_argument('--ground-win', type=float, default=10.0, help='地面估计窗口 m（erode 半径）')
    ap.add_argument('--median', type=int, default=5, help='中值滤波核（去立体匹配噪点）')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    t0 = time.time()
    px, cx, cy = read_pgw(args.tfw)               # px = 原始像素尺寸（米）
    k = max(1, int(round(args.scale / px)))       # 降采样倍数
    step = px * k
    print(f'DSM {px:.4f} m/px → 处理 {step:.3f} m/px（每 {k} 像素取均值）')

    tr = Transformer.from_crs('EPSG:32649', 'EPSG:4326', always_xy=True)
    lo0, la0 = tr.transform(args.minlon, args.minlat)   # 占位，真正换算在下面
    inv = Transformer.from_crs('EPSG:4326', 'EPSG:32649', always_xy=True)
    E0, N0 = inv.transform(args.minlon, args.maxlat)    # 左上角
    E1, N1 = inv.transform(args.maxlon, args.minlat)    # 右下角

    c0 = int(math.floor((min(E0, E1) - (cx - px / 2)) / px))
    c1 = int(math.ceil((max(E0, E1) - (cx - px / 2)) / px))
    r0 = int(math.floor(((cy + px / 2) - max(N0, N1)) / px))
    r1 = int(math.ceil(((cy + px / 2) - min(N0, N1)) / px))
    print(f'窗口 rows {r0}..{r1}  cols {c0}..{c1}  = {r1-r0}×{c1-c0} px')

    store = tifffile.imread(args.dsm, aszarr=True)
    z = zarr.open(store, mode='r')
    H, W = z.shape
    r0, c0 = max(0, r0), max(0, c0)
    r1, c1 = min(H, r1), min(W, c1)
    oh = (r1 - r0) // k
    ow = (c1 - c0) // k
    dsm = np.full((oh, ow), np.nan, dtype=np.float32)

    CH = 2048
    t1 = time.time()
    done = 0
    for rr in range(r0, r0 + oh * k, CH):
        for cc in range(c0, c0 + ow * k, CH):
            rh = min(CH, r0 + oh * k - rr)
            cw = min(CH, c0 + ow * k - cc)
            blk = np.asarray(z[rr:rr + rh, cc:cc + cw], dtype=np.float32)
            blk[(blk <= -1000) | (blk > 400)] = np.nan   # -9999 与 652 那个填充块
            small = block_reduce(blk, k)
            rr2 = (rr - r0) // k
            cc2 = (cc - c0) // k
            dsm[rr2:rr2 + small.shape[0], cc2:cc2 + small.shape[1]] = small
            done += blk.size
    print(f'读 DSM 完成 {done/1e6:.1f} Mpx  {time.time()-t1:.1f}s')

    valid = np.isfinite(dsm)
    print(f'有效像素 {valid.mean()*100:.1f}%  高程 {np.nanmin(dsm):.1f}~{np.nanmax(dsm):.1f} m')
    fill = np.where(valid, dsm, float(np.nanmedian(dsm)))   # 空洞用中位数填，别用最大值

    # ---- 地面估计：局部最低（窗口 ~35m）----
    # DSM 有立体匹配噪点（±3~8m 的散斑和孤立深坑），先中值平滑再取局部最低
    if args.median >= 3:
        fill = cv2.medianBlur(fill.astype(np.float32), args.median)
    gw = max(3, int(round(args.ground_win / step)) | 1)
    ground = cv2.erode(fill, np.ones((gw, gw), np.uint8))    # erode = 取最小值
    hag = fill - ground
    print(f'地面窗口 {gw}px ≈ {gw*step:.0f}m   高差 中位 {np.median(hag):.2f}  99% {np.percentile(hag,99):.2f}')

    mask = ((hag > args.min_h) & (hag < 60) & valid).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    min_px = max(4, int(round(args.min_area / (step * step))))
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_px]
    print(f'连通块 {n-1} 个 → 面积达标 {len(keep)} 个（≥{min_px}px = {args.min_area} m²）')

    # ---- 轮廓 → 经纬度 ----
    utm2geo = Transformer.from_crs('EPSG:32649', 'EPSG:4326', always_xy=True)
    out = []
    for i in keep:
        x, y, w, h, area = stats[i]
        sub = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
        cnts, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        c = max(cnts, key=cv2.contourArea)
        eps = max(0.8, 0.35 / step)                 # 简化容差 ≈ 0.35 m
        ap_ = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(ap_) < 3:
            continue
        poly = []
        for (px_, py_) in ap_:
            gx = c0 + (x + px_) * k
            gy = r0 + (y + py_) * k
            E = (cx - px / 2) + gx * px
            N = (cy + px / 2) - gy * px
            lon, lat = utm2geo.transform(E, N)
            poly.append([round(lon, 7), round(lat, 7)])
        hh = float(np.percentile(hag[y:y + h, x:x + w][sub > 0], 90))
        out.append({'p': poly, 'h': round(hh, 1), 'a': round(area * step * step, 1)})

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    hs = np.array([b['h'] for b in out]) if out else np.array([0])
    print(f'写出 {len(out)} 栋 → {args.out}  ({os.path.getsize(args.out)/1e6:.2f} MB)')
    print(f'高度 中位 {np.median(hs):.1f} m  90% {np.percentile(hs,90):.1f} m  最大 {hs.max():.1f} m')
    print(f'总耗时 {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
