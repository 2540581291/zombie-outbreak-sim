#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 碰撞层生成器（通用，不依赖具体城市）

把 OSM 的矢量几何栅格化成原版那套「每格一个字节」的位域网格：

  0x00 墙            0x03 路/空地      0x07 树/林地
  0x0f 门            0x16 窗            0x1f 建筑内部（可走！）
  0x22 围栏/栏杆      0x82 水

位：
  0x01 可走   0x02 视线可穿   0x04 有顶   0x08|0x10 室内

流程（照抄原版编辑器的生成顺序）：
  1 地面 0x03 → 水 0x82 → 林地 0x07
  2 建筑：先整块填 0x1f，再描墙 0x00（先内后墙，共用墙才保得住）
  3 开门 0x0f：优先用 OSM 的 entrance 节点，没有就在朝外的长边中点开
  4 开窗 0x16：沿朝外的墙等距铺
  5 围栏 0x22（挡人不挡视线）
  6 connect()：洪水填充 + 并查集，把被墙隔开的可走块打通门洞，
     剩下来的小块死区填成墙
"""
import math, zlib, base64, os
from collections import deque

WALL, OPEN, GRASS, DOOR, WINDOW, INSIDE, FENCE, FENCE_GAP, WATER = 0x00, 0x03, 0x07, 0x0F, 0x16, 0x1F, 0x42, 0x43, 0x82


class Grid:
    def __init__(self, w, h, cell):
        self.cell = cell
        self.cols = int(math.ceil(w / cell))
        self.rows = int(math.ceil(h / cell))
        self.halfW = w / 2.0
        self.halfH = h / 2.0
        self.g = bytearray([OPEN]) * (self.cols * self.rows)
        self.idx = lambda c, r: r * self.cols + c

    # ---------- 坐标 ----------
    def col(self, x):
        return int((x + self.halfW) / self.cell)

    def row(self, z):
        # 世界坐标 z 南为正 → 第 0 行在南边（和前端 collision.js 完全一致）
        return int((self.halfH - z) / self.cell)

    def cell_center(self, c, r):
        return ((c + 0.5) * self.cell - self.halfW, self.halfH - (r + 0.5) * self.cell)

    def get(self, c, r):
        if c < 0 or r < 0 or c >= self.cols or r >= self.rows:
            return WALL
        return self.g[r * self.cols + c]

    def set(self, c, r, v):
        if 0 <= c < self.cols and 0 <= r < self.rows:
            self.g[r * self.cols + c] = v

    # ---------- 填充 ----------
    def fill_poly(self, pts, value):
        if len(pts) < 3:
            return
        rs = [self.row(p[1]) for p in pts]
        r0 = max(0, min(rs))
        r1 = min(self.rows - 1, max(rs))
        n = len(pts)
        for r in range(r0, r1 + 1):
            y = self.halfH - (r + 0.5) * self.cell
            xs = []
            for i in range(n):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % n]
                if (y1 > y) != (y2 > y):
                    t = (y - y1) / (y2 - y1)
                    xs.append(x1 + t * (x2 - x1))
            if len(xs) < 2:
                continue
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                c0 = max(0, self.col(xs[i]))
                c1 = min(self.cols - 1, self.col(xs[i + 1]))
                if c1 >= c0:
                    base = r * self.cols
                    self.g[base + c0:base + c1 + 1] = bytes([value]) * (c1 - c0 + 1)

    def line(self, pts, value):
        """粗线（Bresenham），用于墙 / 围栏。"""
        for i in range(len(pts) - 1):
            self._seg(pts[i], pts[i + 1], value)

    def _seg(self, a, b, value):
        c0, r0 = self.col(a[0]), self.row(a[1])
        c1, r1 = self.col(b[0]), self.row(b[1])
        dc, dr = abs(c1 - c0), abs(r1 - r0)
        sc = 1 if c0 < c1 else -1
        sr = 1 if r0 < r1 else -1
        err = dc - dr
        while True:
            self.set(c0, r0, value)
            if c0 == c1 and r0 == r1:
                break
            e2 = err * 2
            if e2 > -dr:
                err -= dr
                c0 += sc
            if e2 < dc:
                err += dc
                r0 += sr

    def disc(self, c, r, rad, value):
        for rr in range(r - rad, r + rad + 1):
            for cc in range(c - rad, c + rad + 1):
                if (cc - c) ** 2 + (rr - r) ** 2 <= rad * rad:
                    self.set(cc, rr, value)


def _point_in_poly(x, y, pts):
    """射线法判断点是否在多边形内（世界坐标）。"""
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def faces_out(grid, c, r, nx, ny, depth=2):
    """法线方向走几步是不是空地（用来判断这面墙是不是朝街）。"""
    for d in range(1, depth + 1):
        cc = int(c + nx * d)
        rr = int(r + ny * d)
        v = grid.get(cc, rr)
        if v in (OPEN, GRASS):
            return True
        if v in (WALL, INSIDE, WINDOW):
            return False
    return False


def _inside_normal(pts, edge_i):
    """这条边的外法线（背离多边形质心）。"""
    n = len(pts)
    a, b = pts[edge_i], pts[(edge_i + 1) % n]
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = dy / ln, -dx / ln
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    mx, my = (a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy
    if nx * mx + ny * my < 0:
        nx, ny = -nx, -ny
    return nx, ny


_LUMA = None
_LUMA_KEY = None


def _luma_grid(city, cols, rows, sat_path=None):
    """把卫星图**裁到城市 bbox** 再降到网格分辨率，取亮度（0-255）。

    这一步以前是错的：它直接 resize 整张图（没有裁 bbox、没做南北翻转），
    于是亮度图和碰撞网格对不上，量出来的河宽自然全是垃圾 —— 结果是宽度
    退回"估算值"，河道变成一条等宽的带子，跟河岸对不上。

    sat_path 指向 data/cities/<id>/sat.json；找不到就返回 None（退回估算宽度）。
    """
    global _LUMA, _LUMA_KEY
    key = (sat_path, cols, rows)
    if _LUMA_KEY == key:
        return _LUMA
    _LUMA, _LUMA_KEY = None, key
    try:
        import json
        import numpy as np
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None

        meta_path = sat_path if sat_path and os.path.exists(sat_path) else "data/sat.json"
        if not os.path.exists(meta_path):
            print("  [warn] 没有卫星图，河宽退回估算值", flush=True)
            return None
        meta = json.load(open(meta_path, encoding="utf-8"))
        img = Image.open(os.path.join(os.path.dirname(meta_path), meta["image"])).convert("L")
        IW, IH = meta["size"]
        w, s, e, n = meta["bounds"]
        min_lat, min_lon, max_lat, max_lon = city["bbox"]
        u0 = (min_lon - w) / (e - w)
        u1 = (max_lon - w) / (e - w)
        v0 = (min_lat - s) / (n - s)
        v1 = (max_lat - s) / (n - s)
        box = (max(0, u0 * IW), max(0, (1 - v1) * IH),
               min(IW, u1 * IW), min(IH, (1 - v0) * IH))
        crop = img.crop(box).resize((cols, rows), Image.BOX)
        arr = np.asarray(crop, dtype=np.float32)
        # 卫星图第 0 行是北，碰撞网格第 0 行是南（r = (halfH - z)/cell）→ 翻一下
        _LUMA = np.flipud(arr)
        print(f"  [luma] 河宽测量用卫星亮度 {_LUMA.shape[1]}×{_LUMA.shape[0]} "
              f"（裁 bbox 后从 {IW}×{IH} 缩下来）", flush=True)
    except Exception as e:
        print("  [warn] 读卫星亮度失败，河宽退回估算值：", e, flush=True)
        _LUMA = None
    return _LUMA


def _luma_at(L, g, x, y):
    c, r = g.col(x), g.row(y)
    if 0 <= c < g.cols and 0 <= r < g.rows:
        return float(L[r, c])
    return None


def _water_halfwidth(g, L, px, py, nx, ny, fallback_m, cell):
    """从中心线往两侧各量一次，返回 (负向格数, 正向格数)。

    判定：亮度超过中心值 +22 就算上岸（水面暗、岸上亮）。
    量不到（没卫星 / 碰到边界）就用中心线给的估算宽度。
    这是"贴住河岸"的关键：逐采样点、左右分开量。
    """
    fb = max(1, int(round(fallback_m / cell)))
    if L is None:
        return fb, fb
    l0 = _luma_at(L, g, px, py)
    if l0 is None:
        return fb, fb
    lim = l0 + 22.0
    # 上限收紧：桥下 / 屋檐的暗处会让探测一直走，探出三角形水楔把桥截断
    cap = max(fb + 2, min(80, int(fallback_m * 1.45 / cell) + 2))
    out = []
    for sgn in (-1, 1):
        k = 0
        found = False
        while k < cap:
            v = _luma_at(L, g, px + nx * sgn * (k + 0.5) * cell, py + ny * sgn * (k + 0.5) * cell)
            if v is None:
                break
            if v > lim:
                found = True
                break
            k += 1
        # 走到上限还没看见岸 → 说明这段是桥下的阴影/树荫，不是河更宽：用 OSM 的估算宽度，
        # 否则会沿着暗处一路探出去，在岸上拉出三角形水楔（桥就是这样被"截断"的）
        out.append(max(1, k) if found else fb)
    return out[0], out[1]


def _water_fill(g, a, b, halfw_m, L, smooth=0.45, overlap=1.2):
    """沿线段盖水面：每个采样点左右分别量宽度，贴着河岸走。

    关键：**按格覆盖**而不是"沿法线按格步进"。截图里水面上飘着一堆孤立墙格，
    就是因为斜法线按 1m 步进采到的格子呈锯齿状、中间漏格，漏出来的空格是
    可走的孤点，最后被 connect() 当成死区填成了墙。
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-6:
        return
    tx, ty = dx / ln, dy / ln
    nx, ny = -ty, tx                     # 单位法线（米）
    steps = max(1, int(ln / (g.cell * 0.5)))
    neg_s = pos_s = halfw_m / g.cell     # 单位：格
    for i in range(steps + 1):
        t = i / steps
        px, py = a[0] + dx * t, a[1] + dy * t
        neg, pos = _water_halfwidth(g, L, px, py, nx, ny, halfw_m, g.cell)
        # 每步最多涨到上一采样点的 1.35 倍、最少缩到 0.7 倍 —— 避免在暗处探出一根三角楔
        neg = min(neg, neg_s * 1.35 + 1); neg = max(neg, neg_s * 0.70 - 1)
        pos = min(pos, pos_s * 1.35 + 1); pos = max(pos, pos_s * 0.70 - 1)
        neg_s = neg_s * (1 - smooth) + neg * smooth
        pos_s = pos_s * (1 - smooth) + pos * smooth
        lo_m, hi_m = neg_s * g.cell, pos_s * g.cell
        # 带内也逐格看亮度：桥墩/桥面/船这些"亮"的东西不该被刷成水
        l0c = _luma_at(L, g, px, py) if L is not None else None
        lim_c = (l0c + 26.0) if l0c is not None else None
        reach = max(lo_m, hi_m) + 2 * g.cell
        c0, c1 = g.col(px - reach), g.col(px + reach)
        r0, r1 = g.row(py - reach), g.row(py + reach)
        for r in range(min(r0, r1), max(r0, r1) + 1):
            cy = g.halfH - (r + 0.5) * g.cell
            for c in range(min(c0, c1), max(c0, c1) + 1):
                cx = (c + 0.5) * g.cell - g.halfW
                d = (cx - px) * nx + (cy - py) * ny      # 沿法线的投影
                if d < -lo_m - g.cell * 0.5 or d > hi_m + g.cell * 0.5:
                    continue
                along = (cx - px) * tx + (cy - py) * ty  # 沿中心线的投影
                if abs(along) > overlap:
                    continue
                if g.get(c, r) in (INSIDE, WALL, DOOR, WINDOW):
                    continue
                if lim_c is not None:
                    lv = _luma_at(L, g, cx, cy)
                    if lv is not None and lv > lim_c:
                        continue        # 结构（桥墩/桥面/船）保持原样，不刷水
                g.set(c, r, WATER)


