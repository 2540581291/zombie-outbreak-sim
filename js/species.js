// ============================================================
//  ZOS-R · 物种表
//  人 / 尸 / 特感 / 载具，全部在这张表里定义。
//  设计照抄原版：一个 PersonType 结构体 + 每类一份数值。
// ============================================================

export const SP = {
  CIV1: 0, CIV2: 1, CIV3: 2,      // 平民三种体型
  POLICE: 3,
  SOLDIER: 4,                     // 普通士兵
  ELITE: 5,                       // 重装兵
  ZOMBIE: 6,                      // 普通丧尸
  TANK: 7,                        // 坦克：巨大、慢、肉
  CHARGER: 8,                     // 冲锋者：快、直线冲撞
  BOOMER: 9,                      // 自爆者：死亡喷毒
  SPITTER: 10,                    // 喷吐者：远程酸液
  APC: 11,                        // 装甲车
  DOG: 12,                        // 狗（会被感染）
  CAT: 13,                        // 猫（会被感染）
  BEAR: 14,                       // 熊（野生，直接敌对）
  TIGER: 15,                      // 老虎（野生，直接敌对）
};

// 阵营
export const TEAM = { HUMAN: 0, ZOMBIE: 1, VEHICLE: 2, WILD: 3 };

/**
 * scale   体型倍率（也决定点云大小和渲染尺寸）
 * hp      血量
 * speed   基础移速 m/s
 * dmg     造成伤害（咬 / 子弹）
 * rate    攻击间隔（秒）
 * range   攻击距离（米）
 * acc     命中率（人类射击）
 * biteR   咬合距离
 * team    阵营
 * special 特感能力标记
 */
export const SPECIES = {
  [SP.CIV1]: {
    name: '平民', team: TEAM.HUMAN, scale: 1.0, hp: 100, speed: 2.00,
    dmg: 0, rate: 3, range: 26, acc: 0.08, biteR: 1.8,
    color: [0.30, 0.80, 0.44], infectedColor: [0.97, 0.72, 0.26],
    infectable: true,
  },
  [SP.CIV2]: {
    name: '平民', team: TEAM.HUMAN, scale: 0.94, hp: 100, speed: 2.00,
    dmg: 0, rate: 3, range: 26, acc: 0.08, biteR: 1.8,
    color: [0.36, 0.78, 0.52], infectedColor: [0.97, 0.72, 0.26],
    infectable: true,
  },
  [SP.CIV3]: {
    name: '胖子', team: TEAM.HUMAN, scale: 1.22, hp: 100, speed: 2.00,
    dmg: 0, rate: 3, range: 26, acc: 0.08, biteR: 1.8,
    color: [0.42, 0.72, 0.56], infectedColor: [0.97, 0.72, 0.26],
    infectable: true,
  },
  [SP.POLICE]: {
    name: '警察', team: TEAM.HUMAN, scale: 1.02, hp: 100, speed: 2.30,
    dmg: 5, rate: 0.95, range: 30, acc: 0.30, biteR: 1.8,
    color: [0.28, 0.56, 0.98], infectedColor: [0.97, 0.72, 0.26],
    infectable: true,
  },
  [SP.SOLDIER]: {
    name: '士兵', team: TEAM.HUMAN, scale: 1.06, hp: 100, speed: 2.10,
    dmg: 8, rate: 0.42, range: 42, acc: 0.55, biteR: 1.8,
    color: [0.42, 0.55, 0.34], infectedColor: [0.97, 0.72, 0.26],
    infectable: false,            // 装甲：不会被感染，只会被打死
  },
  [SP.ELITE]: {
    name: '重装兵', team: TEAM.HUMAN, scale: 1.20, hp: 200, speed: 1.75,
    dmg: 14, rate: 0.28, range: 55, acc: 0.72, biteR: 1.8,
    color: [0.26, 0.30, 0.26], infectedColor: [0.97, 0.72, 0.26],
    infectable: false,
  },
  [SP.ZOMBIE]: {
    name: '丧尸', team: TEAM.ZOMBIE, scale: 1.0, hp: 200, speed: 3.0,
    dmg: 20, rate: 2.0, range: 60, acc: 0, biteR: 1.8,
    color: [0.94, 0.28, 0.18], infectedColor: [0.94, 0.28, 0.18],
    infectable: false,
  },
  // ---------------- 特感 ----------------
  [SP.TANK]: {
    name: '坦克', team: TEAM.ZOMBIE, scale: 2.05, hp: 900, speed: 1.35,
    dmg: 60, rate: 1.6, range: 70, acc: 0, biteR: 3.0,
    color: [0.62, 0.16, 0.10], infectedColor: [0.62, 0.16, 0.10],
    special: 'tank', knock: 6,        // 命中把人打飞
    infectable: false,
  },
  [SP.CHARGER]: {
    name: '冲锋者', team: TEAM.ZOMBIE, scale: 1.30, hp: 450, speed: 2.60,
    dmg: 30, rate: 1.4, range: 80, acc: 0, biteR: 2.2,
    color: [0.98, 0.46, 0.08], infectedColor: [0.98, 0.46, 0.08],
    special: 'charge',                // 锁定后直线加速冲刺
    infectable: false,
  },
  [SP.BOOMER]: {
    name: '自爆者', team: TEAM.ZOMBIE, scale: 1.45, hp: 250, speed: 1.55,
    dmg: 0, rate: 2.0, range: 40, acc: 0, biteR: 2.2,
    color: [0.88, 0.86, 0.28], infectedColor: [0.88, 0.86, 0.28],
    special: 'boom',                  // 死亡时爆开，范围内全感染
    infectable: false,
  },
  [SP.SPITTER]: {
    name: '喷吐者', team: TEAM.ZOMBIE, scale: 1.35, hp: 350, speed: 1.50,
    dmg: 25, rate: 2.6, range: 26, acc: 0, biteR: 2.2,
    color: [0.55, 0.95, 0.32], infectedColor: [0.55, 0.95, 0.32],
    special: 'spit',                  // 远程喷酸
    infectable: false,
  },
  // ---------------- 载具 ----------------
  [SP.APC]: {
    name: '装甲车', team: TEAM.VEHICLE, scale: 1.0, hp: 2000, speed: 3.2,
    dmg: 60, rate: 1.1, range: 48, acc: 0.6, biteR: 2.6,
    color: [0.36, 0.40, 0.34], infectedColor: [0.36, 0.40, 0.34],
    special: 'crush',                 // 碾过丧尸
    infectable: false,
  },
  // ---------------- 动物 ----------------
  [SP.DOG]: {
    name: '狗', team: TEAM.HUMAN, scale: 0.62, hp: 8, speed: 3.6,
    dmg: 2, rate: 2, range: 26, acc: 0, biteR: 1.4,
    color: [0.72, 0.55, 0.32], infectedColor: [0.95, 0.42, 0.20],
    infectable: true, infectChance: 0.45,      // 比人难感染
    hpZombie: 26, zombieSpeedMul: 1.55, zombiePow: 2.4,   // 但变成丧尸犬后很凶
    zombieKind: 'animals_dog_z',
  },
  [SP.CAT]: {
    name: '猫', team: TEAM.HUMAN, scale: 0.42, hp: 5, speed: 3.9,
    dmg: 1, rate: 2, range: 26, acc: 0, biteR: 1.1,
    color: [0.62, 0.62, 0.66], infectedColor: [0.95, 0.45, 0.25],
    infectable: true, infectChance: 0.60,
    hpZombie: 14, zombieSpeedMul: 1.45, zombiePow: 2.0,
    zombieKind: 'animals_cat_z',
  },
  [SP.BEAR]: {
    name: '熊', team: TEAM.WILD, scale: 1.05, hp: 420, speed: 2.2,
    dmg: 22, rate: 1.5, range: 90, acc: 0, biteR: 2.8,
    color: [0.30, 0.22, 0.16], infectedColor: [0.85, 0.35, 0.20],
    special: 'tank',
    infectable: true, infectChance: 0.35,      // 皮糙肉厚，难感染
    hpZombie: 520, zombieSpeedMul: 1.15, zombiePow: 1.3, zombieKind: 'animals_bear_z',
  },
  [SP.TIGER]: {
    name: '老虎', team: TEAM.WILD, scale: 0.95, hp: 300, speed: 3.4,
    dmg: 18, rate: 1.2, range: 90, acc: 0, biteR: 2.4,
    color: [0.85, 0.48, 0.14], infectedColor: [0.90, 0.30, 0.18],
    special: 'charge',
    infectable: true, infectChance: 0.40,
    hpZombie: 380, zombieSpeedMul: 1.20, zombiePow: 1.4, zombieKind: 'animals_tiger_z',
  },
};

