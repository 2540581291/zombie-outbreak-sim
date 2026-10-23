// 寻路诊断：单个个体绕楼的逐帧轨迹
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });

let b = null;
for (const bb of city.buildings) {
  const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
  if (Math.max(...xs) - Math.min(...xs) > 30 && Math.max(...zs) - Math.min(...zs) > 30) { b = bb; break; }
}
const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...zs) - Math.min(...zs)) / 2;
const i = 0;
const sx = cx - hw - 12, sz = cz, gx = cx + hw + 12, gz = cz;
console.log(`楼 ${(hw * 2).toFixed(0)}×${(hh * 2).toFixed(0)}m  起点(${sx.toFixed(0)},${sz.toFixed(0)}) 终点(${gx.toFixed(0)},${gz.toFixed(0)})`);
sim.px[i] = sx; sim.pz[i] = sz; sim.state[i] = 0;
sim.setGoal(i, GOAL.MOVE_TO, gx, gz);
sim.pathBudget = 20;

let lastIdx = -1, lastN = -1;
for (let k = 0; k < 20 * 40; k++) {
  sim.step(1 / 20, 0, 0);
  const n = sim.pathN[i], idx = sim.pathIdx[i];
  const d = Math.hypot(sim.px[i] - gx, sim.pz[i] - gz);
  if (k % 10 === 0 || n !== lastN || idx !== lastIdx) {
    let wp = '-';
    if (n > 0 && idx < n) wp = `${sim.pathX[i * 16 + idx].toFixed(0)},${sim.pathZ[i * 16 + idx].toFixed(0)}`;
    console.log(`t=${sim.time.toFixed(1)} pos=${sim.px[i].toFixed(1)},${sim.pz[i].toFixed(1)} 剩${d.toFixed(0)}m path=${n}@${idx} wp=${wp}`);
    lastN = n; lastIdx = idx;
  }
  if (d < 10) { console.log(`✅ 到达 ${sim.time.toFixed(1)}s`); break; }
}
