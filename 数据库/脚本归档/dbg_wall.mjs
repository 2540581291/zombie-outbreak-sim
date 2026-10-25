import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
const P = { seed: 4242, population: 20000, initialZombies: 60, zombieSpeed: 1.6, infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3 };
sim.reset(P);
for (let i = 0; i < 400; i++) sim.step(1/20, 0, 0);
for (let i = 0; i < sim.n; i++) {
  const st = sim.state[i];
  if (st === ST.CORPSE || st === ST.SAVED) continue;
  if (!nav.walkable(sim.px[i], sim.pz[i])) {
    const c = ((sim.px[i] + nav.halfW)/nav.cell)|0, r = ((sim.pz[i] + nav.halfH)/nav.cell)|0;
    console.log(`agent ${i} state=${st} pos=(${sim.px[i].toFixed(3)}, ${sim.pz[i].toFixed(3)}) cell=(${c},${r}) value=0x${nav.grid[r*nav.cols+c].toString(16)} stuck=${sim.stuck[i].toFixed(2)}`);
  }
}
