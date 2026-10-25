import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
old = "  const lo = retroMode ? 55 : 26;"
new = "  // 2D 最小视距 300（视高约 28 m）——再拉近就只剩空地面，看不到单位\n  const lo = retroMode ? 300 : 26;"
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("2D 最小缩放已设为 300")
