import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

old = """      const frames = this._frames(sprType, anim);"""
new = """      const fv = this._frames(sprType, anim);"""
assert old in s
s = s.replace(old, new)

old2 = """      let fi = Math.floor(sim.phase[i] * frames.length) % frames.length;
      if (st === ST.ZOMBIE || st === ST.WILD) fi = Math.floor((sim.phase[i] * 1.3 + t * 0.2) * frames.length) % frames.length;
      if (st === ST.CORPSE) fi = frames.length - 1;   // 尸体停在最后一帧
      const r = frames[fi];"""
new2 = """      // 衣服变体：每个个体挑一套（animal 只有 1 套）
      const frames = Array.isArray(fv[0]) ? fv[Math.floor(this.seed2[i] * fv.length)] : fv;
      let fi = Math.floor(sim.phase[i] * frames.length) % frames.length;
      if (st === ST.ZOMBIE || st === ST.WILD) fi = Math.floor((sim.phase[i] * 1.3 + t * 0.2) * frames.length) % frames.length;
      if (st === ST.CORPSE) fi = frames.length - 1;   // 尸体停在最后一帧
      const r = frames[fi];"""
assert old2 in s
s = s.replace(old2, new2)

# 不再需要 shader 换色
s = s.replace("      hues[k] = (this.seed[i] - 0.5) * 1.30;", "      hues[k] = 0;")
io.open(p, "w", encoding="utf-8").write(s)
print("变体已接入")
