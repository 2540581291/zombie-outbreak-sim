// ============================================================
//  ZOS-R · 家庭系统（M2）
//
//  难点：2 万人不能存一张任意图。解法：**家庭 = 平民索引上的连续区间**。
//    · 分组：按顺序切块，块大小按分布抽（哈希决定）→ 约 6.6k 个家庭
//    · 成员关系：按年龄现算（配偶 / 子女 / 祖辈），不存字段
//    · 姓氏：从家庭 id 取 → 一家人同姓
//    · 例外：旅客（无家无家属）、独居（单人家庭）
//
//  全部确定性：同一 seed 同一批家庭，纯函数式查询，零图谱存储。
// ============================================================

// 家庭规模分布（百分比），5 人封顶
const SIZE_DIST = [
  [1, 0.10], [2, 0.30], [3, 0.28], [4, 0.22], [5, 0.10],
];

export const TOURIST_RATE = 0.03;   // 旅客：无家、无家属（**按人口**算，不是按户）
//  旅客永远是"一户一人"，所以按户抽样的阈值要放大到 人均比例 × 平均户规模，
//  否则实际只有 1% 的人。MEAN_SIZE 由上面的分布算出来。
const MEAN_SIZE = SIZE_DIST.reduce((a, [n, p]) => a + n * p, 0);
const HH_TOURIST_RATE = TOURIST_RATE * MEAN_SIZE;

function sizeFrom(u) {
  let acc = 0;
  for (const [n, p] of SIZE_DIST) {
    acc += p;
    if (u < acc) return n;
  }
  return SIZE_DIST[SIZE_DIST.length - 1][0];
}

/**
 * 把平民切成家庭。
 *   civs —— 平民的个体下标（按出生顺序），家庭按这个顺序连续切块
 *   sim.hh / sim.hhStart / sim.hhEnd / sim.tourist / sim.civAt 由本函数填
 * 返回家庭数。
 */
/**
 * 家庭里的角色序列（决定年龄，从而决定关系）：
 *   1 人 → 独居；2 人 → 夫妻 / 单亲+孩子 / 室友；3 人以上 → 家长 + 孩子，少量多代同堂
 */
function roleList(size, u) {
  if (size <= 1) return ['adult'];
  if (size === 2) return u < 0.62 ? ['parent', 'parent'] : (u < 0.85 ? ['parent', 'kid'] : ['adult', 'adult']);
  const roles = [];
  if (u < 0.12 && size >= 4) roles.push('elder');     // 多代同堂：祖辈一起住
  roles.push('parent');
  if (u > 0.22) roles.push('parent');                 // 78% 是双亲
  while (roles.length < size) roles.push('kid');
  return roles;
}

export function buildFamilies(sim, civs, hash01) {
  const n = civs.length;
  sim.civAt = civs;
  sim.hhStart = new Uint16Array(Math.min(62000, n + 2));
  sim.hhEnd = new Uint16Array(Math.min(62000, n + 2));
  sim.age = new Uint8Array(Math.min(62000, n + 2));
  let pos = 0, hid = 0;
  while (pos < n) {
    const tourist = hash01(pos, 42) < HH_TOURIST_RATE;
    let size = tourist ? 1 : sizeFrom(hash01(pos, 41));
    if (pos + size > n) size = n - pos;
    sim.hhStart[hid] = pos;
    sim.hhEnd[hid] = pos + size - 1;

    // ---- 按角色给这一家人分配年龄 ----
    const roles = roleList(size, hash01(pos, 43));
    let parentAge = 0, kidN = 0;
    for (let j = 0; j < size; j++) {
      const i = civs[pos + j];
      const role = roles[j];
      let age;
      if (role === 'parent') {
        if (!parentAge) parentAge = 26 + hash01(pos, 44) * 26;              // 26–52
        age = Math.round(parentAge + (j > 0 ? (hash01(pos, 45) - 0.5) * 10 : 0)); // 配偶差 ±5
        age = Math.max(22, Math.min(56, age));
      } else if (role === 'kid') {
        age = Math.round(2 + hash01(pos + kidN * 7, 46) * 15);              // 2–17
        kidN++;
        age = Math.min(age, Math.max(0, Math.round(parentAge) - 17));       // 至少比家长小 17 岁
      } else if (role === 'elder') {
        age = Math.round(64 + hash01(pos, 47) * 22);                        // 64–86
      } else {
        age = Math.round(20 + hash01(pos, 48) * 30);                        // 室友 / 独居
      }
      sim.age[i] = Math.max(1, Math.min(99, age));
      sim.hh[i] = hid;
      if (sim.tourist) sim.tourist[i] = tourist ? 1 : 0;
    }
    pos += size;
    hid++;
  }
  sim.nHh = hid;
  return hid;
}

