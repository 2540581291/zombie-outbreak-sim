import json, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
m = json.load(open("data/sat.json", encoding="utf-8"))
im = Image.open("data/sat.jpg")
print("=== 最终地图 ===")
print(f"  data/sat.jpg   {im.size[0]} x {im.size[1]} = {im.size[0]*im.size[1]/1e6:.0f} MP")
print(f"  文件            {os.path.getsize('data/sat.jpg')/1024/1024:.1f} MB")
print(f"  分辨率          {m['sweetSpot']['r_eff']} m/px")
print(f"  bounds          {[round(v,6) for v in m['bounds']]}")
print(f"  provider        {m.get('provider')}")
print()
print("=== 分块状态 ===")
print("  tileset.json    ", "已停用" if not os.path.exists("data/ground/tileset.json") else "启用")
print("  ground/ 占用    ", round(sum(os.path.getsize(os.path.join("data/ground",f)) for f in os.listdir("data/ground"))/1024/1024), "MB（未使用，可删）")
print()
print("=== 备份 ===")
for f in ("data/sat_z18.jpg", "data/sat_z19.jpg"):
    if os.path.exists(f):
        print(f"  {f}  {os.path.getsize(f)/1024/1024:.0f} MB")