def _thick(g, a, b, halfw, value):
    """沿线段盖一条带宽度的水面（不压建筑）。"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-6:
        return
    nx, ny = -dy / ln * halfw, dx / ln * halfw
    steps = max(1, int(ln / (g.cell * 0.5)))
    for i in range(steps + 1):
        t = i / steps
        px, py = a[0] + dx * t, a[1] + dy * t
        # 用一条垂直短线填出宽度
        nstep = max(1, int(halfw / (g.cell * 0.5)))
        for j in range(-nstep, nstep + 1):
            k = j / nstep if nstep else 0
            cc = g.col(px + nx * k)
            rr = g.row(py + ny * k)
            if g.get(cc, rr) not in (INSIDE, WALL, DOOR, WINDOW):
                g.set(cc, rr, value)


def _deck(g, a, b, halfw):
    """桥面：**压掉一切**（包括墙和建筑内部）。

    桥是架在地形之上的结构，岸边建筑如果压在桥头，它的墙会把桥切断 ——
    这正是"桥走不过去"的根因。所以桥面必须最后画，并且允许覆盖墙/室内。
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-6:
        return
    nx, ny = -dy / ln * halfw, dx / ln * halfw
    steps = max(1, int(ln / (g.cell * 0.5)))
    for i in range(steps + 1):
        t = i / steps
        px, py = a[0] + dx * t, a[1] + dy * t
        nstep = max(1, int(halfw / (g.cell * 0.5)))
        for j in range(-nstep, nstep + 1):
            k = j / nstep if nstep else 0
            g.set(g.col(px + nx * k), g.row(py + ny * k), OPEN)


