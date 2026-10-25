# -*- coding: utf-8 -*-
"""
从 v2 图集里切出某个 clip 的帧条，肉眼确认打包/rect 没串帧。

    python tools/preview_atlas.py guy01/turn01            # 默认全帧
    python tools/preview_atlas.py guy01/turn01 8 out.png  # 取 8 帧采样
"""
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image

doc = json.load(open("assets/atlas/atlas.json", encoding="utf-8"))
atlas = Image.open("assets/atlas/atlas.png").convert("RGBA")

key = sys.argv[1] if len(sys.argv) > 1 else "guy01/turn01"
sample = int(sys.argv[2]) if len(sys.argv) > 2 else 0
out = sys.argv[3] if len(sys.argv) > 3 else "shots/atlas_preview.png"

clip = doc["clips"][key]
frames = clip["frames"]
if sample and len(frames) > sample:
    step = (len(frames) - 1) / (sample - 1)
    frames = [frames[round(i * step)] for i in range(sample)]

Z = 6
w = max(f[2] for f in frames)
h = max(f[3] for f in frames)
img = Image.new("RGBA", (len(frames) * (w * Z + 4) + 4, h * Z + 28), (28, 30, 34, 255))
x = 4
for (rx, ry, rw, rh) in frames:
    piece = atlas.crop((rx, ry, rx + rw, ry + rh)).resize((rw * Z, rh * Z), Image.NEAREST)
    img.alpha_composite(piece, (x, 4 + (h * Z - rh * Z) // 2))
    x += rw * Z + 4
img.convert("RGB").save(out)
print("%s  %d 帧  n=%d ms=%d loop=%s  -> %s" % (key, len(frames), clip["n"], clip["ms"], clip["loop"], out))

# 顺带报一下剪影是不是真的白
if key.endswith("@sil") or (key + "@sil") in doc["clips"]:
    k = key if key.endswith("@sil") else key + "@sil"
    rx, ry, rw, rh = doc["clips"][k]["frames"][0]
    px = atlas.crop((rx, ry, rx + rw, ry + rh)).getdata()
    cols = {p[:3] for p in px if p[3] > 128}
    print("  %s 不透明像素的颜色集合: %s" % (k, list(cols)[:4]))

