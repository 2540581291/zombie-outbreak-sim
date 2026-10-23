import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
if '"--cell"' not in s:
    s = s.replace('ap.add_argument("--out", default="data/city.json"',
'ap.add_argument("--cell", type=float, default=1.0, help="碰撞格边长（米），1.0 为高清推荐值")\n    ap.add_argument("--out", default="data/city.json"')
    s = s.replace("collision.build(out,", "collision.build(out, cell=args.cell, ")
    io.open(p, "w", encoding="utf-8").write(s)
print("已加 --cell")
