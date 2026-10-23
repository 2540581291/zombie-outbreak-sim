import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

old_frames = """  _frames(type, anim) {
    const f = this.meta.frames[`${type}/${anim}`];
    if (f) return f;
    return this.meta.frames[`${type}/walk`] || this.meta.frames[`${type}/walk_solid`] || null;
  }

  _pickAnim(sim, i) {
    const st = sim.state[i];
    if (st === ST.CORPSE) return 'die01_solid';
    if (st === ST.ZOMBIE) return 'walk_solid';
    if (st === ST.INFECTED) return 'walk_solid';
    if (st === ST.FLEE) return 'run01_solid';
    if (st === ST.FIGHT) return 'shoot01_solid';
    if (sim.idle && sim.idle[i]) return 'idle01_solid';
    return 'walk_solid';
  }"""
new_frames = """  // 每种体型有的动画不一样（police01 没有丧尸动画，girl01 没有 zwalk），
  // 所以按"想要的 → 次选 → 兜底"三级取帧。
  _frames(type, anim) {
    const F = this.meta.frames;
    const chain = [
      `${type}/${anim}_solid`,
      `${type}/walk_solid`,
      `${type}/idle01_solid`,
      `fat01/${anim}_solid`,       // fat01 的丧尸动画最全
      `fat01/walk_solid`,
    ];
    for (const k of chain) if (F[k]) return F[k];
    return null;
  }

  /**
   * 状态 → 动画名（不含 _solid 后缀）
   * 分类依据 sim 的状态机，不是物种：同一物种在不同状态下动作完全不同。
   */
  _pickAnim(sim, i, isZombieBody) {
    const st = sim.state[i];
    if (st === ST.CORPSE) return isZombieBody ? 'zdie01' : 'die01';
    if (st === ST.ZOMBIE) {
      // 正在啃人 → 攻击帧；否则走路
      const tg = sim.tgt ? sim.tgt[i] : -1;
      if (tg >= 0) {
        const dx = sim.px[tg] - sim.px[i], dz = sim.pz[tg] - sim.pz[i];
        if (dx * dx + dz * dz < 3.2 * 3.2) return 'zattack01';
      }
      return 'zwalk01';
    }
    if (st === ST.INFECTED) return 'walk';          // 潜伏期还是活人
    if (st === ST.WILD) return 'walk';              // 熊/虎
    if (st === ST.FLEE) return 'run01';
    if (st === ST.FIGHT) return 'shoot01';
    if (st === ST.POLICE || st === ST.SOLDIER) {
      if (sim.tgt && sim.tgt[i] >= 0) return 'shoot01';
      return sim.idle && sim.idle[i] ? 'idle01' : 'walk';
    }
    if (sim.idle && sim.idle[i]) return ((i & 1) ? 'idle02' : 'idle01');
    return 'walk';
  }"""
assert old_frames in s
s = s.replace(old_frames, new_frames)

# 调用处：传 isZombieBody，并按 isZombieBody 选体型
s = s.replace("""      const anim = this._pickAnim(sim, i);""",
"""      const isZombieBody = st === ST.ZOMBIE;
      const anim = this._pickAnim(sim, i, isZombieBody);""")

# 丧尸换着用不同体型，避免全场一个样
s = s.replace("""      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';""",
"""      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';
      // 丧尸：在几种体型间轮换（图集里只有 fat01 有完整的 zwalk 动画链）
      if (st === ST.ZOMBIE && kind === SP.ZOMBIE) {
        sprType = ZOMBIE_BODIES[i % ZOMBIE_BODIES.length];
      }""")
s = s.replace("const CAP = 9000;", "const CAP = 9000;\nconst ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];")
io.open(p, "w", encoding="utf-8").write(s)
print("retro 分类逻辑已重写")
