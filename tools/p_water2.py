import io
p = "pipeline/collision.py"
s = io.open(p, encoding="utf-8").read()
# 水面支持内环（岛屿）：先填水面，再把内环填回陆地
s = s.replace("""    for z in city.get("water") or []:
        g.fill_poly([tuple(p) for p in z["p"]], WATER)""",
"""    for z in city.get("water") or []:
        g.fill_poly([tuple(p) for p in z["p"]], WATER)
        # 河心岛 / 湖心岛：内环填回陆地
        for hole in z.get("hole") or []:
            g.fill_poly([tuple(p) for p in hole], OPEN)""")
io.open(p, "w", encoding="utf-8").write(s)
print("collision patched")
