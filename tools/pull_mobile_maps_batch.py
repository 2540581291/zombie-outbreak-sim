# -*- coding: utf-8 -*-
"""把手游包里 5 张内嵌地图（map01..map05）批量转成我们的城市数据。"""
import sys, os, io, re, json, zlib, base64, zipfile, math
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from PIL import Image
from collections import deque

APK = r"C:\Users\Administrator\Downloads\zombie-sim-1-6-4.apk"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALUE_MAP = {0: 0x00, 3: 0x03, 7: 0x07, 15: 0x0f, 22: 0x16, 31: 0x1f, 66: 0x42, 35: 0x43}
METER_PER_PX = 0.11
ZOOM = 20          # 用最高缩放级别拼图

zf = zipfile.ZipFile(APK)


def tiles_of(mid):
    out = {}
    for i in zf.infolist():
        m = re.match(r"assets/images/maps/(map\d+)/tile_(\d+)_(\d+)_(\d+)\.jpg", i.filename)
        if m and m.group(1) == mid and int(m.group(2)) == ZOOM:
            out[(int(m.group(3)), int(m.group(4)))] = i.filename
    return out


def stitch(mid):
    t = tiles_of(mid)
    xs = [k[0] for k in t]; ys = [k[1] for k in t]
    nx, ny = max(xs) + 1, max(ys) + 1
    one = Image.open(io.BytesIO(zf.read(next(iter(t.values())))))
    tw, th = one.size
    img = Image.new("RGB", (nx * tw, ny * th))
    # 文件名是 tile_<zoom>_<行>_<列>：第一个数字是 y（行），第二个是 x（列）。
    # 之前按 (x, y) 贴，整张图被转置了 —— 用 z16 缩略图做模板比对，transpose
    # 的相关性 0.225 明显高于原样 0.073，据此确认行列写反。
    for (a, b), name in t.items():
        x, y = b, a
        img.paste(Image.open(io.BytesIO(zf.read(name))), (x * tw, y * th))
    return img


def collision(mid):
    raw = zlib.decompress(zf.read(f"assets/data/collision_layer_{mid}.cl"))
    g = int(round(math.isqrt(len(raw))))
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(g, g)[::-1]   # 引擎 row0 = 南，影像 row0 = 北 → 必须翻
    out = np.zeros_like(arr)
    for k, v in VALUE_MAP.items():
        out[arr == k] = v
    return out


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


for mid in ("map01", "map02", "map03", "map04", "map05"):
    img = stitch(mid)
    grid = collision(mid)
    n = grid.shape[0]
    cell = (img.size[0] / n) * METER_PER_PX
    world = n * cell
    bl = buildings_of(grid, cell, world)
    outp = os.path.join(ROOT, "data", "cities", mid)
    os.makedirs(outp, exist_ok=True)
    img.save(os.path.join(outp, "sat.jpg"), quality=90)
    half_lon = (world / 2) / 111320.0
    half_lat = (world / 2) / 110540.0
    city = {"name": mid.upper(), "size": [round(world, 1), round(world, 1)], "cell": round(cell, 4),
            "origin": [0.0, 0.0], "bbox": [-half_lat, -half_lon, half_lat, half_lon],
            "buildings": bl, "roads": [], "pois": [], "entrances": [], "water": [],
            "collision": {"cell": round(cell, 4), "cols": n, "rows": n,
                          "b64": base64.b64encode(zlib.compress(grid.tobytes(), 9)).decode()}}
    io.open(os.path.join(outp, "city.json"), "w", encoding="utf-8").write(json.dumps(city, ensure_ascii=False, separators=(",", ":")))
    meta = {"provider": "mobile-original", "image": "sat.jpg", "size": list(img.size),
            "cell": img.size[0] / n, "citySize": [world, world],
            "bounds": [-half_lon, -half_lat, half_lon, half_lat]}
    io.open(os.path.join(outp, "sat.json"), "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=1))
    img.resize((420, 420), Image.LANCZOS).save(os.path.join(ROOT, "shots", f"mob_{mid}.jpg"), quality=85)
    print(f"{mid}: 图 {img.size} 格 {n}x{n} cell={cell:.3f}m 世界 {world:.0f}m 建筑 {len(bl)} 栋")
