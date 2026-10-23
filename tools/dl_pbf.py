#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 OSM PBF，支持断点续传和多轮重试（Geofabrik 连接经常被中途掐断）。"""
import os, time, requests

H = {"User-Agent": "ZOS-R personal project"}
JOB = [
    ("kanto.osm.pbf", "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf"),
    ("china.osm.pbf", "https://download.geofabrik.de/asia/china-latest.osm.pbf"),
]
OUT = os.path.join("pipeline", "raw")


def total_size(url):
    try:
        r = requests.head(url, headers=H, timeout=60, allow_redirects=True)
        return int(r.headers.get("content-length", 0))
    except Exception:
        return 0


def fetch(url, path, total, rounds=40):
    for i in range(rounds):
        have = os.path.getsize(path) if os.path.exists(path) else 0
        if total and have >= total:
            print(f"  已完整 {have/1024/1024:.0f} MB", flush=True)
            return True
        hdr = dict(H)
        if have:
            hdr["Range"] = f"bytes={have}-"
        try:
            with requests.get(url, headers=hdr, stream=True, timeout=(30, 120)) as r:
                if r.status_code not in (200, 206):
                    print(f"  HTTP {r.status_code}，5 秒后重试", flush=True)
                    time.sleep(5)
                    continue
                mode = "ab" if (have and r.status_code == 206) else "wb"
                if mode == "wb" and have:
                    have = 0
                with open(path, mode) as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                        have += len(chunk)
                        if total and have % (100 << 20) < (1 << 20):
                            print(f"  {have/1024/1024:.0f}/{total/1024/1024:.0f} MB", flush=True)
        except Exception as e:
            print(f"  第 {i+1} 轮中断（{type(e).__name__}），2 秒后续传", flush=True)
            time.sleep(2)
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, url in JOB:
        path = os.path.join(OUT, name)
        print(f"下载 {name}", flush=True)
        total = total_size(url)
        ok = fetch(url, path, total)
        sz = os.path.getsize(path) / 1024 / 1024 if os.path.exists(path) else 0
        print(f"{'完成' if ok else '未完成'} {name}  {sz:.0f} MB", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
