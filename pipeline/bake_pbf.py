#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 从 OSM PBF 离线烘焙城市
比 Overpass 稳定、可全城离线、不依赖网络。

用法:
  python bake_pbf.py --pbf raw/berlin.osm.pbf --name "Berlin Mitte" \
      --minlat 52.5140 --minlon 13.3800 --maxlat 52.5330 --maxlon 13.4230
"""
import argparse, json, math, os, random, sys, time, hashlib

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import osmium

try:
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    HAVE_SHAPELY = True
except Exception:
    HAVE_SHAPELY = False

ROAD_WIDTH = {
    "motorway": 24, "motorway_link": 12, "trunk": 20, "trunk_link": 11,
    "primary": 16, "primary_link": 10, "secondary": 13, "secondary_link": 9,
    "tertiary": 11, "tertiary_link": 8, "residential": 8, "unclassified": 7,
    "living_street": 6, "pedestrian": 8, "footway": 3, "path": 2.5,
    "cycleway": 3, "service": 5, "track": 4, "steps": 3, "construction": 6,
}
SKIP_HW = {"proposed", "abandoned", "planned", "raceway", "bus_guideway"}

HEIGHT_DEFAULT = {
    # 兜底：按 footprint 面积估
}

def num(v):
    if v is None:
        return None
    try:
        return float(str(v).replace("m", "").replace(",", ".").strip())
    except Exception:
        return None


def poly_area(p):
    a = 0.0
    n = len(p)
    for i in range(n):
        x1, y1 = p[i]
        x2, y2 = p[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def _interior_point(pts):
    """在多边形内部取一个稳妥的点（用于"这栋楼里的某个位置"）。

    质心对 L 形 / 凹形建筑会落到楼外，所以用扫描线：取质心高度，
    求这一行上所有交点，取最宽的一段的中点。
    """
    ys = [p[1] for p in pts]
    cy = sum(ys) / len(ys)
    xs = []
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > cy) != (y2 > cy):
            xs.append(x1 + (cy - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    if len(xs) >= 2:
        best = (0.0, xs[0], xs[1])
        for k in range(0, len(xs) - 1, 2):
            w = xs[k + 1] - xs[k]
            if w > best[0]:
                best = (w, xs[k], xs[k + 1])
        return (best[1] + best[2]) / 2, cy
    return sum(p[0] for p in pts) / n, cy


# 每 Km² 期望多少个（中国小城也至少 1 个医院/警局）
POI_DENSITY = {
    "police":   (2.0, 1), "hospital": (3.0, 1), "fire":   (6.0, 0),
    "school":   (1.5, 1), "market":   (1.0, 2), "transit": (3.0, 1),
    "pharmacy": (2.0, 0), "gov":      (4.0, 0),
}
POI_MIN_DIST = {"police": 350, "hospital": 500, "school": 300, "market": 150,
                "transit": 400, "pharmacy": 120, "gov": 400, "fire": 500}
POI_MIN_AREA = {"police": 250, "hospital": 400, "school": 300, "market": 120,
                "transit": 250, "pharmacy": 80, "gov": 300, "fire": 150}


def infer_pois(buildings, size, pois, verbose=True):
    """没有 amenity 数据的地图（中国城市常见）也要有医院/警局。

    做法：**按建筑存量推导** —— 目标数量按城市面积缩放，从楼里挑，
    位置取多边形内部点（所以一定在楼里，不会落在空地或水上）。
    随机种子 = 城市尺寸的哈希 → 同一张地图每次结果完全一致，换地图自动变。
    """
    W, H = size
    km2 = W * H / 1e6
    have = {}
    for p in pois:
        have[p["k"]] = have.get(p["k"], 0) + 1

    rnd = random.Random(int(hashlib.md5(f"{W:.0f}x{H:.0f}".encode()).hexdigest()[:8], 16))
    cand = []
    for b in buildings:
        pts = [tuple(q) for q in b["p"]]
        a = poly_area(pts)
        if a >= 80:
            x, y = _interior_point(pts)
            cand.append({"a": a, "x": x, "z": y, "h": b.get("h", 0)})
    cand.sort(key=lambda c: -c["a"])
    if not cand:
        return 0

    made = 0
    for kind, (per_km2, min_n) in POI_DENSITY.items():
        want = max(min_n, int(round(km2 / per_km2)))
        need = want - have.get(kind, 0)
        if need <= 0:
            continue
        # 医院/警局/政府/车站挑大的；超市/药店可以小一点
        big = kind in ("hospital", "police", "gov", "transit", "fire")
        pool = cand[: max(need * 6, 12)] if big else cand
        picked = []
        for c in pool:
            if len(picked) >= need:
                break
            if c["a"] < POI_MIN_AREA[kind]:
                continue
            dmin = POI_MIN_DIST[kind]
            if any((c["x"] - q["x"]) ** 2 + (c["z"] - q["z"]) ** 2 < dmin * dmin for q in picked):
                continue
            picked.append(c)
            pois.append({"k": kind, "x": round(c["x"], 1), "z": round(c["z"], 1),
                         "n": "", "a": round(c["a"], 0), "i": 1})
            made += 1
    if verbose and made:
        print(f"      推导 POI {made} 个（地图 {km2:.1f} km²，OSM 标签只有 "
              f"{sum(have.values())} 个）", flush=True)
    return made


def _in_poly(x, y, pts):
    """射线法判点是否在多边形内。"""
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def snap_pois_to_buildings(buildings, pois, max_dist=160, verbose=True):
    """把 POI 收进"某栋楼"里 —— 这是数据层的不变量。

    OSM 的 amenity 节点常常画在马路上，取到的坐标并不属于任何建筑；
    而"医院在空地/河上"是绝对不能接受的。所以：
      · 点在某栋楼里 → 改成这栋楼的内部点（更稳，贴近楼心）
      · 不在任何楼里 → 找 160m 内最近的楼，挪到它的内部点
      · 附近连楼都没有 → 丢掉（宁可少一个 POI，也不要一个假的）
    """
    if not pois:
        return 0, 0
    bl = []
    for b in buildings:
        pts = [tuple(p) for p in b["p"]]
        if len(pts) < 3:
            continue
        a = poly_area(pts)
        if a < 40:
            continue
        x, y = _interior_point(pts)
        if not _in_poly(x, y, pts):
            # 扫描线失败（自交 / 退化多边形）→ 退到包围盒中心，再不行就跳过这栋
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            bx, by = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            if _in_poly(bx, by, pts):
                x, y = bx, by
            else:
                continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        bl.append({"pts": pts, "x": x, "y": y, "cx": cx, "cy": cy, "a": a})
    if not bl:
        return 0, 0

    kept, moved, dropped = [], 0, 0
    for p in pois:
        px, py = p["x"], p["z"]
        host = None
        for b in bl:
            xs = [q[0] for q in b["pts"]]
            ys = [q[1] for q in b["pts"]]
            if not (min(xs) <= px <= max(xs) and min(ys) <= py <= max(ys)):
                continue
            if _in_poly(px, py, b["pts"]):
                host = b
                break
        if host is None:
            best, bd = None, max_dist * max_dist
            for b in bl:
                d = (b["cx"] - px) ** 2 + (b["cy"] - py) ** 2
                if d < bd:
                    best, bd = b, d
            if best is None:
                dropped += 1
                continue
            host = best
            moved += 1
        p["x"] = round(host["x"], 1)
        p["z"] = round(host["y"], 1)
        p["a"] = round(max(p.get("a") or 0, host["a"]), 0)
        kept.append(p)
    if verbose and (moved or dropped):
        print(f"      POI 收进建筑：挪位 {moved} 个，丢弃 {dropped} 个（附近没有楼）", flush=True)
    return kept, moved, dropped


def height_of(tags, area):
    h = num(tags.get("height"))
    if h is not None and h > 0:
        return h, True
    lv = num(tags.get("building:levels"))
    if lv is not None and lv > 0:
        return lv * 3.3 + 1.8, True
    lv2 = num(tags.get("building:levels:aboveground"))
    if lv2 is not None and lv2 > 0:
        return lv2 * 3.3 + 1.8, True
    # 面积启发式
    if area < 90:
        return 7.0, False
    if area < 400:
        return 11.0, False
    if area < 1500:
        return 17.0, False
    if area < 5000:
        return 24.0, False
    return 30.0, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True, nargs="+")
    ap.add_argument("--name", default="City")
    ap.add_argument("--minlat", type=float, required=True)
    ap.add_argument("--minlon", type=float, required=True)
    ap.add_argument("--maxlat", type=float, required=True)
    ap.add_argument("--maxlon", type=float, required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--overpass", action="store_true")
    ap.add_argument("--cell", type=float, default=1.0, help="碰撞格边长（米）")
    args = ap.parse_args()

    mlat, mlon, xlat, xlon = args.minlat, args.minlon, args.maxlat, args.maxlon
    lat0 = (mlat + xlat) / 2
    lon0 = (mlon + xlon) / 2
    kx = math.cos(math.radians(lat0)) * 111320.0
    ky = 110540.0
    W = (xlon - mlon) * kx
    H = (xlat - mlat) * ky
    halfW, halfH = W / 2, H / 2
    PAD = 0.0015        # 建筑/道路的边界容差
    PAD_BIG = 0.012     # 水面环要闭合到框外，节点范围放大 ~1.3km

    def proj(lat, lon):
        # 统一坐标系：x 东为正、z 南为正（= 前端世界坐标，2D 正北朝上就是 -z）
        # 以前这里吐的是 y 北为正，导致每跨一次边界都要翻符号，POI 就因此镜像过一次。
        return ((lon - lon0) * kx, -((lat - lat0) * ky))

    # OSM 标签 → POI 类型（顺序即优先级）
    POI_TAGS = [
        ("amenity", "police", "police"), ("amenity", "hospital", "hospital"),
        ("amenity", "clinic", "hospital"), ("amenity", "fire_station", "fire"),
        ("amenity", "school", "school"), ("amenity", "university", "school"),
        ("amenity", "college", "school"), ("amenity", "kindergarten", "school"),
        ("amenity", "marketplace", "market"), ("shop", "supermarket", "market"),
        ("shop", "convenience", "market"), ("amenity", "pharmacy", "pharmacy"),
        ("amenity", "townhall", "gov"), ("amenity", "courthouse", "gov"),
        ("railway", "station", "transit"), ("public_transport", "station", "transit"),
        ("amenity", "bus_station", "transit"),
    ]

    def poi_kind(t):
        for k, v, kind in POI_TAGS:
            if t.get(k) == v:
                return kind
        return None

    nodes = {}
    buildings, roads, water, parks, trees = [], [], [], [], []
    barriers, entrances, water_lines, bridges = [], [], [], []
    pois = []          # 地点属性：医院 / 警局 / 学校 / 超市 / 车站 / 药店 / 政府
    real_h = 0
    t0 = time.time()

    # ---- 第一遍：找出所有水面 multipolygon 用到的 way ----
    needed = set()

    class RelScan(osmium.SimpleHandler):
        def relation(self, r):
            t = r.tags
            if t.get("type") == "multipolygon" and (
                    t.get("natural") == "water" or t.get("waterway") in ("riverbank", "river", "canal", "stream", "drain")):
                for m in r.members:
                    if m.type == "w":
                        needed.add(m.ref)

    _rs = RelScan()
    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        _rs.apply_file(_f, locations=False)
    print(f"      水面 multipolygon 涉及 {len(needed)} 条 way", flush=True)

    way_coords = {}

    def assemble_rings(segs):
        segs = [list(x) for x in segs]
        rings = []
        while segs:
            ring = segs.pop(0)
            changed = True
            while ring[0] != ring[-1] and changed:
                changed = False
                for i, sq in enumerate(segs):
                    if sq[0] == ring[-1]: ring += sq[1:]; segs.pop(i); changed = True; break
                    if sq[-1] == ring[-1]: ring += sq[::-1][1:]; segs.pop(i); changed = True; break
                    if sq[-1] == ring[0]: ring = sq[:-1] + ring; segs.pop(i); changed = True; break
                    if sq[0] == ring[0]: ring = sq[::-1][:-1] + ring; segs.pop(i); changed = True; break
            if len(ring) >= 4 and ring[0] == ring[-1]:
                rings.append(ring)
        return rings

    class Handler(osmium.SimpleHandler):
        def node(self, n):
            lat, lon = n.location.lat, n.location.lon
            if mlat - PAD_BIG <= lat <= xlat + PAD_BIG and mlon - PAD_BIG <= lon <= xlon + PAD_BIG:
                nodes[n.id] = (lat, lon)
                if n.tags.get("natural") == "tree":
                    trees.append(proj(lat, lon))
                if n.tags.get("entrance") or n.tags.get("building") == "entrance":
                    entrances.append(proj(lat, lon))
                _k = poi_kind(n.tags)
                if _k:
                    _x, _y = proj(lat, lon)
                    if -W / 2 <= _x <= W / 2 and -H / 2 <= _y <= H / 2:
                        pois.append({"k": _k, "x": round(_x, 1), "z": round(_y, 1),
                                     "n": (n.tags.get("name") or "")[:40], "a": 0})

        def relation(self, r):
            t = r.tags
            if not (t.get("type") == "multipolygon" and
                    (t.get("natural") == "water" or t.get("waterway") in ("riverbank", "river", "canal", "stream", "drain"))):
                return
            outers, inners = [], []
            for m in r.members:
                if m.type != "w":
                    continue
                c = way_coords.get(m.ref)
                if not c:
                    continue
                (outers if m.role != "inner" else inners).append(c)
            for ring in assemble_rings(outers):
                water.append({"p": [[round(x, 1), round(y, 1)] for x, y in ring],
                              "hole": [[[round(x, 1), round(y, 1)] for x, y in h]
                                       for h in assemble_rings(inners)]})

        def way(self, w):
            t = w.tags
            _poi = poi_kind(t)
            if _poi is None and not (("building" in t) or ("highway" in t) or ("barrier" in t)
                    or t.get("natural") == "water"
                    or t.get("waterway") in ("riverbank", "river", "canal", "stream", "drain")
                    or t.get("leisure") in ("park", "garden", "common")
                    or t.get("landuse") in ("grass", "forest", "meadow", "recreation_ground")):
                return
            pts = []
            miss = False
            for nd in w.nodes:
                c = nodes.get(nd.ref)
                if c is None:
                    miss = True
                    continue
                pts.append(proj(c[0], c[1]))
            if w.id in needed:
                way_coords[w.id] = list(pts)
            if len(pts) < 2:
                return

            def outside(pts):
                cx = sum(q[0] for q in pts) / len(pts)
                cy = sum(q[1] for q in pts) / len(pts)
                return not (-W / 2 - 30 <= cx <= W / 2 + 30 and -H / 2 - 30 <= cy <= H / 2 + 30)

            # POI 多边形：用质心 + 面积
            if _poi and len(pts) >= 3 and not outside(pts):
                _a = poly_area(pts)
                if _a >= 20:
                    pois.append({"k": _poi,
                                 "x": round(sum(q[0] for q in pts) / len(pts), 1),
                                 "z": round(sum(q[1] for q in pts) / len(pts), 1),
                                 "n": (t.get("name") or "")[:40], "a": round(_a, 0)})

            if "building" in t:
                nonlocal real_h
                if len(pts) < 3 or outside(pts):
                    return
                area = poly_area(pts)
                if area < 10:
                    return
                h, isreal = height_of(t, area)
                if isreal:
                    real_h += 1
                h = max(3.5, min(h, 320.0))
                buildings.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                                  "h": round(h, 1)})
                return

            if "highway" in t:
                if outside(pts):
                    return
                hw = t["highway"]
                if hw in SKIP_HW:
                    return
                if t.get("tunnel") in ("yes", "building_passage"):
                    return
                wd = ROAD_WIDTH.get(hw, 5)
                roads.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                              "w": wd, "t": hw})
                if t.get("bridge") and t.get("bridge") not in ("no",):
                    bridges.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts], "w": wd})
                return

            if "barrier" in t:
                if len(pts) >= 2 and t.get("barrier") not in ("no", "entrance", "kerb", "gate"):
                    barriers.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                                     "k": t.get("barrier")})
                return

            if t.get("waterway") in ("river", "canal", "stream", "drain"):
                wk = t.get("waterway")
                wd = {"river": 70, "canal": 32, "stream": 8, "drain": 6}.get(wk, 10)
                if len(pts) >= 2:
                    water_lines.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts], "w": wd})
                return

            if t.get("natural") == "water" or t.get("waterway") == "riverbank":
                if len(pts) >= 3:
                    water.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts]})
                return

            if len(pts) >= 3:
                parks.append({"p": [[round(x, 1), round(y, 1)] for x, y in pts],
                              "k": t.get("landuse") or t.get("leisure")})

    _files = args.pbf if isinstance(args.pbf, list) else [args.pbf]
    _names = ", ".join(os.path.basename(f) for f in _files[:3]) + (" …" if len(_files) > 3 else "")
    print(f"[1/3] 解析 {_names} （{len(_files)} 个文件）…", flush=True)
    _h = Handler()
    for _f in (args.pbf if isinstance(args.pbf, list) else [args.pbf]):
        _h.apply_file(_f, locations=False)
    print(f"      {time.time()-t0:.1f}s  节点 {len(nodes):,}  建筑 {len(buildings):,}  "
          f"道路 {len(roads):,}  水系 {len(water)}  绿地 {len(parks)}  树 {len(trees):,}", flush=True)

    if len(trees) > 22000:
        step = len(trees) // 22000 + 1
        trees = trees[::step]

    out = {
        "name": args.name,
        "bbox": [mlat, mlon, xlat, xlon],
        "origin": [lon0, lat0],
        "size": [round(W, 1), round(H, 1)],
        "buildings": buildings,
        "roads": roads,
        "water": water,
        "parks": parks,
        "trees": [[round(x, 1), round(y, 1)] for x, y in trees],
        "water_lines": water_lines,
        "bridges": bridges,
        "pois": pois,
        "barriers": barriers,
        "entrances": [[round(x, 1), round(y, 1)] for x, y in entrances],
    }

    # ---------- POI：先用 OSM 标签，缺的按建筑存量推导，最后全部收进建筑 ----------
    infer_pois(buildings, [W, H], pois, verbose=True)
    pois, _moved, _dropped = snap_pois_to_buildings(buildings, pois, verbose=True)
    out["pois"] = pois          # out 是在这之前建的，必须重新绑定（否则丢弃的不生效）
    print(f"      POI 共 {len(pois)} 个"
          f"（标签 {sum(1 for p in pois if not p.get('i'))} + 推导 {sum(1 for p in pois if p.get('i'))}）", flush=True)

    # ---------- 碰撞层 ----------
    path = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "city.json")
    print("[3/4] 生成碰撞层…", flush=True)
    import collision
    # 河宽要从这个城市的卫星图量（裁 bbox 对齐网格后再取亮度）
    sat_path = os.path.join(os.path.dirname(os.path.abspath(path)), "sat.json")
    col = collision.build(out, cell=args.cell, sat_path=sat_path)
    out["collision"] = {
        "cell": col["cell"], "cols": col["cols"], "rows": col["rows"],
        "b64": col["b64"],
    }
    print(f"      压缩 {col['raw']:,} → {col['comp']:,} 字节 "
          f"（{col['raw']/max(1,col['comp']):.1f}:1，base64 后 {len(col['b64']):,}）", flush=True)

    path = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "city.json")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    mb = os.path.getsize(path) / 1e6
    print(f"[4/4] 写出 {os.path.abspath(path)}  {mb:.2f} MB", flush=True)
    print(f"      面积 {W/1000:.2f} x {H/1000:.2f} km = {W*H/1e6:.2f} km²", flush=True)
    print(f"      建筑 {len(buildings):,}（真实高度 {real_h:,} = {real_h/max(1,len(buildings))*100:.0f}%）", flush=True)


if __name__ == "__main__":
    main()


