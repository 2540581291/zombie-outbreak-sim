import { readFileSync } from 'node:fs';
import { loadCollision } from '../js/collision.js';
import { Sim } from '../js/sim.js';
const city = JSON.parse(readFileSync(new URL('../数据库/cities/tokyo/city.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const nav = await loadCollision(city);
const t1 = performance.now();
console.log(`东京 碰撞层 ${nav.cols}×${nav.rows} @${nav.cell}m  加载 ${(t1-t0).toFixed(0)}ms  ${(nav.cols*nav.rows/1048576).toFixed(1)}MB`);
const sim = new Sim(nav);
sim.reset({ seed: 9, population: 20000, initialZombies: 150, zombieSpeed: 2.0, infectTime: 8,
  armedRate: 0.1, police: 60, policeAccuracy: 0.3, dogs: 240, cats: 160, bears: 3, tigers: 2, animalInfected: 0.15 });
let bad = 0;
for (let i = 0; i < sim.n; i++) if (!nav.walkable(sim.px[i], sim.pz[i])) bad++;
const t2 = performance.now();
for (let i = 0; i < 200; i++) sim.step(1/20, 0, 0);
console.log(`tick ${((performance.now()-t2)/200).toFixed(2)}ms   出生在墙里 ${bad}`);
