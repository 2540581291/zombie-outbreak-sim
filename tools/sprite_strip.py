from PIL import Image, ImageDraw
import os, re, glob
from collections import defaultdict

SRC = "reference/core/images"
OUT = "shots/sprites"
os.makedirs(OUT, exist_ok=True)
pat = re.compile(r"animationfactory\.(\w+?)\.(\w+?)\.(_\w+?)__")
groups = defaultdict(list)
for f in glob.glob(os.path.join(SRC, "*.png")):
    m = pat.search(os.path.basename(f))
    if m: groups[(m.group(1), m.group(2), m.group(3))].append(f)

def frames(t, a, v):
    if (t, a, v) not in groups: return []
    return sorted(groups[(t, a, v)], key=lambda p: int(re.match(r"(\d+)", os.path.basename(p)).group(1)))

def strip(t, a, v, scale, out):
    fs = frames(t, a, v)
    if not fs: return
    ims = [Image.open(p).convert("RGBA") for p in fs]
    w = sum(i.width for i in ims) * scale + 8 * (len(ims) + 1)
    h = max(i.height for i in ims) * scale + 28
    c = Image.new("RGBA", (w, h), (14, 16, 20, 255))
    d = ImageDraw.Draw(c)
    d.text((8, 6), f"{t}.{a} {v}  ({len(ims)} 帧, 单帧 {ims[0].size[0]}x{ims[0].size[1]})", fill=(140, 150, 160, 255))
    x = 8
    for i in ims:
        big = i.resize((i.width * scale, i.height * scale), Image.NEAREST)
        c.alpha_composite(big, (x, 24))
        x += big.width + 8
    c.save(out)
    print("写出", out, c.size)

strip("guy01", "walk",  "_sj1166", 10, f"{OUT}/guy01_walk.png")
strip("guy01", "walk",  "_yc249", 10, f"{OUT}/guy01_walk_outline.png")
strip("guy01", "idle02","_sj1166", 10, f"{OUT}/guy01_idle02.png")
strip("guy01", "die01", "_sj1166", 10, f"{OUT}/guy01_die.png")
strip("police01","shoot01","_sj1166", 10, f"{OUT}/police01_shoot.png")
