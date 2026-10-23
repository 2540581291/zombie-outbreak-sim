// 信息层自检（M3）：知晓度 / 电话 / 网络 / 家人优先 / 确定性
//   node tools/test_info.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 2024, population: 12000, initialZombies: 120, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single', infoRate: 1,
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const run = (sec) => { for (let t = 0; t < 20 * sec; t++) sim.step(1 / 20, 0, 0); };
const awareFrac = () => sim.nAware / Math.max(1, sim.n);

// ---------- 1. 开局 ----------
console.log('1) 开局');
sim.reset(P);
ok(sim.nAware === 0, `开局知情人数 ${sim.nAware}（应为 0）`);
ok(sim.heat === 0, `开局网络热度 ${sim.heat}（应为 0）`);

// ---------- 2. 曲线 ----------
console.log('2) 传播曲线（目标：S 形，5 分钟约 30%，10 分钟 70% 上下）');
const marks = {};
for (const t of [60, 120, 300, 600]) { run(t - (marks._prev || 0)); marks._prev = t; marks[t] = awareFrac(); }
for (const [t, v] of Object.entries(marks)) if (t !== '_prev') console.log(`     ${(+t / 60).toFixed(0)} 分钟：${(v * 100).toFixed(0)}%`);
ok(marks[60] < 0.15, `1 分钟 ${(marks[60] * 100).toFixed(0)}%（应 < 15%，不能一上来全城都知道）`);
ok(marks[300] > 0.12 && marks[300] < 0.6, `5 分钟 ${(marks[300] * 100).toFixed(0)}%（应落在 12–60%）`);
ok(marks[600] > 0.5, `10 分钟 ${(marks[600] * 100).toFixed(0)}%（应 > 50%）`);

// ---------- 3. 家人优先 ----------
console.log('3) 家人优先');
{
  let allIn = 0, tot = 0;
  for (let i = 0; i < sim.n && tot < 300; i++) {
    if (sim.aware[i] < 1 || !sim.hhStart || sim.hh[i] >= sim.nHh) continue;
    const a = sim.hhStart[sim.hh[i]], b = sim.hhEnd[sim.hh[i]];
    if (b - a + 1 < 2) continue;
    tot++;
    let all = true;
    for (let p = a; p <= b; p++) if (sim.aware[sim.civAt[p]] < 1) all = false;
    if (all) allIn++;
  }
  ok(allIn / Math.max(1, tot) > 0.6,
    `知情者中 ${allIn}/${tot}（${(allIn / Math.max(1, tot) * 100).toFixed(0)}%）全家都已知道（应 > 60%）`);
}

// ---------- 4. 目击 vs 听说 ----------
console.log('4) 目击 / 听说 / 亲历');
{
  let c = [0, 0, 0, 0];
  for (let i = 0; i < sim.n; i++) c[Math.min(3, sim.aware[i])]++;
  console.log(`     无知 ${c[0]} / 听说 ${c[1]} / 目击 ${c[2]} / 亲历 ${c[3]}`);
  ok(c[2] > 0, `有人亲眼看见（${c[2]}）`);
  ok(c[1] > c[2], '听说的人远多于目击（电话/网络是主渠道）');
  let policeAware = 0, policeN = 0;
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.POLICE) { policeN++; if (sim.aware[i] >= 3) policeAware++; }
  ok(policeN === 0 || policeAware === policeN, `警察全部有电台（${policeAware}/${policeN}）`);
}

// ---------- 5. 传播系数 ----------
console.log('5) 传播系数可调');
{
  const fracAt = (rate) => {
    sim.reset({ ...P, infoRate: rate });
    for (let t = 0; t < 20 * 180; t++) sim.step(1 / 20, 0, 0);
    return awareFrac();
  };
  const slow = fracAt(0.3), fast = fracAt(2);
  ok(fast > slow * 1.3, `2.0× 传播下 3 分钟 ${(fast * 100).toFixed(0)}% > 0.3× 的 ${(slow * 100).toFixed(0)}%`);
}

// ---------- 6. 确定性 ----------
console.log('6) 确定性');
{
  const snap = () => {
    let s = 0;
    for (let i = 0; i < sim.n; i++) s = (s * 31 + sim.aware[i]) | 0;
    return s;
  };
  sim.reset(P); run(60); const a = snap();
  sim.reset(P); run(60); const b = snap();
  ok(a === b, '同 seed 同参数，60 秒后的知晓度分布完全一致');
}

// ---------- 7. 性能 ----------
console.log('7) 性能');
{
  sim.reset({ ...P, population: 20000 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
