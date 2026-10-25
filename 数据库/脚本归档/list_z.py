import os
base = "reference/sprites"
for t in sorted(os.listdir(base)):
    p = os.path.join(base, t)
    if not os.path.isdir(p) or t == "animals":
        continue
    dirs = sorted(d for d in os.listdir(p) if os.path.isdir(os.path.join(p, d)))
    z = [d for d in dirs if d.startswith("z")]
    print(f"{t:10} 共 {len(dirs):2} 个动画   僵尸相关: {z if z else '无'}")
