import json
from collections import defaultdict
d = json.load(open("assets/retro/atlas.json", encoding="utf-8"))
owner = {}
dup = 0
examples = []
for k, variants in d["frames"].items():
    for vi, rects in enumerate(variants):
        for r in rects:
            key = tuple(r[:2])
            if key in owner and owner[key] != (k, vi):
                dup += 1
                if len(examples) < 6:
                    examples.append((owner[key], (k, vi), key))
            owner[key] = (k, vi)
print(f"总矩形 {sum(len(v) for vs in d['frames'].values() for v in vs)}")
print(f"起点重复 {dup}")
for a, b, p in examples:
    print(f"  重复 {p}  {a}  vs  {b}")
# 检查 solid 与 outline 是否共用
sol = {tuple(r[:2]) for k, vs in d["frames"].items() if k.endswith("_solid") for v in vs for r in v}
out = {tuple(r[:2]) for k, vs in d["frames"].items() if k.endswith("_outline") for v in vs for r in v}
print(f"solid 起点 {len(sol)}  outline 起点 {len(out)}  交集 {len(sol & out)}")
