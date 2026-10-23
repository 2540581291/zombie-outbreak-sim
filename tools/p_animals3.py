import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()

# 1) import 增加动物
s = s.replace("import { SP, TEAM, SPECIES, SPECIAL_KINDS, CIV_KINDS } from './species.js';",
"import { SP, TEAM, SPECIES, SPECIAL_KINDS, CIV_KINDS, ANIMAL_KINDS, WILD_KINDS } from './species.js';")

# 2) pow 数组
s = s.replace("    this.nextSpecial = 8;                        // 下一次刷特感的秒数",
"    this.nextSpecial = 8;                        // 下一次刷特感的秒数\n    this.pow = new Float32Array(NMAX);           // 伤害倍率（丧尸化后增强）\n    this.nextWild = 45;                          // 下一次刷野生动物的秒数")
s = s.replace("    this.nextSpecial = 8;","    this.nextSpecial = 8;\n    this.pow.fill(1);\n    this.nextWild = 45;")

# 3) 咬合：感染概率 + 伤害倍率
s = s.replace("                const vsp = SPECIES[this.kind[c]] || SPECIES[SP.CIV1];\n                this.hp[c] -= (sp.dmg || 2);",
"                const vsp = SPECIES[this.kind[c]] || SPECIES[SP.CIV1];\n                this.hp[c] -= (sp.dmg || 2) * (this.pow[i] || 1);")

s = s.replace("                } else if (vsp.infectable !== false) {",
"                } else if (vsp.infectable !== false && this.rng() < (vsp.infectChance == null ? 1 : vsp.infectChance)) {")

# 4) 潜伏结束变丧尸：按物种给强化
s = s.replace("""          if (this.timer[i] <= 0) {
            this.state[i] = ST.ZOMBIE;
            this.kind[i] = SP.ZOMBIE;
            this.hp[i] = SPECIES[SP.ZOMBIE].hp;
            this.spd[i] = P.zombieSpeed * (0.85 + rng() * 0.3);""",
"""          if (this.timer[i] <= 0) {
            const zsp = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
            this.state[i] = ST.ZOMBIE;
            if (zsp.hpZombie) {
              // 动物尸变：血量、速度、伤害都按物种强化（狗/猫变丧尸后更凶）
              this.hp[i] = zsp.hpZombie;
              this.spd[i] = zsp.speed * (zsp.zombieSpeedMul || 1);
              this.pow[i] = zsp.zombiePow || 1;
            } else {
              this.kind[i] = SP.ZOMBIE;
              this.hp[i] = SPECIES[SP.ZOMBIE].hp;
              this.spd[i] = P.zombieSpeed * (0.85 + rng() * 0.3);
            }""")

# 5) 开局撒狗猫
s = s.replace("    this.n = k;\n    this.countStats();",
"""    // 猫狗：散布在街区里，比人难感染，但尸变后很凶
    const nDog = Math.round(pop * 0.012);
    const nCat = Math.round(pop * 0.008);
    for (let j = 0; j < nDog + nCat && k < NMAX; j++) {
      const kind = j < nDog ? SP.DOG : SP.CAT;
      const [x, z] = this.randWalk(rng, 1);
      const i = k++;
      const asp = SPECIES[kind];
      this.px[i] = x; this.pz[i] = z;
      this.heading[i] = rng() * 6.2832;
      this.kind[i] = kind;
      this.hp[i] = asp.hp;
      this.spd[i] = asp.speed * (0.9 + rng() * 0.2);
      this.state[i] = ST.CIV;
      this.phase[i] = rng();
      this.idle[i] = rng() < 0.4 ? 1 : 0;
      this.actT[i] = 10 + rng() * 30;
      this.pow[i] = 1;
      this.pickWander(i);
    }
    this.n = k;
    this.countStats();""")

# 6) 野生动物随机刷新
s = s.replace("    this.rebuildHash();\n\n    const P = this.params;",
"""    // 野生动物：熊/虎随机出没，不受感染影响，直接敌对
    this.nextWild -= dt;
    if (this.nextWild <= 0) {
      const wk = WILD_KINDS[(this.rng() * WILD_KINDS.length) | 0];
      const [wx, wz] = this.randWalk(this.rng, 0.85);
      const wi = this.addUnit(wx, wz, wk);
      if (wi >= 0) this.pushEvent('出没：' + SPECIES[wk].name, 'danger');
      this.nextWild = 70 + this.rng() * 80;
    }

    this.rebuildHash();

    const P = this.params;""")
io.open(p, "w", encoding="utf-8").write(s)
print("sim ok")
