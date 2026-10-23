import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

# 1) 最小屏幕尺寸常量
s = s.replace("const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];",
"""const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];
// 远看时的最小屏幕尺寸：低于这个像素数就把精灵放大成"颜色块"，
// 这样整城拉远也能一眼看出势力和分布。
const MIN_SCREEN_PX = 3.2;""")

# 2) update 里按屏幕像素下限放大
s = s.replace("    const halfW = cam.halfW, halfH = cam.halfH;",
"""    const halfW = cam.halfW, halfH = cam.halfH;
    // 每米多少屏幕像素；用来保证远看时单位至少 MIN_SCREEN_PX 大
    const pxPerM = cam.pxPerM || (720 / (2 * halfH));
    const minWorld = MIN_SCREEN_PX / Math.max(pxPerM, 1e-4);""")

s = s.replace("""      const scaleX = px * M_PER_PX * (sp.scale || 1);
      const scaleZ = py * M_PER_PX * (sp.scale || 1);""",
"""      let scaleX = px * M_PER_PX * (sp.scale || 1);
      let scaleZ = py * M_PER_PX * (sp.scale || 1);
      // 远看：放大到最小屏幕尺寸（保持长宽比），变成一块能分辨的颜色
      const big = Math.max(scaleX, scaleZ);
      if (big < minWorld) {
        const k = minWorld / big;
        scaleX *= k; scaleZ *= k;
      }""")
io.open(p, "w", encoding="utf-8").write(s)
print("retro 加最小屏幕尺寸")