export const ANIMAL_KINDS = [SP.DOG, SP.CAT];
export const WILD_KINDS = [SP.BEAR, SP.TIGER];

export function speciesOf(kind) {
  return SPECIES[kind] || SPECIES[SP.CIV1];
}

export const SPECIAL_KINDS = [SP.TANK, SP.CHARGER, SP.BOOMER, SP.SPITTER];
export const CIV_KINDS = [SP.CIV1, SP.CIV2, SP.CIV3];
export const ZOMBIE_KINDS = [SP.ZOMBIE];


// ============================================================
//  统一阵营配色（3D 点云 / 2D 精灵染色共用）
//  平民绿 · 警察蓝 · 军队军绿 · 丧尸红 · 特殊丧尸紫
// ============================================================
export const UNIT_COLOR = {
  CIV:     [0.28, 0.85, 0.40],   // 平民 绿
  POLICE:  [0.28, 0.55, 1.00],   // 警察 蓝
  ARMY:    [0.55, 0.68, 0.30],   // 军队 军绿
  ZOMBIE:  [0.95, 0.18, 0.18],   // 丧尸 红
  SPECIAL: [0.72, 0.35, 1.00],   // 特殊丧尸 紫
  INFECTED:[0.98, 0.62, 0.50],   // 感染（带血，还没变）
  CORPSE:  [0.30, 0.06, 0.06],   // 尸体 暗红
  VIP:     [1.00, 0.80, 0.15],   // 要员 金
  WILD:    [1.00, 0.52, 0.10],   // 野兽 橙（和丧尸红区分开，否则分不清敌我）
};

/** 某物种属于哪个配色档 */
export function colorClassOf(kind, state) {
  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  if (state === 5) return 'CORPSE';        // ST.CORPSE
  if (state === 7) return 'INFECTED';      // ST.INFECTED 潜伏期
  if (state === 4) {                       // ST.ZOMBIE
    return sp.special ? 'SPECIAL' : 'ZOMBIE';
  }
  if (sp.team === TEAM.ZOMBIE) return sp.special ? 'SPECIAL' : 'ZOMBIE';
  if (sp.team === TEAM.WILD) return 'WILD';
  if (kind === SP.POLICE) return 'POLICE';
  if (kind === SP.SOLDIER || kind === SP.ELITE || kind === SP.APC) return 'ARMY';
  return 'CIV';
}
