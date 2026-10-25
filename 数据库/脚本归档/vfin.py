import json, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
m = json.load(open("data/sat.json", encoding="utf-8"))
im = Image.open("data/sat.jpg")
print(f"当前 {im.size[0]} x {im.size[1]} = {im.size[0]*im.size[1]/1e6:.0f} MP  "
      f"{os.path.getsize('data/sat.jpg')/1024/1024:.0f} MB  {m['sweetSpot']['r_eff']} m/px")
print("单边是否等于上限:", max(im.size) == 16384)
