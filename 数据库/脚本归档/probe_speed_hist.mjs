import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 7, population: 4000, initialZombies: 0, police: 0, homeGunRate: 0 });
const n = sim.n;
const x0 = new Float32Array(n), z0 = new Float32Array(n);
const buckets = [0, 0, 0, 0, 0];
let total = 0, sum = 0;
for (let w = 0; w < 30; w++) {
  for (let i = 0; i < n; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; }
  for (let t = 0; t < 10; t++) sim.step(1 / 20, 0, 0);
  for (let i = 0; i < n; i++) {
    if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE || sim.idle[i]) continue;
    const v = Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]) / 0.5;
    total++; sum += v;
    if (v < 0.2) buckets[0]++;
    else if (v < 1.0) buckets[1]++;
    else if (v < 1.6) buckets[2]++;
    else if (v < 2.1) buckets[3]++;
    else buckets[4]++;
  }
}
const pct = (b) => (b / total * 100).toFixed(0) + '%';
console.log(`样本 ${total}  平均 ${(sum / total).toFixed(2)} m/s`);
console.log(`  <0.2: ${pct(buckets[0])}   0.2~1.0: ${pct(buckets[1])}   1.0~1.6: ${pct(buckets[2])}   1.6~2.1: ${pct(buckets[3])}   >2.1: ${pct(buckets[4])}`);
