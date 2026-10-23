import io
# 1) 统一色表写进 species.js
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()
if "UNIT_COLOR" not in s:
    s += '''

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
  CORPSE:  [0.30, 0.06, 0.06],   // 尸体 暗红
  VIP:     [1.00, 0.80, 0.15],   // 要员 金
};

/** 某物种属于哪个配色档 */
export function colorClassOf(kind, state) {
  const sp = SPECIES[kind] || SPECIES[SP.CIV1];
  if (state === 4) {                       // ST.ZOMBIE
    return sp.special ? 'SPECIAL' : 'ZOMBIE';
  }
  if (sp.team === TEAM.ZOMBIE) return sp.special ? 'SPECIAL' : 'ZOMBIE';
  if (sp.team === TEAM.WILD) return 'ZOMBIE';
  if (kind === SP.POLICE) return 'POLICE';
  if (kind === SP.SOLDIER || kind === SP.ELITE || kind === SP.APC) return 'ARMY';
  return 'CIV';
}
'''
    io.open(p, "w", encoding="utf-8").write(s)
    print("species.js 增加 UNIT_COLOR")

# 2) agents.js 点云用统一色
p2 = "js/agents.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""      let c = sp.color;
      if (st === ST.INFECTED) c = sp.infectedColor;
      else if (st === ST.CORPSE) c = COLORS[ST.CORPSE];
      else if (st === ST.ZOMBIE) c = COLORS[ST.ZOMBIE];""",
"""      let c = UNIT_COLOR[colorClassOf(kind, st)];
      if (st === ST.CORPSE) c = UNIT_COLOR.CORPSE;""")
if "UNIT_COLOR" in s2 and "colorClassOf" not in s2.split("import")[0]:
    s2 = s2.replace("import { SP, TEAM, SPECIES", "import { SP, TEAM, SPECIES, UNIT_COLOR, colorClassOf")
io.open(p2, "w", encoding="utf-8").write(s2)
print("agents.js 已换色")

# 3) retro.js 用同色做轻度染色（保原画细节）
p3 = "js/retro.js"
s3 = io.open(p3, encoding="utf-8").read()
s3 = s3.replace("""      let c = [1, 1, 1];
      if (st === ST.ZOMBIE) c = [1.15, 0.55, 0.45];
      else if (st === ST.INFECTED) c = [1.25, 0.95, 0.55];
      else if (sp.team === TEAM.ZOMBIE) c = [
        Math.min(1.6, sp.color[0] + 0.6), sp.color[1] * 0.8, sp.color[2] * 0.8];
      else if (kind === SP.SOLDIER) c = [0.75, 1.0, 0.7];
      else if (kind === SP.ELITE) c = [0.6, 0.95, 0.65];
      else if (kind === SP.APC) c = [0.7, 0.75, 0.7];""",
"""      // 统一阵营色：精灵保留原画，只做 35% 的偏色，保证一眼分得清敌我
      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const K = 0.35;
      let c = [
        1 * (1 - K) + base[0] * K * 1.9,
        1 * (1 - K) + base[1] * K * 1.9,
        1 * (1 - K) + base[2] * K * 1.9,
      ];""")
if "UNIT_COLOR" in s3:
    s3 = s3.replace("import { SP, SPECIES, TEAM } from './species.js';",
                    "import { SP, SPECIES, TEAM, UNIT_COLOR, colorClassOf } from './species.js';")
io.open(p3, "w", encoding="utf-8").write(s3)
print("retro.js 已换色")
