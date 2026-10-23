// 零号病人自检（M6）：长潜伏 / 发病 / 医院链 / 与快速模式对比
//   node tools/test_patientzero.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL, INCFG } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 909, population: 12000, initialZombies: 120, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'stealth',
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const run = (sec) => { for (let t = 0; t < 20 * sec; t++) sim.step(1 / 20, 0, 0); };
const sickList = () => {
  const out = [];
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.INFECTED && sim.sick[i]) out.push(i);
  return out;
};

// ---------- 1. 开局：只有 1–3 个潜伏者 ----------
console.log('1) 开局');
sim.reset(P);
{
  let inf = 0, inRange = 0;
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] !== ST.INFECTED) continue;
    inf++;
    const tot = sim.incTot[i];
    if (tot >= INCFG.long[0] * 0.95 && tot <= INCFG.long[1] * 1.05) inRange++;
  }
  ok(inf >= 1 && inf <= 3, `潜伏者 ${inf} 人（1–3）`);
  ok(inRange === inf, `潜伏时长都在 10–30 分钟内（${inRange}/${inf}）`);
  ok(sim.stats.zombie === 0, '开场没有丧尸');
  ok(sim.nAware === 0, '开场没人知情（连警察都还不知道）');
}

// ---------- 2. 前 10 分钟什么都不会发生 ----------
console.log('2) 长潜伏：前 10 分钟风平浪静');
{
  run(300);
  const z5 = sim.stats.zombie, a5 = sim.nAware / sim.n;
  run(300);
  const z10 = sim.stats.zombie;
  ok(z5 === 0, `5 分钟时丧尸 ${z5}（应为 0）`);
  ok(z10 === 0, `10 分钟时丧尸 ${z10}（应为 0）`);
  ok(a5 < 0.1, `5 分钟时知情 ${(a5 * 100).toFixed(0)}%（应 < 10%，没人知道出事了）`);
}

// ---------- 3. 发病：往医院跑 ----------
console.log('3) 发病阶段');
{
  let sick = sickList();
  if (!sick.length) { run(300); sick = sickList(); }
  ok(sick.length > 0, `${sick.length} 人进入发病期`);
  const h = sim.nearestPoi('hospital', sim.px[sick[0]], sim.pz[sick[0]]);
  ok(!!h, '城里有医院 POI');
  // 发病者的目标应该是"去医院"，并且确实在靠近
  const before = sick.map((i) => {
    const hp = sim.nearestPoi('hospital', sim.px[i], sim.pz[i]);
    return hp ? Math.hypot(hp.x - sim.px[i], hp.z - sim.pz[i]) : Infinity;
  });
  run(120);
  let closer = 0;
  sick.forEach((i, k) => {
    const hp = sim.nearestPoi('hospital', sim.px[i], sim.pz[i]);
    if (!hp) return;
    const d = Math.hypot(hp.x - sim.px[i], hp.z - sim.pz[i]);
    if (d < before[k] - 5) closer++;
  });
  ok(closer > 0, `${closer}/${sick.length} 个发病者离医院更近了（往医院跑）`);
  const helpGoals = sick.filter((i) => sim.goal[i] === GOAL.HELP).length;
  ok(helpGoals > 0, `${helpGoals} 个发病者的目标是"去医院"`);
}

// ---------- 4. 第一次尸变 ----------
console.log('4) 第一次尸变');
{
  // 用一个全新的 sim，从 t=0 开始计时（前面几段已经把时间推过了）
  const s2 = new Sim(nav, city);
  s2.reset(P);
  let firstIdx = -1, tFirst = -1;
  for (let m = 1; m <= 45 && firstIdx < 0; m++) {
    for (let t = 0; t < 20 * 60; t++) s2.step(1 / 20, 0, 0);
    for (let i = 0; i < s2.n; i++) if (s2.state[i] === ST.ZOMBIE) { firstIdx = i; break; }
    if (firstIdx >= 0) tFirst = s2.time / 60;
  }
  ok(firstIdx >= 0, `第一次尸变发生在开局后约 ${tFirst.toFixed(0)} 分钟`);
  ok(tFirst >= 9, `至少潜伏了 ${tFirst.toFixed(0)} 分钟（应 ≥ 9，不像快速模式那样几分钟就爆）`);
  if (firstIdx >= 0) {
    const hp = s2.nearestPoi('hospital', s2.px[firstIdx], s2.pz[firstIdx]);
    if (hp) {
      const d = Math.hypot(hp.x - s2.px[firstIdx], hp.z - s2.pz[firstIdx]);
      console.log(`     第一只丧尸距离最近的医院 ${d.toFixed(0)}m`);
      ok(d < 400, `第一只丧尸就在医院附近（${d.toFixed(0)}m）—— 医院链成立`);
    }
  }
}
// ---------- 5. 与快速模式对比 ----------
console.log('5) 对比：普通模式 1 分钟内就会爆');
{
  const quick = new Sim(nav, city);
  quick.reset({ ...P, mode: 'single', seed: 909 });
  for (let t = 0; t < 20 * 60; t++) quick.step(1 / 20, 0, 0);
  ok(quick.stats.zombie > 100, `普通模式 1 分钟后丧尸 ${quick.stats.zombie} 只`);
}

// ---------- 6. 确定性 / 性能 ----------
console.log('6) 确定性 / 性能');
{
  const snap = () => {
    let s = 0;
    for (let i = 0; i < sim.n; i++) s = (s * 31 + sim.state[i] * 3 + sim.sick[i]) | 0;
    return s;
  };
  sim.reset(P); run(600); const a = snap();
  sim.reset(P); run(600); const b = snap();
  ok(a === b, '同 seed 同参数，10 分钟后的感染状态一致');

  sim.reset({ ...P, population: 20000 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4.5, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4.5ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
