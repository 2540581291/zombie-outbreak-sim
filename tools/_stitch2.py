import sys, glob, os
sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image
tiles = []
for p in glob.glob("reference/core/images/*.jpg"):
    try:
        im = Image.open(p)
        if im.size == (256, 256):
            tiles.append((int(os.path.basename(p).split("_")[0].split(".")[0]), p))
    except Exception: pass
tiles.sort()
side = 18
canvas = Image.new("RGB", (side*256, side*256))
for i, (_, p) in enumerate(tiles[:side*side]):
    col, row = divmod(i, side)          # 列优先
    canvas.paste(Image.open(p), (col*256, row*256))
canvas.resize((900, 900), Image.LANCZOS).save("shots/leicester_colmajor.png")
print("-> shots/leicester_colmajor.png")
