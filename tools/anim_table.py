import os, re, glob, json
from PIL import Image

SRC = r"reference/core/scripts/src/animationfactory"
IMG = r"reference/core/images"

def num(txt, fn):
    m = re.search(r"function %s\(\)\s*:\s*\w+\s*\{\s*return ([^;]+);" % fn, txt)
    return m.group(1).strip() if m else None

rows = []
for path in glob.glob(os.path.join(SRC, "*", "*", "_*.as")):
    base = os.path.basename(path)[:-3]
    if "__" in base:            # per-frame asset class, skip
        continue
    parts = path.replace("\\", "/").split("/")
    typ, anim, sym = parts[-3], parts[-2], base
    txt = open(path, encoding="utf-8", errors="replace").read()
    frames = num(txt, "_qk83")
    interval = num(txt, "_br451")
    loop = num(txt, "_wc1144")
    files = glob.glob(os.path.join(IMG, "*%s.%s.%s*" % (typ, anim, sym)))
    size = None
    if files:
        size = "%dx%d" % Image.open(files[0]).size
    rows.append(dict(type=typ, anim=anim, sym=sym, frames=int(frames) if frames else None,
                     interval=int(interval) if interval else None, loop=loop,
                     size=size, nimg=len(files)))

rows.sort(key=lambda r: (r["type"], r["anim"], r["sym"]))
json.dump(rows, open("tools/anim_table.json", "w"), indent=1)
print("%-8s %-9s %-8s %-6s %-6s %-6s %-7s %-9s" % ("type","anim","sym","frames","int_ms","loop","dur_s","size"))
for r in rows:
    dur = (r["frames"] * r["interval"] / 1000.0) if r["frames"] and r["interval"] else 0
    print("%-8s %-9s %-8s %-6s %-6s %-6s %-7.2f %-9s" % (
        r["type"], r["anim"], r["sym"], r["frames"], r["interval"], r["loop"], dur, r["size"]))
print("rows:", len(rows))
