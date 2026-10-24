# -*- coding: utf-8 -*-
"""把原版 Leicester 地图（324 张拼好的 4608² 影像 + 1152² 碰撞表）装成我们的 city.json。"""
import sys, io, os, json, zlib, base64, collections
sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image
import numpy as np
from collections import deque

SRC_BIN = "reference/core/binaryData/355_src._ov276__rr255.bin"
OUT = "data/cities/leicester"
COLS = ROWS = 1152
CELL = 4 * 0.11                 # 4 px × 0.11 m/px = 0.44 m
WORLD = COLS * CELL             # 506.88 m
os.makedirs(OUT, exist_ok=True)

# ---------- 1. 拼好的影像 ----------
if not os.path.exists(f"{OUT}/sat.jpg"):
    Image.open("shots/leicester_full.jpg").save(f"{OUT}/sat.jpg", quality=88)
meta = {
    "provider": "original-2009",
    "image": "sat.jpg",
    "size": [4608, 4608],
    "cell": 4,
    "citySize": [WORLD, WORLD],
    "note": "From Zombie Outbreak Simulator 2009 (Leicester), 324 tiles x 256px stitched, 4px/cell",
}
io.open(f"{OUT}/sat.json", "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=1))
print("sat.jpg + sat.json 就绪", flush=True)

# ---------- 2. 碰撞表：原版值 → 我们的值 ----------
raw = zlib.decompress(open(SRC_BIN, "rb").read())
assert len(raw) == COLS * ROWS, len(raw)
MAP = {0: 0x00, 3: 0x03, 7: 0x07, 15: 0x0f, 22: 0x16, 31: 0x1f, 66: 0x42, 35: 0x43}
grid = bytearray(COLS * ROWS)
for i, v in enumerate(raw):
    grid[i] = MAP.get(v, 0x00)
cnt = collections.Counter(grid)
print("碰撞值分布:", {f"0x{k:02x}": v for k, v in cnt.most_common(8)}, flush=True)
b64 = base64.b64encode(zlib.compress(bytes(grid), 9)).decode()

# ---------- 3. 从"室内"格合成建筑（给 POI 生成和 3D 用）----------
inside = np.frombuffer(bytes(grid), dtype=np.uint8).reshape(ROWS, COLS) & 0x1F == 0x1F
buildings = []
seen = np.zeros((ROWS, COLS), dtype=bool)
for r in range(0, ROWS):
    for c in range(COLS):
        if not inside[r, c] or seen[r, c]:
            continue
        q = deque([(r, c)]); seen[r, c] = True
        cells = []
        while q:
            y, x = q.popleft(); cells.append((y, x))
            for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                ny, nx = y+dy, x+dx
                if 0 <= ny < ROWS and 0 <= nx < COLS and inside[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; q.append((ny, nx))
        if len(cells) < 25:       # 小于 25 格（≈5 m²）当噪点
            continue
        ys = [p[0] for p in cells]; xs = [p[1] for p in cells]
        r0, r1, c0, c1 = min(ys), max(ys), min(xs), max(xs)
        # 网格 → 世界坐标（z 向上：z = halfH - row*cell）
        half = WORLD / 2
        x0 = c0 * CELL - half; x1 = (c1 + 1) * CELL - half
        z0 = half - (r1 + 1) * CELL; z1 = half - r0 * CELL
        buildings.append({"p": [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
                          "h": 7.0, "a": len(cells) * CELL * CELL})
print("合成建筑", len(buildings), "栋", flush=True)

city = {
    "name": "Leicester",
    "size": [WORLD, WORLD],
    "cell": CELL,
    "buildings": buildings,
    "roads": [],
    "pois": [],
    "entrances": [],
    "water": [],
    "collision": {"cell": CELL, "cols": COLS, "rows": ROWS, "b64": b64},
}
io.open(f"{OUT}/city.json", "w", encoding="utf-8").write(json.dumps(city, ensure_ascii=False, separators=(",", ":")))
print(f"city.json {os.path.getsize(OUT + '/city.json')/1048576:.1f} MB, 世界 {WORLD:.1f}m, 格 {CELL}m", flush=True)
