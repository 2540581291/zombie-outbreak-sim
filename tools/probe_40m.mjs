import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
let b = null;
for (const bb of city.buildings) {
  const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
  if (w > 34 && w < 56 && h > 34 && h < 56) { b = bb; break; }
}
const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...zs) - Math.min(...zs)) / 2;
const sim = new Sim(nav, city);
sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
const i = 0;
let sx = cx - hw - 12, sz = cz, gx = cx + hw + 12, gz = cz;
for (let k = 0; k < 25 && !(sim.walkable(sx, sz) && !nav.indoor(sx, sz)); k++) sx -= 2;
for (let k = 0; k < 25 && !(sim.walkable(gx, gz) && !nav.indoor(gx, gz)); k++) gx += 2;
sim.px[i] = sx; sim.pz[i] = sz; sim.state[i] = 0;
sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
sim.setGoal(i, GOAL.MOVE_TO, gx, gz);
console.log(`楼 ${(hw*2).toFixed(0)}x${(hh*2).toFixed(0)} 起点(${sx.toFixed(0)},${sz.toFixed(0)}) 终点(${gx.toFixed(0)},${gz.toFixed(0)}) kind=${sim.kind[i]} animal=${sim.isAnimal(i)}`);
const okPlan = sim.planPath(i, gx, gz);
console.log(`终点 ${gx.toFixed(0)},${gz.toFixed(0)}`); console.log(`planPath=${okPlan} pathN=${sim.pathN[i]}`);
let lastX = sim.px[i], stall = 0;
for (let k = 0; k < 20 * 90; k++) {
  sim.step(1 / 20, 0, 0);
  if (Math.abs(sim.px[i] - lastX) < 0.02) { if (++stall > 100) { console.log(`卡在 x=${sim.px[i].toFixed(1)},z=${sim.pz[i].toFixed(1)} t=${sim.time.toFixed(1)}`); break; } } else stall = 0;
  lastX = sim.px[i];
  if (k % 200 === 0) console.log(`t=${sim.time.toFixed(1)} pos=${sim.px[i].toFixed(1)},${sim.pz[i].toFixed(1)} goal=${sim.goal[i]} st=${sim.state[i]} pathN=${sim.pathN[i]}@${sim.pathIdx[i]} idle=${sim.idle[i]} actT=${sim.actT[i].toFixed(1)}`);
}
