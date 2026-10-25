import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH });",
"retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH,\n      pxPerM: window.innerHeight / Math.max(1e-4, 2 * halfH) });")
io.open(p, "w", encoding="utf-8").write(s)
print("main 传入 pxPerM")
