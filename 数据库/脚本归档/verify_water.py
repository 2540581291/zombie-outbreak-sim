from PIL import Image
import json, zlib, base64, math, random
city = json.load(open("data/city.json", encoding="utf-8"))
sat = json.load(open("data/sat.json", encoding="utf-8"))
col = city["collision"]
g = zlib.decompress(base64.b64decode(col["b64"]))
cols, rows, cell = col["cols"], col["rows"], col["cell"]
img = Image.open("data/" + sat["image"]).convert("RGB"); W, H = img.size
w, s, e, n = sat["bounds"]
lon0, lat0 = city["origin"]
kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
halfW = city["size"][0] / 2; halfH = city["size"][1] / 2
def cell_to_px(c, r):
    x = (c + 0.5) * cell - halfW; z = (r + 0.5) * cell - halfH
    lat = lat0 - z / ky; lon = lon0 + x / kx
    u = (lon - w) / (e - w); v = (n - lat) / (n - s)
    return int(u * W), int(v * H)
def sample(c, r):
    px, py = cell_to_px(c, r)
    if not (0 <= px < W and 0 <= py < H): return None
    return img.getpixel((px, py))
water, land = [], []
random.seed(1)
for i in range(20000):
    k = random.randrange(len(g))
    c, r = k % cols, k // cols
    p = sample(c, r)
    if not p: continue
    if g[k] == 0x82: water.append(p)
    elif g[k] == 0x03: land.append(p)
def avg(lst):
    if not lst: return None
    return tuple(sum(x[i] for x in lst) // len(lst) for i in range(3))
aw, al = avg(water[:800]), avg(land[:800])
print(f"水格样本 {len(water[:800])} 个，平均 RGB = {aw}")
print(f"空地样本 {len(land[:800])} 个，平均 RGB = {al}")
if aw and al:
    print(f"水的蓝/红比 {aw[2]/max(1,aw[0]):.2f}   空地的蓝/红比 {al[2]/max(1,al[0]):.2f}")
    print("→ 水格下面是水" if aw[2] > aw[0] * 1.15 else "→ 水格下面不是水！图层错位")

