import io
# 1) bake_pbf.py 支持 --out 城市目录
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
if '"--out"' not in s:
    s = s.replace('ap.add_argument("--name", default="")',
'ap.add_argument("--name", default="")\n    ap.add_argument("--out", default="data/city.json", help="输出路径，如 数据库/cities/tokyo/city.json")')
    # 找到写文件处
    s = s.replace('os.path.join("data", "city.json")', 'args.out')
    s = s.replace('"data/city.json"', 'args.out')
    s = s.replace('open("data/city.json"', 'open(args.out')
    io.open(p, "w", encoding="utf-8").write(s)

import re
s = io.open(p, encoding="utf-8").read()
print("bake out 参数:", '"--out"' in s)
for line in s.splitlines():
    if "args.out" in line or "city.json" in line:
        print("   ", line.strip()[:100])

# 2) fetch_sat.py 支持 --city（读哪个城市、写回哪个目录）
p2 = "pipeline/fetch_sat.py"
s2 = io.open(p2, encoding="utf-8").read()
if '"--citydir"' not in s2:
    s2 = s2.replace('ap.add_argument("--city", default=None)',
'ap.add_argument("--city", default=None)\n    ap.add_argument("--citydir", default="data", help="城市数据目录，如 数据库/cities/tokyo")')
    s2 = s2.replace('"data/city.json"', 'os.path.join(args.citydir, "city.json")')
    s2 = s2.replace('"data/sat.jpg"', 'os.path.join(args.citydir, "sat.jpg")')
    s2 = s2.replace("os.path.join(outdir, \"sat.json\")", "os.path.join(args.citydir, \"sat.json\")")
    io.open(p2, "w", encoding="utf-8").write(s2)
s2 = io.open(p2, encoding="utf-8").read()
print("fetch_sat citydir:", '"--citydir"' in s2)
