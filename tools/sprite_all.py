from PIL import Image, ImageDraw
import os

ROOT = "reference/sprites"
ORDER = ["walk_solid","run01_solid","idle01_solid","idle02_solid","shoot01_solid",
         "turn01_solid","die01_solid","zrise01_solid","zwalk01_solid","zattack01_solid","zdie01_solid"]
TYPES = [("guy01","男 1"),("guy02","男 2"),("girl01","女 1"),("girl02","女 2"),
         ("fat01","胖子"),("police01","警察")]
SCALE, PAD, LABW, LABH = 6, 6, 92, 16

def load(t, anim):
    d = os.path.join(ROOT, t, anim)
    if not os.path.isdir(d): return []
    return [Image.open(os.path.join(d, f)).convert("RGBA") for f in sorted(os.listdir(d))]

rows = []
for t, cn in TYPES:
    for a in ORDER:
        ims = load(t, a)
        if ims: rows.append((f"{cn} {a.replace('_solid','')}", ims[:14]))

W = LABW + max(sum(i.width for i in ims) * SCALE + PAD * len(ims) for _, ims in rows) + PAD
H = sum(max(i.height for i in ims) * SCALE + LABH for _, ims in rows) + PAD
c = Image.new("RGBA", (W, H), (16, 18, 22, 255))
d = ImageDraw.Draw(c)
y = PAD
for label, ims in rows:
    d.text((PAD, y + 4), label, fill=(150, 162, 175, 255))
    x = LABW
    for i in ims:
        big = i.resize((i.width * SCALE, i.height * SCALE), Image.NEAREST)
        c.alpha_composite(big, (x, y + 2))
        x += big.width + PAD
    y += max(i.height for i in ims) * SCALE + LABH
    d.line([(0, y - 6), (W, y - 6)], fill=(30, 34, 40, 255))
c.save("shots/sprites/all_types.png")
print("写出 shots/sprites/all_types.png", c.size, f"({len(rows)} 行)")
