// ============================================================
//  ZOS-R · 个体档案
//  纯函数：同一个个体的档案永远一致（姓名/年龄/职业/住址都由下标哈希决定）
//  表格类数据在 profiles.js 里（sim.js 也要用职业来分配工作地）
// ============================================================
import { ST, GOAL } from './sim.js';
import {
  firstNamePool, lastNamePool, surnameFirst, companiesPool, streetsPool,
  h, pick, ageOf, maleOf, jobFor,
} from './profiles.js';
import { kinText, ageOfAgent } from './family.js';
import { WEAPONS } from './weapons.js';

/** 姓氏：平民按家庭取（一家人同姓），警察/士兵等按个体取 */
function surnameOf(sim, i) {
  const LAST = lastNamePool();
  if (sim && sim.hh && sim.civAt && sim.nHh && sim.hh[i] < sim.nHh) {
    return LAST[sim.hh[i] % LAST.length];
  }
  return pick(LAST, i, 2);
}

/** 家庭内的序号（0 起）；不在家庭里返回 0 */
function posInFamily(sim, i) {
  if (!sim || !sim.hh || !sim.hhStart || !sim.civAt) return 0;
  const hid = sim.hh[i];
  if (hid >= sim.nHh || sim.hhStart[hid] >= sim.civAt.length) return 0;
  return i - sim.civAt[sim.hhStart[hid]];
}

/**
 * 名：一家人里按序号错开，保证同户不重名（"本·米勒"和"本·米勒"会很怪）。
 * 只有 20 个名字、家庭最多 5 人，错开足够。
 */
function firstNameOf(sim, i) {
  const FIRST = firstNamePool();
  if (!sim || !sim.hh || !sim.hhStart || !sim.civAt || !sim.nHh) return pick(FIRST, i, 1);
  const hid = sim.hh[i];
  if (hid >= sim.nHh) return pick(FIRST, i, 1);
  // 一户共用一个起点、按户内序号错开 → 同户必不重名（家庭 ≤ 5 人，名字 20 个）
  const start = sim.civAt[sim.hhStart[hid]];
  if (start === undefined) return pick(FIRST, i, 1);
  const base = Math.floor(h(start, 1) * FIRST.length) % FIRST.length;
  // 户内错开用大步长（质数），否则相邻下标会取到"德琳/德蕾"这种只差一字的连号
  const STRIDE = 97;
  return FIRST[(base + (i - start) * STRIDE) % FIRST.length];
}

/** 短名：中日「姓 + 名」（王伟 / 佐藤健太），其余「名·姓首字」（卢卡斯·米） */
export function shortName(i, sim) {
  if (sim && sim.nameFix && sim.nameFix.has(i)) return sim.nameFix.get(i);
  const given = firstNameOf(sim, i);
  const last = surnameOf(sim, i);
  return surnameFirst() ? last + given : given + '·' + last[0];
}

const STATE_TXT = {
  [ST.CIV]: ['在街上走动', 'green'],
  [ST.FLEE]: ['正在逃跑', 'amber'],
  [ST.FIGHT]: ['持枪还击', 'cyan'],
  [ST.POLICE]: ['执勤中', 'blue'],
  [ST.SOLDIER]: ['作战中', 'blue'],
  [ST.ZOMBIE]: ['已丧尸化', 'red'],
  [ST.INFECTED]: ['已被咬（潜伏期）', 'amber'],
  [ST.CORPSE]: ['已死亡', 'grey'],
  [ST.SAVED]: ['已撤离', 'cyan'],
  [ST.WILD]: ['野生动物', 'grey'],
};

/** 当前"社会目标"的文字：回家 / 上班 / 到了没有 */
export function goalText(sim, i) {
  const st = sim.state[i];
  // 尸体 / 已撤离 / 已尸变：goal 数组里还留着生前那个目标，不能拿来显示
  if (st === ST.CORPSE || st === ST.SAVED || st === ST.ZOMBIE) return null;
  const g = sim.goal ? sim.goal[i] : GOAL.NONE;
  if (g === GOAL.NONE) return null;
  const dist = (x, z) => Math.hypot(x - sim.px[i], z - sim.pz[i]);
  const near = (x, z) => dist(x, z) < 6;
  switch (g) {
    case GOAL.WORK: return near(sim.workX[i], sim.workZ[i]) ? '在单位' : '在去上班的路上';
    case GOAL.HOME: return near(sim.homeX[i], sim.homeZ[i]) ? '在家' : '在回家的路上';
    case GOAL.FLEE: return '正在撤往撤离线';
    case GOAL.ARM_HOME: return near(sim.homeX[i], sim.homeZ[i]) ? '在家取枪' : '赶回家取枪';
    case GOAL.SHELTER: return dist(sim.goalX[i], sim.goalZ[i]) < 8 ? '在警察局避难' : '正赶往警察局避难';
    case GOAL.HELP: return dist(sim.goalX[i], sim.goalZ[i]) < 8 ? '在医院门口' : '正赶往医院';
    case GOAL.HOLD: return '就地固守';
    case GOAL.FOLLOW: return '跟着人群走';
    case GOAL.MOVE_TO: return '执行命令';
    default: return null;
  }
}

