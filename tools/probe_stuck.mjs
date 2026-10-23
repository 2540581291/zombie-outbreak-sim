import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);
sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
const i = 0;
sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
sim.px[i] = -384.5; sim.pz[i] = 614;
console.log('该点: walkable=', sim.walkable(-384.5, 614), ' indoor=', nav.indoor(-384.5, 614));
let free = 0;
for (let k = 0; k < 16; k++) {
  const a = (k / 16) * Math.PI * 2;
  const x = -384.5 + Math.cos(a) * 0.5, z = 614 + Math.sin(a) * 0.5;
  const w = sim.walkable(x, z), ind = nav.indoor(x, z);
  if (w) free++;
  if (k < 8) console.log(`  dir${k} (${x.toFixed(1)},${z.toFixed(1)}) walk=${w} indoor=${ind}`);
}
console.log('0.5m 内可走方向数 =', free, '/ 16');
// 试直接规划一条路
const okPlan = sim.planPath(i, -276, 624);
console.log('planPath →', okPlan, ' pathN=', sim.pathN[i], ' idx=', sim.pathIdx[i]);
console.log('  cgrid 起点格可走？', sim.cgrid ? sim.cgrid[(0)] : 'n/a');
