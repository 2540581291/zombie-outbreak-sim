import io
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  CORPSE:  [0.30, 0.06, 0.06],   // 尸体 暗红",
"  INFECTED:[0.98, 0.62, 0.50],   // 感染（带血，还没变）\n  CORPSE:  [0.30, 0.06, 0.06],   // 尸体 暗红")
s = s.replace("  if (state === 5) return 'CORPSE';        // ST.CORPSE",
"  if (state === 5) return 'CORPSE';        // ST.CORPSE\n  if (state === 7) return 'INFECTED';      // ST.INFECTED 潜伏期")
io.open(p, "w", encoding="utf-8").write(s)
print("感染配色已加")
