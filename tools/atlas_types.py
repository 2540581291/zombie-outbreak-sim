import json
d = json.load(open("assets/retro/atlas.json", encoding="utf-8"))
by = {}
for k in d["frames"]:
    t, a = k.split("/")
    by.setdefault(t, set()).add(a.replace("_solid", "").replace("_outline", ""))
for t in sorted(by):
    print(f"{t:14} {len(d['frames'][t+'/walk_solid'])} 帧walk  |  " + " ".join(sorted(by[t])))
