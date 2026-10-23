from PIL import Image
import json, os
Image.MAX_IMAGE_PIXELS = None
meta = json.load(open("data/sat.json", encoding="utf-8"))
im = Image.open("data/sat.jpg")          # z20 源图 36352x28672
TARGET_W = 12288
k = TARGET_W / im.width
W, H = TARGET_W, int(round(im.height * k))
print(f"源 {im.size[0]}x{im.size[1]} → 目标 {W}x{H}  ({W*H/1e6:.0f} MP)")
im = im.convert("RGB").resize((W, H), Image.LANCZOS)
im.save("data/sat.jpg", "JPEG", quality=90, optimize=True)
mb = os.path.getsize("data/sat.jpg") / 1024 / 1024
meta["size"] = [W, H]
meta["provider"] = "google"
meta["note"] = "Google satellite z20, 单张 12288px 甜点尺寸"
json.dump(meta, open("data/sat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"写出 data/sat.jpg  {mb:.1f} MB")
