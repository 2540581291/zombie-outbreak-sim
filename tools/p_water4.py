import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()

# 节点收集范围放大（水面环需要闭合到框外），但建筑仍限在原框内
s = s.replace("    PAD = 0.0015  # 略微外扩，避免边界建筑被切",
"    PAD = 0.0015        # 建筑/道路的边界容差\n    PAD_BIG = 0.012     # 水面环要闭合到框外，节点范围放大 ~1.3km")

s = s.replace("if mlat - PAD <= lat <= xlat + PAD and mlon - PAD <= lon <= xlon + PAD:",
"if mlat - PAD_BIG <= lat <= xlat + PAD_BIG and mlon - PAD_BIG <= lon <= xlon + PAD_BIG:")

# way 里缺节点不要整条丢弃，跳过该点继续
s = s.replace("""            pts = []
            for nd in w.nodes:
                c = nodes.get(nd.ref)
                if c is None:
                    return
                pts.append(proj(c[0], c[1]))""",
"""            pts = []
            miss = False
            for nd in w.nodes:
                c = nodes.get(nd.ref)
                if c is None:
                    miss = True
                    continue
                pts.append(proj(c[0], c[1]))""")

# 建筑/道路/绿地：中心点必须在真实框内，避免把框外的整座城都拉进来
s = s.replace("""            if "building" in t:
                nonlocal real_h
                if len(pts) < 3:
                    return""",
"""            def outside(pts):
                cx = sum(q[0] for q in pts) / len(pts)
                cy = sum(q[1] for q in pts) / len(pts)
                return not (-W / 2 - 30 <= cx <= W / 2 + 30 and -H / 2 - 30 <= cy <= H / 2 + 30)

            if "building" in t:
                nonlocal real_h
                if len(pts) < 3 or outside(pts):
                    return""")
s = s.replace("""            if "highway" in t:
                hw = t["highway"]""",
"""            if "highway" in t:
                if outside(pts):
                    return
                hw = t["highway"]""")
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
