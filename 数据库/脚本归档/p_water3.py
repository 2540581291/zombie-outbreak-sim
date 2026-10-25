import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
anchor = "    class Handler(osmium.SimpleHandler):"
block = '''    # ---- 第一遍：找出所有水面 multipolygon 用到的 way ----
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

'''
assert anchor in s
s = s.replace(anchor, block + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("inserted")
