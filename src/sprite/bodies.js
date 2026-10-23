// ============================================================
//  src/sprite/bodies.js  ——  渲染侧的体型 / 剪影 / 状态→动画
//
//  体型号和阶段时长表都在 js/bodymap.js（模拟层也要用，所以放在中性位置）。
//  这里只做渲染相关的事：把 state+stage 翻成动画名，以及剪影配色。
// ============================================================
import { SP, SPECIES, TEAM } from '../../js/species.js';
import { ST as STATE } from '../../js/sim.js';
import { BODIES, CIV_BODIES, ZOMBIE_BODIES, STAGE, bodyOf, stageAnim } from '../../js/bodymap.js';

export { BODIES, CIV_BODIES, ZOMBIE_BODIES, STAGE, stageAnim };

/** 个体 i 现在该用哪套贴图。 */
export function bodyFor(sim, i, st) {
  const kind = sim.kind ? sim.kind[i] : 0;
  return bodyOf(i, kind, st === STATE.ZOMBIE);
}

/** 阵营 → 剪影色（原版实测：绿 #40D43B / 蓝 #1212FF / 红 #E30000）。 */
export const SIL = {
  civ: [0.25, 0.83, 0.23],
  police: [0.07, 0.07, 1.0],
  zombie: [0.89, 0.0, 0.0],
};

export function silColorFor(kind, st) {
  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  if (st === STATE.ZOMBIE || sp.team === TEAM.ZOMBIE) return SIL.zombie;
  if (kind === SP.POLICE || kind === SP.SOLDIER || kind === SP.ELITE || kind === SP.APC) return SIL.police;
  return SIL.civ;
}

/**
 * 状态 → 动画名（不含 @sil）。
 * 阶段动画（turn01 / die01 / zdie01 / zrise01）优先，其余按 state。
 */
export function animFor(sim, i, st, stage, zDie) {
  if (stage) return stageAnim(stage, zDie);

  if (st === STATE.CORPSE) {
    const sp = SPECIES[sim.kind[i]] || SPECIES[SP.CIV1];
    return sp.team === TEAM.ZOMBIE ? 'zdie01' : 'die01';
  }
  if (st === STATE.ZOMBIE) {
    const tg = sim.tgt ? sim.tgt[i] : -1;
    if (tg >= 0) {
      const dx = sim.px[tg] - sim.px[i], dz = sim.pz[tg] - sim.pz[i];
      if (dx * dx + dz * dz < 3.2 * 3.2) return 'zattack01';
    }
    return 'zwalk01';
  }
  if (st === STATE.INFECTED) return 'walk';
  if (st === STATE.WILD) return (sim.tgt && sim.tgt[i] >= 0) ? 'run01' : 'walk';
  if (st === STATE.FLEE) return 'run01';
  if (st === STATE.FIGHT) return 'shoot01';
  if (st === STATE.POLICE || st === STATE.SOLDIER) {
    if (sim.tgt && sim.tgt[i] >= 0) return 'shoot01';
    return sim.idle && sim.idle[i] ? 'idle01' : 'walk';
  }
  if (sim.idle && sim.idle[i]) return (i & 1) ? 'idle02' : 'idle01';
  return 'walk';
}
