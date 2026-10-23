import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("this.seed2[i] * fv.length", "this.seed2[i % CAP] * fv.length")
s = s.replace("const v = 0.82 + this.seed2[i] * 0.38;", "const v = 0.82 + this.seed2[i % CAP] * 0.38;")
io.open(p, "w", encoding="utf-8").write(s)
print("已加取模")
