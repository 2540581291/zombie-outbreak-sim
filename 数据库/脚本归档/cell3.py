import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('ap.add_argument("--overpass", action="store_true")',
'ap.add_argument("--overpass", action="store_true")\n    ap.add_argument("--cell", type=float, default=1.0, help="碰撞格边长（米）")')
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
