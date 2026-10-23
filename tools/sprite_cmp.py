from PIL import Image, ImageDraw
import os, glob
rows = []
for t in ("guy01", "fat01", "police01"):
    for a in ("walk_solid", "walk_outline"):
        p = f"reference/sprites/{t}/{a}/00.png"
        if not os.path.exists(p):
            cand = sorted(glob.glob(f"reference/sprites/{t}/{a}/*.png"))
            p = cand[0] if cand else None
        rows.append((f"{t}/{a}", p))
S = 10
cellw = 340
c = Image.new("RGBA", (cellw * 2 + 20, len(rows) // 2 * 220 + 20), (24, 26, 30, 255))
d = ImageDraw.Draw(c)
for i, (name, p) in enumerate(rows):
    if not p: continue
    im = Image.open(p).convert("RGBA")
    sc = min(200 // max(1, im.width), 180 // max(1, im.height))
    sc = max(1, sc)
    im2 = im.resize((im.width * sc, im.height * sc), Image.NEAREST)
    x = 10 + (i % 2) * (cellw + 10)
    y = 10 + (i // 2) * 220
    c.alpha_composite(im2, (x, y + 20))
    d.text((x, y + 4), f"{name}  {Image.open(p).size}", fill=(150, 200, 160, 255))
c.save("shots/sprite_variants.png")
print("写出 shots/sprite_variants.png")
for name, p in rows:
    if p: print(f"  {name}: {Image.open(p).size}")