/** 取年龄：优先用家庭分配的（平民），否则按哈希（警察/士兵等） */
export function ageOfAgent(sim, i, fallback) {
  const a = sim && sim.age ? sim.age[i] : 0;
  return a || (fallback ? fallback(i) : 0);
}

/** 家庭 id → 成员下标数组 */
export function membersOf(sim, hid) {
  const out = [];
  if (!sim.civAt || !sim.hhStart) return out;
  const a = sim.hhStart[hid], b = sim.hhEnd[hid];
  for (let p = a; p <= b && p < sim.civAt.length; p++) out.push(sim.civAt[p]);
  return out;
}

/** 某人所在家庭的全部成员（含自己） */
export function familyOf(sim, i) {
  if (!sim.hh || !sim.hhStart) return [i];
  return membersOf(sim, sim.hh[i]);
}

/**
 * 关系推断（看年龄，不存字段）：
 *   · 最年长两位成年、年龄差 < 15 → 配偶
 *   · 未满 18 → 子女，父母是那两位成年
 *   · 最年长 > 60 且有中间代 + 孙辈 → 祖辈
 * 返回 { role: 'self'|'spouse'|'parent'|'child'|'grandparent'|'sibling', of: idx }
 */
export function relationTo(sim, i, j, ageOf) {
  if (i === j) return 'self';
  const ai = ageOf(i), aj = ageOf(j);
  const both = ai >= 18 && aj >= 18;
  if (both && Math.abs(ai - aj) < 15) return 'spouse';
  if (ai >= 18 && aj < 18) return 'parent';    // i 是 j 的父母
  if (ai < 18 && aj >= 18) return 'child';
  if (ai >= 60) return 'grandparent';
  return 'sibling';
}

/** 给档案用的一句话：配偶 / 子女 / 独居 / 旅客 */
export function kinText(sim, i, ageOf, nameOf) {
  if (!sim.hh) return '—';
  if (sim.tourist && sim.tourist[i]) return '旅客（独自一人，没有家属）';
  const fam = familyOf(sim, i);
  if (fam.length <= 1) return '独居';
  const ai = ageOf(i);
  const spouse = [], kids = [], parents = [];
  for (const j of fam) {
    if (j === i) continue;
    const aj = ageOf(j);
    if (ai >= 18 && aj >= 18 && Math.abs(ai - aj) < 15) spouse.push(j);
    else if (ai >= 18 && aj < 18) kids.push(j);
    else if (ai < 18 && aj >= 18) parents.push(j);
  }
  const parts = [];
  if (spouse.length) parts.push('配偶 ' + spouse.slice(0, 1).map((j) => nameOf(j)).join(''));
  if (kids.length) parts.push('子女 ' + kids.slice(0, 3).map((j) => `${nameOf(j)}（${ageOf(j)}）`).join('、'));
  if (parents.length) parts.push('父母 ' + parents.slice(0, 2).map((j) => nameOf(j)).join('和'));
  if (!parts.length) parts.push('家人 ' + fam.filter((j) => j !== i).slice(0, 3).map((j) => nameOf(j)).join('、'));
  return parts.join('　');
}
