import os, re, glob, json, shutil
from collections import defaultdict
from PIL import Image, ImageDraw

pat = re.compile(r"animationfactory\.(\w+?)\.(\w+?)\.(_\w+?)__")
files = defaultdict(list)
for f in glob.glob("reference/core/images/*.png"):
    m = pat.search(os.path.basename(f))
    if m: files[(m.group(1), m.group(2), m.group(3))].append(f)

ROOT = "reference/sprites"
shutil.rmtree(ROOT, ignore_errors=True)
order = ["walk","run01","idle01","idle02","shoot01","turn01","die01","zrise01","zwalk01","zwalk02","zattack01","zdie01"]
variant_name = {"_sj1166": "solid", "_yc249": "outline"}

manifest = {}
total = 0
for (t, a, v), fs in sorted(files.items()):
    fs = sorted(fs, key=lambda p: int(re.match(r"(\d+)", os.path.basename(p)).group(1)))
    d = os.path.join(ROOT, t, f"{a}_{variant_name[v]}")
    os.makedirs(d, exist_ok=True)
    for i, f in enumerate(fs):
        shutil.copy(f, os.path.join(d, f"{i:02d}.png"))
    total += len(fs)

print(f"整理完成：{total} 帧 → {ROOT}/<类型>/<动作_变体>/NN.png")
for t in ["guy01","guy02","girl01","girl02","fat01","police01"]:
    dirs = sorted(os.listdir(os.path.join(ROOT, t)))
    print(f"  {t}: {len(dirs)} 组  {', '.join(dirs)}")
