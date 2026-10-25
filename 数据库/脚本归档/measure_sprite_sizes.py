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


agg = {}
for typ in ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]:
    for anim in ["walk", "idle01", "idle02", "run01", "shoot01", "die01", "turn01",
                 "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]:
        p = os.path.join(AS, typ, anim, "_sj1166.as")
        if not os.path.exists(p):
            continue
        ids = frame_ids(p)
        f = frame_path(typ, anim, "_sj1166", ids[0]) if ids else None
        if not f:
            agg.setdefault(anim, []).append((typ, None))
            continue
        agg.setdefault(anim, []).append((typ, Image.open(f).size))

for anim in agg:
    sizes = [(t, s) for t, s in agg[anim]]
    known = [(t, s) for t, s in sizes if s]
    if not known:
        print("%-10s (none)" % anim)
        continue
    ws = [s[0] for _, s in known]
    hs = [s[1] for _, s in known]
    detail = " ".join("%s=%dx%d" % (t, s[0], s[1]) for t, s in known)
    print("%-10s %dx%d .. %dx%d   %s" % (anim, min(ws), min(hs), max(ws), max(hs), detail))
