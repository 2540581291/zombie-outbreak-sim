import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()

# 1) 用 shapely 正确拼装水域多边形（替换手写环拼接）
s = s.replace("import osmium", """import osmium

try:
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    HAVE_SHAPELY = True
except Exception:
    HAVE_SHAPELY = False""")

s = s.replace("""        def relation(self, r):
            return   # multipolygon 环拼装不可靠，先关掉；水面靠中心线 + way 多边形""",
"""        def relation(self, r):
            t = r.tags
            if not (t.get("type") == "multipolygon" and
                    (t.get("natural") == "water" or t.get("waterway") == "riverbank")):
                return
            if not HAVE_SHAPELY:
                return
            outers, inners = [], []
            for m in r.members:
                if m.type != "w":
                    continue
                c = way_coords.get(m.ref)
                if not c or len(c) < 2:
                    continue
                (inners if m.role == "inner" else outers).append(c)

            def build(segs):
                lines = [LineString([(x, y) for x, y in sg]) for sg in segs]
                if not lines:
                    return []
                return [g for g in polygonize(unary_union(lines))
                        if g.geom_type == "Polygon" and g.area > 150]

            ops = build(outers)
            ips = build(inners)
            for poly in ops:
                water.append({
                    "p": [[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords],
                    "hole": [[[round(x, 1), round(y, 1)] for x, y in h.coords]
                             for h in ips if poly.contains(h.representative_point())],
                })""")

# 2) 收集桥（bridge=yes 的道路），后面在水面上盖回可通行
s = s.replace("    barriers, entrances, water_lines = [], [], []",
              "    barriers, entrances, water_lines, bridges = [], [], [], []")
s = s.replace("""                roads.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                              "w": wd, "t": hw})
                return""",
"""                roads.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                              "w": wd, "t": hw})
                if t.get("bridge") and t.get("bridge") not in ("no",):
                    bridges.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts], "w": wd})
                return""")
s = s.replace('"water_lines": water_lines,', '"water_lines": water_lines,\n        "bridges": bridges,')
io.open(p, "w", encoding="utf-8").write(s)
print("bake patched")

# 3) collision.py：先水面，再把桥盖回空地
p2 = "pipeline/collision.py"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""    # ---------- 2. 建筑：先内部，再描墙 ----------""",
"""    # 桥：水面上方的可通行结构，盖回空地（含引桥，稍微加宽）
    for br in city.get("bridges") or []:
        pts = [tuple(p) for p in br["p"]]
        halfw = max(1.0, (br.get("w") or 10) / 2.0)
        for i in range(len(pts) - 1):
            _thick(g, pts[i], pts[i + 1], halfw, OPEN)

    # ---------- 2. 建筑：先内部，再描墙 ----------""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("collision patched")
