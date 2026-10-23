import json, math
from PIL import Image
sat = json.load(open("data/sat.json", encoding="utf-8"))
city = json.load(open("data/city.json", encoding="utf-8"))
sat["provider"] = "google"
sat["note"] = "Google satellite, zoom 19, url https://mt1.google.com/vt/lyrs=s"
json.dump(sat, open("data/sat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
lon0, lat0 = city["origin"]; kx = 111320*math.cos(math.radians(lat0))
W, H = city["size"]; sw, sh = sat["size"]
w, s, e, n = sat["bounds"]
spans_x = (e-w)*kx; spans_y = (n-s)*110540
print(f"图像      {sw} x {sh} px   ({sw*sh/1e6:.0f} MP)")
print(f"覆盖      {spans_x:.0f} x {spans_y:.0f} m")
print(f"分辨率    {spans_x/sw:.3f} m/px   (原 z17 是 0.727)")
print(f"城市范围  {W:.0f} x {H:.0f} m  → 实际 {(W/(spans_x/sw)):.0f} x {(H/(spans_y/sh)):.0f} px")
print(f"文件      {__import__('os').path.getsize('data/sat.jpg')/1024/1024:.1f} MB")
