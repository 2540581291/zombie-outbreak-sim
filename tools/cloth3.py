import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
old = """  vec3 shifted = clamp(hueShift(col, vHue), 0.0, 1.0);
  col = mix(col, shifted, cloth * (1.0 - skin));"""
new = """  // 衣服换色：用逐通道乘子（偏暖/偏冷/偏绿），不会产生负值
  vec3 warm = vec3(1.0 + vHue * 0.45, 1.0 + vHue * 0.10, 1.0 - vHue * 0.35);
  vec3 cool = vec3(1.0 - vHue * 0.35, 1.0 + vHue * 0.15, 1.0 + vHue * 0.45);
  vec3 mulv = mix(warm, cool, step(0.0, vHue));
  mulv = clamp(mulv, 0.55, 1.55);
  col = mix(col, clamp(col * mulv, 0.0, 1.0), cloth * (1.0 - skin));"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("已换成逐通道乘子")
