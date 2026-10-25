import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()

# 1) 河流中心线分支（插在水面多边形之前），并给宽度
old = """            if t.get("natural") == "water" or t.get("waterway") in ("riverbank", "river", "canal", "stream", "drain"):
                if len(pts) >= 3:
                    water.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts]})
                return"""
new = """            if t.get("waterway") in ("river", "canal", "stream", "drain"):
                wk = t.get("waterway")
                wd = {"river": 70, "canal": 32, "stream": 8, "drain": 6}.get(wk, 10)
                if len(pts) >= 2:
                    water_lines.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts], "w": wd})
                return

            if t.get("natural") == "water" or t.get("waterway") == "riverbank":
                if len(pts) >= 3:
                    water.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts]})
                return"""
assert old in s
s = s.replace(old, new)

# 2) 关掉 multipolygon 水面（环拼错会填出大片假水）
s = s.replace("""        def relation(self, r):
            t = r.tags
            if not (t.get("type") == "multipolygon" and
                    (t.get("natural") == "water" or t.get("waterway") == "riverbank")):
                return""",
"""        def relation(self, r):
            return   # multipolygon 环拼装不可靠，先关掉；水面靠中心线 + way 多边形""")

# 3) 过滤也只认 way 多边形，避免把巨大的湖面关系拽进来
s = s.replace("""        if not (t.get("type") == "multipolygon" and (
                t.get("natural") == "water" or t.get("waterway") == "riverbank")):
            return""", """        if not (t.get("type") == "multipolygon" and (
                t.get("natural") == "water" or t.get("waterway") == "riverbank")):
            return""")
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
