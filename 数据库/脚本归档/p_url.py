import io
p = "pipeline/fetch_sat.py"
s = io.open(p, encoding="utf-8").read()
if "--url" not in s:
    s = s.replace('ap.add_argument("--threads", type=int, default=12)',
'ap.add_argument("--threads", type=int, default=12)\n    ap.add_argument("--url", default="", help="自定义图源 URL 模板，含 {z}/{x}/{y}，例如 https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}")')
    # 有 --url 时用它替换 provider 模板
    s = s.replace("if args.zoom:", "if args.url:\n        PROVIDERS[args.provider] = args.url\n    if args.zoom:", 1)
    io.open(p, "w", encoding="utf-8").write(s)
    print("fetch_sat.py 已支持 --url")
else:
    print("already patched")
