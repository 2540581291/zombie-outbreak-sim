import { loadCity } from './_city.mjs';
import { loadCollision, CL } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 3, population: 20000, initialZombies: 150, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 240, cats: 160, bears: 3, tigers: 2, animalInfected: 0.15 });
const NAME = { 0x00:'墙', 0x03:'空地', 0x07:'林地', 0x0f:'门', 0x16:'窗', 0x1f:'室内', 0x22:'围栏', 0x82:'水' };
let bad = 0, byVal = {};
for (let i = 0; i < sim.n; i++) {
  if (sim.state[i] === ST.CORPSE) continue;
  const v = nav.valueAt(sim.px[i], sim.pz[i]);
  if (!(v & 1)) { bad++; byVal[NAME[v] || v] = (byVal[NAME[v]] || 0) + 1; }
}
console.log(`出生 ${sim.n} 个，落在不可通行格上的：${bad}`, byVal);
// 再跑 5 秒看移动中有没有进水
for (let i = 0; i < 100; i++) sim.step(1/20, 0, 0);
let bad2 = 0; const b2 = {};
for (let i = 0; i < sim.n; i++) {
  if (sim.state[i] === ST.CORPSE) continue;
  const v = nav.valueAt(sim.px[i], sim.pz[i]);
  if (!(v & 1)) { bad2++; b2[NAME[v] || v] = (b2[NAME[v]] || 0) + 1; }
}
console.log(`跑 5 秒后落在不可通行格上的：${bad2}`, b2);