def build(city, cell=1.0, verbose=True, sat_path=None):   # 默认 1m/格
    W, H = city["size"]
    g = Grid(W, H, cell)
    per_m = 1.0 / cell
    luma = _luma_grid(city, g.cols, g.rows, sat_path)   # 量河宽用

    # ---------- 1. 地面 ----------
    for z in city.get("water") or []:
        g.fill_poly([tuple(p) for p in z["p"]], WATER)
        # 河心岛 / 湖心岛：内环填回陆地
        for hole in z.get("hole") or []:
            g.fill_poly([tuple(p) for p in hole], OPEN)
    for z in city.get("parks") or []:
        kind = z.get("k")
        g.fill_poly([tuple(p) for p in z["p"]], GRASS if kind in ("forest", "wood") else OPEN)

    # 河流中心线：逐个采样点从卫星亮度量左右岸，贴住河岸盖水面
    # （比依赖 multipolygon 闭合稳；宽度不再用固定估算值）
    for wl in city.get("water_lines") or []:
        pts = [tuple(p) for p in wl["p"]]
        halfw_m = max(0.5, (wl.get("w") or 20) / 2.0)
        for i in range(len(pts) - 1):
            _water_fill(g, pts[i], pts[i + 1], halfw_m, luma)

    # 桥放到最后画（见文件末尾）—— 桥面要压过岸边建筑的墙

    # 水面快照（建筑画上去之前）—— 用来找"跨在水上的建筑"，那些其实是桥/高架
    water_snap = bytes(g.g)

    # ---------- 2. 建筑：先内部，再描墙 ----------
    buildings = city.get("buildings") or []
    for b in buildings:
        g.fill_poly([tuple(p) for p in b["p"]], INSIDE)
    for b in buildings:
        pts = [tuple(p) for p in b["p"]]
        for i in range(len(pts)):
            g.line([pts[i], pts[(i + 1) % len(pts)]], WALL)

    # ---------- 3. 门 / 4. 窗 ----------
    entrances = [tuple(e) for e in (city.get("entrances") or [])]
    door_half = max(1, int(round(1.0 * per_m)))          # 门宽 ≈ 2m
    window_len = max(1, int(round(1.6 * per_m)))         # 窗宽 ≈ 3.2m
    window_gap = max(2, int(round(2.4 * per_m)))         # 间隔 ≈ 4.8m
    n_door = n_win = 0

    for b in buildings:
        pts = [tuple(p) for p in b["p"]]
        n = len(pts)
        edges = []
        for i in range(n):
            a, c = pts[i], pts[(i + 1) % n]
            ln = math.hypot(c[0] - a[0], c[1] - a[1])
            if ln > 0.2:
                nx, ny = _inside_normal(pts, i)
                edges.append((a, c, ln, nx, ny))
        if not edges:
            continue

        # --- 门：优先 OSM entrance 节点 ---
        doors = 0
        for ex, ey in entrances:
            ec, er = g.col(ex), g.row(ey)
            if not (0 <= ec < g.cols and 0 <= er < g.rows):
                continue
            if g.get(ec, er) not in (WALL, INSIDE):
                continue          # 这个入口不在本楼边界上
            # 把入口附近 3×3 的墙/内部开成门
            for rr in range(er - door_half, er + door_half + 1):
                for cc in range(ec - door_half, ec + door_half + 1):
                    if g.get(cc, rr) in (WALL, INSIDE):
                        g.set(cc, rr, DOOR)
            doors += 1
            n_door += 1
            if doors >= 2:
                break

        # --- 兜底：朝外的长边中点开门 ---
        if doors == 0:
            ordered = sorted(edges, key=lambda e: -e[2])
            want = 2 if sum(e[2] for e in edges) > 80 else 1
            first = None
            for (a, c, ln, nx, ny) in ordered:
                if ln < door_half * 4:
                    continue
                mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
                mc, mr = g.col(mid[0]), g.row(mid[1])
                if not faces_out(g, mc, mr, nx, ny, 3):
                    continue
                if first is not None:
                    if (mid[0] - first[0]) ** 2 + (mid[1] - first[1]) ** 2 < 30 ** 2:
                        continue
                for k in range(-door_half, door_half + 1):
                    cc = int(mc + (-ny) * k)
                    rr = int(mr + nx * k)
                    if g.get(cc, rr) in (WALL, INSIDE):
                        g.set(cc, rr, DOOR)
                first = mid
                doors += 1
                n_door += 1
                if doors >= want:
                    break

        # --- 窗：沿朝外的墙等距铺 ---
        for (a, c, ln, nx, ny) in edges:
            margin = window_gap * 0.75
            if ln < margin * 2 + window_len * cell:
                continue
            span = ln - margin * 2
            count = max(1, int((span + window_gap * cell) / ((window_len + window_gap) * cell)))
            ux, uy = (c[0] - a[0]) / ln, (c[1] - a[1]) / ln
            for i in range(count):
                t = margin + (span * i / max(1, count - 1) if count > 1 else span / 2)
                mx, my = a[0] + ux * t, a[1] + uy * t
                mc, mr = g.col(mx), g.row(my)
                if g.get(mc, mr) not in (WALL,):
                    continue       # 已经是门/窗/内部了
                if not faces_out(g, mc, mr, nx, ny, 2):
                    continue
                for k in range(window_len):
                    cc = g.col(mx + ux * k * cell)
                    rr = g.row(my + uy * k * cell)
                    if g.get(cc, rr) == WALL:
                        g.set(cc, rr, WINDOW)
                n_win += 1

    # ---------- 5. 围栏 / 墙 ----------
    n_barrier = 0
    for bar in city.get("barriers") or []:
        kind = bar.get("k", "fence")
        v = WALL if kind in ("wall", "retaining_wall", "city_wall", "hedge") else FENCE
        pts = [tuple(p) for p in bar["p"]]
        g.line(pts, v)
        n_barrier += 1

    # ---------- 5.5 跨水建筑 = 桥面 ----------
    # OSM 里横跨河面的车站/高架（比如柏林 Friedrichstraße 站）是当作 building 多边形给的。
    # 照普通建筑画，它就变成"室内 + 一圈外墙"，桥两头都被墙封死 —— 看起来就是"桥被截断在房子里"。
    # 这里把这些建筑刷成可通行的桥面。
    n_overwater = 0
    for b in buildings:
        pts = [tuple(p) for p in b["p"]]
        if len(pts) < 3:
            continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        c0, c1 = g.col(min(xs)), g.col(max(xs))
        r0, r1 = g.row(min(ys)), g.row(max(ys))
        total = over = 0
        for r in range(max(0, min(r0, r1)), min(g.rows - 1, max(r0, r1)) + 1):
            cy = g.halfH - (r + 0.5) * g.cell
            for c in range(max(0, min(c0, c1)), min(g.cols - 1, max(c0, c1)) + 1):
                cx = (c + 0.5) * g.cell - g.halfW
                if not _point_in_poly(cx, cy, pts):
                    continue
                total += 1
                if water_snap[r * g.cols + c] == WATER:
                    over += 1
        if total and over * g.cell * g.cell >= 20.0 and over / total >= 0.08:
            g.fill_poly(pts, OPEN)
            n_overwater += 1

    # ---------- 5.6 桥线穿过的建筑 = 桥面 ----------
    # 铁路高架 / 跨河的车站常被 OSM 画成一个 building 多边形，桥线从它内部穿过。
    # 这种楼按"室内 + 外墙"画，桥上的人就被墙封在两头 —— 整栋改成桥面。
    bb = []
    for i, b in enumerate(buildings):
        pts = [tuple(p) for p in b["p"]]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        bb.append((min(xs), min(ys), max(xs), max(ys), pts))
    hit_buildings = set()
    for br in city.get("bridges") or []:
        for (bx, by) in br["p"]:
            for i, (x0, y0, x1, y1, pts) in enumerate(bb):
                if not (x0 <= bx <= x1 and y0 <= by <= y1):
                    continue
                if _point_in_poly(bx, by, pts):
                    hit_buildings.add(i)
    for i in hit_buildings:
        g.fill_poly(bb[i][4], OPEN)
    n_bridge_bld = len(hit_buildings)

    # ---------- 6. 桥（最后画）----------
    # 桥是架在地形之上的结构：岸边建筑压在桥头时，它的墙会把桥切断。
    # 所以桥面必须在建筑/门/窗/围栏之后画，而且允许覆盖墙和室内。
    # 另外两端各外延 8m，保证桥头接上街道而不是停在墙缝里。
    n_bridge = 0
    for br in city.get("bridges") or []:
        pts = [tuple(p) for p in br["p"]]
        if len(pts) < 2:
            continue
        halfw = max(1.5, (br.get("w") or 10) / 2.0)
        # 两端外延
        ext = []
        for i in (0, -1):
            a, b = (pts[0], pts[1]) if i == 0 else (pts[-1], pts[-2])
            dx, dy = a[0] - b[0], a[1] - b[1]
            ln = math.hypot(dx, dy)
            k = (8.0 / ln) if ln > 1e-6 else 0.0
            ext.append((a[0] + dx * k, a[1] + dy * k))
        pts = [ext[0]] + pts + [ext[1]]
        for i in range(len(pts) - 1):
            _deck(g, pts[i], pts[i + 1], halfw)
        n_bridge += 1

    # ---------- 7. 连通性修补 ----------
    stats = connect(g)

    if verbose:
        hist = {}
        for v in g.g:
            hist[v] = hist.get(v, 0) + 1
        total = len(g.g)
        print(f"      碰撞层 {g.cols}×{g.rows} = {total:,} 格 @ {cell}m", flush=True)
        for v, name in [(OPEN, "空地/路"), (GRASS, "林地"), (INSIDE, "室内"),
                        (WALL, "墙"), (DOOR, "门"), (WINDOW, "窗"),
                        (FENCE, "围栏"), (WATER, "水")]:
            if v in hist:
                print(f"        {name:<6} 0x{v:02x}  {hist[v]:>9,}  {hist[v]*100/total:5.1f}%", flush=True)
        print(f"      跨水建筑→桥面 {n_overwater} 栋  桥线穿过→桥面 {n_bridge_bld} 栋  桥 {n_bridge} 条", flush=True)
        print(f"      门 {n_door}  窗 {n_win}  围栏 {n_barrier}  "
              f"连通块 {stats['pieces']} → 补门 {stats['punched']}  填死区 {stats['filled']} 格", flush=True)

    raw = bytes(g.g)
    comp = zlib.compress(raw, 9)
    return {
        "cell": cell,
        "cols": g.cols,
        "rows": g.rows,
        "b64": base64.b64encode(comp).decode("ascii"),
        "raw": len(raw),
        "comp": len(comp),
    }


