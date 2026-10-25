#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给已有 city.json 的城市补：卫星图 → 按公式定尺寸 → 写索引。不重新烘焙。"""
import os, sys, json, math, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))
from cities import CITIES

PY = sys.executable
URL = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"


def run(cmd):
    print("  $", " ".join(cmd[1:]), flush=True)
    if subprocess.run(cmd, cwd=ROOT).returncode != 0:
        raise SystemExit("失败：" + " ".join(cmd))


def main():
    ids = sys.argv[1:] or [c for c in CITIES]
    for cid in ids:
        cdir = os.path.join("data", "cities", cid)
        if not os.path.exists(os.path.join(cdir, "city.json")):
            print(f"[跳过] {cid}：没有 city.json")
            continue
        print(f"\n=== {cid} ===", flush=True)
        zoom = CITIES[cid].get("zoom", 19)
        if not os.path.exists(os.path.join(cdir, "sat.json")):
            run([PY, "pipeline/fetch_sat.py", "--citydir", cdir, "--zoom", str(zoom),
                 "--threads", "24", "--url", URL])

        meta = json.load(open(os.path.join(cdir, "sat.json"), encoding="utf-8"))
        city = json.load(open(os.path.join(cdir, "city.json"), encoding="utf-8"))
        w, s, e, n = meta["bounds"]
        kx = 111320 * math.cos(math.radians(city["origin"][1]))
        w_m = (e - w) * kx
        h_m = (n - s) * 110540
        res = w_m / meta["size"][0]
        run([PY, "tools/pick_size.py", "--w-m", f"{w_m:.1f}", "--h-m", f"{h_m:.1f}",
             "--res", f"{res:.5f}", "--citydir", cdir, "--apply"])

        idx_path = os.path.join("data", "cities", "index.json")
        idx = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else []
        idx = [x for x in idx if x["id"] != cid]
        idx.append({"id": cid, "name": CITIES[cid]["name"], "bbox": city["bbox"],
                    "size": city["size"], "buildings": len(city["buildings"])})
        idx.sort(key=lambda x: x["id"])
        json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
