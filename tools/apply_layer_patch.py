#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 把手工图层补丁烘进 city.json（可选）

平时游戏运行时会自己读 data/cities/<id>/collision.edit.json 并叠加，不需要本脚本。
但下面两种情况需要烘一次：
  · 想让 Node 测试 / 其它读 city.json 的工具也看到修正后的图层；
  · 想把某一版手绘结果"冻结"进数据（之后删掉 json 也不影响）。

    python tools/apply_layer_patch.py berlin                 # 就地烘焙（先备份 city.json.bak）
    python tools/apply_layer_patch.py berlin --out tmp.json  # 烘焙到别处，不碰原文件
    python tools/apply_layer_patch.py berlin --dry-run       # 只统计会改多少格

补丁格式见 js/layerpatch.js 顶部注释。
"""
import os, sys, json, zlib, base64, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 与 js/layerpatch.js 的 VALUE_NAMES 保持一致
VALUES = {
    "wall": 0x00, "open": 0x03, "cover": 0x07, "door": 0x0f,
    "window": 0x16, "room": 0x1f, "fence": 0x22, "water": 0x82,
    "inside": 0x1f, "indoor": 0x1f, "building": 0x1f,
    "grass": 0x07, "forest": 0x07, "erase": 0x03,
}
LABELS = {0x00: "墙", 0x03: "空地", 0x07: "草地", 0x0f: "门",
          0x16: "窗", 0x1f: "室内", 0x22: "围栏", 0x82: "水"}


def code_of(v):
    if isinstance(v, int):
        return v & 0xFF
    if isinstance(v, str):
        if v.startswith("0x") or v.isdigit():
            return int(v, 16 if v.startswith("0x") else 10) & 0xFF
        if v in VALUES:
            return VALUES[v]
    raise ValueError("未知的层值：%r" % (v,))


class Layer:
    def __init__(self, grid, cols, rows, cell, halfW, halfH):
        self.g, self.cols, self.rows, self.cell = grid, cols, rows, cell
        self.halfW, self.halfH = halfW, halfH
        self.changed = 0

    def col_row(self, x, z):
        return int((x + self.halfW) / self.cell), int((self.halfH - z) / self.cell)

    def set(self, c, r, v):
        if 0 <= c < self.cols and 0 <= r < self.rows:
            k = r * self.cols + c
            if self.g[k] != v:
                self.g[k] = v
                self.changed += 1

    def poly(self, x, z, pts):
        inside = False
        n = len(pts)
        j = n - 1
        for i in range(n):
            xi, zi = pts[i]
            xj, zj = pts[j]
            if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / (zj - zi) + xi):
                inside = not inside
            j = i
        return inside


def apply_op(L, op):
    t = op.get("t", "cell")
    v = code_of(op["v"])
    if t == "cell":
        L.set(int(op["c"]), int(op["r"]), v)
    elif t == "brush":
        rad = max(0.5, float(op.get("rad", 3)))
        c0, r0 = L.col_row(float(op["x"]), float(op["z"]))
        span = int(rad / L.cell) + 1
        rr = rad / L.cell
        for dr in range(-span, span + 1):
            for dc in range(-span, span + 1):
                if dc * dc + dr * dr > rr * rr:
                    continue
                L.set(c0 + dc, r0 + dr, v)
    elif t == "rect":
        x, z, w, h = float(op["x"]), float(op["z"]), float(op["w"]), float(op["h"])
        c0, r0 = L.col_row(min(x, x + w), max(z, z + h))
        c1, r1 = L.col_row(max(x, x + w), min(z, z + h))
        for r in range(min(r0, r1), max(r0, r1) + 1):
            for c in range(min(c0, c1), max(c0, c1) + 1):
                L.set(c, r, v)
    elif t == "poly":
        pts = [(float(p[0]), float(p[1])) for p in op["pts"]]
        if len(pts) < 3:
            return
        xs = [p[0] for p in pts]
        zs = [p[1] for p in pts]
        c0, _ = L.col_row(min(xs), 0)
        c1, _ = L.col_row(max(xs), 0)
        _, r0 = L.col_row(0, max(zs))
        _, r1 = L.col_row(0, min(zs))
        for r in range(min(r0, r1), max(r0, r1) + 1):
            z = L.halfH - (r + 0.5) * L.cell
            for c in range(min(c0, c1), max(c0, c1) + 1):
                x = (c + 0.5) * L.cell - L.halfW
                if L.poly(x, z, pts):
                    L.set(c, r, v)
    elif t == "line":
        a, b = op["a"], op["b"]
        rad = max(0.5, float(op.get("rad", 1.5)))
        ln = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        steps = max(1, int(ln / (L.cell * 0.5)))
        for i in range(steps + 1):
            k = i / steps
            apply_op(L, {"t": "brush", "x": a[0] + (b[0] - a[0]) * k,
                         "z": a[1] + (b[1] - a[1]) * k, "rad": rad, "v": op["v"]})
    else:
        print("  [跳过] 不认识的 op：", t)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cid = args[0]
    out = None
    dry = "--dry-run" in args
    if "--out" in args:
        out = args[args.index("--out") + 1]

    cdir = os.path.join(ROOT, "data", "cities", cid)
    cpath = os.path.join(cdir, "city.json")
    ppath = os.path.join(cdir, "collision.edit.json")
    if not os.path.exists(ppath):
        print("没有补丁文件：", ppath)
        return
    city = json.load(open(cpath, encoding="utf-8"))
    patch = json.load(open(ppath, encoding="utf-8"))
    col = city["collision"]
    grid = bytearray(zlib.decompress(base64.b64decode(col["b64"])))
    W, H = city["size"]
    L = Layer(grid, col["cols"], col["rows"], col["cell"], W / 2, H / 2)

    before = sum(1 for v in grid if v == 0x1F)
    n = 0
    for op in patch.get("ops", []):
        try:
            apply_op(L, op)
            n += 1
        except Exception as e:
            print("  [跳过] %s：%s" % (e, op))
    after = sum(1 for v in grid if v == 0x1F)
    print("%s：%d 条 op，改动 %d 格；室内 %.1f%% → %.1f%%"
          % (cid, n, L.changed, before / len(grid) * 100, after / len(grid) * 100))

    if dry:
        print("（--dry-run，未写文件）")
        return
    col["b64"] = base64.b64encode(zlib.compress(bytes(grid), 9)).decode("ascii")
    dst = out or cpath
    if not out:
        shutil.copyfile(cpath, cpath + ".bak")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))
    print("已写入", dst, ("（原文件备份为 city.json.bak）" if not out else ""))


if __name__ == "__main__":
    main()
