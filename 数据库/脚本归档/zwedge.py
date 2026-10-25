import io
p = "tools/gen_zwalk.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""def stamp(arr, stencil, density=0.75, seed=0):""",
"""def edge_mask(arr, thick=2):
    \"\"\"轮廓边缘（肢体外侧）：离透明区不超过 thick 像素的不透明像素\"\"\"
    a = arr[:, :, 3] > 0.4
    m = np.zeros_like(a)
    h, w = a.shape
    for dy in range(-thick, thick + 1):
        for dx in range(-thick, thick + 1):
            if dx * dx + dy * dy > thick * thick:
                continue
            ys = slice(max(0, dy), h + min(0, dy))
            xs = slice(max(0, dx), w + min(0, dx))
            sy = slice(max(0, -dy), h + min(0, -dy))
            sx = slice(max(0, -dx), w + min(0, -dx))
            m[ys, xs] |= ~a[sy, sx]
    return a & m


def stamp(arr, stencil, density=0.55, seed=0):""")
s = s.replace("""        if out[y, x, 3] < 0.5:
            continue                      # 透明处不画""",
"""        if out[y, x, 3] < 0.5:
            continue                      # 透明处不画
        if not em[y, x]:
            continue                      # 只染轮廓边缘（肢体），保留衣服主体""")
s = s.replace("""    out = arr.copy()
    rng = np.random.default_rng(seed)""",
"""    out = arr.copy()
    em = edge_mask(arr, 2)
    rng = np.random.default_rng(seed)""")
io.open(p, "w", encoding="utf-8").write(s)
print("已加边缘限制")
