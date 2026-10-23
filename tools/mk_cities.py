import json, os
import math
b = "data/cities/berlin"
city = json.load(open(os.path.join(b, "city.json"), encoding="utf-8"))
idx = [{
    "id": "berlin",
    "name": "Berlin Mitte",
    "bbox": city["bbox"],
    "size": city["size"],
    "buildings": len(city["buildings"]),
}]
json.dump(idx, open("data/cities/index.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("已建 data/cities/index.json，柏林已迁入 data/cities/berlin/")
print("柏林 bbox:", city["bbox"], " 面积", [round(v) for v in city["size"]])
