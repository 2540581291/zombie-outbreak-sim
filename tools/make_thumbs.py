# -*- coding: utf-8 -*-
"""给 data/cities/*/sat.jpg 生成 192px 缩略图（城市选择弹窗用）"""
import os, glob, sys
sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
n = 0
for d in sorted(glob.glob("data/cities/*")):
    s, o = os.path.join(d, "sat.jpg"), os.path.join(d, "thumb.jpg")
    if not os.path.exists(s): continue
    im = Image.open(s); im.draft("RGB", (512, 512))
    im = im.convert("RGB"); im.thumbnail((192, 192), Image.LANCZOS)
    im.save(o, quality=82); n += 1
print("生成缩略图", n, "张")
