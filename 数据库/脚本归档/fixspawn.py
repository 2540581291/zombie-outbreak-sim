import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()

# 统一约定：网格第 0 行 = 南 = z 正方向。所以 r -> z: z = halfH - (r+0.5)*cell
# 1) 平民出生点
s = s.replace("        const z = (r + rng()) * nav.cell - nav.halfH;",
"        const z = nav.halfH - (r + rng()) * nav.cell;")

# 2) randWalk
s = s.replace("        return [(c + 0.5) * nav.cell - nav.halfW, (r + 0.5) * nav.cell - nav.halfH];",
"        return [(c + 0.5) * nav.cell - nav.halfW, nav.halfH - (r + 0.5) * nav.cell];")

# 3) walkable()：行序号必须和碰撞层同一套方向
s = s.replace("""  walkable(x, z) {
    const nav = this.nav;
    const c = ((x + nav.halfW) / nav.cell) | 0;
    const r = ((z + nav.halfH) / nav.cell) | 0;""",
"""  walkable(x, z) {
    const nav = this.nav;
    // 网格第 0 行 = 南，而世界 z 也是南为正 → r = (halfH - z)/cell
    if (typeof nav.walkable === 'function') return nav.walkable(x, z);
    const c = ((x + nav.halfW) / nav.cell) | 0;
    const r = ((nav.halfH - z) / nav.cell) | 0;""")

# 4) 另一处（道具/落点偏移）同样修正
s = s.replace("      const wz = (r + 0.5) * nav.cell - nav.halfH - z;",
"      const wz = nav.halfH - (r + 0.5) * nav.cell - z;")
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
