import json, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
m = json.load(open("data/sat.json", encoding="utf-8"))
print("sat.json size:", m["size"], " MB:", round(os.path.getsize("data/sat.jpg")/1024/1024,1))
print("tileset 状态:", "已停用" if os.path.exists("data/ground/tileset.json.off") else ("仍启用" if os.path.exists("data/ground/tileset.json") else "无"))
w, s, e, n = m["bounds"]
import math
kx = 111320*math.cos(math.radians(52.5235))
print(f"图幅 {((e-w)*kx):.0f} x {((n-s)*110540):.0f} m")
print(f"当前分辨率 {((e-w)*kx)/m['size'][0]:.4f} m/px")
