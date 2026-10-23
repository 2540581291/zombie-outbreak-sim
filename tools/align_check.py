from PIL import Image, ImageDraw
import json
city = json.load(open("data/city.json", encoding="utf-8"))
sat = json.load(open("data/sat.json", encoding="utf-8"))
img = Image.open("data/" + sat["image"]).convert("RGB")
W, H = img.size
w, s, e, n = sat["bounds"]
lon0, lat0 = city["origin"]
kx = 111320 * __import__("math").cos(__import__("math").radians(lat0))
ky = 110540
def world(lon, lat):
    return ((lon - lon0) * kx, -((lat - lat0) * ky))
# 卫星图四角的世界坐标
nw = world(w, n); se = world(e, s)
def to_px(x, z):
    # 世界坐标 → 图片像素
    u = (x - nw[0]) / (se[0] - nw[0])
    v = (z - nw[1]) / (se[1] - nw[1])
    return (u * W, v * H)
# 城市尺寸（米）→ 转经纬度 → 世界坐标
def local_to_lonlat(x, y):
    return (lon0 + x / kx, lat0 + y / ky)
d = ImageDraw.Draw(img)
cnt = 0
for b in city["buildings"][::6]:
    pts = []
    for (x, y) in b["p"]:
        lon, lat = local_to_lonlat(x, y)
        wx, wz = world(lon, lat)
        pts.append(to_px(wx, wz))
    if len(pts) >= 3:
        d.line(pts + [pts[0]], fill=(255, 40, 40), width=1)
        cnt += 1
img.crop((0, 0, 1400, 1000)).save("shots/align_check.png")
print("画了", cnt, "栋，输出 shots/align_check.png", img.size)

