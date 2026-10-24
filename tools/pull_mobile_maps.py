# -*- coding: utf-8 -*-
"""
从手游版（APK / IPA / 已解包的资源目录）里提取"内嵌地图"，装成我们的城市格式。

背景：3DS 移植版的 MapConfigFactory 数据显示，原版共有 20 张官方图：
  15 张 Google（运行时联网拉瓦片，拿不到）
   5 张 Embedded（买断影像，4096x4096，**就在安装包里**）
我们目前只有莱斯特那 5 张里的 1 张（来自 Flash SWF）。剩下的要从手游包里挖。

用法：
  # 1) 先看看包里有什么（不写盘）
  python tools/pull_mobile_maps.py scan reference/mobile/zos.apk

  # 2) 认出地图后，逐张转换（--map 指定大图在包内的路径，--bin 指定碰撞表）
  python tools/pull_mobile_maps.py convert reference/mobile/zos.apk \
      --map assets/maps/2/map.jpg --bin assets/maps/2/collision.bin --id london --name "英国 · 伦敦"

包内布局未知，所以 scan 模式会把"看起来像地图的条目"全列出来：
  · 图片：边长 >= 1024 且为正方形（4096x4096 的最可疑）
  · 二进制：解压/未解压后长度是完全平方数（1152²/2048²/4096² 之类）
"""
import sys, os, io, re, json, zlib, base64, zipfile, argparse, math

sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALUE_MAP = {0: 0x00, 3: 0x03, 7: 0x07, 15: 0x0f, 22: 0x16, 31: 0x1f, 66: 0x42, 35: 0x43}
METER_PER_PX = 0.11


def scan(path):
    if not zipfile.is_zipfile(path):
        print("不是 zip/apk：", path)
        return
    zf = zipfile.ZipFile(path)
    print(f"包内条目 {len(zf.namelist())} 个")
    print("\n[可疑图片] 正方形且边长 >= 1024：")
    for info in zf.infolist():
        n = info.filename.lower()
        if not n.endswith((".jpg", ".jpeg", ".png")):
            continue
        if info.file_size < 200_000:
            continue
        try:
            with zf.open(info) as f:
                im = Image.open(io.BytesIO(f.read()))
                w, h = im.size
            if w == h and w >= 1024:
                print(f"  {info.filename}  {w}x{h}  {info.file_size/1048576:.1f} MB")
        except Exception:
            pass
    print("\n[可疑二进制] 长度是完全平方数（碰撞表的特征）：")
    for info in zf.infolist():
        if info.file_size < 100_000:
            continue
        data = zf.read(info)
        for raw, tag in ((data, "raw"), (None, "")):
            if raw is None:
                try:
                    raw = zlib.decompress(data)
                    tag = "zlib"
                except Exception:
                    break
            n = len(raw)
            r = int(round(math.isqrt(n)))
            if r * r == n and 256 <= r <= 8192:
                print(f"  {info.filename}  {tag}  {r}x{r}  ({n} 字节)")
                break
    print("\n[目录样本]")
    seen = set()
    for n in zf.namelist():
        d = os.path.dirname(n)
        if d and d not in seen and len(seen) < 25:
            seen.add(d)
            print("  " + d)


def load_bin(path, entry):
    if entry:
        zf = zipfile.ZipFile(path)
        data = zf.read(entry)
    else:
        data = open(path, "rb").read()
    try:
        return zlib.decompress(data)
    except Exception:
        return data


def load_image(path, entry):
    zf = zipfile.ZipFile(path)
    return Image.open(io.BytesIO(zf.read(entry))).convert("RGB")


def convert(apk, map_entry, bin_entry, cid, name):
    img = load_image(apk, map_entry)
    raw = load_bin(apk, bin_entry)
    grid = int(round(math.isqrt(len(raw))))
    assert grid * grid == len(raw), f"碰撞表不是正方形：{len(raw)} 字节"
    g = np.frombuffer(raw, dtype=np.uint8).reshape(grid, grid)[::-1]   # 引擎 row0 = 南，影像 row0 = 北 → 必须翻
    out = np.zeros_like(g)
    for k, v in VALUE_MAP.items():
        out[g == k] = v
    px_per_cell = img.size[0] / grid
    cell = px_per_cell * METER_PER_PX
    world = grid * cell

    # 建筑：室内格连通域
    inside = (out & 0x1f) == 0x1f
    from collections import deque
    seen = np.zeros_like(inside)
    buildings = []
    half = world / 2
    for r in range(grid):
        for c in range(grid):
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
                    if 0 <= ny < grid and 0 <= nx < grid and inside[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(cells) < 25:
                continue
            ys = [p[0] for p in cells]
            xs = [p[1] for p in cells]
            r0, r1, c0, c1 = min(ys), max(ys), min(xs), max(xs)
            x0 = c0 * cell - half
            x1 = (c1 + 1) * cell - half
            z0 = half - (r1 + 1) * cell
            z1 = half - r0 * cell
            buildings.append({"p": [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
                              "h": 7.0, "a": len(cells) * cell * cell})

    outp = os.path.join(ROOT, "data", "cities", cid)
    os.makedirs(outp, exist_ok=True)
    img.save(os.path.join(outp, "sat.jpg"), quality=90)
    half_lon = (world / 2) / 111320.0
    half_lat = (world / 2) / 110540.0
    city = {
        "name": name, "size": [world, world], "cell": cell,
        "origin": [0.0, 0.0], "bbox": [-half_lat, -half_lon, half_lat, half_lon],
        "buildings": buildings, "roads": [], "pois": [], "entrances": [], "water": [],
        "collision": {"cell": cell, "cols": grid, "rows": grid,
                      "b64": base64.b64encode(zlib.compress(out.tobytes(), 9)).decode()},
    }
    io.open(os.path.join(outp, "city.json"), "w", encoding="utf-8").write(
        json.dumps(city, ensure_ascii=False, separators=(",", ":")))
    half_lon = (world / 2) / 111320.0
    half_lat = (world / 2) / 110540.0
    meta = {"provider": "mobile-original", "image": "sat.jpg",
            "size": list(img.size), "cell": px_per_cell, "citySize": [world, world],
            "bounds": [-half_lon, -half_lat, half_lon, half_lat]}
    io.open(os.path.join(outp, "sat.json"), "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"已转换 {cid}：图 {img.size}，格 {cell:.3f}m，世界 {world:.1f}m，建筑 {len(buildings)} 栋 → {outp}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["scan", "convert"])
    ap.add_argument("apk")
    ap.add_argument("--map", help="包内的地图大图路径")
    ap.add_argument("--bin", help="包内的碰撞表路径")
    ap.add_argument("--id", default="imap")
    ap.add_argument("--name", default="导入地图")
    a = ap.parse_args()
    if a.mode == "scan":
        scan(a.apk)
    else:
        if not a.map or not a.bin:
            sys.exit("convert 需要 --map 和 --bin")
        convert(a.apk, a.map, a.bin, a.id, a.name)


if __name__ == "__main__":
    main()
