#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把航测正射（RGBA，带镂空）烘成项目里的一座城：
     sat.jpg      颜色（JPEG，无 alpha）
     sat_mask.png 覆盖遮罩（灰度，1/2 分辨率）
     sat.json     元数据（image / mask / bounds / size）
   并顺手把碰撞层里"没被航测覆盖"的格子刷成不可走。
"""
import argparse, base64, json, math, os, sys, zlib
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
R = 40075016.68557849          # Web Mercator 赤道周长


def lon2x(lon): return lon * R / 360.0
def lat2y(lat): return math.log(math.tan((90 + lat) * math.pi / 360.0)) * R / math.pi


def read_pgw(path):
    v = [float(x) for x in open(path).read().split()]
    # A D B E C F  (C,F) = 左上像素中心
    return dict(A=v[0], D=v[1], B=v[2], E=v[3], C=v[4], F=v[5])


def crop_merc(src, gw, lo_w, lo_s, lo_e, lo_n):
    """在 3857 坐标系里把 [w,s,e,n] 那块裁出来（返回 PIL 图）"""
    A, C, F = gw['A'], gw['C'], gw['F']
    left = C - A / 2.0
    top = F + A / 2.0                      # E = -A
    x0, x1 = lon2x(lo_w), lon2x(lo_e)
    y0, y1 = lat2y(lo_n), lat2y(lo_s)      # 北在上
    px0 = (x0 - left) / A
    px1 = (x1 - left) / A
    py0 = (top - y0) / A
    py1 = (top - y1) / A
    W, H = src.size
    px0 = max(0, min(W - 1, px0)); px1 = max(0, min(W, px1))
    py0 = max(0, min(H - 1, py0)); py1 = max(0, min(H, py1))
    return src.crop((int(math.floor(px0)), int(math.floor(py0)),
                     int(math.ceil(px1)), int(math.ceil(py1))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--city', required=True, help='data/cities/<id>')
    ap.add_argument('--mosaic', required=True, help='RGBA 正射图（带 .pgw）')
    ap.add_argument('--width', type=int, default=16384, help='底图宽度像素')
    ap.add_argument('--mask-div', type=int, default=2, help='遮罩相对底图的缩小倍数')
    ap.add_argument('--jpeg-quality', type=int, default=88)
    ap.add_argument('--skip-sat', action='store_true', help='底图已生成，只重刷碰撞遮罩')
    args = ap.parse_args()

    cdir = os.path.join(os.path.dirname(__file__), '..', 'data', 'cities', args.city)
    cdir = os.path.abspath(cdir)
    cj = json.load(open(os.path.join(cdir, 'city.json'), encoding='utf-8'))
    s, w, n, e = cj['bbox']          # bbox = [minlat, minlon, maxlat, maxlon]

    if args.skip_sat and os.path.exists(os.path.join(cdir, 'sat_mask.png')):
        mask = Image.open(os.path.join(cdir, 'sat_mask.png')).convert('L')
        print(f'[{args.city}] 跳过底图生成，复用 sat_mask.png {mask.size}')
        img = None
    else:
        src = Image.open(args.mosaic).convert('RGBA')
        gw = read_pgw(args.mosaic.rsplit('.', 1)[0] + '.pgw')
        part = crop_merc(src, gw, w, s, e, n)
        img = True

    # 按城市长宽比定尺寸
    cw, ch = cj['size']
    W = args.width
    H = max(64, int(round(W * ch / cw)))
    md = max(1, args.mask_div)
    if img is not None:
        print(f'[{args.city}] 裁切 {part.size} → 输出 {W}×{H}  ({cw:.0f}×{ch:.0f} m)')
        img = part.resize((W, H), Image.LANCZOS)
        rgb = img.convert('RGB')
        rgb.save(os.path.join(cdir, 'sat.jpg'), quality=args.jpeg_quality, optimize=True,
                 progressive=True)
        mask = img.getchannel('A').resize((max(1, W // md), max(1, H // md)), Image.BOX)
        m = np.asarray(mask)
        m = np.where(m > 110, 255, 0).astype(np.uint8)
        Image.fromarray(m, 'L').save(os.path.join(cdir, 'sat_mask.png'), optimize=True)
    else:
        m = np.asarray(mask)
        m = np.where(m > 110, 255, 0).astype(np.uint8)

    meta = {
        'provider': 'drone',
        'image': 'sat.jpg',
        'mask': 'sat_mask.png',
        'maskDiv': md,
        'size': [W, H],
        'bounds': [w, s, e, n],
        'origin': cj['origin'],
        'citySize': [cw, ch],
        'note': 'DJI Terra 正射 TDOM，0.079 m/px 原图；alpha 镂空 = 未测绘区域',
    }
    json.dump(meta, open(os.path.join(cdir, 'sat.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # ---- 碰撞层：把航测范围外的格子刷成墙 ----
    col = cj['collision']
    raw = bytearray(zlib.decompress(base64.b64decode(col['b64'])))
    cols, rows, cell = col['cols'], col['rows'], col['cell']
    halfW, halfH = cols * cell / 2.0, rows * cell / 2.0
    lon0, lat0 = cj['origin']
    kx = math.cos(math.radians(lat0)) * 111320.0
    ky = 110540.0
    mh, mw = m.shape
    blocked = 0
    for r in range(rows):
        cy = halfH - (r + 0.5) * cell
        lat = lat0 - cy / ky
        my = int((n - lat) / (n - s) * mh) if n != s else 0
        if my < 0 or my >= mh:
            base = r * cols
            for c in range(cols):
                if raw[base + c] & 1:
                    raw[base + c] = 0x00; blocked += 1
            continue
        row = m[my]
        base = r * cols
        for c in range(cols):
            cx = (c + 0.5) * cell - halfW
            lon = lon0 + cx / kx
            mx = int((lon - w) / (e - w) * mw) if e != w else 0
            if mx < 0 or mx >= mw or row[mx] < 128:
                if raw[base + c] & 1:
                    raw[base + c] = 0x00; blocked += 1
    col['b64'] = base64.b64encode(zlib.compress(bytes(raw), 9)).decode('ascii')
    cj['validArea'] = {'mask': 'sat_mask.png', 'div': md}
    json.dump(cj, open(os.path.join(cdir, 'city.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))

    tot = cols * rows
    print(f'  遮罩 {mw}×{mh}  碰撞层 {cols}×{rows}：刷掉 {blocked:,} 格 '
          f'({blocked*100/tot:.1f}%)  可走 {tot-blocked:,}')
    print(f'  sat.jpg {os.path.getsize(os.path.join(cdir,"sat.jpg"))/1e6:.1f} MB  '
          f'mask {os.path.getsize(os.path.join(cdir,"sat_mask.png"))/1e6:.2f} MB')


if __name__ == '__main__':
    main()
