import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];",
"""const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];
// 只有这两套有 idle 动画；站着发呆的平民必须用它们，否则会定格在走路姿势
const IDLE_BODIES = ['guy01', 'girl01'];""")
s = s.replace("""      if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
        sprType = CIV_BODIES[(i * 2654435761 >>> 0) % CIV_BODIES.length];
      }""",
"""      if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
        const h = (i * 2654435761) >>> 0;
        sprType = CIV_BODIES[h % CIV_BODIES.length];
        // 站着的人换成有 idle 帧的体型
        if (sim.idle && sim.idle[i] &&
            !this.meta.frames[sprType + '/idle01_solid']) {
          sprType = IDLE_BODIES[h % IDLE_BODIES.length];
        }
      }""")
io.open(p, "w", encoding="utf-8").write(s)
print("站立筛选已加")
