"""Build figure assets for the ZOS-R technical report.
Everything is taken straight out of reference/core (the decompiled 2009 SWF):
frame order comes from each animation class' _ir761() switch, pixels from the
exported PNGs, the shadow blob is _dw934__vt862.
"""
import os, re, glob
from PIL import Image, ImageDraw, ImageFont

IMG = "reference/core/images"
AS = "reference/core/scripts/src/animationfactory"
OUT = "shots"
FONT = "C:/Windows/Fonts/msyh.ttc"
BG = (24, 26, 30, 255)


def frame_ids(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    pairs = re.findall(r"case (\d+):\s*return (_\w+);", txt)
    return [n for _, n in sorted(pairs, key=lambda p: int(p[0]))]


def frame_file(typ, anim, sym, name):
    """Resolve one frame to a PNG. Frame classes embed either
    /_assets/<symbol path>_<id>.png (-> named PNG) or a bare /_assets/<n>.png
    (-> <n>.png); the bare form is how the SWF shares bitmaps between clips."""
    cls = os.path.join(AS, typ, anim, "%s__%s.as" % (sym, name.lstrip("_")))
    if not os.path.exists(cls):
        cls = os.path.join(AS, typ, anim, name + ".as")
    if os.path.exists(cls):
        m = re.search(r'Embed\(source="/_assets/([^"]+)"\)', open(cls, encoding="utf-8", errors="replace").read())
        if m:
            p = os.path.join(IMG, m.group(1))
            if os.path.exists(p):
                return p
    ids = glob.glob(os.path.join(IMG, "*%s.%s.%s__%s.png" % (typ, anim, sym, name.lstrip("_"))))
    return ids[0] if ids else None


def frames(typ, anim, sym, sample=None):
    path = os.path.join(AS, typ, anim, sym + ".as")
    if not os.path.exists(path):
        return []
    out = []
    for name in frame_ids(path):
        f = frame_file(typ, anim, sym, name)
        if f:
            out.append(Image.open(f).convert("RGBA"))
    if sample and len(out) > sample:
        step = (len(out) - 1) / (sample - 1)
        out = [out[round(i * step)] for i in range(sample)]
    return out


# ---------------- figure 1: the bite -> zombie sprite chain ----------------
CHAIN = [
    ("walk",      "_sj1166", "walk  行走",        "8f / 150ms  循环"),
    ("idle01",    "_sj1166", "idle01  站立",      "29f / 150ms 循环"),
    ("die01",     "_sj1166", "die01  被打死",     "25f / 150ms 一次性"),
    ("turn01",    "_sj1166", "turn01  感染发作",  "49f / 150ms 一次性"),
    ("zrise01",   "_sj1166", "zrise01  尸体爬起", "43f / 150ms 一次性"),
    ("zwalk01",   "_sj1166", "zwalk01  丧尸游荡", "8f / 200ms  循环"),
    ("zattack01", "_sj1166", "zattack01  扑咬",   "8f / 150ms  一次性"),
    ("zdie01",    "_sj1166", "zdie01  丧尸倒下",  "25f / 150ms 一次性"),
]
ZOOM = 4
CELL_W, CELL_H = 196, 104
LABEL_W = 210
font_l = ImageFont.truetype(FONT, 14)
font_s = ImageFont.truetype(FONT, 10)

W = LABEL_W + CELL_W * 8 + 20
H = 60 + len(CHAIN) * (CELL_H + 6) + 10
sheet = Image.new("RGBA", (W, H), BG)
d = ImageDraw.Draw(sheet)
d.text((12, 12), "原版 2009 ZOS · 被咬→尸变 的精灵链 (guy01, _sj1166 实色版, 每行等距采样)", font=ImageFont.truetype(FONT, 16), fill=(238, 238, 244, 255))
d.text((12, 34), "帧序来自反编译的 _ir761() switch，像素来自 zos-core.swf 导出的 PNG", font=font_s, fill=(140, 146, 158, 255))
y = 60
for anim, sym, label, note in CHAIN:
    fr = frames("guy01", anim, sym, sample=8)
    d.text((12, y + CELL_H // 2 - 12), label, font=font_l, fill=(222, 224, 232, 255))
    d.text((12, y + CELL_H // 2 + 4), note, font=font_s, fill=(140, 146, 158, 255))
    x = LABEL_W
    for f in fr:
        big = f.resize((f.width * ZOOM, f.height * ZOOM), Image.NEAREST)
        sheet.alpha_composite(big, (x + (CELL_W - big.width) // 2, y + (CELL_H - big.height) // 2))
        x += CELL_W
    y += CELL_H + 6
sheet.convert("RGB").save(os.path.join(OUT, "原版_被咬到尸变_精灵链.png"))
print("wrote chain", sheet.size)

# ---------------- figure 2: shadow + 三色剪影 ----------------
shadow = Image.open(glob.glob(os.path.join(IMG, "*_dw934__vt862.png"))[0]).convert("RGBA")
Z = 9
PW, PH = 210, 190
variants = [
    ("实色 + 阴影（默认）",   "guy01", "walk", "_sj1166", True),
    ("只有实色（无阴影）",    "guy01", "walk", "_sj1166", False),
    ("平民·屋内 绿色剪影",    "guy01", "turn01", "_yc249", False),
    ("警察·屋内 蓝色剪影",    "police01", "walk", "_yc249", False),
    ("丧尸·屋内 红色剪影",    "guy01", "zwalk01", "_yc249", False),
]
canvas = Image.new("RGBA", (PW * len(variants) + 10, PH + 48), BG)
d = ImageDraw.Draw(canvas)

ground = Image.new("RGBA", (PW, PH), (96, 100, 88, 255))
gd = ImageDraw.Draw(ground)
for i in range(0, PW, 22):
    for j in range(0, PH, 22):
        if (i // 22 + j // 22) % 2 == 0:
            gd.rectangle([i, j, i + 21, j + 21], fill=(90, 94, 82, 255))

for k, (label, typ, anim, sym, use_shadow) in enumerate(variants):
    tile = ground.copy()
    fr = frames(typ, anim, sym)
    if not fr:
        fr = frames(typ, anim, "_sj1166")
    body = fr[len(fr) // 2]
    cx, cy = PW // 2, PH // 2
    if use_shadow:
        sh = shadow.resize((shadow.width * Z, shadow.height * Z), Image.BILINEAR)
        tile.alpha_composite(sh, (cx - 8 * Z - sh.width // 2, cy - 2 * Z - sh.height // 2))
    b = body.resize((body.width * Z, body.height * Z), Image.NEAREST)
    tile.alpha_composite(b, (cx - b.width // 2, cy - b.height // 2))
    canvas.alpha_composite(tile, (k * PW + 5, 5))
    d.text((k * PW + 10, PH + 14), label, font=ImageFont.truetype(FONT, 13), fill=(228, 228, 234, 255))
canvas.convert("RGB").save(os.path.join(OUT, "原版_阴影与三色剪影.png"))
print("wrote shadow", canvas.size)
