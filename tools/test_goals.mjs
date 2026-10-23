// 目标决策自检（M4）：目标分布 / 戒严解锁 / 家人死亡 / 逃跑 / 持枪
//   node tools/test_goals.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';
import { membersOf } from '../js/family.js';
import { hasGunAtHome } from '../js/profiles.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 31, population: 12000, initialZombies: 120, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single',
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const run = (sec) => { for (let t = 0; t < 20 * sec; t++) sim.step(1 / 20, 0, 0); };
const census = () => {
  const c = new Array(10).fill(0);
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.CIV) c[sim.goal[i]]++;
  return c;
};
const NAMES = ['无', '回家', '上班', '逃', '回家取枪', '去警局', '去医院', '固守', '跟随', '被指挥'];

// ---------- 1. 开局：都市照常 ----------
console.log('1) 开局');
sim.reset(P);
{
  const c = census();
  const civ = c.reduce((a, b) => a + b, 0) || 1;
  ok(c[GOAL.FLEE] === 0, `开局没人逃（${c[GOAL.FLEE]}）`);
  const homeWork = (c[GOAL.HOME] + c[GOAL.WORK] + c[GOAL.NONE]) / civ;
  ok(homeWork > 0.98, `开局 ${(homeWork * 100).toFixed(0)}% 的人只关心通勤（回家/上班/闲晃）`);
}

// ---------- 2. 五分钟后：分化 ----------
console.log('2) 五分钟后');
run(300);
{
  const c = census();
  const civ = c.reduce((a, b) => a + b, 0) || 1;
  const txt = c.map((v, k) => [NAMES[k], v]).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / civ * 100).toFixed(0)}%`).join('  ');
  console.log(`     ${txt}（感染 ${(sim.infectRate * 100).toFixed(1)}%）`);
  ok(c[GOAL.FLEE] / civ > 0.05, `逃跑 ${(c[GOAL.FLEE] / civ * 100).toFixed(0)}%（应 > 5%）`);
  ok(c[GOAL.HOLD] / civ > 0.05, `固守 ${(c[GOAL.HOLD] / civ * 100).toFixed(0)}%（应 > 5%）`);
  const kinds = c.filter((v) => v / civ > 0.03).length;
  ok(kinds >= 2, `至少两种目标并存（${kinds} 种）`);
  const top = Math.max(...c) / civ;
  ok(top < 0.8, `最大的一类只占 ${(top * 100).toFixed(0)}%（应 < 80%，不能一边倒）`);
}

// ---------- 3. 家人死亡 → 牵挂断了 ----------
console.log('3) 家人死亡');
{
  sim.reset(P);
  // 找一户 2 人家庭
  let hid = -1;
  for (let h = 0; h < sim.nHh; h++) {
    const mem = membersOf(sim, h);
    if (mem.length === 2 && !sim.tourist[mem[0]]) { hid = h; break; }
  }
  ok(hid >= 0, `找到 2 人家庭 #${hid}`);
  const mem = membersOf(sim, hid);
  const me = mem[0], other = mem[1];
  sim.aware[me] = 2;
  sim.heat = 0.6;
  run(30);                       // 让决策先跑起来
  const before = sim.goal[me];
  sim.state[other] = ST.CORPSE;  // 家人死了
  sim.decT[me] = 0;
  run(5);
  const after = sim.goal[me];
  ok(after !== GOAL.HOME, `家人死后不再"回家"（${NAMES[before]} → ${NAMES[after]}）`);
}

// ---------- 4. 戒严：感染率 > 20% 才有人去警局 ----------
console.log('4) 20% 阈值');
{
  const probe = (zombies) => {
    sim.reset({ ...P, initialZombies: zombies });
    run(120);
    const c = census();
    return { police: c[GOAL.ARM_POLICE], rate: sim.infectRate, martial: sim.martialLaw };
  };
  sim.reset(P); run(60);
  const low = { police: census()[GOAL.ARM_POLICE] };
  const high = probe(2600);
  console.log(`     低感染：去警局 ${low.police} 人；高感染 ${(high.rate * 100).toFixed(0)}%（戒严 ${high.martial ? '是' : '否'}）：去警局 ${high.police} 人`);
  ok(high.police > 0, '高感染时有人去警局');
  ok(high.martial === true, '感染率跨过 20% 会触发戒严');
}

// ---------- 5. 家里的枪 ----------
console.log('5) 回家取枪');
{
  sim.reset(P);
  const before = [];
  for (let i = 0; i < sim.n; i++) if (hasGunAtHome(i) && sim.state[i] === ST.CIV && !sim.armed[i]) before.push(i);
  run(240);
  let armedNow = 0;
  for (const i of before) if (sim.armed[i]) armedNow++;
  ok(armedNow / Math.max(1, before.length) > 0.1,
    `原本家里有枪的 ${before.length} 人里，${(armedNow / before.length * 100).toFixed(0)}% 已经拿到枪（应 > 10%）`);
}

// ---------- 6. 逃出城 ----------
console.log('6) 逃出城');
{
  sim.reset(P);
  run(600);
  ok(sim.saved > 0, `10 分钟内逃出 ${sim.saved} 人`);
  let atEdge = 0;
  for (let i = 0; i < sim.n; i++) if (Math.abs(sim.px[i]) > nav.halfW - 90 || Math.abs(sim.pz[i]) > nav.halfH - 90) atEdge++;
  console.log(`     已有 ${atEdge} 人走到地图边缘`);
}

// ---------- 7. 卡住的人 ----------
console.log('7) 人真的在动');
{
  sim.reset(P);
  run(240);
  // 30 秒累计路程（不是净位移：绕路、来回走也算在动）
  const dist = new Float64Array(sim.n);
  const last = [];
  for (let i = 0; i < sim.n; i++) last.push([sim.px[i], sim.pz[i]]);
  for (let k = 0; k < 30; k++) {
    for (let t = 0; t < 20; t++) sim.step(1 / 20, 0, 0);
    for (let i = 0; i < sim.n; i++) {
      if (!last[i]) { last[i] = [sim.px[i], sim.pz[i]]; continue; }   // 中途新增的单位
      dist[i] += Math.hypot(sim.px[i] - last[i][0], sim.pz[i] - last[i][1]);
      last[i] = [sim.px[i], sim.pz[i]];
    }
  }
  const MOVING = new Set([GOAL.FLEE, GOAL.HOME, GOAL.WORK, GOAL.ARM_HOME, GOAL.ARM_POLICE, GOAL.HELP]);
  const arr = [];
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.CIV && MOVING.has(sim.goal[i])) arr.push(dist[i]);
  arr.sort((a, b) => a - b);
  const med = arr[Math.floor(arr.length / 2)];
  const dead = arr.filter((d) => d < 3).length / Math.max(1, arr.length);
  console.log(`    30 秒路程：中位 ${med.toFixed(1)}m，< 3m 的占 ${(dead * 100).toFixed(1)}%`);
  ok(med > 6, `中位路程 ${med.toFixed(1)}m（应 > 6m，说明人真的在走）`);
  ok(dead < 0.25, `完全没动的占 ${(dead * 100).toFixed(1)}%（应 < 25%）`);
}
// ---------- 8. 确定性 + 性能 ----------
console.log('8) 确定性 / 性能');
{
  const snap = () => { let s = 0; for (let i = 0; i < sim.n; i++) s = (s * 31 + sim.goal[i]) | 0; return s; };
  sim.reset(P); run(120); const a = snap();
  sim.reset(P); run(120); const b = snap();
  ok(a === b, '同 seed 同参数，120 秒后的目标分布完全一致');

  sim.reset({ ...P, population: 20000 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
