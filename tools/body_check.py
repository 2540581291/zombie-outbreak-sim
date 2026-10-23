import json
F = json.load(open("assets/retro/atlas.json", encoding="utf-8"))["frames"]
CIV = ["guy01","guy02","girl01","girl02","fat01"]
# 模拟 200 个平民的体型分布
from collections import Counter
c = Counter()
for i in range(200):
    c[CIV[(i * 2654435761 & 0xFFFFFFFF) % len(CIV)]] += 1
print("平民体型分布（200 人）:", dict(c))
# 每种体型的动画覆盖
for t in CIV:
    have = [a for a in ("walk","idle01","idle02","run01","shoot01","die01")
            if f"{t}/{a}_solid" in F]
    print(f"  {t:9} {len(have)}/6  " + " ".join(have))
