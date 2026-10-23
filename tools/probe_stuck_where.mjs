import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 7, population: 4000, initialZombies: 0, police: 0, homeGunRate: 0 });
const n = sim.n;
const x0 = new Float32Array(n), z0 = new Float32Array(n);
let inCnt = 0, outCnt = 0, doorCnt = 0, pathCnt = 0, nopathCnt = 0, total = 0;
for (let w = 0; w < 20; w++) {
  for (let i = 0; i < n; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; }
  for (let t = 0; t < 10; t++) sim.step(1 / 20, 0, 0);
  for (let i = 0; i < n; i++) {
    if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE) continue;
    const d = Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]);
    if (d >= 0.05) continue;              // 只看卡住的
    total++;
    if (nav.indoor(x0[i], z0[i])) inCnt++; else outCnt++;
    if (sim.pathN[i] > 0) pathCnt++; else nopathCnt++;
    const dp = nav.doorPoint ? nav.doorPoint(x0[i], z0[i]) : null;
    if (dp && Math.hypot(dp.x - x0[i], dp.z - z0[i]) < 2.5) doorCnt++;
  }
}
console.log(`卡住样本 ${total}：室内 ${inCnt} (${(inCnt/total*100).toFixed(0)}%) 室外 ${outCnt}`);
console.log(`  有路径 ${pathCnt} / 无路径 ${nopathCnt}`);
console.log(`  距最近的门 <2.5m 的占 ${(doorCnt/total*100).toFixed(0)}%`);
