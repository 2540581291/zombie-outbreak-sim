import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { SPECIES, SP } from '../js/species.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 99, population: 20000, initialZombies: 150, zombieSpeed: 2.0,
            infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3 });
const N = sim.n;
console.log('初始单位数', N);
for (let m = 1; m <= 5; m++) {
  for (let i = 0; i < 20 * 60; i++) sim.step(1/20, 0, 0);
  const cnt = {};
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] === ST.CORPSE || sim.state[i] === ST.SAVED) continue;
    const k = sim.kind[i];
    cnt[k] = (cnt[k] || 0) + 1;
  }
  const parts = Object.entries(cnt).map(([k, v]) => `${SPECIES[k].name}×${v}`).join(' ');
  console.log(`${m} 分钟: ${parts}`);
}
