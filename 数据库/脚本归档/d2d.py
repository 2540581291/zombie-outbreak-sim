import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  orthoCam.up.set(0, 0, -1);",
"  orthoCam.up.set(0, 0, -1);\n  if (Q.get('dist2d')) zoom2d = +Q.get('dist2d');   // 调试用：直接指定 2D 视距")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
