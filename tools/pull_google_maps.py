# -*- coding: utf-8 -*-
"""
把原版 15 张 Google 地图做成可玩城市：
  碰撞表来自 APK 的 assets/data/collision_layer_<id>.cl
  位置来自 3DS MapConfig 的 worldX/worldY（z20 Web Mercator 像素，世界宽 2^28）
  影像来自 Esri World Imagery（公开瓦片，无需 key）

用法：
  python tools/pull_google_maps.py --list
  python tools/pull_google_maps.py --id 17
  python tools/pull_google_maps.py --all
"""
import sys, os, io, re, json, math, zlib, base64, time, argparse, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from PIL import Image
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK = r"C:\Users\Administrator\Downloads\zombie-sim-1-6-4.apk"
CFG = os.path.join(ROOT, "reference", "zos3ds", "ZOS-3DS-main", "3DS Files",
                   "source", "game", "mapconfigs_data.cpp")
VALUE_MAP = {0: 0x00, 3: 0x03, 7: 0x07, 15: 0x0f, 22: 0x16, 31: 0x1f, 66: 0x42, 35: 0x43}
TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = "ZOS-R-map-import/1.0 (local research)"
N28 = float(2 ** 28)
TILE = 256


def parse_config():
    src = io.open(CFG, encoding="utf-8").read()
    out = []
    for b in src.split("m = new MapConfig();")[1:]:
        def g(k, cast=float):
            m = re.search(r"m->" + k + r" = ([^;]+);", b)
            return cast(m.group(1).rstrip("f")) if m else None
        out.append({"id": g("id", int), "type": g("type", str) or "",
                    "worldX": g("worldX", int), "worldY": g("worldY", int),
                    "width": g("width", int), "height": g("height", int),
                    "startX": g("startX", int), "startY": g("startY", int)})
    return [m for m in out if "Google" in m["type"]]


def merc_to_lonlat(x, y):
    lon = x / N28 * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / N28))))
    return lon, lat


def lonlat_to_merc(lon, lat):
    x = (lon + 180) / 360 * N28
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N28
    return x, y


def load_collision(cid):
    import zipfile
    zf = zipfile.ZipFile(APK)
    raw = zlib.decompress(zf.read(f"assets/data/collision_layer_{cid}.cl"))
    n = int(round(math.isqrt(len(raw))))
    assert n * n == len(raw), len(raw)
    g = np.frombuffer(raw, dtype=np.uint8).reshape(n, n)[::-1]
    out = np.zeros_like(g)
    for k, v in VALUE_MAP.items():
        out[g == k] = v
    return out


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print("    ! 失败", url.split("/")[-3:], e)
                return None
            time.sleep(1.0 + i)


def build_image(m, grid_n, z):
    """按 z20 像素框拉 Esri 瓦片，拼成 width×height 的图"""
    x0, y0 = m["worldX"], m["worldY"]
    x1, y1 = x0 + m["width"] * N28 / 2 ** 20 * 0 + m["width"], y0 + m["height"]   # 原点已是 z20 px
    # 当前 zoom 下的瓦片范围
    tx0, ty0 = x0 / 2 ** (20 - z) / TILE, y0 / 2 ** (20 - z) / TILE
    tx1, ty1 = (x1 - 1) / 2 ** (20 - z) / TILE, (y1 - 1) / 2 ** (20 - z) / TILE
    ax, ay = int(math.floor(tx0)), int(math.floor(ty0))
    bx, by = int(math.floor(tx1)), int(math.floor(ty1))
    cols, rows = bx - ax + 1, by - ay + 1
    canvas = Image.new("RGB", (cols * TILE, rows * TILE), (30, 30, 30))
    got = 0
    for ty in range(ay, by + 1):
        for tx in range(ax, bx + 1):
            data = fetch(TILE_URL.format(z=z, x=tx, y=ty))
            if not data:
                continue
            try:
                im = Image.open(io.BytesIO(data)).convert("RGB")
                canvas.paste(im, ((tx - ax) * TILE, (ty - ay) * TILE))
                got += 1
            except Exception:
                pass
            time.sleep(0.05)
    print(f"    瓦片 {got}/{cols*rows}  @z{z}")
    # 从拼好的大图里裁出地图范围，再缩放到目标分辨率
    scale = 2 ** (20 - z)
    left = x0 / scale - ax * TILE
    top = y0 / scale - ay * TILE
    right = left + m["width"] / scale
    bottom = top + m["height"] / scale
    crop = canvas.crop((int(round(left)), int(round(top)), int(round(right)), int(round(bottom))))
    return crop.resize((m["width"], m["height"]), Image.LANCZOS)


