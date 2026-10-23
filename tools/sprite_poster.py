from PIL import Image, ImageDraw
import os

ROOT = "reference/sprites"
TYPES = [("guy01","男 1"),("guy02","男 2"),("girl01","女 1"),
         ("girl02","女 2"),("fat01","胖子"),("police01","警察")]
ANIMS = [("walk_solid","走"),("run01_solid","跑"),("zrise01_solid","尸变"),
         ("zattack01_solid","咬")]

CELL, GAP, HDR = 34, 3, 16     # 每帧格子、间距、行标题高
NFRAME = 5

def load(t, anim):
    d = os.path.join(ROOT, t, anim)
    if not os.path.isdir(d): return []
    return [Image.open(os.path.join(d, f)).convert("RGBA") for f in sorted(os.listdir(d))]

colW = NFRAME * (CELL + GAP)
W = 8 + len(TYPES) * (colW + 14)
H = 8 + 22 + len(ANIMS) * (CELL + HDR + 6)
c = Image.new("RGBA", (W, H), (16, 18, 22, 255))
d = ImageDraw.Draw(c)

x0 = 8
for t, cn in TYPES:
    d.text((x0, 6), cn, fill=(210, 220, 230, 255))
    y = 28
    for a, an in ANIMS:
        ims = load(t, a)[:NFRAME]
        d.text((x0, y), an, fill=(120, 132, 145, 255))
        if ims:
            # 均匀抽帧
            step = max(1, len(load(t, a)) // NFRAME)
            allf = load(t, a)
            pick = [allf[min(i * step, len(allf) - 1)] for i in range(NFRAME)]
            xx = x0 + 14
            for im in pick:
                big = im.resize((CELL, CELL), Image.NEAREST)
                c.alpha_composite(big, (xx, y))
                xx += CELL + GAP
        y += CELL + HDR
    x0 += colW + 14

c.save("shots/sprites/poster.png")
print("写出 shots/sprites/poster.png", c.size)
