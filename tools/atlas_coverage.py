import json
F = json.load(open("assets/retro/atlas.json", encoding="utf-8"))["frames"]
BODIES = ["guy01", "girl01", "guy02", "fat01"]
def chain(t, a):
    for k in (f"{t}/{a}_solid", f"{t}/walk_solid", f"{t}/idle01_solid",
              f"fat01/{a}_solid", "fat01/walk_solid"):
        if k in F: return k
    return None
# 每种体型 × 每种动画：命中情况
cases = {
 "平民走路 walk":      ("walk", ["guy01","guy02","fat01"]),
 "平民站着 idle01":    ("idle01", ["guy01","guy02","fat01"]),
 "平民逃跑 run01":     ("run01", ["guy01","guy02","fat01"]),
 "平民开枪 shoot01":   ("shoot01", ["guy01","guy02","fat01"]),
 "市民死亡 die01":     ("die01", ["guy01","guy02","fat01"]),
 "警察走路 walk":      ("walk", ["police01"]),
 "警察开枪 shoot01":   ("shoot01", ["police01"]),
 "丧尸走路 zwalk01":   ("zwalk01", BODIES),
 "丧尸攻击 zattack01": ("zattack01", BODIES),
 "丧尸死亡 zdie01":    ("zdie01", BODIES),
 "尸变起身 zrise01":   ("zrise01", BODIES),
 "狗走路 walk":        ("walk", ["animals_dog"]),
 "狗丧尸 walk":        ("walk", ["animals_dog_z"]),
 "熊走路 walk":        ("walk", ["animals_bear"]),
 "虎走路 walk":        ("walk", ["animals_tiger"]),
}
bad = 0
for name, (anim, types) in cases.items():
    row = []
    for t in types:
        k = chain(t, anim)
        exact = k == f"{t}/{anim}_solid"
        row.append(f"{t}:{'✓' if exact else ('→'+k.split('/')[0] if k else '✗')}")
        if not k: bad += 1
    print(f"{name:20} " + "  ".join(row))
print(f"\n完全取不到的: {bad}")