def buildings_of(grid, cell, world):
    inside = (grid & 0x1f) == 0x1f
    n = grid.shape[0]
    seen = np.zeros_like(inside)
    half = world / 2
    out = []
    for r in range(n):
        for c in range(n):
            if not inside[r, c] or seen[r, c]:
                continue
            q = deque([(r, c)]); seen[r, c] = True; cells = []
            while q:
                y, x = q.popleft(); cells.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < n and 0 <= nx < n and inside[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            if len(cells) < 25:
                continue
            ys = [p[0] for p in cells]; xs = [p[1] for p in cells]
            r0, r1, c0, c1 = min(ys), max(ys), min(xs), max(xs)
            x0 = c0 * cell - half; x1 = (c1 + 1) * cell - half
            z0 = half - (r1 + 1) * cell; z1 = half - r0 * cell
            out.append({"p": [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
                        "h": 7.0, "a": len(cells) * cell * cell})
    return out


NAMES = {
    17: "珀斯（澳大利亚）", 752: "广岛（日本）", 11171: "斯托克顿堡（美国）",
    13021: "迈阿密（美国）", 14016: "德班（南非）", 15961: "基尔（德国）",
    56601: "桑托斯（巴西）", 66032: "萨尔瓦多（巴西）", 79478: "里贾纳（加拿大）",
    79818: "萨尔茨堡（奥地利）", 85014: "里贾纳东（加拿大）", 94544: "吕伐登（荷兰）",
    111850: "耶莱尼亚古拉（波兰）", 114009: "碧瑶（菲律宾）", 115885: "泽西城（美国）",
}


def do_one(m, z=19):
    cid = f"g{m['id']}"
    grid = load_collision(m["id"])
    n = grid.shape[0]
    lon, lat = merc_to_lonlat(m["worldX"], m["worldY"])
    # 真实米制：z20 一个像素的米数
    mpp = 156543.03392 * math.cos(math.radians(lat)) / 2 ** 20
    world = m["width"] * mpp
    cell = world / n
    print(f"  {cid}: {m['width']}x{m['height']}px, 格 {n}x{n}, cell={cell:.3f}m, 世界 {world:.0f}m, 起点 {lat:.3f},{lon:.3f}")
    img = build_image(m, n, z)
    bl = buildings_of(grid, cell, world)
    outp = os.path.join(ROOT, "data", "cities", cid)
    os.makedirs(outp, exist_ok=True)
    img.save(os.path.join(outp, "sat.jpg"), quality=90)
    # 左下角经纬度（引擎用 origin+bbox 定位贴图）
    lon2, lat2 = merc_to_lonlat(m["worldX"], m["worldY"] + m["height"])
    city = {"name": NAMES.get(m["id"], cid),
            "size": [round(world, 1), round(world, 1)], "cell": round(cell, 4),
            "origin": [lon, lat],
            "bbox": [lat2, lon, lat, lon2],      # minLat,minLon,maxLat,maxLon
            "buildings": bl, "roads": [], "pois": [], "entrances": [], "water": [],
            "collision": {"cell": round(cell, 4), "cols": n, "rows": n,
                          "b64": base64.b64encode(zlib.compress(grid.tobytes(), 9)).decode()}}
    io.open(os.path.join(outp, "city.json"), "w", encoding="utf-8").write(
        json.dumps(city, ensure_ascii=False, separators=(",", ":")))
    meta = {"provider": "esri-world-imagery", "image": "sat.jpg", "size": list(img.size),
            "cell": m["width"] / n, "citySize": [world, world],
            "bounds": [lon, lat2, lon2, lat]}
    io.open(os.path.join(outp, "sat.json"), "w", encoding="utf-8").write(
        json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"    → {outp}  建筑 {len(bl)} 栋")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--id", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--zoom", type=int, default=19)
    a = ap.parse_args()
    maps = parse_config()
    if a.list:
        for m in maps:
            lon, lat = merc_to_lonlat(m["worldX"], m["worldY"])
            print(f"  {m['id']:>7}  {lat:8.3f} {lon:9.3f}  {m['width']}x{m['height']}")
        return
    todo = maps if a.all else [m for m in maps if m["id"] == a.id]
    if not todo:
        sys.exit("没找到该 id")
    for m in todo:
        do_one(m, a.zoom)


if __name__ == "__main__":
    main()
