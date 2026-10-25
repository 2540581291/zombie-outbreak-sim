import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("    retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH });",
"""    retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH });
    if (++fc % 20 === 0) document.title = 'RETRO n=' + retro.count + ' ready=' + retro.ready +
      ' halfW=' + halfW.toFixed(0) + ' tx=' + rig.target.x.toFixed(0) + ' cz=' + rig.target.z.toFixed(0) +
      ' total=' + (sim ? sim.n : 0);""")
io.open(p, "w", encoding="utf-8").write(s)
print("dbg ok")
