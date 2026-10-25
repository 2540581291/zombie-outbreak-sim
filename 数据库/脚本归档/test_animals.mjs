import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { SPECIES } from '../js/species.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 31, population: 20000, initialZombies: 150, zombieSpeed: 2.0,
            infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
            dogs: 240, cats: 160, bears: 3, tigers: 2, animalInfected: 0.15 });
const N = sim.n;
let dog0 = 0, cat0 = 0;
for (let i = 0; i < N; i++) { if (sim.kind[i] === 12) dog0++; if (sim.kind[i] === 13) cat0++; }
console.log(`初始：狗 ${dog0} 猫 ${cat0} 总数 ${N}`);
for (let m = 1; m <= 4; m++) {
  for (let i = 0; i < 20 * 60; i++) sim.step(1/20, 0, 0);
  const cnt = {};
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] === ST.CORPSE) continue;
    const k = sim.kind[i];
    if (k >= 12) cnt[k] = (cnt[k] || 0) + 1;
  }
  const parts = Object.entries(cnt).map(([k,v]) => `${SPECIES[k].name}×${v}`).join(' ');
  console.log(`${m} 分钟: ${parts}  |  丧尸总数 ${sim.stats.zombie}`);
}
