import json
d = json.load(open("assets/retro/atlas.json", encoding="utf-8"))
keys = sorted(d["frames"].keys())
types = sorted({k.split("/")[0] for k in keys})
anims = sorted({k.split("/")[1] for k in keys})
print("精灵类型:", types)
print("动画名  :", anims)
