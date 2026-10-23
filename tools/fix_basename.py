import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('print(f"[1/3] 解析 {os.path.basename(args.pbf)} …", flush=True)',
'''_files = args.pbf if isinstance(args.pbf, list) else [args.pbf]
    _names = ", ".join(os.path.basename(f) for f in _files[:3]) + (" …" if len(_files) > 3 else "")
    print(f"[1/3] 解析 {_names} （{len(_files)} 个文件）…", flush=True)''')
io.open(p, "w", encoding="utf-8").write(s)
print("已修 basename 报错")
