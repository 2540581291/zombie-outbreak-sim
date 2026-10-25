from PIL import Image
import glob, os
from collections import Counter
for t in ["guy01","girl01","police01","fat01"]:
    cnt = Counter()
    for f in glob.glob(f"reference/sprites/{t}/walk_solid/*.png") + glob.glob(f"reference/sprites/{t}/idle01_solid/*.png"):
        for px in Image.open(f).convert("RGBA").getdata():
            if px[3] > 128: cnt[px[:3]] += 1
    tot = sum(cnt.values())
    print(f"\n{t}: {len(cnt)} 种颜色, {tot} 个不透明像素")
    for c, n in cnt.most_common(10):
        print(f"   #{c[0]:02x}{c[1]:02x}{c[2]:02x}  {n:>5}  {n*100/tot:4.1f}%")
