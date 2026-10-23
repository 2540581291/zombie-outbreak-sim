from PIL import Image
import json, zlib, base64, math
city = json.load(open("data/city.json", encoding="utf-8"))
sat = json.load(open("data/sat.json", encoding="utf-8"))
col = city["collision"]
g = zlib.decompress(base64.b64decode(col["b64"]))
cols, rows, cell = col["cols"], col["rows"], col["cell"]
img = Image.open("data/" + sat["image"]).convert("RGB")
W, H = img.size
# 用网格直接生成同尺寸的掩膜（网格正好覆盖城市 = 卫星范围）
mask = Image.new("RGBA", (cols, rows), (0, 0, 0, 0))
px = mask.load()
n_water = 0
for r in range(rows):
    base = r * cols
    for c in range(cols):
        if g[base + c] == 0x82:
            px[c, rows - 1 - r] = (255, 0, 0, 170)
            n_water += 1
mask = mask.resize((W, H), Image.NEAREST)
out = Image.alpha_composite(img.convert("RGBA"), mask).convert("RGB")
out.resize((1400, int(1400 * H / W)), Image.LANCZOS).save("shots/water_check.png")
print(f"水格 {n_water:,} / {cols*rows:,} = {n_water/(cols*rows)*100:.2f}%")
print("输出 shots/water_check.png")

