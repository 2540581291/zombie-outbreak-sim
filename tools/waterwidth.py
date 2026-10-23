import io
p = "pipeline/collision.py"
s = io.open(p, encoding="utf-8").read()

# 1) 懒加载卫星亮度图（网格分辨率）
s = s.replace("def _thick(g, a, b, halfw, value):",
'''_LUMA = None


def _luma_of(city, cols, rows):
    """把卫星图降到网格分辨率，取亮度（0-255）。用于测量河道实际宽度。"""
    global _LUMA
    if _LUMA is not None:
        return _LUMA
    try:
        import json
        from PIL import Image
        import numpy as np
        meta = json.load(open("data/sat.json", encoding="utf-8"))
        img = Image.open("data/" + meta["image"]).convert("L").resize((cols, rows), Image.BOX)
        _LUMA = np.asarray(img, dtype=np.float32)
    except Exception:
        _LUMA = False
    return _LUMA


def _halfwidth_cells(g, city, px, py, nx, ny, fallback):
    """沿法线量河道宽度：从中心往外走，亮度突然变亮就是岸。"""
    L = _luma_of(city, g.cols, g.rows)
    if L is None or L is False:
        return fallback
    def val(x, y):
        c, r = g.col(x), g.row(y)
        if 0 <= c < g.cols and 0 <= r < g.rows:
            return L[r, c]
        return None
    l0 = val(px, py)
    if l0 is None:
        return fallback
    lim = l0 + 26.0            # 比中心亮这么多就算上岸
    total = 0; n = 0
    for sgn in (1, -1):
        k = 1
        while k < 40:
            v = val(px + nx * k * g.cell * sgn, py + ny * k * g.cell * sgn)
            if v is None or v > lim:
                break
            k += 1
        total += k; n += 1
    measured = total / max(1, n)
    # 与中心线给的估算值互相约束，防止量到一大片阴影
    lo = max(1.0, fallback * 0.35)
    hi = min(fallback * 1.9, 30.0)
    return max(lo, min(hi, measured))


def _thick(g, a, b, halfw, value):''')

# 2) 河线按实测宽度盖
s = s.replace("""    for wl in city.get("water_lines") or []:
        pts = [tuple(p) for p in wl["p"]]
        halfw = max(0.5, (wl.get("w") or 20) / 2.0)
        for i in range(len(pts) - 1):
            _thick(g, pts[i], pts[i + 1], halfw, WATER)""",
"""    for wl in city.get("water_lines") or []:
        pts = [tuple(p) for p in wl["p"]]
        halfw_m = max(0.5, (wl.get("w") or 20) / 2.0)
        for i in range(len(pts) - 1):
            ax, ay = pts[i]; bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            ln = math.hypot(dx, dy) or 1.0
            nx, ny = -dy / ln, dx / ln
            # 每隔 ~30m 实测一次宽度，两点之间线性过渡
            steps = max(1, int(ln / 30))
            for k in range(steps):
                t0 = k / steps; t1 = (k + 1) / steps
                px, py = ax + dx * t0, ay + dy * t0
                hw = _halfwidth_cells(g, city, px, py, nx, ny, halfw_m / g.cell)
                _thick(g, (px, py), (ax + dx * t1, ay + dy * t1), hw * g.cell, WATER)""")
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
