// ============================================================
//  js/bodymap.js  ——  体型号 → 贴图 / 阶段时长（中性模块）
//
//  为什么单独一个文件：**原版的动作时长取决于体型**
//  （turn01：guy01 7.35 s、guy02 1.20 s、fat01 6.90 s），
//  所以模拟层（算时长）和渲染层（挑贴图）必须用同一张表。
//  这里不依赖 three、不依赖 DOM，两边都能 import。
// ============================================================
import { SP, SPECIES } from './species.js';

export const BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01', 'police01'];
export const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];
export const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];

const TYPE_TO_SPRITE = {
  [SP.CIV1]: 'guy01', [SP.CIV2]: 'guy02', [SP.CIV3]: 'fat01',
  [SP.POLICE]: 'police01', [SP.SOLDIER]: 'police01', [SP.ELITE]: 'police01',
  [SP.ZOMBIE]: 'guy02',
  [SP.TANK]: 'fat01', [SP.CHARGER]: 'guy01', [SP.BOOMER]: 'fat01', [SP.SPITTER]: 'girl01',
  [SP.APC]: 'police01',
  [SP.DOG]: 'animals_dog', [SP.CAT]: 'animals_cat',
};

/**
 * 个体 i 该用哪套贴图。
 *   isZombie：是否已经处于丧尸形态（决定用不用 animal 的 _z 变体）
 * 平民按稳定哈希挑体型（不是随机的 —— 同一人必须始终同一副样子）。
 */
export function bodyOf(i, kind, isZombie, fix) {
  if (fix && !isZombie) return fix;   // 彩蛋角色指定体型
  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  let b = TYPE_TO_SPRITE[kind] || 'guy01';
  if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
    b = CIV_BODIES[((i * 2654435761) >>> 0) % CIV_BODIES.length];
  }
  if (isZombie && kind === SP.ZOMBIE) b = ZOMBIE_BODIES[i % ZOMBIE_BODIES.length];
  if (isZombie && sp.zombieKind) {
    b = sp.zombieKind.startsWith('animals_') ? sp.zombieKind : 'animals_' + sp.zombieKind;
  }
  return b;
}

// ---------------- 动作阶段（正交于 state） ----------------
export const STAGE = { NONE: 0, TURN: 1, DIE: 2, RISE: 3 };

/**
 * 阶段时长（秒）= 帧数 × 帧长，全部来自反编译的 _qk83() / _br451()。
 * police01 没有自己的 zwalk/zattack/zdie，原版直接复用 guy01 那几支。
 */
export const DUR = {
  guy01: { walk: 1.20, die: 3.75, turn: 7.35, rise: 6.45, zdie: 3.75, zwalk: 1.60, zattack: 1.20 },
  guy02: { walk: 1.20, die: 6.84, turn: 1.20, rise: 3.30, zdie: 1.65, zwalk: 1.20, zattack: 1.20 },
  girl01: { walk: 1.60, die: 3.75, turn: 4.20, rise: 3.45, zdie: 2.40, zwalk: 1.20, zattack: 1.60 },
  girl02: { walk: 1.60, die: 3.75, turn: 5.80, rise: 3.90, zdie: 2.40, zwalk: 1.20, zattack: 1.60 },
  fat01: { walk: 1.76, die: 4.20, turn: 6.90, rise: 2.00, zdie: 3.75, zwalk: 1.20, zattack: 1.60 },
  police01: { walk: 0.80, die: 3.75, turn: 6.00, rise: 7.80, zdie: 3.75, zwalk: 1.60, zattack: 1.20 },
};

/** 阶段时长；body 不认识就按 guy01。 */
export function stageDur(body, stage, zDie) {
  const b = DUR[body] || DUR.guy01;
  if (stage === STAGE.TURN) return b.turn;
  if (stage === STAGE.DIE) return zDie ? b.zdie : b.die;
  if (stage === STAGE.RISE) return b.rise;
  return 0;
}

/** 阶段对应的动画名（不含 @sil）。 */
export function stageAnim(stage, zDie) {
  if (stage === STAGE.TURN) return 'turn01';
  if (stage === STAGE.DIE) return zDie ? 'zdie01' : 'die01';
  if (stage === STAGE.RISE) return 'zrise01';
  return null;
}
