import io
p = "tools/build_city.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    pbf = os.path.join("pipeline", "raw", c["pbf"])
    if not os.path.exists(pbf):
        print(f"[跳过] {cid}：缺少 {pbf}")
        return False""",
"""    pbf = os.path.join("pipeline", "raw", c["pbf"])
    if not os.path.exists(pbf):
        # 有切片文件就用切片（快很多）
        cut = os.path.join("pipeline", "raw", c.get("cut", ""))
        if c.get("cut") and os.path.exists(cut):
            pbf = cut
        else:
            print(f"[跳过] {cid}：缺少 {pbf}")
            return False""")
io.open(p, "w", encoding="utf-8").write(s)
print("build_city 支持切片优先")
