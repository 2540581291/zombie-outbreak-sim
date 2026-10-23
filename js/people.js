// ============================================================
//  ZOS-R · 个体档案
//  纯函数：同一个个体的档案永远一致（姓名/年龄/职业/住址都由下标哈希决定）
//  表格类数据在 profiles.js 里（sim.js 也要用职业来分配工作地）
// ============================================================
import { ST, GOAL } from './sim.js';
import {
  FIRST, LAST, COMPANIES, STREETS,
  h, pick, ageOf, maleOf, jobFor,
} from './profiles.js';
import { kinText, ageOfAgent } from './family.js';
import { WEAPONS } from './weapons.js';

/** 姓氏：平民按家庭取（一家人同姓），警察/士兵等按个体取 */
function surnameOf(sim, i) {
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
  if (!sim || !sim.hh || !sim.hhStart || !sim.civAt || !sim.nHh) return pick(FIRST, i, 1);
  const hid = sim.hh[i];
  if (hid >= sim.nHh) return pick(FIRST, i, 1);
  // 一户共用一个起点、按户内序号错开 → 同户必不重名（家庭 ≤ 5 人，名字 20 个）
  const start = sim.civAt[sim.hhStart[hid]];
  if (start === undefined) return pick(FIRST, i, 1);
  const base = Math.floor(h(start, 1) * FIRST.length) % FIRST.length;
  return FIRST[(base + (i - start)) % FIRST.length];
}

/** 短名（名 + 姓首字），总览表和亲属列表用 */
export function shortName(i, sim) {
  const f = firstNameOf(sim, i);
  return f[0] + '·' + surnameOf(sim, i)[0];
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
  const g = sim.goal ? sim.goal[i] : GOAL.NONE;
  if (g === GOAL.NONE) return null;
  const dist = (x, z) => Math.hypot(x - sim.px[i], z - sim.pz[i]);
  const near = (x, z) => dist(x, z) < 6;
  switch (g) {
    case GOAL.WORK: return near(sim.workX[i], sim.workZ[i]) ? '在单位' : '在去上班的路上';
    case GOAL.HOME: return near(sim.homeX[i], sim.homeZ[i]) ? '在家' : '在回家的路上';
    case GOAL.FLEE: return 正在逃往侧出口;
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
  const age = ageOfAgent(sim, i, ageOf);     // 平民用家庭分配的年龄，其余按哈希
  const male = maleOf(i);
  const job = jobFor(i, age);

  const st1 = pick(STREETS, i, 6), st2 = pick(STREETS, i, 7), st3 = pick(STREETS, i, 8);
  const home = `${st1} ${1 + Math.floor(h(i, 9) * 140)} 号`;
  const work = age < 20 || age > 65
    ? `${st2} ${1 + Math.floor(h(i, 10) * 90)} 号`
    : `${pick(COMPANIES, i, 11)}（${st3} ${1 + Math.floor(h(i, 12) * 90)} 号）`;

  // 家庭：真的按 household 算（配偶 / 子女 / 父母 / 独居 / 旅客）
  const kinAge = (j) => ageOfAgent(sim, j, ageOf);
  const family = kinText(sim, i, kinAge, (j) => shortName(j, sim));

  const state = sim.state[i];
  const [stateTxt, stateColor] = STATE_TXT[state] || ['—', 'grey'];
  const g = goalText(sim, i);
  const AWARE_TXT = ['一无所知', '听说了（电话/网络）', '亲眼看见', '亲身经历'];
  const aw = sim.aware ? sim.aware[i] : 0;
  const awareText = aw > 0 ? AWARE_TXT[Math.min(3, aw)] : null;
  const social = (state === ST.CIV || state === ST.FLEE || state === ST.FIGHT) ? g : null;

  return {
    idx: i,
    name: `${f[0]}·${l[0]}`,
    nameEn: `${f[1]} ${l[1]}`,
    age, male, job, home, work, family,
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
      let n = 0;
      const slot = (sim.vips || []).indexOf(i) + 1;
      for (let k = 0; k < sim.n; k++) if (sim.escortOf[k] === slot) n++;
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


