import { readFileSync } from 'node:fs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
const city = JSON.parse(readFileSync(new URL('../data/cities/berlin/city.json', import.meta.url), 'utf8'));
let t0 = performance.now();
const nav = await loadCollision(city);
console.log(`碰撞层 ${nav.cols}×${nav.rows} @${nav.cell}m  加载 ${(performance.now()-t0).toFixed(0)}ms  内存 ${(nav.cols*nav.rows/1048576).toFixed(1)}MB`);
const sim = new Sim(nav);
t0 = performance.now();
sim.reset({ seed: 1, population: 20000, initialZombies: 150, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 240, cats: 160, bears: 3, tigers: 2, animalInfected: 0.15 });
console.log(`reset ${(performance.now()-t0).toFixed(0)}ms  agents=${sim.n}`);
let bad = 0;
for (let i = 0; i < sim.n; i++) if (sim.state[i] !== ST.CORPSE && !nav.walkable(sim.px[i], sim.pz[i])) bad++;
console.log(`出生在不可通行格: ${bad}`);
t0 = performance.now();
for (let i = 0; i < 400; i++) sim.step(1/20, 0, 0);
console.log(`tick 平均 ${((performance.now()-t0)/400).toFixed(2)}ms`);
let bad2 = 0;
for (let i = 0; i < sim.n; i++) if (sim.state[i] !== ST.CORPSE && !nav.walkable(sim.px[i], sim.pz[i])) bad2++;
console.log(`跑 20 秒后在不可通行格: ${bad2}`);
