import json
m = json.load(open("data/sat.json", encoding="utf-8"))
m["provider"] = "google"
m["note"] = "Google satellite z20 → 单图甜点 16384×12831（E_MAX=16384 实测）"
json.dump(m, open("data/sat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("provider →", m["provider"])
