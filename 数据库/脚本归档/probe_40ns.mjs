import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const openAt = (x, z) => {
  if (!nav.walkable(x, z) || nav.indoor(x, z)) return false;
  let k = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    if (nav.walkable(x + Math.cos(ang) * 1.5, z + Math.sin(ang) * 1.5)) k++;
  }
  return k >= 6;
};
function endpoints(b, dir) {
  const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...zs) - Math.min(...zs)) / 2;
  const ew = dir === 'ew';
  let sx = ew ? cx - hw - 12 : cx, sz = ew ? cz : cz - hh - 12;
  let gx = ew ? cx + hw + 12 : cx, gz = ew ? cz : cz + hh + 12;
  return { sx, sz, gx, gz, cx, cz, hw, hh };
}
let b = null;
for (const bb of city.buildings) {
  const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
  if (!(w > 34 && w < 56 && h > 34 && h < 56)) continue;
  const e0 = endpoints(bb, 'ew'), e1 = endpoints(bb, 'ns');
  if (!openAt(e0.sx, e0.sz) || !openAt(e0.gx, e0.gz)) continue;
  if (!openAt(e1.sx, e1.sz) || !openAt(e1.gx, e1.gz)) continue;
  b = bb; break;
}
const e = endpoints(b, 'ns');
const sim = new Sim(nav, city);
sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
const i = 0;
sim.px[i] = e.sx; sim.pz[i] = e.sz; sim.state[i] = 0;
sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
sim.setGoal(i, GOAL.MOVE_TO, e.gx, e.gz);
console.log(`楼 ${(e.hw*2).toFixed(0)}x${(e.hh*2).toFixed(0)} 起(${e.sx.toFixed(0)},${e.sz.toFixed(0)}) 终(${e.gx.toFixed(0)},${e.gz.toFixed(0)}) 距离 ${Math.hypot(e.gx-e.sx,e.gz-e.sz).toFixed(0)}m`);
console.log('planPath ->', sim.planPath(i, e.gx, e.gz), 'pathN', sim.pathN[i]);
for (let k = 0; k < 20 * 6; k++) {
  sim.step(1 / 20, 0, 0);
  if (k % 10 === 0) console.log(`t=${sim.time.toFixed(1)} pos=${sim.px[i].toFixed(1)},${sim.pz[i].toFixed(1)} goal=${sim.goal[i]} pathN=${sim.pathN[i]}@${sim.pathIdx[i]} idle=${sim.idle[i]} actT=${sim.actT[i].toFixed(1)} st=${sim.state[i]}`);
}
