import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
# --pbf 支持多个文件
s = s.replace('ap.add_argument("--pbf", required=True)', 'ap.add_argument("--pbf", required=True, nargs="+")')
# 主流程支持多文件：把解析那一段包进循环
old = "    Handler().apply_file(args.pbf, locations=False)"
if old in s:
    s = s.replace(old, """    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        Handler().apply_file(_f, locations=False)""")
# RelScan 也要跑多文件
old2 = "    RelScan().apply_file(args.pbf, locations=False)"
if old2 in s:
    s = s.replace(old2, """    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        RelScan().apply_file(_f, locations=False)""")
io.open(p, "w", encoding="utf-8").write(s)
print("bake_pbf 支持多文件")
