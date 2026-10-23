import json, os
idx_path = "data/cities/index.json"
idx = json.load(open(idx_path, encoding="utf-8"))
for x in idx:
    c = json.load(open(os.path.join("data", "cities", x["id"], "city.json"), encoding="utf-8"))
    x["buildings"] = len(c["buildings"])
    x["size"] = c["size"]
    x["cell"] = c["collision"]["cell"]
    x["cells"] = c["collision"]["cols"] * c["collision"]["rows"]
json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("id          建筑     格边长  格数        碰撞层内存")
for x in idx:
    print(f"  {x['id']:10} {x['buildings']:>6}   {x['cell']}m  {x['cells']:>9,}  {x['cells']/1048576:5.1f} MB")
