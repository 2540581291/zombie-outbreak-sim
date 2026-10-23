import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim } from '../js/sim.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
console.log('z0  spd  police |  30s   60s   90s  120s');
for (const z0 of [80, 200, 400]) {
  for (const spd of [1.6, 2.6]) {
    const P = { seed: 7, population: 20000, initialZombies: z0, zombieSpeed: spd,
                infectTime: 8, armedRate: 0.1, police: 40, policeAccuracy: 0.3 };
    sim.reset(P);
    const out = [];
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < 20 * 30; i++) sim.step(1/20, 0, 0);
      out.push(sim.stats.zombie);
    }
    console.log(`${String(z0).padStart(3)}  ${spd.toFixed(1)}   40  | ${out.map(v=>String(v).padStart(5)).join('  ')}`);
  }
}
