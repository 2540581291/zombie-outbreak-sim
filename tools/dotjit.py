import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""        const b2 = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];""",
"""        const b2 = this._jitter(UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1], i % CAP);""")
io.open(p, "w", encoding="utf-8").write(s)
print("圆点也用个体色")
