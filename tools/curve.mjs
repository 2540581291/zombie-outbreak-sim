import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 11, population: 20000, initialZombies: 120, zombieSpeed: 2.2,
            infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3 });
console.log(' 分钟  平民   潜伏   丧尸   死亡');
for (let m = 1; m <= 8; m++) {
  for (let i = 0; i < 20 * 60; i++) sim.step(1/20, 0, 0);
  const s = sim.stats;
  console.log(`${String(m).padStart(4)}  ${String(s.civ).padStart(6)} ${String(s.infected).padStart(6)} ${String(s.zombie).padStart(6)} ${String(s.dead).padStart(6)}`);
}
