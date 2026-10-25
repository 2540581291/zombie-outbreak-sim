import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()
old = "const z = (r + rng()) * nav.cell - nav.halfH;"
assert old in s
s = s.replace(old, "const z = nav.halfH - (r + rng()) * nav.cell;")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
