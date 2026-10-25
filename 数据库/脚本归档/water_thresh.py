import json, zlib, base64, numpy as np
from PIL import Image
city = json.load(open("data/city.json", encoding="utf-8"))
sat = json.load(open("data/sat.json", encoding="utf-8"))
col = city["collision"]; cols, rows = col["cols"], col["rows"]
g = np.frombuffer(zlib.decompress(base64.b64decode(col["b64"])), dtype=np.uint8).reshape(rows, cols)
img = np.asarray(Image.open("data/" + sat["image"]).convert("RGB").resize((cols, rows), Image.BOX), dtype=np.float32)
lum = 0.299*img[:,:,0] + 0.587*img[:,:,1] + 0.114*img[:,:,2]
mx = img.max(2); mn = img.min(2)
satv = (mx - mn) / np.maximum(mx, 1)
# 局部纹理：3x3 亮度标准差
from numpy.lib.stride_tricks import sliding_window_view
pad = np.pad(lum, 1, mode="edge")
tex = sliding_window_view(pad, (3, 3)).std(axis=(2, 3))
water_osm = (g == 0x82)
land = (g == 0x03) | (g == 0x1f)
print("OSM 水格", water_osm.sum(), " 陆格", land.sum())
for name, mask in [("OSM水", water_osm), ("OSM陆", land)]:
    print(f"{name}: 亮度 {lum[mask].mean():5.1f} (p10 {np.percentile(lum[mask],10):4.0f})  "
          f"饱和 {satv[mask].mean():.2f}  纹理 {tex[mask].mean():4.1f}")
for T in (50, 60, 70, 80, 90):
    m = (lum < T) & (tex < 12)
    tp = (m & water_osm).sum(); fp = (m & land).sum()
    print(f"阈值 亮度<{T} & 纹理<12 → 水格 {m.sum():>7}  命中OSM水 {tp*100/max(1,water_osm.sum()):5.1f}%  误占陆地 {fp*100/max(1,land.sum()):4.1f}%")
