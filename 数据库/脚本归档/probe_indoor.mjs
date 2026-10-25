import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 7, population: 1500, initialZombies: 0, police: 0, homeGunRate: 0 });
const n = sim.n;
const x0 = new Float32Array(n), z0 = new Float32Array(n);
let shown = 0;
for (let w = 0; w < 12 && shown < 6; w++) {
  for (let i = 0; i < n; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; }
  for (let t = 0; t < 10; t++) sim.step(1 / 20, 0, 0);
  for (let i = 0; i < n && shown < 6; i++) {
    if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE) continue;
    if (Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]) >= 0.05) continue;
    if (!nav.indoor(x0[i], x0[i] === 0 ? 0 : z0[i])) { /* noop */ }
    if (!nav.indoor(x0[i], z0[i])) continue;
    const gp = sim.goalPoint(i, sim.goal[i]);
    const dp = nav.doorPoint ? nav.doorPoint(sim.px[i], sim.pz[i]) : null;
    const dg = nav.doorGradient ? nav.doorGradient(sim.px[i], sim.pz[i]) : null;
    console.log(`#${i} goal=${sim.goal[i]} 位置(${sim.px[i].toFixed(1)},${sim.pz[i].toFixed(1)}) `
      + `门距=${dp ? Math.hypot(dp.x - sim.px[i], dp.z - sim.pz[i]).toFixed(1) : 'null'} `
      + `梯度=${dg ? dg.x.toFixed(2) + ',' + dg.z.toFixed(2) : 'null'} `
      + `目标=${gp ? gp[0].toFixed(0) + ',' + gp[1].toFixed(0) : 'null'} `
      + `目标室内=${gp && nav.indoor(gp[0], gp[1])} stuck=${sim.stuck[i].toFixed(1)} pathN=${sim.pathN[i]}`);
    shown++;
  }
}
