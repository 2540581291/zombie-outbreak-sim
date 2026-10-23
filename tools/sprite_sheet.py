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
    if not m: continue
    t, a, v = m.group(1), m.group(2), m.group(3)
    groups[(t, a, v)].append(f)

# 尺寸抽样
sample = next(iter(groups.values()))[0]
im = Image.open(sample)
print("单帧尺寸示例:", im.size, im.mode, os.path.basename(sample))
print("分组数:", len(groups))

ORDER = ["walk", "run01", "idle01", "idle02", "shoot01", "turn01", "die01",
         "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]
TYPES = ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]
VARIANT = "_sj1166"     # 实色版

def frames_of(t, a, v):
    fs = groups.get((t, a, v)) or groups.get((t, a, "_yc249")) or []
    return sorted(fs, key=lambda p: int(re.match(r"(\d+)", os.path.basename(p)).group(1)))

def montage(types, variant, out, scale=4, bg=(18, 20, 24)):
    rows = []
    for t in types:
        for a in ORDER:
            fs = groups.get((t, a, variant))
            if not fs: continue
            ims = [Image.open(p).convert("RGBA") for p in frames_of(t, a, variant)[:26]]
            if not ims: continue
            rows.append((f"{t}.{a}", ims))
    if not rows: return
    pad, labelh = 6, 14
    cw = max(sum(i.width for i in ims) + pad * len(ims) for _, ims in rows)
    cw = max(cw, 260)
    rh = max(max(i.height for i in ims) for _, ims in rows) + labelh + pad
    W = cw * scale // scale + 8 * scale + pad * 4
    H = rh * len(rows) + pad * 2
    W = (cw + 8 * 6) + pad * 2
    canvas = Image.new("RGBA", (W, H), bg + (255,))
    d = ImageDraw.Draw(canvas)
    y = pad
    for label, ims in rows:
        d.text((pad, y + 2), label, fill=(150, 160, 170, 255))
        x = pad + 72
        for im in ims:
            big = im.resize((im.width * 4, im.height * 4), Image.NEAREST)
            canvas.alpha_composite(big, (x, y + labelh))
            x += big.width + pad
        y += rh
    canvas.save(out)
    print("写出", out, canvas.size, f"({len(rows)} 行)")

for t in TYPES:
    montage([t], VARIANT, f"{OUT}/{t}.png")
