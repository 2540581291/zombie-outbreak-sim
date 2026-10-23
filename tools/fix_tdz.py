import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("      if (!frames) continue;", "      if (!fv) continue;")
io.open(p, "w", encoding="utf-8").write(s)
print("TDZ 已修（frames → fv）")
