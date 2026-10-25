import json, os
sat = json.load(open("data/sat.json", encoding="utf-8"))
w, h = sat["size"]
print(f"已恢复 z19: {w} x {h} = {w*h/1e6:.0f} MP  {os.path.getsize('data/sat.jpg')/1024/1024:.0f} MB")
print(f"z20 是 {36352}x{28672} = {36352*28672/1e6:.0f} MP（超限，已被替换掉，原文件仍在 data/sat_z20.jpg 吗？)")
print("z20 存在:", os.path.exists("data/sat_z20.jpg"))
