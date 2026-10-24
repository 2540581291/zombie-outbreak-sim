# -*- coding: utf-8 -*-
"""
从原版 2009《Zombie Outbreak Simulator》（Leicester 地图）拉取影像与碰撞表，
装成我们引擎能直接读的 data/cities/leicester/。

原版资源（reference/core/ 下）：
  images/*.jpg            324 张 256x256 的航拍瓦片（文件名是资源 id，不含坐标）
  images/316.jpg          250x250 的整图缩略图 —— **用它来定瓦片顺序**
  binaryData/355_src._ov276__rr255.bin
                          zlib 压缩的碰撞表：1152x1152，4px/格，值 0/3/7/15/22/31/66/35

做法：
  1) 把缩略图缩放到 288x288（= 18x18 个 16x16 单元），每张瓦片也缩到 16x16 灰度，
     做归一化互相关，取最相似的位置 → 得到每张瓦片的 (row, col)
  2) 按这个顺序拼成 4608x4608 的图
  3) 碰撞表按值映射到我们的位域，并**上下翻转**（影像第 0 行是北，引擎 row 0 是南）
  4) 从"室内"格做连通域，合成矩形建筑（给 POI 生成和 3D 用）
  5) 写出 city.json / sat.jpg / sat.json

用法：
  python tools/pull_original_map.py            # 生成到 data/cities/leicester
  python tools/pull_original_map.py --check    # 只校验，不写文件
"""
import sys, os, io, re, json, zlib, base64, argparse
from collections import deque

sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "reference", "core", "images")
BIN = os.path.join(ROOT, "reference", "core", "binaryData", "355_src._ov276__rr255.bin")
MINI = os.path.join(IMG, "316.jpg")
OUT = os.path.join(ROOT, "data", "cities", "leicester")

S = 18                      # 18x18 = 324 张瓦片
P = 16                      # 缩略图上每张瓦片占 16x16
PX = 256                    # 瓦片边长
CELL = 4 * 0.11             # 4px × 0.11m/px = 0.44m
VALUE_MAP = {0: 0x00, 3: 0x03, 7: 0x07, 15: 0x0f, 22: 0x16, 31: 0x1f, 66: 0x42, 35: 0x43}


def load_tiles():
    tiles = []
    for p in os.listdir(IMG):
        if not p.lower().endswith(".jpg"):
            continue
        m = re.match(r"(\d+)", p)
        if not m:
            continue
        try:
            im = Image.open(os.path.join(IMG, p))
        except Exception:
            continue
        if im.size == (PX, PX):
            tiles.append((int(m.group(1)), os.path.join(IMG, p)))
    tiles.sort()
    return tiles


def place_tiles(tiles):
    """用缩略图做模板，给每张瓦片定位。返回 (顺序数组, 最高相似度)"""
    mini = Image.open(MINI).convert("L").resize((S * P, S * P), Image.LANCZOS)
    M = np.asarray(mini, dtype=np.float32)
    T = np.zeros((len(tiles), P * P), dtype=np.float32)
    for i, (_, path) in enumerate(tiles):
        a = np.asarray(Image.open(path).convert("L").resize((P, P), Image.LANCZOS), dtype=np.float32)
        T[i] = ((a - a.mean()) / (a.std() + 1e-6)).reshape(-1)
    B = np.zeros((S * S, P * P), dtype=np.float32)
    for r in range(S):
        for c in range(S):
            a = M[r * P:(r + 1) * P, c * P:(c + 1) * P]
            B[r * S + c] = ((a - a.mean()) / (a.std() + 1e-6)).reshape(-1)
    Sc = T @ B.T
    assign = np.full(len(tiles), -1, dtype=np.int32)
    used = np.zeros(S * S, dtype=bool)
    s2 = Sc.copy()
    for _ in range(len(tiles)):
        f = int(np.argmax(s2))
        ti, pj = divmod(f, S * S)
        assign[ti] = pj
        used[pj] = True
        s2[ti, :] = -9e9
        s2[:, pj] = -9e9
    return assign, float(Sc.max())


def stitch(tiles, assign):
    canvas = Image.new("RGB", (S * PX, S * PX))
    for ti, (_, path) in enumerate(tiles):
        r, c = divmod(int(assign[ti]), S)
        canvas.paste(Image.open(path), (c * PX, r * PX))
    return canvas


def convert_collision():
    raw = zlib.decompress(open(BIN, "rb").read())
    assert len(raw) == 1152 * 1152, len(raw)
    g = np.frombuffer(raw, dtype=np.uint8).reshape(1152, 1152)[::-1]   # 上下翻转
    grid = np.zeros_like(g)
    for k, v in VALUE_MAP.items():
        grid[g == k] = v
    return grid


def make_buildings(grid):
    inside = (grid & 0x1f) == 0x1f
    R = C = 1152
    half = R * CELL / 2
    seen = np.zeros_like(inside)
    out = []
    for r in range(R):
        for c in range(C):
            if not inside[r, c] or seen[r, c]:
                continue
            q = deque([(r, c)])
            seen[r, c] = True
            cells = []
            while q:
                y, x = q.popleft()
                cells.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < R and 0 <= nx < C and inside[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(cells) < 25:
                continue
            ys = [p[0] for p in cells]
            xs = [p[1] for p in cells]
            r0, r1, c0, c1 = min(ys), max(ys), min(xs), max(xs)
            x0 = c0 * CELL - half
            x1 = (c1 + 1) * CELL - half
            z0 = half - (r1 + 1) * CELL
            z1 = half - r0 * CELL
            out.append({"p": [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
                        "h": 7.0, "a": len(cells) * CELL * CELL})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    tiles = load_tiles()
    print(f"瓦片 {len(tiles)} 张（期望 {S*S}）")
    assert len(tiles) == S * S

    assign, best = place_tiles(tiles)
    print(f"缩略图定位完成，最高相似度 {best:.1f}")

    canvas = stitch(tiles, assign)
    grid = convert_collision()
    buildings = make_buildings(grid)
    import collections
    cnt = collections.Counter(grid.ravel())
    print("碰撞值分布:", {f"0x{k:02x}": int(v) for k, v in cnt.most_common(8)})
    print(f"图 {canvas.size}，建筑 {len(buildings)} 栋，格 {CELL}m，世界 {1152*CELL:.1f}m")

    if args.check:
        return
    os.makedirs(OUT, exist_ok=True)
    canvas.save(os.path.join(OUT, "sat.jpg"), quality=90)
    world = 1152 * CELL
    meta = {"provider": "original-2009", "image": "sat.jpg", "size": [S * PX, S * PX],
            "cell": 4, "citySize": [world, world],
            "note": "Zombie Outbreak Simulator 2009 (Leicester): 324 tiles stitched via minimap"}
    io.open(os.path.join(OUT, "sat.json"), "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=1))
    half_lon = (world / 2) / 111320.0
    half_lat = (world / 2) / 110540.0
    city = {
        "name": "Leicester",
        "size": [world, world],
        "cell": CELL,
        "origin": [0.0, 0.0],
        "bbox": [-half_lat, -half_lon, half_lat, half_lon],
        "buildings": buildings,
        "roads": [], "pois": [], "entrances": [], "water": [],
        "collision": {"cell": CELL, "cols": 1152, "rows": 1152,
                      "b64": base64.b64encode(zlib.compress(grid.tobytes(), 9)).decode()},
    }
    io.open(os.path.join(OUT, "city.json"), "w", encoding="utf-8").write(json.dumps(city, ensure_ascii=False, separators=(",", ":")))
    print("已写出:", OUT)


if __name__ == "__main__":
    main()
