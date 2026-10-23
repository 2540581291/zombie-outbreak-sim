import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

# 1) 关闭圆点 LOD 与最小尺寸放大：永远画原尺寸精灵
s = s.replace("const MIN_SCREEN_PX = 6.0;      // 精灵至少占这么多像素",
              "const MIN_SCREEN_PX = 0;        // 0 = 不做最小尺寸放大")
s = s.replace("const DOT_BELOW_PX = 2.2;       // 自然尺寸低于这个就改画纯色圆点",
              "const DOT_BELOW_PX = -1;        // -1 = 关闭圆点 LOD，永远画精灵")

# 2) 变体索引越界保护（种子可能恰好 = 1.0）
s = s.replace("const frames = Array.isArray(fv[0]) ? fv[Math.floor(this.seed2[i % CAP] * fv.length)] : fv;",
"""let frames = fv;
      if (Array.isArray(fv[0])) {
        const vi = Math.min(fv.length - 1, Math.floor(this.seed2[i % CAP] * fv.length));
        frames = fv[Math.max(0, vi)];
      }
      if (!frames || !frames.length) continue;""")
io.open(p, "w", encoding="utf-8").write(s)
print("LOD 已关闭，索引已保护")
