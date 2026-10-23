from PIL import Image
import json
sat = json.load(open("data/sat.json", encoding="utf-8"))
print("sat.json:", {k: sat[k] for k in ("provider","zoom","size","image")})
im = Image.open("data/" + sat["image"])
print("图像", im.size, f"{0.343:.3f} m/px")
# 中心区域 1:1 裁切（博物馆岛附近）
cx, cy = im.width // 2, int(im.height * 0.72)
im.crop((cx - 450, cy - 340, cx + 450, cy + 340)).save("shots/sat_hd_crop.png")
print("裁出 shots/sat_hd_crop.png 900x680（1:1 像素）")
