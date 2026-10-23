import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""  const next = !!on;
  if (next !== retroMode) {
    // 3D 视高 ≈ 0.975×dist；2D 视高 = 2×0.095×dist → 换算系数约 5.13
    rig.dist = next ? Math.min(4200, rig.dist * 5.13) : Math.max(26, rig.dist / 5.13);
  }""",
"""  const next = !!on;
  if (next !== retroMode) {
    // 两种模式各存各的缩放：2D 的"视距"含义不同，直接换算会让小人变成 2 像素
    if (next) { zoom3d = rig.dist; rig.dist = zoom2d; }
    else { zoom2d = rig.dist; rig.dist = zoom3d; }
  }""")
s = s.replace("let overlay = null, overlayOn = false;",
"let overlay = null, overlayOn = false;\nlet zoom3d = 620, zoom2d = 470;   // 2D 默认视高 ≈ 45 m，1.65 m 的小人约 20 px")
io.open(p, "w", encoding="utf-8").write(s)
print("已改为双缩放记忆")
