import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("const MIN_SCREEN_PX = 0;        // 0 = 不做最小尺寸放大",
              "const MIN_SCREEN_PX = 6.0;      // 精灵至少占这么多像素（远看才不至于消失）")
s = s.replace("const DOT_BELOW_PX = -1;        // -1 = 关闭圆点 LOD，永远画精灵",
              "const DOT_BELOW_PX = 2.2;       // 自然尺寸低于这个就改画纯色圆点")
io.open(p, "w", encoding="utf-8").write(s)
print("LOD 已恢复")
