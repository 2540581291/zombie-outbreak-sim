#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 city.json 里的碰撞层：取值分布、连通性、门窗可达性。"""
import json, zlib, base64, sys, os
from collections import deque

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

path = sys.argv[1] if len(sys.argv) > 1 else "data/city.json"
city = json.load(open(path, encoding="utf-8"))
c = city["collision"]
g = zlib.decompress(base64.b64decode(c["b64"]))
w, h, cell = c["cols"], c["rows"], c["cell"]
n = w * h
print(f"网格 {w}×{h} = {n:,} 格 @ {cell}m   （解压 {len(g):,} 字节）")

names = {0x00: "墙", 0x03: "空地", 0x07: "林地", 0x0f: "门",
         0x16: "窗", 0x1f: "室内", 0x22: "围栏", 0x82: "水"}

# ---- 连通性 ----
comp = [-1] * n
sizes = []
for i in range(n):
    if comp[i] >= 0 or not (g[i] & 1):
        continue
    cid = len(sizes)
    size = 0
    comp[i] = cid
    q = deque([i])
    while q:
        k = q.popleft()
        size += 1
        x, y = k % w, k // w
        for nk, ok in ((k - 1, x > 0), (k + 1, x + 1 < w), (k - w, y > 0), (k + w, y + 1 < h)):
            if ok and comp[nk] < 0 and (g[nk] & 1):
                comp[nk] = cid
                q.append(nk)
    sizes.append(size)

walk = sum(sizes)
sizes_sorted = sorted(sizes, reverse=True)
big = sizes_sorted[0] if sizes_sorted else 0
print(f"连通块 {len(sizes)}  可走格 {walk:,}  最大块 {big:,} ({big*100/max(1,walk):.1f}%)")
print(f"  前 8 大: {sizes_sorted[:8]}")
print(f"  <64 格的小块: {sum(1 for s in sizes if s < 64)} 个，合计 {sum(s for s in sizes if s < 64):,} 格")

# ---- 建筑内部是否可达 ----
inside = door = win = wall = 0
inside_reachable = 0
big_id = sizes.index(big)
for i in range(n):
    v = g[i]
    if v == 0x1f:
        inside += 1
        if comp[i] == big_id:
            inside_reachable += 1
    elif v == 0x0f:
        door += 1
    elif v == 0x16:
        win += 1
    elif v == 0x00:
        wall += 1

print(f"室内 {inside:,} 格，其中 {inside_reachable:,} 与主城区连通 "
      f"({inside_reachable*100/max(1,inside):.1f}%)")
print(f"门 {door:,}  窗 {win:,}  墙 {wall:,}")

# ---- 抽查几栋楼：内部有没有门、能不能走到街上 ----
buildings = city["buildings"]
halfW, halfH = city["size"][0] / 2, city["size"][1] / 2
steps = max(1, len(buildings) // 2000)
sampled = buildings[::steps][:2000]
reach = 0
withdoor = 0
for b in sampled:
    p = b["p"]
    cx = sum(q[0] for q in p) / len(p)
    cy = sum(q[1] for q in p) / len(p)
    ci = int((cx + halfW) / cell) + int((cy + halfH) / cell) * w
    if 0 <= ci < n and g[ci] == 0x1f:
        if comp[ci] == big_id:
            reach += 1
        # 附近 6 格内有没有门
        x0, y0 = ci % w, ci // w
        found = False
        for yy in range(max(0, y0 - 6), min(h, y0 + 7)):
            for xx in range(max(0, x0 - 6), min(w, x0 + 7)):
                if g[yy * w + xx] == 0x0f:
                    found = True
                    break
            if found:
                break
        if found:
            withdoor += 1
print(f"抽样 {len(sampled)} 栋楼：中心在主连通块 {reach} 栋 ({reach*100/len(sampled):.1f}%)，"
      f"附近 12m 内有门 {withdoor} 栋 ({withdoor*100/len(sampled):.1f}%)")

