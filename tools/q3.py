import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()

# 7) 开局按参数刷动物（含初始感染）
s = s.replace("""    // 猫狗：散布在街区里，比人难感染，但尸变后很凶
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
    }""",
"""    // 动物：数量由开局参数决定，其中一部分一开始就是感染者
    const spawnList = [
      [SP.DOG, P.dogs | 0], [SP.CAT, P.cats | 0],
      [SP.BEAR, P.bears | 0], [SP.TIGER, P.tigers | 0],
    ];
    for (const [kind, count] of spawnList) {
      const asp = SPECIES[kind];
      for (let j = 0; j < count && k < NMAX; j++) {
        let x = 0, z = 0, ok = false;
        for (let tr = 0; tr < 60; tr++) {
          const [nx, nz] = this.randWalk(rng, 1);
          x = nx; z = nz; ok = true; break;
        }
        if (!ok) continue;
        const i = k++;
        this.px[i] = x; this.pz[i] = z;
        this.heading[i] = rng() * 6.2832;
        this.kind[i] = kind;
        this.hp[i] = asp.hp;
        this.spd[i] = asp.speed * (0.9 + rng() * 0.2);
        this.phase[i] = rng();
        this.pow[i] = 1;
        const wild = asp.team === TEAM.WILD;
        this.state[i] = wild ? ST.WILD : ST.CIV;
        this.idle[i] = 0; this.actT[i] = 10 + rng() * 40;
        // 初始感染：按感染率抽签
        if (rng() < (P.animalInfected || 0)) {
          if (wild) {
            this.state[i] = ST.ZOMBIE;
            this.hp[i] = asp.hpZombie || asp.hp;
            this.spd[i] = asp.speed * (asp.zombieSpeedMul || 1);
            this.pow[i] = asp.zombiePow || 1;
          } else {
            this.state[i] = ST.INFECTED;
            this.timer[i] = P.infectTime * (0.2 + rng() * 0.8);
          }
        }
        this.pickWander(i);
      }
    }""")

# 8) 去掉定时刷野生动物
s = s.replace("""    // 野生动物：熊/虎随机出没，不受感染影响，直接敌对
    this.nextWild -= dt;
    if (this.nextWild <= 0) {
      const wk = WILD_KINDS[(this.rng() * WILD_KINDS.length) | 0];
      const [wx, wz] = this.randWalk(this.rng, 0.85);
      const wi = this.addUnit(wx, wz, wk);
      if (wi >= 0) this.pushEvent('出没：' + SPECIES[wk].name, 'danger');
      this.nextWild = 70 + this.rng() * 80;
    }

""", "")

# 9) 统计里把 WILD 单列
s = s.replace("        case ST.ZOMBIE: s.zombie++; break;",
"        case ST.ZOMBIE: s.zombie++; break;\n        case ST.WILD: s.wild = (s.wild || 0) + 1; break;")
s = s.replace("    s.civ = 0; s.infected = 0; s.zombie = 0; s.dead = 0; s.police = 0;",
"    s.civ = 0; s.infected = 0; s.zombie = 0; s.dead = 0; s.police = 0; s.wild = 0;")

# 10) 被咬的野兽：感染判定（复用 INFECTED 通道）
s = s.replace("                } else if (vsp.infectable !== false && this.rng() < (vsp.infectChance == null ? 1 : vsp.infectChance)) {",
"                } else if (vsp.infectable !== false && this.rng() < (vsp.infectChance == null ? 1 : vsp.infectChance)) {")

# 11) 野兽变丧尸：潜伏结束时回到丧尸阵营
s = s.replace("""        case ST.INFECTED: {
          this.timer[i] -= dt;""",
"""        case ST.INFECTED: {
          this.timer[i] -= dt;
          // 野兽被感染后会继续乱跑，到点才变丧尸""")
io.open(p, "w", encoding="utf-8").write(s)
print("sim part2 ok")
