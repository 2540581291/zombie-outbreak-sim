import io
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  APC: 11,                        // 装甲车",
"""  APC: 11,                        // 装甲车
  DOG: 12,                        // 狗（会被感染）
  CAT: 13,                        // 猫（会被感染）
  BEAR: 14,                       // 熊（野生，直接敌对）
  TIGER: 15,                      // 老虎（野生，直接敌对）""")
s = s.replace("""};

export function speciesOf(kind) {""",
"""  // ---------------- 动物 ----------------
  [SP.DOG]: {
    name: '狗', team: TEAM.HUMAN, scale: 0.62, hp: 8, speed: 3.6,
    dmg: 2, rate: 2, range: 26, acc: 0, biteR: 1.4,
    color: [0.72, 0.55, 0.32], infectedColor: [0.95, 0.42, 0.20],
    infectable: true, infectChance: 0.45,      // 比人难感染
    hpZombie: 26, zombieSpeedMul: 1.55, zombiePow: 2.4,   // 但变成丧尸犬后很凶
    zombieKind: 'dog_z',
  },
  [SP.CAT]: {
    name: '猫', team: TEAM.HUMAN, scale: 0.42, hp: 5, speed: 3.9,
    dmg: 1, rate: 2, range: 26, acc: 0, biteR: 1.1,
    color: [0.62, 0.62, 0.66], infectedColor: [0.95, 0.45, 0.25],
    infectable: true, infectChance: 0.60,
    hpZombie: 14, zombieSpeedMul: 1.45, zombiePow: 2.0,
    zombieKind: 'cat_z',
  },
  [SP.BEAR]: {
    name: '熊', team: TEAM.ZOMBIE, scale: 1.05, hp: 420, speed: 2.2,
    dmg: 22, rate: 1.5, range: 90, acc: 0, biteR: 2.8,
    color: [0.30, 0.22, 0.16], infectedColor: [0.30, 0.22, 0.16],
    special: 'tank', infectable: false,
  },
  [SP.TIGER]: {
    name: '老虎', team: TEAM.ZOMBIE, scale: 0.95, hp: 300, speed: 3.4,
    dmg: 18, rate: 1.2, range: 90, acc: 0, biteR: 2.4,
    color: [0.85, 0.48, 0.14], infectedColor: [0.85, 0.48, 0.14],
    special: 'charge', infectable: false,
  },
};

export const ANIMAL_KINDS = [SP.DOG, SP.CAT];
export const WILD_KINDS = [SP.BEAR, SP.TIGER];

export function speciesOf(kind) {""")
io.open(p, "w", encoding="utf-8").write(s)
print("species ok")
