#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R 城市烘焙器
从 Overpass 拉取一块城区的建筑/道路/水系/绿地，投影到米制局部坐标，
输出 data/city.json（前端直接加载）。

用法:
  python fetch_city.py --name "Berlin Mitte" --minlat 52.5150 --minlon 13.3800 --maxlat 52.5350 --maxlon 13.4250
"""
import argparse, json, math, os, sys, time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ENDPOINTS = [
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

ROAD_WIDTH = {
    "motorway": 24, "motorway_link": 12, "trunk": 20, "trunk_link": 11,
    "primary": 16, "primary_link": 10, "secondary": 13, "secondary_link": 9,
    "tertiary": 11, "tertiary_link": 8, "residential": 8, "unclassified": 7,
    "living_street": 6, "pedestrian": 8, "footway": 3, "path": 2.5,
    "cycleway": 3, "service": 5, "track": 4, "steps": 3,
}
BUILDABLE_HIGHWAY = "|".join(ROAD_WIDTH.keys())

QUERY = """
[out:json][timeout:300];
(
  way["building"]({bbox});
  way["highway"~"^({hw})$"]({bbox});
  way["natural"="water"]({bbox});
  way["waterway"="riverbank"]({bbox});
  way["leisure"~"^(park|garden|common)$"]({bbox});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"]({bbox});
  node["natural"="tree"]({bbox});
);
out geom tags;
"""


def fetch(bbox_str, name):
    q = QUERY.format(bbox=bbox_str, hw=BUILDABLE_HIGHWAY)
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            t0 = time.time()
            try:
                r = requests.post(ep, data=q.encode("utf-8"), timeout=330,
                                  headers={"User-Agent": "zos-remake/1.0 (personal project)",
                                           "Content-Type": "application/x-www-form-urlencoded"})
                if r.status_code != 200:
                    last = f"{ep} -> HTTP {r.status_code}: {r.text[:200]}"
                    print("  [x] " + last, flush=True)
                    continue
                dt = time.time() - t0
                mb = len(r.content) / 1e6
                print(f"  [OK] {ep}  {dt:.1f}s  {mb:.1f} MB", flush=True)
                return r.json()
            except Exception as e:
                last = f"{ep} -> {type(e).__name__}: {e}"
                print("  [x] " + last, flush=True)
    raise RuntimeError(f"所有 Overpass 节点失败: {last}")


def num(v, default=None):
    if v is None:
        return default
    try:
        return float(str(v).replace("m", "").strip())
    except Exception:
        return default


def poly_area(p):
    a = 0.0
    n = len(p)
    for i in range(n):
        x1, y1 = p[i]
        x2, y2 = p[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="City")
    ap.add_argument("--minlat", type=float, required=True)
    ap.add_argument("--minlon", type=float, required=True)
    ap.add_argument("--maxlat", type=float, required=True)
    ap.add_argument("--maxlon", type=float, required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    bbox = f"{args.minlat},{args.minlon},{args.maxlat},{args.maxlon}"
    print(f"[1/3] 拉取 OSM  bbox={bbox}", flush=True)
    raw = fetch(bbox, args.name)

    lat0 = (args.minlat + args.maxlat) / 2
    lon0 = (args.minlon + args.maxlon) / 2
    kx = math.cos(math.radians(lat0)) * 111320.0
    ky = 110540.0

    def proj(lat, lon):
        return ((lon - lon0) * kx, -((lat - lat0) * ky))   # z 南为正（统一坐标系）

    print(f"[2/3] 解析 {len(raw.get('elements', []))} 个元素", flush=True)

    buildings, roads, water, parks, trees = [], [], [], [], []
    is_history = 0
    for el in raw.get("elements", []):
        tags = el.get("tags", {}) or {}
        geom = el.get("geometry")

        if el["type"] == "node" and tags.get("natural") == "tree":
            x, y = proj(el["lat"], el["lon"])
            trees.append((x, y))
            continue

        if not geom or len(geom) < 2:
            continue
        pts = []
        for g in geom:
            if g is None:
                continue
            pts.append(proj(g["lat"], g["lon"]))
        if len(pts) < 2:
            continue

        if "building" in tags:
            if len(pts) < 3:
                continue
            if pts[0] != pts[-1]:
                pass  # 闭合交给前端
            area = poly_area(pts)
            if area < 10:
                continue
            h = num(tags.get("height"))
            if h is None:
                lv = num(tags.get("building:levels"))
                if lv is not None:
                    h = lv * 3.3 + 1.8
            if h is None:
                # 面积启发式
                if area < 90:
                    h = 7.0
                elif area < 400:
                    h = 11.0
                elif area < 1500:
                    h = 17.0
                elif area < 5000:
                    h = 24.0
                else:
                    h = 30.0
            else:
                is_history += 1
            h = max(3.5, min(h, 300.0))
            ring = [(round(x, 1), round(y, 1)) for x, y in pts]
            buildings.append({"p": ring, "h": round(h, 1)})
            continue

        if "highway" in tags:
            hw = tags["highway"]
            w = ROAD_WIDTH.get(hw, 5)
            if tags.get("tunnel") in ("yes", "building_passage"):
                continue
            line = [(round(x, 1), round(y, 1)) for x, y in pts]
            if len(line) >= 2:
                roads.append({"p": line, "w": w, "t": hw})
            continue

        if tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
            if len(pts) >= 3:
                water.append({"p": [(round(x, 1), round(y, 1)) for x, y in pts]})
            continue

        if tags.get("leisure") in ("park", "garden", "common") or \
           tags.get("landuse") in ("grass", "forest", "meadow", "recreation_ground"):
            if len(pts) >= 3:
                parks.append({"p": [(round(x, 1), round(y, 1)) for x, y in pts],
                              "k": tags.get("landuse") or tags.get("leisure")})
            continue

    # 树太多就抽样
    if len(trees) > 20000:
        step = len(trees) // 20000 + 1
        trees = trees[::step]

    W = (args.maxlon - args.minlon) * kx
    H = (args.maxlat - args.minlat) * ky
    out = {
        "name": args.name,
        "bbox": [args.minlat, args.minlon, args.maxlat, args.maxlon],
        "origin": [lon0, lat0],
        "size": [round(W, 1), round(H, 1)],
        "buildings": buildings,
        "roads": roads,
        "water": water,
        "parks": parks,
        "trees": [[round(x, 1), round(y, 1)] for x, y in trees],
    }

    path = args.out or os.path.join(os.path.dirname(__file__), "..", "data", "city.json")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    mb = os.path.getsize(path) / 1e6
    print(f"[3/3] 写出 {path}  {mb:.2f} MB", flush=True)
    print(f"      面积 {W/1000:.2f} x {H/1000:.2f} km = {W*H/1e6:.2f} km²", flush=True)
    print(f"      建筑 {len(buildings)} (带真实高度 {is_history})  道路 {len(roads)}  "
          f"水系 {len(water)}  绿地 {len(parks)}  树 {len(trees)}", flush=True)


if __name__ == "__main__":
    main()

