import os, json, glob
from PIL import Image
CELL, COLS = 64, 32
SRC, OUT = "reference/sprites", "assets/retro"
# animals 子目录也收进来
SRC_EXTRA = "reference/sprites/animals"
os.makedirs(OUT, exist_ok=True)
files = []
dirs = []
if os.path.isdir(SRC_EXTRA):
    for a in sorted(os.listdir(SRC_EXTRA)):
        dirs.append(("animals", a, sorted(glob.glob(os.path.join(SRC_EXTRA, a, "*", "*.png")))))
    # 按 anim 拆开
    dirs = []
    for a in sorted(os.listdir(SRC_EXTRA)):
        for anim in sorted(os.listdir(os.path.join(SRC_EXTRA, a))):
            fs = sorted(glob.glob(os.path.join(SRC_EXTRA, a, anim, "*.png")))
            if fs:
                dirs.append(("animals_" + a, anim, fs))
for t, a, fs in dirs:
    files.append((t, a, fs))
for t in sorted(os.listdir(SRC)):
    tp = os.path.join(SRC, t)
    if not os.path.isdir(tp): continue
    for a in sorted(os.listdir(tp)):
        ap = os.path.join(tp, a)
        if not os.path.isdir(ap): continue
        fs = sorted(glob.glob(os.path.join(ap, "*.png")))
        if fs: files.append((t, a, fs))
total = sum(len(f) for _, _, f in files)
rows = (total + COLS - 1) // COLS
atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
frames, i = {}, 0
scaled = 0
for t, a, fs in files:
    rects = []
    for f in fs:
        im = Image.open(f).convert("RGBA")
        if im.width > CELL or im.height > CELL:
            k = min(CELL / im.width, CELL / im.height)
            im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
            scaled += 1
        x = (i % COLS) * CELL + (CELL - im.width) // 2
        y = (i // COLS) * CELL + (CELL - im.height) // 2
        atlas.alpha_composite(im, (x, y))
        rects.append([x, y, im.width, im.height])
        i += 1
    frames[f"{t}/{a}"] = rects
atlas.save(os.path.join(OUT, "atlas.png"))
json.dump({"cell": CELL, "cols": COLS, "rows": rows, "w": atlas.width, "h": atlas.height,
           "count": total, "frames": frames},
          open(os.path.join(OUT, "atlas.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"图集 {atlas.width}×{atlas.height}  {total} 帧  {os.path.getsize(os.path.join(OUT,'atlas.png'))/1024:.0f} KB  缩小过大的帧 {scaled}")
