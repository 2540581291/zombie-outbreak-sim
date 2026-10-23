import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
# LOD 用的尺寸改成"该体型的基准尺寸"，不随帧变化
old = "      const naturalPx = Math.max(scaleX, scaleZ) * pxPerM;"
new = """      // 用"基准人形尺寸"判 LOD，而不是当前帧 —— 帧与帧尺寸不同会导致
      // 同一个体在"精灵 ↔ 圆点"之间逐帧跳变
      const nominal = 15 * M_PER_PX * (sp.scale || 1);
      const naturalPx = nominal * pxPerM;"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("LOD 改用基准尺寸")
