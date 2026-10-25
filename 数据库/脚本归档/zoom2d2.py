import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
old = "    rig.dist = next ? Math.min(MAX_DIST, rig.dist * 5.13) : Math.max(26, rig.dist / 5.13);"
new = "    // 两种模式各存各的缩放：2D 视距含义不同，直接换算会把小人缩成 2 像素\n    if (next) { zoom3d = rig.dist; rig.dist = zoom2d; }\n    else { zoom2d = rig.dist; rig.dist = zoom3d; }"
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("setRetro 已改")
