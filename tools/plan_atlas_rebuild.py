"""可行性核算：能不能从 reference/core 重建一份"帧数完全正确"的复古图集。
只读、只统计，不写任何图。"""
import os, re, glob
from PIL import Image

IMG = "reference/core/images"
AS = "reference/core/scripts/src/animationfactory"
TYPES = ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]
ANIMS = ["walk", "idle01", "idle02", "run01", "shoot01", "die01",
         "turn01", "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]


def qk83(p):
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.search(r"function _qk83\(\)\s*:\s*int\s*\{\s*return (\d+);", t)
    return int(m.group(1)) if m else None


def interval(p):
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.search(r"function _br451\(\)\s*:\s*int\s*\{\s*return (\d+);", t)
    return int(m.group(1)) if m else None


def frame_ids(p):
    t = open(p, encoding="utf-8", errors="replace").read()
    pairs = re.findall(r"case (\d+):\s*return (_\w+);", t)
    return [n for _, n in sorted(pairs, key=lambda x: int(x[0]))]


def resolve(typ, anim, sym, name):
    cls = os.path.join(AS, typ, anim, "%s__%s.as" % (sym, name.lstrip("_")))
    if os.path.exists(cls):
        t = open(cls, encoding="utf-8", errors="replace").read()
        m = re.search(r'Embed\(source="/_assets/([^"]+)"\)', t)
        if m and os.path.exists(os.path.join(IMG, m.group(1))):
            return os.path.join(IMG, m.group(1))
    g = glob.glob(os.path.join(IMG, "*%s.%s.%s__%s.png" % (typ, anim, sym, name.lstrip("_"))))
    return g[0] if g else None


total = 0
missing = 0
combos = 0
area = 0
size_cache = {}
sizes = {}
for typ in TYPES:
    for anim in ANIMS:
        p = os.path.join(AS, typ, anim, "_sj1166.as")
        if not os.path.exists(p):
            continue
        n = qk83(p)
        iv = interval(p)
        for sym in ("_sj1166", "_yc249"):
            ids = frame_ids(os.path.join(AS, typ, anim, sym + ".as"))
            combos += 1
            if len(ids) != n:
                print("  ! %s/%s%s frame count %d != %d" % (typ, anim, sym, len(ids), n))
            for name in ids:
                f = resolve(typ, anim, sym, name)
                if not f:
                    missing += 1
                    continue
                total += 1
                if f not in size_cache:
                    im = Image.open(f)
                    size_cache[f] = im.size
                    area += im.size[0] * im.size[1]
                sizes[(typ, anim, sym)] = size_cache[f]

print("combos(动画×两套贴图):", combos)
print("可解析帧总数:", total, "  解析失败:", missing)
print("去重后的不同图片数:", len(size_cache))
print("图片像素总面积: %.1f M px" % (area / 1e6))

# 64×64 cell 打包估算
cells = total
cols = 32
rows = (cells + cols - 1) // cols
print("按 64×64 cell 打包: %d 格 → %d×%d = %.1f M px (%.1f MB RGBA)"
      % (cells, cols * 64, rows * 64, cols * 64 * rows * 64 / 1e6, cols * 64 * rows * 64 * 4 / 1e6))

mx = 0
for k, v in sizes.items():
    mx = max(mx, v[0], v[1])
print("单帧最大边长:", mx, "px  → 64×64 cell 是否够:", "够" if mx <= 64 else "不够")
