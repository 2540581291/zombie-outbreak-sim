import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  console.error('DBG setRetro on=' + on + ' ready=' + (retro && retro.ready));\n", "")
# 2D 模式：1 米约等于 4 像素（原版也是这个比例），所以视野高度远比 3D 小
s = s.replace("    const halfH = Math.max(14, rig.dist * 0.42);",
              "    const halfH = Math.max(7, rig.dist * 0.095);")
io.open(p, "w", encoding="utf-8").write(s)
print("zoom patched")
