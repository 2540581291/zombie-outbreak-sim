import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()

# 1) 新状态：野生动物（第三方，同时打人和丧尸）
s = s.replace("  SAVED: 8,    // 已被直升机救走（不渲染、不计数）",
"  SAVED: 8,    // 已被直升机救走（不渲染、不计数）\n  WILD: 9,     // 野生动物：人尸双杀")

# 2) 目标筛选增加两种掩码
s = s.replace("""          const ok = want === 1 ? (st === ST.ZOMBIE)
            : want === 2 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED)
              : want === 4 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT)
                : (st === ST.POLICE);""",
"""          const ok = want === 1 ? (st === ST.ZOMBIE)
            : want === 2 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED)
              : want === 4 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT)
                : want === 5 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                st === ST.INFECTED || st === ST.WILD)          // 丧尸的猎物：人和野兽
                  : want === 6 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                  st === ST.POLICE || st === ST.SOLDIER || st === ST.ZOMBIE)
                    : (st === ST.POLICE);""")

# 3) 感知：丧尸找 5（人+野兽），野兽找 6（人+丧尸）
s = s.replace("""        } else if (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED) {
          this.nearZ[i] = this.findNearest(i, 1, 26);
        }""",
"""        } else if (st === ST.WILD) {
          const wsp = SPECIES[this.kind[i]] || SPECIES[SP.BEAR];
          this.nearC[i] = this.findNearest(i, 6, wsp.range || 90);
        } else if (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED) {
          this.nearZ[i] = this.findNearest(i, 1, 26);
        }""")

# 4) step 里 ST.WILD 走丧尸那套
s = s.replace("        // ---------------- 丧尸 ----------------\n        case ST.ZOMBIE: {",
"        // ---------------- 丧尸 / 野兽 ----------------\n        case ST.WILD:\n        case ST.ZOMBIE: {\n          const isWild = st === ST.WILD;")

# 5) 猎物筛选（目标记忆）放宽到野兽
s = s.replace("            if (!(cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT)) c = -1;",
"            if (!(cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT ||\n                  (isWild && (cs === ST.ZOMBIE || cs === ST.POLICE || cs === ST.SOLDIER)))) c = -1;")

# 6) 咬合：野兽只造成伤害不感染；被咬的野兽走感染判定
s = s.replace("""            if (d2 < biteR2) {
              const cs = this.state[c];""",
"""            if (d2 < biteR2) {
              const cs = this.state[c];
              // 野兽咬人/咬尸：只掉血，不传播感染
              if (isWild) {
                this.hp[c] -= (sp.dmg || 2);
                this.panic[c] = 1.4;
                this.pushAudio('bite', this.px[c], this.pz[c], 1);
                if (this.hp[c] <= 0) this.killAgent(c, i);
                this.tgt[i] = -1;
                break;
              }""")

io.open(p, "w", encoding="utf-8").write(s)
print("sim part1 ok")
