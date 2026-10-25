import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 7, population: 4000, initialZombies: 0, police: 0, homeGunRate: 0 });
const n = sim.n;
const x0 = new Float32Array(n), z0 = new Float32Array(n);
const acc = { in: [0, 0], out: [0, 0], stuck: [0, 0] };
for (let w = 0; w < 30; w++) {
  for (let i = 0; i < n; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; }
  for (let t = 0; t < 10; t++) sim.step(1 / 20, 0, 0);
  for (let i = 0; i < n; i++) {
    if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE) continue;
    const d = Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]);
    const inB = nav.indoor(x0[i], z0[i]);
    const slot = inB ? acc.in : acc.out;
    slot[0] += d; slot[1]++;
    if (d < 0.05) acc.stuck[inB ? 0 : 1]++;
  }
}
const f = (a) => (a[1] ? (a[0] / a[1] / 0.5).toFixed(2) + ' m/s  样本 ' + a[1] : 'n/a');
console.log('室内:', f(acc.in), ' 卡住比例', acc.in[1] ? (acc.stuck[0] / acc.in[1] * 100).toFixed(0) + '%' : '-');
console.log('室外:', f(acc.out), ' 卡住比例', acc.out[1] ? (acc.stuck[1] / acc.out[1] * 100).toFixed(0) + '%' : '-');
