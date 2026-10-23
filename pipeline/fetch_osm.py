#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 用 OSM 官方 API 取一个 bbox 的数据

官方 API 有 5 万节点上限，超了就返回 400。这里自动递归四分，直到每块都能取下来，
输出若干 .osm 文件（bake_pbf.py 可以一次读多个）。

    python pipeline/fetch_osm.py --city zhengzhou

输出：pipeline/raw/<city>_*.osm
"""
import argparse, os, sys, time
import requests

H = {"User-Agent": "ZOS-R personal project (offline zombie simulation, personal use)"}
API = "https://api.openstreetmap.org/api/0.6/map?bbox={}"
OUT = os.path.join("pipeline", "raw")
MAX_DEPTH = 5


def get(bbox, tries=3):
    """返回 (ok, content)。bbox = (minlon, minlat, maxlon, maxlat)"""
    url = API.format("%.6f,%.6f,%.6f,%.6f" % bbox)
    for i in range(tries):
        try:
            r = requests.get(url, headers=H, timeout=180)
            if r.status_code == 200:
                return True, r.content
            if r.status_code == 400 and "too many nodes" in r.text:
                return False, "too many nodes"
            if r.status_code in (429, 502, 503, 504):
                time.sleep(3 * (i + 1))
                continue
            return False, f"HTTP {r.status_code} {r.text[:80]}"
        except Exception as e:
            time.sleep(2 * (i + 1))
            if i == tries - 1:
                return False, type(e).__name__
    return False, "retries exhausted"


def split(bbox):
    a, b, c, d = bbox
    mx, my = (a + c) / 2, (b + d) / 2
    return [(a, b, mx, my), (mx, b, c, my), (a, my, mx, d), (mx, my, c, d)]


def fetch(bbox, out_prefix, depth=0, files=None):
    if files is None:
        files = []
    ok, data = get(bbox)
    if ok:
        fn = f"{out_prefix}_{len(files):02d}.osm"
        with open(fn, "wb") as f:
            f.write(data)
        files.append(fn)
        mb = len(data) / 1024 / 1024
        print(f"    [{len(files)-1:02d}] {mb:6.2f} MB  {bbox}", flush=True)
        return files
    if data == "too many nodes" and depth < MAX_DEPTH:
        print(f"    拆分（第 {depth+1} 层）", flush=True)
        for sub in split(bbox):
            fetch(sub, out_prefix, depth + 1, files)
        return files
    print(f"    失败：{data}  {bbox}", flush=True)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--bbox", default="", help="minlon,minlat,maxlon,maxlat（不填则从 cities.py 读）")
    ap.add_argument("--margin", type=float, default=0.004)
    a = ap.parse_args()

    if a.bbox:
        bbox = tuple(float(x) for x in a.bbox.split(","))
    else:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/.." + "/tools")
        from cities import CITIES
        c = CITIES[a.city]
        bbox = (c["minlon"], c["minlat"], c["maxlon"], c["maxlat"])

    m = a.margin
    bbox = (bbox[0] - m, bbox[1] - m, bbox[2] + m, bbox[3] + m)
    os.makedirs(OUT, exist_ok=True)
    print(f"取 {a.city}  bbox={tuple(round(v,5) for v in bbox)}")
    files = fetch(bbox, os.path.join(OUT, a.city))
    total = sum(os.path.getsize(f) for f in files) / 1024 / 1024
    print(f"完成：{len(files)} 个文件，共 {total:.2f} MB")
    print("文件列表（传给 bake_pbf.py --pbf）:")
    print("  " + " ".join(files))


if __name__ == "__main__":
    main()
