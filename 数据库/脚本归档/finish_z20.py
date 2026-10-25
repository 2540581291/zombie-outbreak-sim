import json, os
sat = json.load(open("data/sat.json", encoding="utf-8"))
sat["provider"] = "google"
sat["note"] = "Google satellite z20"
json.dump(sat, open("data/sat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
mb = os.path.getsize("data/sat.jpg") / 1024 / 1024
w, h = sat["size"]
print(f"sat.jpg  {w} x {h}  = {w*h/1e6:.0f} MP  {mb:.0f} MB")
print(f"贴图显存  约 {w*h*4/1024**3:.1f} GB（不含 mipmap）")
print("备份      data\\sat_z19.jpg（64 MB）  data\\sat_z18.jpg（18 MB）")
