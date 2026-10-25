import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

old = """  if (drag.btn === 2) {
    rig.yaw -= dx * 0.005;
    rig.pitch = Math.max(0.18, Math.min(1.52, rig.pitch + dy * 0.004));
  } else {
    const k = rig.dist * 0.0016;
    rig.target.addScaledVector(fwd, dy * k).addScaledVector(right, -dx * k);
  }"""
new = """  if (drag.btn === 2) {
    // 右键 = 平移（灵敏度系数 0.0016 → 0.00085）
    const k = rig.dist * 0.00085;
    rig.target.addScaledVector(fwd, dy * k).addScaledVector(right, -dx * k);
  } else if (drag.btn === 1) {
    // 中键 = 旋转 / 俯仰
    rig.yaw -= dx * 0.005;
    rig.pitch = Math.max(0.18, Math.min(1.52, rig.pitch + dy * 0.004));
  }"""
assert old in s
s = s.replace(old, new)

# 右键不再触发上下文菜单（已有），并且拖拽后不当作点击
s = s.replace("  const wasClick = drag && drag.moved < 5 && drag.btn === 0;",
"  const wasClick = drag && drag.moved < 5 && drag.btn === 0;   // 只有左键算点击")
io.open(p, "w", encoding="utf-8").write(s)
print("main ok")

# 操作提示同步
p2 = "index.html"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("左键拖拽平移 · 滚轮缩放 · 右键拖拽旋转/俯仰",
"右键拖拽平移 · 滚轮缩放 · 中键拖拽旋转/俯仰")
s2 = s2.replace("WASD 平移 · QE 旋转 · RF 俯仰", "WASD 平移 · QE 旋转 · RF 俯仰 · 左键放技能")
io.open(p2, "w", encoding="utf-8").write(s2)
print("html ok")
