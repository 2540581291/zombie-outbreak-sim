import io
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  if (state === 4) {                       // ST.ZOMBIE""",
"""  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  if (state === 5) return 'CORPSE';        // ST.CORPSE
  if (state === 4) {                       // ST.ZOMBIE""")
io.open(p, "w", encoding="utf-8").write(s)
print("尸体配色已修正")
