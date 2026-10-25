import io
# 1) collision.js：行方向对齐 Python（第 0 行 = 南）
p = "js/collision.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    idx(x, z) {
      const cc = ((x + this.halfW) / this.cell) | 0;
      const rr = ((z + this.halfH) / this.cell) | 0;""",
"""    idx(x, z) {
      // 注意：Python 生成时 y 是"北为正"，所以第 0 行是南边。
      // 世界 z 是"南为正"，这里必须反过来算，否则整张图上下颠倒。
      const cc = ((x + this.halfW) / this.cell) | 0;
      const rr = ((this.halfH - z) / this.cell) | 0;""")
s = s.replace("""        const cc = ((x0 + dx * t + this.halfW) / this.cell) | 0;
        const rr = ((z0 + dz * t + this.halfH) / this.cell) | 0;""",
"""        const cc = ((x0 + dx * t + this.halfW) / this.cell) | 0;
        const rr = ((this.halfH - (z0 + dz * t)) / this.cell) | 0;""")
io.open(p, "w", encoding="utf-8").write(s)

# 2) overlay.js：行已经对齐，不再需要翻转
p2 = "js/overlay.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""        const i = (r * cols + c) * 4;
        // 图集需要上下翻转（UV 原点在左下）
        const rr = rows - 1 - r;
        const j = (rr * cols + c) * 4;""",
"""        const j = (r * cols + c) * 4;""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("patched")
