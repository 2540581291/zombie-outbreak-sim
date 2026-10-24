// ============================================================
//  政府行动：数据聚合 + 行动效果（统一派遣 / 清剿 / 停课 / 停收治）
//      node tools/test_gov.mjs
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL, INST } from '../js/sim.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };

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
console.log(`  政府 ${d.gov.total} 人（在岗 ${d.gov.atPost} / 街上 ${d.gov.street} / 死亡 ${d.gov.dead} / 感染 ${d.gov.infected} / 撤离 ${d.gov.saved}）`);
console.log(`  警察 ${d.police.total} 人（驻局 ${d.police.atPost} / 街上 ${d.police.street} / 阵亡 ${d.police.dead}）`);
console.log(`  医院 ${d.hosp.total} 人（在岗 ${d.hosp.atPost} / 死亡 ${d.hosp.dead}）· 前往的病人 ${d.patients}`);
console.log(`  学校 ${d.school.total} 人（在校 ${d.school.atPost} / 死亡 ${d.school.dead}）`);
ok(d.gov.total > 0, '政府雇员 > 0');
ok(d.police.total > 0, '警察 > 0');
ok(d.hosp.total > 0, '医院编制 > 0');
ok(d.school.total > 0, '学校编制 > 0');

// ---------- 2. 统一派遣：士兵从政府刷出来，再走过去 ----------
const hosp = (sim.poiByKind.hospital || [])[0];
const gov = (sim.poiByKind.gov || [])[0];
ok(!!hosp && !!gov, '存在政府大楼与医院 POI');
const nSoldBefore = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.SOLDIER) n++; return n; })();
const r = sim.dispatchTo('soldier', hosp.x, hosp.z, 8);
const nSoldAfter = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.SOLDIER) n++; return n; })();
console.log(`\n[2] 派兵去医院：${JSON.stringify({ ok: r.ok, n: r.n, from: r.from })}  士兵 ${nSoldBefore} → ${nSoldAfter}`);
ok(r.ok && r.n === 8, '派出 8 名士兵');
ok(nSoldAfter - nSoldBefore === 8, '士兵确实是从无到有刷出来的');
// 起点应该在政府大楼附近
let nearGov = 0;
for (const i of r.ids) {
  if (Math.hypot(sim.px[i] - gov.x, sim.pz[i] - gov.z) < 40) nearGov++;
}
ok(nearGov >= 6, `士兵出生在政府大楼附近（${nearGov}/8）`);

// 走 20 秒：应该朝医院方向移动
const startD = r.ids.map((i) => Math.hypot(sim.px[i] - hosp.x, sim.pz[i] - hosp.z));
for (let t = 0; t < 20 * 20; t++) sim.step(1 / 20, 0, 0);
const endD = r.ids.map((i) => Math.hypot(sim.px[i] - hosp.x, sim.pz[i] - hosp.z));
const closed = endD.filter((v, k) => v < startD[k] - 20).length;
console.log(`  20 秒后：${closed}/8 明显靠近了医院（平均缩短 ${(startD.reduce((a, v, k) => a + v - endD[k], 0) / 8).toFixed(0)} m）`);
ok(closed >= 5, '士兵在往医院走，不是站在原地');

// ---------- 3. 清剿 ----------
const rp = sim.orderPurge(hosp.x, hosp.z, 6, false);
let purging = 0;
for (let i = 0; i < sim.n; i++) if (sim.purgeT[i] > sim.time) purging++;
console.log(`\n[3] 清剿令：派出 ${rp.n} 人，处于清剿状态 ${purging} 人`);
ok(rp.ok && purging >= 6, '清剿兵力已标记（对人开火）');

// ---------- 4. 学校停课 ----------
const before = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.jobKind[i] === INST.SCHOOL && sim.goal[i] === GOAL.WORK) n++; return n; })();
sim.setSchoolClosed(true);
for (let t = 0; t < 10 * 20; t++) sim.step(1 / 20, 0, 0);
const after = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.jobKind[i] === INST.SCHOOL && sim.goal[i] === GOAL.WORK) n++; return n; })();
console.log(`\n[4] 停课：去学校的人 ${before} → ${after}`);
ok(after < before * 0.35, '停课后大部分学生不再往学校跑');
sim.setSchoolClosed(false);

// ---------- 5. 医院停止收治 ----------
const patBefore = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.goal[i] === GOAL.HELP) n++; return n; })();
sim.setHospitalClosed(true);
const evac = sim.clearPatients();
for (let t = 0; t < 6 * 20; t++) sim.step(1 / 20, 0, 0);
const patAfter = (() => { let n = 0; for (let i = 0; i < sim.n; i++) if (sim.goal[i] === GOAL.HELP) n++; return n; })();
console.log(`\n[5] 停止收治 + 疏散 ${evac} 人：前往医院 ${patBefore} → ${patAfter}`);
ok(patAfter <= Math.max(2, patBefore * 0.2), '停收治后几乎没人再往医院跑');

// ---------- 6. 警察全员回局 ----------
const ph = sim.orderPoliceHome();
console.log(`\n[6] 全员回局：${ph.n} 人`);
ok(ph.n > 0, '有警员接到回局命令');

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
