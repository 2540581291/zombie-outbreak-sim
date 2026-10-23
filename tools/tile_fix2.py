import io, json
# 1) 路径前缀改成 data/ground
p = "pipeline/split_sat.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('"dir": "ground",', '"dir": "data/ground",')
io.open(p, "w", encoding="utf-8").write(s)
ts = json.load(open("data/ground/tileset.json", encoding="utf-8"))
ts["dir"] = "data/ground"
json.dump(ts, open("data/ground/tileset.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# 2) 选中窗口裁剪到 MAX_TILES 以内，避免反复加载卸载
p2 = "js/ground.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {""",
"""    // 窗口太大就裁到相机附近，保证不超过驻留上限（否则每帧都在换）
    let cc0 = c0, cc1 = c1, rr0 = r0, rr1 = r1;
    while ((cc1 - cc0 + 1) * (rr1 - rr0 + 1) > MAX_TILES) {
      if (cc1 - cc0 > rr1 - rr0) {
        if (Math.abs(cx - (x0w + (cc0 + 0.5) * perX)) < Math.abs(cx - (x0w + (cc1 + 0.5) * perX))) cc1--;
        else cc0++;
      } else {
        if (Math.abs(cz - (z0w + (rr0 + 0.5) * perZ)) < Math.abs(cz - (z0w + (rr1 + 0.5) * perZ))) rr1--;
        else rr0++;
      }
    }

    for (let r = rr0; r <= rr1; r++) {
      for (let c = cc0; c <= cc1; c++) {""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("patched")
