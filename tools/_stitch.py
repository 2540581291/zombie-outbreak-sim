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
print("瓦片数", len(tiles), "id 范围", tiles[0][0], "→", tiles[-1][0])
n = len(tiles)
side = int(round(n ** 0.5))
print("按", side, "x", side, "拼")
canvas = Image.new("RGB", (side*256, side*256))
for i, (_, p) in enumerate(tiles[:side*side]):
    canvas.paste(Image.open(p), ((i % side)*256, (i // side)*256))
canvas.resize((1024, 1024), Image.LANCZOS).save("shots/leicester_stitch.png")
print("->", "shots/leicester_stitch.png")
