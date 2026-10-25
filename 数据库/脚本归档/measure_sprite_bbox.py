import os, re, glob
from PIL import Image

IMG = "reference/core/images"
AS = "reference/core/scripts/src/animationfactory"

def frame_ids(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    pairs = re.findall(r"case (\d+):\s*return (_\w+);", txt)
    return [n for _, n in sorted(pairs, key=lambda p: int(p[0]))]

def frame_path(typ, anim, sym, name):
    cls = os.path.join(AS, typ, anim, "%s__%s.as" % (sym, name.lstrip("_")))
    if os.path.exists(cls):
        m = re.search(r'Embed\(source="/_assets/([^"]+)"\)', open(cls, encoding="utf-8", errors="replace").read())
        if m:
            p = os.path.join(IMG, m.group(1))
            if os.path.exists(p):
                return p
    g = glob.glob(os.path.join(IMG, "*%s.%s.%s__%s.png" % (typ, anim, sym, name.lstrip("_"))))
    return g[0] if g else None

print("%-8s %-9s %-9s %-10s %-22s %s" % ("type", "anim", "canvas", "n_frames", "bbox_center_offset", "bbox size"))
for typ, anim, sym in [("guy01","walk","_sj1166"), ("guy01","shoot01","_sj1166"), ("guy01","die01","_sj1166"),
                       ("guy01","turn01","_sj1166"), ("guy01","zrise01","_sj1166"), ("guy01","zattack01","_sj1166"),
                       ("guy01","zdie01","_sj1166"), ("police01","shoot01","_sj1166")]:
    ids = frame_ids(os.path.join(AS, typ, anim, sym + ".as"))
    offs = []
    for name in ids:
        p = frame_path(typ, anim, sym, name)
        if not p:
            continue
        im = Image.open(p).convert("RGBA")
        bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        if not bb:
            continue
        cx = (bb[0] + bb[2]) / 2 - im.width / 2
        cy = (bb[1] + bb[3]) / 2 - im.height / 2
        offs.append((cx, cy, bb[2]-bb[0], bb[3]-bb[1], im.size))
    if not offs:
        print("%-8s %-9s (no frames)" % (typ, anim))
        continue
    cx = sum(o[0] for o in offs)/len(offs); cy = sum(o[1] for o in offs)/len(offs)
    w = max(o[4][0] for o in offs); h = max(o[4][1] for o in offs)
    print("%-8s %-9s %-9s %-10d (%+6.1f,%+6.1f)           %s" % (typ, anim, "%dx%d" % (w, h), len(ids), cx, cy,
          "bbox %dx%d" % (max(o[2] for o in offs), max(o[3] for o in offs))))
