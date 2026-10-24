// ============================================================
//  ZOS-R · 武器表（M5）
//
//  一把枪 = 一个对象。伤害 / 射速 / 射程 / 弹匣 / 备弹 / 精度 / 噪音 / 装填。
//  熟练度（skill 0–1）只影响两件事：实际精度、装填时间。
//  噪音半径决定"这一枪会招来多远的丧尸"。
// ============================================================

export const WPN = {
  NONE: 0, PISTOL9: 1, PISTOL45: 2, REVOLVER: 3, SHOTGUN: 4,
  SMG: 5, RIFLE: 6, SNIPER: 7, RPG: 8, MOLOTOV: 9,
  DBSHOTGUN: 10, AR: 11, LMG: 12, CROSSBOW: 13,
};

export const WEAPONS = [
  { id: 0, name: '徒手', dmg: 0, rate: 0, range: 0, mag: 0, reserve: 0, noise: 0, reload: 0 },
  { id: 1, name: '手枪 9mm', dmg: 25, rate: 0.45, range: 26, mag: 15, reserve: 45, noise: 90, reload: 1.4 },
  { id: 2, name: '大口径手枪', dmg: 40, rate: 0.55, range: 28, mag: 8, reserve: 24, noise: 100, reload: 1.7 },
  { id: 3, name: '左轮 .357', dmg: 60, rate: 0.85, range: 32, mag: 6, reserve: 18, noise: 110, reload: 2.2 },
  { id: 4, name: '霰弹枪', dmg: 120, rate: 1.1, range: 18, mag: 6, reserve: 18, noise: 140, reload: 2.6 },
  { id: 5, name: '冲锋枪', dmg: 15, rate: 0.10, range: 24, mag: 30, reserve: 90, noise: 120, reload: 2.0 },
  { id: 6, name: '步枪', dmg: 50, rate: 0.30, range: 60, mag: 30, reserve: 90, noise: 150, reload: 2.4 },
  { id: 7, name: '狙击枪', dmg: 200, rate: 1.8, range: 120, mag: 5, reserve: 15, noise: 170, reload: 2.8 },
  { id: 8, name: '火箭筒', dmg: 800, rate: 3.5, range: 90, mag: 1, reserve: 1, noise: 300, reload: 4.0 },
  { id: 9, name: '燃烧瓶', dmg: 90, rate: 2.5, range: 20, mag: 1, reserve: 3, noise: 20, reload: 2.0 },
  // ---- 扩充：远近兼顾，形成"精度 / 火力 / 隐蔽"三条线 ----
  { id: 10, name: '双管霰弹枪', dmg: 160, rate: 1.4, range: 15, mag: 2, reserve: 20, noise: 150, reload: 2.2 },
  { id: 11, name: '突击步枪', dmg: 38, rate: 0.14, range: 55, mag: 30, reserve: 120, noise: 145, reload: 2.3 },
  { id: 12, name: '轻机枪', dmg: 32, rate: 0.09, range: 70, mag: 100, reserve: 200, noise: 180, reload: 4.5 },
  { id: 13, name: '十字弩', dmg: 150, rate: 2.2, range: 45, mag: 1, reserve: 12, noise: 10, reload: 2.0 },
];

/** 职业 → 初始武器（警局/军营库存按这个发） */
export const ROLE_WEAPON = {
  police: WPN.PISTOL9,
  soldier: WPN.RIFLE,
  elite: WPN.SMG,
};

/** 熟练度初值（0–1）：警察 0.6、士兵 0.8、军警 0.7、普通市民 0.25 */
export function skillFor(role) {
  if (role === 'soldier') return 0.8;
  if (role === 'elite') return 0.72;
  if (role === 'police') return 0.6;
  return 0.25;
}

export const weaponOf = (id) => WEAPONS[id] || WEAPONS[0];
