import json, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
m = json.load(open("data/sat.json", encoding="utf-8"))
im = Image.open("data/sat.jpg")
mb = os.path.getsize("data/sat.jpg") / 1024 / 1024
print(f"文件   {im.size[0]} x {im.size[1]}  = {im.size[0]*im.size[1]/1e6:.0f} MP  {mb:.1f} MB")
print(f"分辨率 {m.get('sweetSpot',{}).get('r_eff')} m/px")
print(f"分块   {'已停用' if not os.path.exists('data/ground/tileset.json') else '仍启用'}")
