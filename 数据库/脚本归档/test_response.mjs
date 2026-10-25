// 事件与指挥自检（M7）：报警 / 出警 / 调度 / 命令士兵
//   node tools/test_response.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 606, population: 8000, initialZombies: 0, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single',
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const run = (sec) => { for (let t = 0; t < 20 * sec; t++) sim.step(1 / 20, 0, 0); };

// ---------- 1. 报警 ----------
console.log('1) 报警');
sim.reset(P);
{
  const st = sim.poiByKind.police[0];
  const e1 = sim.reportEvent(st.x + 400, st.z, 1);
  ok(!!e1, `产生了一个事件（#${e1 && e1.id}）`);
  const e2 = sim.reportEvent(st.x + 420, st.z, 1);
  ok(e2 === null, '同一片区域（80m 内 / 60 秒）不重复报警');
  const e3 = sim.reportEvent(st.x + 2000, st.z, 1);
  ok(!!e3 && e3.id !== e1.id, '远处是另一起事件');
}

// ---------- 2. 出警：从警局出发，走过去 ----------
console.log('2) 出警：派的是局里现有的人');
{
  const si = 0;
  const st = sim.poiByKind.police[si];
  sim.countStats();
  const p0 = sim.stats.police;
  const idle0 = sim.idleAt(si);
  // 先记下出警前谁在局里
  const atStation = [];
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] !== ST.POLICE || sim.stationOf[i] !== si + 1) continue;
    if (Math.hypot(sim.px[i] - st.x, sim.pz[i] - st.z) < 25) atStation.push(i);
  }
  const tx = st.x + 300, tz = st.z + 200;
  const r = sim.dispatchPolice(tx, tz, 2);
  ok(r.ok && r.n === 2, `派出 ${r.n} 人（警局距目标 ${r.dist.toFixed(0)}m）`);
  sim.countStats();
  ok(sim.stats.police === p0, `场上警员总数不变（${p0} → ${sim.stats.police}）—— 不是凭空生成`);
  ok(sim.idleAt(si) === idle0 - 2, `局里可用从 ${idle0} 变成 ${sim.idleAt(si)}（人被派出去了）`);
  ok(r.ids.every((i) => atStation.includes(i)), '派出去的正是刚才站在局里的那几个人');
  // 走过去
  const id0 = r.ids[0];
  const d0 = Math.hypot(sim.px[id0] - tx, sim.pz[id0] - tz);
  ok(sim.goal[id0] === GOAL.MOVE_TO, '目标是"执行命令"');
  run(30);
  const d1 = Math.hypot(sim.px[id0] - tx, sim.pz[id0] - tz);
  ok(d1 < d0 - 30, `30 秒后离目标从 ${d0.toFixed(0)}m 缩到 ${d1.toFixed(0)}m（在走）`);
}
// ---------- 3. 警局空了就派不出 ----------
console.log('3) 没人可派');
{
  const si = 0;
  const st = sim.poiByKind.police[si];
  const idleBefore = sim.idleAt(si);
  // 把这家的闲人全部派光
  const guard = 40;
  for (let k = 0; k < guard; k++) if (sim.idleAt(si) > 0) sim.dispatchPolice(st.x + 100, st.z, 1);
  ok(sim.idleAt(si) === 0, `局里 ${idleBefore} 人已经全部派出去了`);
  const r = sim.dispatchPolice(st.x + 100, st.z, 2);
  ok(r.ok === false || r.station !== st, '这家局没人了就不会再从这里派人');
}
// ---------- 4. 命令士兵 ----------
console.log('4) 命令士兵');
{
  sim.reset(P);
  const s = sim.addUnit(0, 0, 'soldier');
  const pol = sim.addUnit(20, 0, 'police');
  ok(sim.orderMove(s, 120, 60) === true, '士兵接受命令');
  ok(sim.orderMove(pol, 120, 60) === false, '警察不接受命令（只能命令士兵）');
  ok(sim.goal[s] === GOAL.MOVE_TO, '士兵目标 = 执行命令');
  const d0 = Math.hypot(sim.px[s] - 120, sim.pz[s] - 60);
  run(20);
  const d1 = Math.hypot(sim.px[s] - 120, sim.pz[s] - 60);
  ok(d1 < d0 - 20, `士兵执行命令走了 ${(d0 - d1).toFixed(0)}m`);
}

// ---------- 5. 自动出警到场 ----------
console.log('5) 自动出警到场');
{
  sim.reset(P);
  const pick = sim.nearestStation(0, 0, 2);
  const st = pick ? pick.poi : sim.poiByKind.police[0];
  const tx = st.x + 120, tz = st.z + 80;
  const ev = sim.reportEvent(tx, tz, 1);
  const r = sim.dispatchPolice(tx, tz, 2);
  ev.responders = r.n;
  ev.ids = r.ids;
  let ack = false, secs = 0;
  for (let s2 = 0; s2 < 90 && !ack; s2++) {
    run(1); secs++;
    if (ev.ids.some((id) => (sim.state[id] === ST.POLICE || sim.state[id] === ST.SOLDIER)
      && Math.hypot(sim.px[id] - tx, sim.pz[id] - tz) < 50)) ack = true;
  }
  ok(ack, `${secs} 秒后警员到场（50m 内，${Math.hypot(st.x - tx, st.z - tz).toFixed(0)}m 的路）`);
}

// ---------- 6. 确定性 / 性能 ----------
console.log('6) 确定性 / 性能');
{
  const snap = () => {
    let s = 0;
    for (let i = 0; i < sim.n; i++) s = (s * 31 + sim.goal[i] * 5 + (sim.state[i] | 0)) | 0;
    return s;
  };
  const Z = { ...P, initialZombies: 240 };
  sim.reset(Z); run(90); const a = snap();
  sim.reset(Z); run(90); const b = snap();
  ok(a === b, '同 seed 同参数，90 秒后的事件/命令状态一致');

  sim.reset({ ...P, population: 20000, initialZombies: 240 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4.5, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4.5ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
