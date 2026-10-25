// ============================================================
//  政府行动：自动决策（玩家只读）
//      node tools/test_gov.mjs
//
//  验证点：
//    1. 面板聚合（四个机构的编制/在岗/死亡/感染/撤离/病人）
//    2. 统一派遣：士兵从政府刷出再走过去（dispatchTo）
//    3. 条件触发：混乱↑ → 学校自动停课
//    4. 条件触发：感染↑ → 医院停收治 + 军队进驻
//    5. 混乱爆表 → 清剿令，且真的会杀人
//    6. 决策日志 + 在外执勤名单
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL, INST } from '../js/sim.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const count = (fn) => { let n = 0; for (let i = 0; i < sim.n; i++) if (fn(i)) n++; return n; };

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({
  seed: 20251022, population: 20000, initialZombies: 80, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 40, policeAccuracy: 0.3,
});
sim.ensureNav();
for (let t = 0; t < 20 * 20; t++) sim.step(1 / 20, 0, 0);

// ---------- 1. 聚合 ----------
const d = sim.govDetail();
console.log(`\n[1] 机构总览`);
console.log(`  政府 ${d.gov.total} 人（在岗 ${d.gov.atPost} / 死亡 ${d.gov.dead} / 感染 ${d.gov.infected}）`);
console.log(`  警察 ${d.police.total} 人（驻局 ${d.police.atPost} / 街上 ${d.police.street}）`);
console.log(`  医院 ${d.hosp.total} 人 · 前往病人 ${d.patients} · 院内 ${d.patientsInside}`);
console.log(`  学校 ${d.school.total} 人（在校 ${d.school.atPost}）`);
ok(d.gov.total > 0 && d.police.total > 0 && d.hosp.total > 0 && d.school.total > 0,
  '四个机构都有编制数据');
ok(Array.isArray(d.duties) && Array.isArray(d.log), '面板数据里带 派遣名单 + 决策日志');

// ---------- 2. 统一派遣 ----------
const hosp = (sim.poiByKind.hospital || [])[0];
const gov = (sim.poiByKind.gov || [])[0];
const nSold = () => count((i) => sim.state[i] === ST.SOLDIER);
const before = nSold();
const r = sim.dispatchTo('soldier', hosp.x, hosp.z, 8, { dest: '医院', why: '测试' });
console.log(`\n[2] 派兵去医院：${r.n} 人，士兵 ${before} → ${nSold()}，出发地「${r.from}」`);
ok(r.ok && nSold() - before === 8, '士兵从政府刷出来（数量正确）');
let nearGov = 0;
for (const i of r.ids) if (Math.hypot(sim.px[i] - gov.x, sim.pz[i] - gov.z) < 40) nearGov++;
ok(nearGov >= 6, `出生点在政府大楼附近（${nearGov}/8）`);
const d2 = sim.govDetail();
console.log(`  名单里 ${d2.duties.length} 人：` +
  d2.duties.slice(0, 3).map((x) => `${x.soldier ? '士兵' : '警员'}→${x.dest} ${Math.round(x.dist)}m`).join(' / '));
ok(d2.duties.length >= 8, '在外执勤名单记录了这批人');
const startD = r.ids.map((i) => Math.hypot(sim.px[i] - hosp.x, sim.pz[i] - hosp.z));
for (let t = 0; t < 20 * 20; t++) sim.step(1 / 20, 0, 0);
const endD = r.ids.map((i) => Math.hypot(sim.px[i] - hosp.x, sim.pz[i] - hosp.z));
const closer = endD.filter((v, k) => v < startD[k] - 20).length;
console.log(`  20 秒后 ${closer}/8 明显靠近医院（平均缩短 ${(startD.reduce((a, v, k) => a + v - endD[k], 0) / 8).toFixed(0)} m）`);
ok(closer >= 5, '士兵在往医院走');

// ---------- 3. 混乱 ↑ → 学校自动停课 ----------
const beforeKids = count((i) => sim.jobKind[i] === INST.SCHOOL && sim.goal[i] === GOAL.WORK);
sim.time = 200;
sim.chaos = 30;
sim.govT = 0;
sim.updateGov(0.1);
console.log(`\n[3] 混乱 30 → 学校停课=${sim.govOrders.schoolClosed}；日志：${sim.govLog.slice(-1)[0]?.text || '—'}`);
ok(sim.govOrders.schoolClosed, '混乱到 30 自动停课');
for (let t = 0; t < 8 * 20; t++) sim.step(1 / 20, 0, 0);
const afterKids = count((i) => sim.jobKind[i] === INST.SCHOOL && sim.goal[i] === GOAL.WORK);
console.log(`  去学校的人 ${beforeKids} → ${afterKids}`);
ok(afterKids < beforeKids * 0.4, '停课后学生不再往学校跑');

// ---------- 4. 感染 ↑ → 医院停收治 + 军队进驻 ----------
sim.time = 400;
sim.chaos = 20;
sim.infectRate = 0.12;
sim.govT = 0;
sim.updateGov(0.1);
const solDuty = sim.govDetail().duties.filter((x) => x.soldier).length;
console.log(`\n[4] 感染 6% → 停收治=${sim.govOrders.hospitalClosed}；军队在外 ${solDuty} 人`);
ok(sim.govOrders.hospitalClosed, '感染 6% 自动停止收治');
ok(sim.govLog.some((l) => l.inst === 'gov'), '政府决策写进了日志');
ok(solDuty >= 6, '军队自动进驻医院');

// ---------- 5. 混乱爆表 → 清剿 ----------
sim.time = 600;
sim.chaos = 90;
sim.govT = 0;
sim.updateGov(0.1);
const purging = count((i) => sim.purgeT[i] > sim.time);
const corpse0 = count((i) => sim.state[i] === ST.CORPSE);
const gp = (sim.poiByKind.gov || [])[0];
const rr = sim.orderPurge(gp.x, gp.z, 8, false);   // 就地下令，确保有人在射程内
const shots0 = sim.stats.shots;
for (let t = 0; t < 30 * 20; t++) sim.step(1 / 20, 0, 0);
const corpse1 = count((i) => sim.state[i] === ST.CORPSE);
console.log(`\n[5] 清剿：混乱 85 触发 ${purging} 人；再派 ${rr.n} 人 → 30 秒开火 ${sim.stats.shots - shots0} 次，尸体 ${corpse0} → ${corpse1}`);
ok(purging >= 8, '混乱爆表自动下清剿令');
ok(corpse1 - corpse0 > 5, '清剿真的在杀人');

// ---------- 6. 日志与名单 ----------
const d3 = sim.govDetail();
console.log(`\n[6] 决策日志 ${d3.log.length} 条，名单 ${d3.duties.length} 人`);
console.log('   最近：' + d3.log.slice(0, 3).map((l) => `[${l.inst}] ${l.text}`).join(' ｜ '));
ok(d3.log.length >= 3, '决策日志有内容');
ok(d3.duties.length > 0, '名单有内容');

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
