import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
console.log('nav:', { cols: nav.cols, rows: nav.rows, cell: nav.cell, indoor: typeof nav.indoor, door: typeof nav.doorPoint });

const sim = new Sim(nav);
sim.reset({ seed: 3, population: 4000, initialZombies: 0, police: 0, homeGunRate: 0 });
const n = sim.n;
const lastX = new Float32Array(n), lastZ = new Float32Array(n);
let progSum = 0;
const gpStart = new Map();
const goalStart = new Int8Array(n);
let samples = 0, stuckSum = 0, indoorSum = 0, indoorMax = 0, movedSum = 0, stuckInside = 0, stuckOutside = 0;
const hasIndoor = typeof nav.indoor === 'function';

for (let k = 1; k <= 120; k++) {
  for (let i = 0; i < n; i++) { lastX[i] = sim.px[i]; lastZ[i] = sim.pz[i]; }
  gpStart.clear();
  for (let i = 0; i < n; i++) {
    const g0 = sim.goalPoint(i, sim.goal[i]);
    goalStart[i] = sim.goal[i];
    if (g0) gpStart.set(i, Math.hypot(g0[0] - sim.px[i], g0[1] - sim.pz[i]));
  }
  const travel = new Float32Array(n);
  let px0 = new Float32Array(n), pz0 = new Float32Array(n);
  for (let i = 0; i < n; i++) { px0[i] = sim.px[i]; pz0[i] = sim.pz[i]; }
  for (let s = 0; s < 5 * 20; s++) {
    sim.step(1 / 20, 0, 0);
    if (s % 5 === 4) {
      for (let i = 0; i < n; i++) {
        travel[i] += Math.hypot(sim.px[i] - px0[i], sim.pz[i] - pz0[i]);
        px0[i] = sim.px[i]; pz0[i] = sim.pz[i];
      }
    }
  }
  let stuck = 0, indoors = 0;
  for (let i = 0; i < n; i++) {
    if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE) continue;
    const gp = sim.goalPoint(i, sim.goal[i]);
    if (!gp) continue;
    const dGoal = Math.hypot(gp[0] - sim.px[i], gp[1] - sim.pz[i]);
    if (dGoal < 15) continue;          // 已经到了还在目标附近的不算"该动"
    if (sim.goal[i] !== goalStart[i]) continue;   // 中途换目标的样本不算
    samples++;
    const d = travel[i];
    const gpNow = sim.goalPoint(i, sim.goal[i]);
    const prog = gpStart.has(i) && gpNow ? (gpStart.get(i) - Math.hypot(gpNow[0] - sim.px[i], gpNow[1] - sim.pz[i])) : 0;
    progSum += prog;
    movedSum += d;
    const inB = hasIndoor ? nav.indoor(sim.px[i], sim.pz[i]) : false;
    if (d < 1) { stuck++; if (inB) stuckInside++; else stuckOutside++; }
    if (inB) { indoors++; indoorSum++; }
  }
  stuckSum += stuck;
  indoorMax = Math.max(indoorMax, indoors);
  if (k % 30 === 0) console.log(`t=${sim.time.toFixed(0)}s 有目标 ${samples}，卡住 ${stuck}，屋里 ${indoors}`);
}
console.log('---');
console.log(`卡住率 ${(stuckSum / samples * 100).toFixed(1)}%（其中屋内 ${(stuckInside / Math.max(1, stuckSum) * 100).toFixed(0)}%）`);
console.log(`屋里的人占比 ${(indoorSum / samples * 100).toFixed(1)}%（峰值 ${indoorMax}）`);
console.log(`平均 5 秒总行走 ${(movedSum / samples).toFixed(2)} m，朝目标净推进 ${(progSum / samples).toFixed(2)} m  → 效率 ${(progSum / Math.max(1, movedSum) * 100).toFixed(0)}%`);
