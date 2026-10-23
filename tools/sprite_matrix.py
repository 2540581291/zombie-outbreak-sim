import os, re, glob
from collections import defaultdict
pat = re.compile(r"animationfactory\.(\w+?)\.(\w+?)\.(_\w+?)__")
g = defaultdict(set); cnt = defaultdict(int)
for f in glob.glob("reference/core/images/*.png"):
    m = pat.search(os.path.basename(f))
    if m: g[(m.group(1), m.group(2))].add(m.group(3)); cnt[(m.group(1), m.group(2), m.group(3))] += 1
order = ["walk","run01","idle01","idle02","shoot01","turn01","die01","zrise01","zwalk01","zwalk02","zattack01","zdie01"]
types = ["guy01","guy02","girl01","girl02","fat01","police01"]
print("类型/动作         实色  描边")
for t in types:
    for a in order:
        vs = g.get((t,a))
        if not vs: continue
        print(f"  {t+'/'+a:<18} {cnt.get((t,a,'_sj1166'),0):>4}  {cnt.get((t,a,'_yc249'),0):>4}")
