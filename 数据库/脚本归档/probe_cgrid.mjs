import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });

const cs = sim.cs, gw = sim.gw, gh = sim.gh;
const cellIdx = (x, z) => {
  const c = Math.floor((x + nav.halfW) / cs);
  const r = Math.floor((nav.halfH - z) / cs);
  return [c, r, r * gw + c];
};
let cut = 0;
for (let k = 0; k < sim.cgrid.length; k++) if (sim.cgrid[k]) cut++;
console.log(`cs=${cs} gw=${gw} gh=${gh} 可走粗格=${cut} / ${sim.cgrid.length}`);

for (const [x, z, tag] of [[2, 1059, '起点'], [75, 1059, '终点'], [24.7, 1054, '卡点']]) {
  const [c, r, k] = cellIdx(x, z);
  console.log(`${tag}(${x},${z}) → 粗格 c=${c} r=${r} idx=${k} 可走=${sim.cgrid[k]} 细格可走=${sim.walkable(x, z)}`);
}
console.log('planPath=', sim.planPath(0, 75, 1059), 'pathN=', sim.pathN[0]);
