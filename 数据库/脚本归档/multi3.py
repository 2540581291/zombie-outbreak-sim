import io
p = "pipeline/fetch_sat.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('city_path = args.city or os.path.join(root, "data", "city.json")',
              'city_path = args.city or os.path.join(args.citydir, "city.json")')
s = s.replace('outdir = os.path.join(root, "data")', 'outdir = args.citydir')
s = s.replace('print(f"[2/3] 写出 data/sat.jpg', 'print(f"[2/3] 写出 {img_path}')
io.open(p, "w", encoding="utf-8").write(s)
print("fetch_sat 已按城市目录读写")
