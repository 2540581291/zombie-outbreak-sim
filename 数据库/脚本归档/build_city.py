#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 一键生成一个城市

    python tools/build_city.py tokyo
    python tools/build_city.py all

流程：PBF → 烘焙 city.json → 拉卫星图 → 按公式定尺寸缩放 → 更新 cities/index.json
PBF 需要事先放在 pipeline/raw/ 里（见 tools/cities.py 的 pbf 字段）。
"""
import os, sys, json, subprocess, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cities import CITIES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable


def run(cmd):
    print("  $", " ".join(str(c) for c in cmd[1:]), flush=True)
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"失败：{cmd[1:]}")


def build(cid):
    c = CITIES[cid]
    cdir = os.path.join("data", "cities", cid)
    os.makedirs(cdir, exist_ok=True)
    pbf = os.path.join("pipeline", "raw", c["pbf"])
    if not os.path.exists(pbf):
        # 有切片文件就用切片（快很多）
        cut = os.path.join("pipeline", "raw", c.get("cut", ""))
        if c.get("cut") and os.path.exists(cut):
            pbf = cut
        else:
            print(f"[跳过] {cid}：缺少 {pbf}")
            return False

    print(f"\n=== {c['name']} ({cid}) ===", flush=True)

    # 1. 烘焙
    run([PY, "pipeline/bake_pbf.py", "--pbf", pbf, "--name", c["name"],
         "--minlat", str(c["minlat"]), "--minlon", str(c["minlon"]),
         "--maxlat", str(c["maxlat"]), "--maxlon", str(c["maxlon"]),
         "--out", os.path.join(cdir, "city.json")])

    # 2. 卫星图
    run([PY, "pipeline/fetch_sat.py", "--citydir", cdir, "--zoom", str(c.get("zoom", 19)),
         "--threads", "24",
         "--url", "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"])

    # 3. 按公式定尺寸（从刚下载的原图反推真实 m/px）
    sj = os.path.join(cdir, "sat.json")
    meta = json.load(open(sj, encoding="utf-8"))
    city = json.load(open(os.path.join(cdir, "city.json"), encoding="utf-8"))
    w, s, e, n = meta["bounds"]
    kx = 111320 * math.cos(math.radians(city["origin"][1]))
    w_m = (e - w) * kx
    h_m = (n - s) * 110540
    res = w_m / meta["size"][0]
    run([PY, "tools/pick_size.py", "--w-m", f"{w_m:.1f}", "--h-m", f"{h_m:.1f}",
         "--res", f"{res:.5f}", "--citydir", cdir, "--apply"])

    # 4. 更新索引
    idx_path = os.path.join("data", "cities", "index.json")
    idx = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else []
    idx = [x for x in idx if x["id"] != cid]
    idx.append({"id": cid, "name": c["name"], "bbox": city["bbox"],
                "size": city["size"], "buildings": len(city["buildings"])})
    idx.sort(key=lambda x: x["id"])
    json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"完成 {cid}：{len(city['buildings'])} 栋建筑，已写入 index.json", flush=True)
    return True


def main():
    args = sys.argv[1:] or ["all"]
    ids = list(CITIES) if args[0] == "all" else args
    for cid in ids:
        if cid not in CITIES:
            print(f"未知城市 {cid}，可选：{', '.join(CITIES)}")
            continue
        build(cid)


if __name__ == "__main__":
    main()
