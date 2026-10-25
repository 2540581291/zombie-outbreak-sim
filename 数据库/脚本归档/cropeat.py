import io
p = "js/city.js"
s = io.open(p, encoding="utf-8").read()

old = """  const [w, s, e, n] = meta.bounds;
  const nw = toWorld(w, n), ne = toWorld(e, n), se = toWorld(e, s), sw = toWorld(w, s);"""
new = """  const [w, s, e, n] = meta.bounds;
  // 卫星图比城市大一圈（瓦片对齐），按城市 bbox 裁掉，保证"看到的 = 能走的"
  const [cMinLat, cMinLon, cMaxLat, cMaxLon] = city.bbox;
  const u0 = (cMinLon - w) / (e - w), u1 = (cMaxLon - w) / (e - w);
  const v0 = (cMinLat - s) / (n - s), v1 = (cMaxLat - s) / (n - s);
  const nw = toWorld(cMinLon, cMaxLat), ne = toWorld(cMaxLon, cMaxLat);
  const se = toWorld(cMaxLon, cMinLat), sw = toWorld(cMinLon, cMinLat);"""
assert old in s
s = s.replace(old, new)

old2 = """  // u=0 西, v=1 北（three 默认 flipY，图片顶行对应 v=1）
  const uv = [0, 1, 1, 1, 1, 0, 0, 0];"""
new2 = """  // u=0 西, v=1 北（three 默认 flipY，图片顶行对应 v=1）
  const uv = [u0, v1, u1, v1, u1, v0, u0, v0];"""
assert old2 in s
s = s.replace(old2, new2)
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
