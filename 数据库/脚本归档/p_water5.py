import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()

# 1) 收河流中心线
s = s.replace("    barriers, entrances = [], []",
              "    barriers, entrances, water_lines = [], [], []")
s = s.replace('or t.get("waterway") == "riverbank"',
              'or t.get("waterway") in ("riverbank", "river", "canal", "stream", "drain")')
s = s.replace("""            if t.get("natural") == "water" or t.get("waterway") == "riverbank":""",
"""            if t.get("waterway") in ("river", "canal", "stream", "drain"):
                wk = t.get("waterway")
                wd = {"river": 60, "canal": 30, "stream": 8, "drain": 6}.get(wk, 10)
                if len(pts) >= 2:
                    water_lines.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts], "w": wd})
                return

            if t.get("natural") == "water" or t.get("waterway") == "riverbank":""")
s = s.replace('"barriers": barriers,', '"water_lines": water_lines,\n        "barriers": barriers,')
io.open(p, "w", encoding="utf-8").write(s)
print("bake ok")

# 2) collision.py 里把中心线按线宽盖成水面
p2 = "pipeline/collision.py"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""    # ---------- 2. 建筑：先内部，再描墙 ----------""",
"""    # 河流中心线：按宽度盖成水面（比依赖 multipolygon 闭合稳）
    for wl in city.get("water_lines") or []:
        pts = [tuple(p) for p in wl["p"]]
        halfw = max(0.5, (wl.get("w") or 20) / 2.0)
        for i in range(len(pts) - 1):
            _thick(g, pts[i], pts[i + 1], halfw, WATER)

    # ---------- 2. 建筑：先内部，再描墙 ----------""")
s2 = s2.replace("def build(city, cell=2.0, verbose=True):",
"""def _thick(g, a, b, halfw, value):
    \"\"\"沿线段盖一条带宽度的水面。\"\"\"
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


def build(city, cell=2.0, verbose=True):""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("collision ok")
