import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("    const tints = this.tints.array;",
              "    const tints = this.tints.array;\n    const hues = this.hues.array;")
io.open(p, "w", encoding="utf-8").write(s)
print("已补 hues 数组")
