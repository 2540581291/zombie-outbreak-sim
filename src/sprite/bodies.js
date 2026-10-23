// ============================================================
//  src/sprite/bodies.js  ——  体型表 / 状态→动画 映射 / 剪影配色
//
//  为什么体型要单独一个文件：**原版的阶段时长取决于体型**
//  （turn01：guy01 7.35 s、guy02 1.20 s、fat01 6.90 s）。
//  以前体型是在渲染循环里按 i 现算的，模拟层拿不到；现在统一从这里出。
// ============================================================
import { SP, SPECIES, TEAM } from '../../js/species.js';
import { ST as STATE } from '../../js/sim.js';

export const BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01', 'police01'];
export const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];
export const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];   // 丧尸只用这 4 套

const TYPE_TO_SPRITE = {
  [SP.CIV1]: 'guy01', [SP.CIV2]: 'guy02', [SP.CIV3]: 'fat01',
  [SP.POLICE]: 'police01', [SP.SOLDIER]: 'police01', [SP.ELITE]: 'police01',
  [SP.ZOMBIE]: 'guy02',
  [SP.TANK]: 'fat01', [SP.CHARGER]: 'guy01', [SP.BOOMER]: 'fat01', [SP.SPITTER]: 'girl01',
  [SP.APC]: 'police01',
  [SP.DOG]: 'animals_dog', [SP.CAT]: 'animals_cat',
  [SP.BEAR]: 'animals_bear', [SP.TIGER]: 'animals_tiger',
};

/** 稳定哈希：同一个 i 永远同一个体型（否则每帧"变身"）。 */
export function hash01(i) {
  const h = (i * 2654435761) >>> 0;
  return ((h ^ (h >>> 13)) & 0xffff) / 65535;
}

/**
 * 某个体现在用哪套贴图。
 * 注意：平民按 hash 挑、丧尸按 i%4 轮换 —— 都是原来 retro.js 的行为，保持像素级一致。
 */
export function bodyFor(sim, i, st) {
  const kind = sim.kind ? sim.kind[i] : 0;
  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  let spr = TYPE_TO_SPRITE[kind] || 'guy01';

  if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
    spr = CIV_BODIES[((i * 2654435761) >>> 0) % CIV_BODIES.length];
  }
  if (st === STATE.ZOMBIE && kind === SP.ZOMBIE) {
    spr = ZOMBIE_BODIES[i % ZOMBIE_BODIES.length];
  }
  // 动物尸变：换成 _z 那套贴图
  const zk = sp.zombieKind;
  if (zk && st === STATE.ZOMBIE) spr = zk.startsWith('animals_') ? zk : 'animals_' + zk;

  return spr;
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
  if (kind === SP.POLICE) return SIL.police;
  if (kind === SP.SOLDIER || kind === SP.ELITE || kind === SP.APC) return SIL.police;
  return SIL.civ;
}

/**
 * 状态 → 动画名（不含 @sil 后缀）。
 * 和旧 retro.js 的 _pickAnim 等价，只是把 ST 换成具名常量、并把"阶段动画"放在最前面。
 */
export function animFor(sim, i, st, stage, zDie) {
  if (stage === 1) return 'turn01';        // A.TURN
  if (stage === 2) return zDie ? 'zdie01' : 'die01';   // A.DIE
  if (stage === 3) return 'zrise01';       // A.RISE

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