def connect(g):
    """洪水填充 + 并查集：被墙隔开的可走块打通门洞；小死区填成墙。"""
    w, h = g.cols, g.rows
    n = w * h
    g_ = g.g
    piece = [-1] * n
    sizes = []
    stack = []
    for i in range(n):
        if piece[i] >= 0 or not (g_[i] & 1):
            continue
        pid = len(sizes)
        size = 0
        piece[i] = pid
        stack.append(i)
        while stack:
            c = stack.pop()
            size += 1
            x, y = c % w, c // w
            if x > 0 and piece[c - 1] < 0 and (g_[c - 1] & 1):
                piece[c - 1] = pid; stack.append(c - 1)
            if x + 1 < w and piece[c + 1] < 0 and (g_[c + 1] & 1):
                piece[c + 1] = pid; stack.append(c + 1)
            if y > 0 and piece[c - w] < 0 and (g_[c - w] & 1):
                piece[c - w] = pid; stack.append(c - w)
            if y + 1 < h and piece[c + w] < 0 and (g_[c + w] & 1):
                piece[c + w] = pid; stack.append(c + w)
        sizes.append(size)

    if len(sizes) < 2:
        return {"pieces": len(sizes), "punched": 0, "filled": 0}

    parent = list(range(len(sizes)))

    def root(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    passable = (WALL, WINDOW, FENCE)
    punched = 0

    for step, lines, length in ((1, h, w), (w, w, h)):
        side = w if step == 1 else 1
        for line in range(lines):
            first = line * w if step == 1 else line
            for i in range(length - 2):
                a = first + i * step
                if piece[a] < 0 or piece[a + step] >= 0 or g_[a + step] not in passable:
                    continue
                k = 1
                if i + 3 < length and piece[a + 2 * step] < 0 and g_[a + 2 * step] in passable:
                    k = 2
                b = a + (k + 1) * step
                if b >= n or piece[b] < 0:
                    continue
                ra, rb = root(piece[a]), root(piece[b])
                if ra == rb:
                    continue
                parent[ra] = rb
                for d in (-1, 0, 1):
                    if line + d < 0 or line + d >= lines:
                        continue
                    a2, b2 = a + d * side, b + d * side
                    ok = d == 0
                    if not ok and 0 <= a2 < n and 0 <= b2 < n and piece[a2] >= 0 and piece[b2] >= 0:
                        ok = root(piece[a2]) == rb and root(piece[b2]) == rb
                    if ok:
                        for j in range(1, k + 1):
                            idx = a2 + j * step
                            if 0 <= idx < n and g_[idx] in passable:
                                g_[idx] = DOOR
                                piece[idx] = piece[a]
                                punched += 1

    joined = [0] * len(sizes)
    for i in range(len(sizes)):
        joined[root(i)] += sizes[i]
    biggest = joined.index(max(joined))
    filled = 0
    for i in range(n):
        if piece[i] >= 0:
            r = root(piece[i])
            if r != biggest and joined[r] < 64:
                g_[i] = WALL
                filled += 1
    return {"pieces": len(sizes), "punched": punched, "filled": filled}
