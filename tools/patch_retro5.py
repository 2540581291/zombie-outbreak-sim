import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  retroMode = !!on;",
"  console.error('DBG setRetro on=' + on + ' ready=' + (retro && retro.ready));\n  retroMode = !!on;")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
