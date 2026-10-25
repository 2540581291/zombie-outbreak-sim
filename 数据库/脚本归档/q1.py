import io
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace("export const TEAM = { HUMAN: 0, ZOMBIE: 1, VEHICLE: 2 };",
"export const TEAM = { HUMAN: 0, ZOMBIE: 1, VEHICLE: 2, WILD: 3 };")

# 熊/虎改成第三方阵营，可被感染；狗猫加僵尸形态
s = s.replace("""  [SP.BEAR]: {
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
  },""",
"""  [SP.BEAR]: {
    name: '熊', team: TEAM.WILD, scale: 1.05, hp: 420, speed: 2.2,
    dmg: 22, rate: 1.5, range: 90, acc: 0, biteR: 2.8,
    color: [0.30, 0.22, 0.16], infectedColor: [0.85, 0.35, 0.20],
    special: 'tank',
    infectable: true, infectChance: 0.35,      // 皮糙肉厚，难感染
    hpZombie: 520, zombieSpeedMul: 1.15, zombiePow: 1.3, zombieKind: 'bear_z',
  },
  [SP.TIGER]: {
    name: '老虎', team: TEAM.WILD, scale: 0.95, hp: 300, speed: 3.4,
    dmg: 18, rate: 1.2, range: 90, acc: 0, biteR: 2.4,
    color: [0.85, 0.48, 0.14], infectedColor: [0.90, 0.30, 0.18],
    special: 'charge',
    infectable: true, infectChance: 0.40,
    hpZombie: 380, zombieSpeedMul: 1.20, zombiePow: 1.4, zombieKind: 'tiger_z',
  },""")
io.open(p, "w", encoding="utf-8").write(s)
print("species ok")
