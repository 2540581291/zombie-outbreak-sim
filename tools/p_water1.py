import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()

# 1) 增加关系（multipolygon 水面）支持：先扫一遍收集成员 way id
s = s.replace("""    print(f"[1/4] 解析 {os.path.basename(args.pbf)} …", flush=True)""",
"""    # ---- 第一遍：找出所有水面 multipolygon 用到的 way ----
    needed = set()

    class RelScan(osmium.SimpleHandler):
        def relation(self, r):
            t = r.tags
            if t.get("type") == "multipolygon" and (
                    t.get("natural") == "water" or t.get("waterway") == "riverbank"):
                for m in r.members:
                    if m.type == "w":
                        needed.add(m.ref)

    RelScan().apply_file(args.pbf, locations=False)
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

    print(f"[1/4] 解析 {os.path.basename(args.pbf)} …", flush=True)""")

# 2) way 里收集水面成员坐标
s = s.replace("""            pts = []
            for nd in w.nodes:
                c = nodes.get(nd.ref)
                if c is None:
                    return
                pts.append(proj(c[0], c[1]))""",
"""            pts = []
            for nd in w.nodes:
                c = nodes.get(nd.ref)
                if c is None:
                    return
                pts.append(proj(c[0], c[1]))
            if w.id in needed:
                way_coords[w.id] = list(pts)""")

# 3) 增加 relation 处理
s = s.replace("""    print(f"[1/4] 解析 {os.path.basename(args.pbf)} …", flush=True)""", """    print(f"[1/4] 解析 {os.path.basename(args.pbf)} …", flush=True)""")
s = s.replace("""        def way(self, w):""",
"""        def relation(self, r):
            t = r.tags
            if not (t.get("type") == "multipolygon" and
                    (t.get("natural") == "water" or t.get("waterway") == "riverbank")):
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

        def way(self, w):""")
io.open(p, "w", encoding="utf-8").write(s)
print("bake patched")