export function profileFor(sim, i) {
  const f = firstNameOf(sim, i), l = surnameOf(sim, i);
  let age = ageOfAgent(sim, i, ageOf);       // 平民用家庭分配的年龄，其余按哈希（后面会按身份修正）
  const male = maleOf(i);
  // 职业：平民按年龄/哈希算，但动物、警察、军队、要员有固定身份
  let job = jobFor(i, age);
  const kind = sim.kind ? sim.kind[i] : 0;
  const isAnimalKind = (kind === 12 || kind === 13);
  // 家养/野生由 sim 出生时决定（sim.pet），UI 只读不重算，避免两边不一致
  const animalWild = isAnimalKind ? !(sim.pet && sim.pet[i]) : false;
  if (kind === 12) job = animalWild ? '流浪狗' : '家养宠物狗';
  else if (kind === 13) job = animalWild ? '流浪猫' : '家养宠物猫';
  else if (kind === 3) job = '警察';
  else if (kind === 4) job = '士兵';
  else if (kind === 5) job = '重装兵';
  else if (kind === 11) job = '装甲车组';
  else if (sim.vip && sim.vip[i]) job = '政府要员';

  // 年龄也按身份修正（警察/军人/要员不该出现 66 岁一线执勤）
  if (kind === 4 || kind === 5) age = 19 + Math.floor(h(i, 88) * 22);        // 士兵 19~40
  else if (kind === 3) age = 24 + Math.floor(h(i, 88) * 30);                 // 警察 24~53
  else if (sim.vip && sim.vip[i]) age = 40 + Math.floor(h(i, 88) * 32);      // 要员 40~71
  else if (kind === 12 || kind === 13) age = 1 + Math.floor(h(i, 88) * 12);  // 猫狗 1~12 岁

  const ST = streetsPool();
  const st1 = pick(ST, i, 6), st2 = pick(ST, i, 7), st3 = pick(ST, i, 8);
  const home = `${st1} ${1 + Math.floor(h(i, 9) * 140)} 号`;
  const work = age < 20 || age > 65
    ? `${st2} ${1 + Math.floor(h(i, 10) * 90)} 号`
    : `${pick(companiesPool(), i, 11)}（${st3} ${1 + Math.floor(h(i, 12) * 90)} 号）`;

  // 家庭：真的按 household 算（配偶 / 子女 / 父母 / 独居 / 旅客）
  const kinAge = (j) => ageOfAgent(sim, j, ageOf);
  let family = kinText(sim, i, kinAge, (j) => shortName(j, sim));
  // 家属文本按身份：
  //   警察是本地人，正常有家（不覆盖）
  //   士兵/重装兵住部队营房
  //   动物分家养（有主人）/ 野生（无主）
  if (isAnimalKind) family = animalWild ? '—（野生，无主）' : '有主人照料（在住处附近活动）';
  else if (kind === 4 || kind === 5) family = '住部队营房，家属不随行';

  const state = sim.state[i];
  const [stateTxt, stateColor] = STATE_TXT[state] || ['—', 'grey'];
  const g = goalText(sim, i);
  const AWARE_TXT = ['一无所知', '听说了（电话/网络）', '亲眼看见', '亲身经历'];
  const aw = sim.aware ? sim.aware[i] : 0;
  const awareText = aw > 0 ? AWARE_TXT[Math.min(3, aw)] : null;
  const social = (state === ST.CIV || state === ST.FLEE || state === ST.FIGHT) ? g : null;

  const DOG_NAME = ['旺财', '来福', '大黄', '黑豆', '豆豆', '可乐'];
  const CAT_NAME = ['咪咪', '雪球', '花卷', '汤圆', '布丁', '奶糖'];
  const namePool = kind === 13 ? CAT_NAME : DOG_NAME;
  const petName = namePool[Math.floor(h(i, 89) * namePool.length) | 0];
  return {
    idx: i,
    name: (kind === 12 || kind === 13) ? petName
      : (sim.nameFix && sim.nameFix.has(i) ? sim.nameFix.get(i)
        : (surnameFirst() ? `${l}${f}` : `${f}·${l}`)),
    nameEn: null,                       // 姓名池里没有罗马字，不再拼 "undefined"

    age, male, job, home, work, family,
    isAnimal: !!(sim.kind && sim.kind[i] >= 12),
    animalWild,
    state, stateTxt, stateColor,
    social,                     // 通勤状态（回家/上班/在单位/在家）或 null
    aware: aw,
    awareText,                  // 知情程度
    vip: !!(sim.vip && sim.vip[i]),
    hp: Math.max(0, Math.round(sim.hp[i])),
    hpMax: Math.max(1, Math.round(Math.max(100, sim.hp[i]))),
    vipEscort: (sim.vip && sim.vip[i] && sim.vipStage) ? (() => {
      const st = sim.vipStage[i], gl = sim.vipGoal[i];
      if (sim.vipDone && sim.vipDone[i]) return '已安置（护送完成）';
      if (!st) return '暂无护送（混乱度未到 20%）';
      // 用 sim 维护的计数（每帧在 escortOf 变更处维护），不再 O(n) 扫描
      const slot = (sim.vips || []).indexOf(i) + 1;
      const n = (sim.escortCount && sim.escortCount[slot]) || 0;
      return `${st === 2 ? '八人' : '四人'}小队护送中（当前 ${n} 人）→ ${gl === 2 ? '撤离城区' : '前往警察局'}`;
    })() : null,
    infected: state === ST.INFECTED,
    timer: sim.timer[i],
    armed: !!sim.armed[i],
    ammo: sim.ammo[i],
    weaponTxt: sim.wpn && sim.armed[i] ? (WEAPONS[sim.wpn[i]] || WEAPONS[0]).name : null,
    mag: sim.mag ? sim.mag[i] : 0,
    reserve: sim.reserve ? sim.reserve[i] : 0,
    skillPct: sim.skill ? Math.round(sim.skill[i] / 255 * 100) : 0,
  };
}


