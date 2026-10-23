#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · PBF 裁剪

从全国/全省的 PBF 里切出一小块（按 bbox），供 bake_pbf.py 快速烘焙。
烘焙 1538 MB 的全国数据要扫两遍，切出几十 MB 的局部文件后每次只要几十秒。

用法：
    python pipeline/cut_pbf.py --pbf pipeline/raw/china.osm.pbf ^
        --out pipeline/raw/henan.osm.pbf ^
        --bbox 112.19,32.95,113.71,34.80

--bbox 是 minlon,minlat,maxlon,maxlat（注意顺序，和 bake_pbf 的 --minlat 系列不同）
"""
import argparse, os, sys

try:
    import osmium
except ImportError:
    sys.exit("需要 pyosmium：pip install osmium")


class Cutter:
    def __init__(self, bbox, out_path):
        self.b = bbox                      # (minlon, minlat, maxlon, maxlat)
        self.out_path = out_path
        self.w = None
        self.kept_ways = set()
        self.n_node = 0
        self.n_way = 0
        self.n_rel = 0

    def inside(self, lon, lat):
        minlon, minlat, maxlon, maxlat = self.b
        return minlon <= lon <= maxlon and minlat <= lat <= maxlat

    def run(self, pbf):
        self.w = osmium.SimpleWriter(self.out_path)
        # locations=True 才能从 way/relation 拿到节点坐标
        handler = self

        class H(osmium.SimpleHandler):
            def node(self, n):
                if n.location.valid() and handler.inside(n.location.lon, n.location.lat):
                    handler.w.add_node(n)
                    handler.n_node += 1

            def way(self, w):
                try:
                    hit = any(handler.inside(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid())
                except Exception:
                    hit = False
                if hit:
                    handler.w.add_way(w)
                    handler.kept_ways.add(w.id)
                    handler.n_way += 1

            def relation(self, r):
                # 成员 way 被保留的 relation 才保留（水面/建筑轮廓）
                try:
                    hit = any(m.type == "w" and m.ref in handler.kept_ways for m in r.members)
                except Exception:
                    hit = False
                if hit:
                    handler.w.add_relation(r)
                    handler.n_rel += 1

        H().apply_file(pbf, locations=True)
        self.w.close()

    def report(self, pbf):
        a = os.path.getsize(pbf) / 1024 / 1024
        b = os.path.getsize(self.out_path) / 1024 / 1024
        print(f"  节点 {self.n_node:,}  way {self.n_way:,}  relation {self.n_rel:,}")
        print(f"  {a:.0f} MB → {b:.1f} MB  （{a/max(b,0.01):.0f}:1）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bbox", required=True, help="minlon,minlat,maxlon,maxlat")
    ap.add_argument("--margin", type=float, default=0.01, help="外扩度数，默认 0.01")
    a = ap.parse_args()

    minlon, minlat, maxlon, maxlat = [float(x) for x in a.bbox.split(",")]
    bbox = (minlon - a.margin, minlat - a.margin, maxlon + a.margin, maxlat + a.margin)

    print(f"裁剪 {os.path.basename(a.pbf)}")
    print(f"  bbox = {bbox}")
    c = Cutter(bbox, a.out)
    c.run(a.pbf)
    c.report(a.pbf)


if __name__ == "__main__":
    main()
