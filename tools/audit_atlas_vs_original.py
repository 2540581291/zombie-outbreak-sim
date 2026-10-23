import json, os, re

meta = json.load(open("assets/retro/atlas.json"))
F = meta["frames"]
AS = "reference/core/scripts/src/animationfactory"


def qk83(p):
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.search(r"function _qk83\(\)\s*:\s*int\s*\{\s*return (\d+);", t)
    return int(m.group(1)) if m else None


def interval(p):
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.search(r"function _br451\(\)\s*:\s*int\s*\{\s*return (\d+);", t)
    return int(m.group(1)) if m else None


anims = ["walk", "idle01", "idle02", "run01", "shoot01", "die01", "turn01",
         "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]
types = ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]

print("%-9s %-9s %5s %5s %5s  %s" % ("type", "anim", "orig", "atlas", "diff", "note"))
rows = 0
bad = 0
for t in types:
    for a in anims:
        p = os.path.join(AS, t, a, "_sj1166.as")
        if not os.path.exists(p):
            continue
        n = qk83(p)
        iv = interval(p)
        key = "%s/%s_solid" % (t, a)
        v = F.get(key)
        have = len(v[0]) if v else None
        if have is None:
            print("%-9s %-9s %5s %5s %5s  MISSING in atlas (dur %.2fs)" % (t, a, n, "-", "-", n * iv / 1000))
            bad += 1
            continue
        rows += 1
        if have != n:
            bad += 1
            print("%-9s %-9s %5d %5d %+5d  %s" % (t, a, n, have, have - n,
                  "atlas 少了帧 → 动作偏快" if have < n else "atlas 多了帧"))
print("checked %d combos, %d mismatched" % (rows, bad))
