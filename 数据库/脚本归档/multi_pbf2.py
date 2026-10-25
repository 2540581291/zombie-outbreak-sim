import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        RelScan().apply_file(_f, locations=False)""",
"""    _rs = RelScan()
    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        _rs.apply_file(_f, locations=False)""")
s = s.replace("""    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        Handler().apply_file(_f, locations=False)""",
"""    _h = Handler()
    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        _h.apply_file(_f, locations=False)""")
io.open(p, "w", encoding="utf-8").write(s)
print("改为单实例多文件")
