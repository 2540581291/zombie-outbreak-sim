import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""  vec3 col = t.rgb;
  // 皮肤保护：接近肤色的像素不做色相旋转，否则脸会变绿变紫
  float skin = 1.0 - smoothstep(0.09, 0.20, distance(col, vec3(0.95, 0.80, 0.62)));
  col = mix(hueShift(col, vHue), col, skin);""",
"""  vec3 col = t.rgb;
  // 只处理"有颜色、不太暗"的像素：描边和阴影不参与换色，否则会发黑
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mx = max(max(col.r, col.g), col.b);
  float mn = min(min(col.r, col.g), col.b);
  float sat = mx > 0.02 ? (mx - mn) / mx : 0.0;
  float cloth = step(0.16, lum) * smoothstep(0.10, 0.28, sat);
  // 皮肤保护
  float skin = 1.0 - smoothstep(0.09, 0.20, distance(col, vec3(0.95, 0.80, 0.62)));
  vec3 shifted = clamp(hueShift(col, vHue), 0.0, 1.0);
  col = mix(col, shifted, cloth * (1.0 - skin));""")
s = s.replace("hues[k] = (this.seed[i] - 0.5) * 1.75;",
              "hues[k] = (this.seed[i] - 0.5) * 1.30;")
io.open(p, "w", encoding="utf-8").write(s)
print("已加亮度/饱和保护")
