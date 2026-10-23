#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 卫星影像烘焙
按 city.json 的 bbox 下载瓦片、拼成一张大图，输出 data/sat.jpg + data/sat.json

用法:
  python fetch_sat.py                       # 默认 Esri World Imagery，z 自动
  python fetch_sat.py --zoom 17
  python fetch_sat.py --provider google     # 备用
"""
import argparse, json, math, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

TILE = 256
MAX_PX = 4096  # 单张纹理上限

PROVIDERS = {
    "esri": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "google": "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) zos-remake-personal",
      "Referer": "http://127.0.0.1:8777/"}


def lonlat_to_pixel(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def pixel_to_lonlat(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def pick_zoom(west, south, east, north, lat0):
    """选一个让拼接后长边 <= MAX_PX 的最大缩放级别"""
    for z in range(19, 10, -1):
        x0, y0 = lonlat_to_pixel(west, north, z)
        x1, y1 = lonlat_to_pixel(east, south, z)
        w = (int(x1) - int(x0) + 1) * TILE
        h = (int(y1) - int(y0) + 1) * TILE
        if max(w, h) <= MAX_PX:
            return z, w, h
    return 11, 0, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=None)
    ap.add_argument("--citydir", default="data", help="城市数据目录，如 data/cities/tokyo")
    ap.add_argument("--provider", default="esri", choices=list(PROVIDERS.keys()))
    ap.add_argument("--zoom", type=int, default=0)
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--url", default="", help="自定义图源 URL 模板，含 {z}/{x}/{y}，例如 https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}")
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    city_path = args.city or os.path.join(args.citydir, "city.json")
    city = json.load(open(city_path, encoding="utf-8"))

    if "bbox" not in city:
        print("[x] city.json 里没有 bbox，无法定位卫星影像")
        return 1
    minlat, minlon, maxlat, maxlon = city["bbox"]
    lon0, lat0 = city["origin"]

    # 略微外扩，避免边界处出现黑边
    pad = 0.0008
    west, east = minlon - pad, maxlon + pad
    south, north = minlat - pad, maxlat + pad

    if args.url:
        PROVIDERS[args.provider] = args.url
    if args.zoom:
        z = args.zoom
        x0, y0 = lonlat_to_pixel(west, north, z)
        x1, y1 = lonlat_to_pixel(east, south, z)
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    else:
        z, _, _ = pick_zoom(west, south, east, north, lat0)
        x0, y0 = lonlat_to_pixel(west, north, z)
        x1, y1 = lonlat_to_pixel(east, south, z)
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)

    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    W, H = cols * TILE, rows * TILE
    print(f"[1/3] 缩放 z={z}  瓦片 {cols}×{rows} = {cols*rows} 张  拼图 {W}×{H}", flush=True)
    if max(W, H) > MAX_PX:
        print(f"      [!] 超过 {MAX_PX}px，显卡可能吃不下，建议 --zoom {z-1}")

    url_t = PROVIDERS[args.provider]
    sess = requests.Session()
    sess.headers.update(UA)

    canvas = Image.new("RGB", (W, H), (18, 20, 24))
    ok = fail = 0
    t0 = time.time()

    def fetch(tx, ty):
        u = url_t.format(z=z, x=tx, y=ty)
        for attempt in range(3):
            try:
                r = sess.get(u, timeout=30)
                if r.status_code == 200 and len(r.content) > 500:
                    return tx, ty, Image.open(__import__("io").BytesIO(r.content)).convert("RGB")
            except Exception:
                pass
            time.sleep(0.4 * (attempt + 1))
        return tx, ty, None

    jobs = [(x0 + i, y0 + j) for j in range(rows) for i in range(cols)]
    done = 0
    with ThreadPoolExecutor(max_workers=args.threads) as ex:
        futs = [ex.submit(fetch, tx, ty) for tx, ty in jobs]
        for f in as_completed(futs):
            tx, ty, im = f.result()
            done += 1
            if im is None:
                fail += 1
            else:
                ok += 1
                canvas.paste(im, ((tx - x0) * TILE, (ty - y0) * TILE))
            if done % 25 == 0 or done == len(jobs):
                print(f"      {done}/{len(jobs)}  ok={ok} fail={fail}  {time.time()-t0:.0f}s", flush=True)

    # 图像覆盖的经纬度范围（瓦片边界，不是 bbox）
    img_w = pixel_to_lonlat(x0, y0, z)
    img_e = pixel_to_lonlat(x1 + 1, y1 + 1, z)
    bounds = [round(img_w[0], 6), round(img_e[1], 6), round(img_e[0], 6), round(img_w[1], 6)]  # W,S,E,N

    outdir = args.citydir
    os.makedirs(outdir, exist_ok=True)
    img_path = os.path.join(outdir, "sat.jpg")
    canvas.save(img_path, "JPEG", quality=88, optimize=True)
    mb = os.path.getsize(img_path) / 1e6

    meta = {
        "provider": args.provider,
        "zoom": z,
        "tile": TILE,
        "image": "sat.jpg",
        "size": [W, H],
        "bounds": bounds,          # [west, south, east, north]
        "tiles": [x0, y0, x1, y1],
        "origin": city["origin"],  # 与 city.json 同一原点，便于前端换算
        "citySize": city["size"],
    }
    with open(os.path.join(args.citydir, "sat.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    print(f"[2/3] 写出 {img_path}  {mb:.2f} MB  ({W}×{H})", flush=True)
    print(f"[3/3] 写出 data/sat.json  bounds={bounds}  provider={args.provider} z={z}", flush=True)
    if fail:
        print(f"      [!] {fail} 张瓦片失败（会显示为深色底）", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
