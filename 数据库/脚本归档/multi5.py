import io
p = "tools/pick_size.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('def apply(w_px, h_px, sat_json="data/sat.json", sat_jpg="data/sat.jpg", quality=90):',
'def apply(w_px, h_px, sat_json="data/sat.json", sat_jpg="data/sat.jpg", quality=90):')
s = s.replace('    ap.add_argument("--quality", type=int, default=90)',
'    ap.add_argument("--quality", type=int, default=90)\n    ap.add_argument("--citydir", default="data", help="城市数据目录，如 数据库/cities/tokyo")')
s = s.replace("""    if a.apply:
        apply(W, H, quality=a.quality)
        meta = json.load(open("data/sat.json", encoding="utf-8"))
        meta["sweetSpot"] = {"r_eff": round(r, 4), "px": d["px"], "scale": round(d["scale"], 4)}
        json.dump(meta, open("data/sat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)""",
"""    if a.apply:
        sj = os.path.join(a.citydir, "sat.json")
        sg = os.path.join(a.citydir, "sat.jpg")
        apply(W, H, sat_json=sj, sat_jpg=sg, quality=a.quality)
        meta = json.load(open(sj, encoding="utf-8"))
        meta["sweetSpot"] = {"r_eff": round(r, 4), "px": d["px"], "scale": round(d["scale"], 4)}
        json.dump(meta, open(sj, "w", encoding="utf-8"), ensure_ascii=False, indent=1)""")
io.open(p, "w", encoding="utf-8").write(s)
print("pick_size 支持 --citydir")
