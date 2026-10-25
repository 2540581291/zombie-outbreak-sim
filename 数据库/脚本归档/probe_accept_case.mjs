// 复现 accept_path 的选楼与运行，并逐帧打印，定位"有路径但不动"
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
  return {
    sx: ew ? cx - hw - 12 : cx,
    sz: ew ? cz : cz - hh - 12,
    gx: ew ? cx + hw + 12 : cx,
    gz: ew ? cz : cz + hh + 12,
  };
}
function pickBuilding(lo, hi) {
  for (const bb of city.buildings) {
    const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    if (!(w > lo && w < hi && h > lo && h < hi)) continue;
    const e0 = endpoints(bb, 'ew'), e1 = endpoints(bb, 'ns');
    if (!openAt(e0.sx, e0.sz) || !openAt(e0.gx, e0.gz)) continue;
    if (!openAt(e1.sx, e1.sz) || !openAt(e1.gx, e1.gz)) continue;
    const probe = new Sim(nav, city);
    let ok = true;
    for (const dir of ['ew', 'ns']) {
      probe.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
      const e = endpoints(bb, dir);
      probe.px[0] = e.sx; probe.pz[0] = e.sz;
      if (probe.planPath(0, e.gx, e.gz) <= 0) { ok = false; break; }
    }
    if (ok) return bb;
  }
  return null;
}

const b = pickBuilding(34, 56);
if (!b) { console.log('没选到楼'); process.exit(0); }
for (const dir of ['ns', 'ew']) {
  const e = endpoints(b, dir);
  const sim = new Sim(nav, city);
  sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
  const i = 0;
  sim.px[i] = e.sx; sim.pz[i] = e.sz; sim.state[i] = 0;
  sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
  sim.setGoal(i, GOAL.MOVE_TO, e.gx, e.gz);
  const planned = sim.planPath(i, e.gx, e.gz);
  console.log(`\n[${dir}] 起(${e.sx.toFixed(0)},${e.sz.toFixed(0)}) 终(${e.gx.toFixed(0)},${e.gz.toFixed(0)}) planPath=${planned} pathN=${sim.pathN[i]} indoor=${nav.indoor(e.sx, e.sz)}`);
  for (let k = 0; k < 20 * 4; k++) {
    sim.step(1 / 20, 0, 0);
    if (k % 10 === 0) {
      const wp = sim.pathN[i] > 0 ? `${sim.pathX[i * 16 + Math.min(sim.pathIdx[i], 15)].toFixed(0)},${sim.pathZ[i * 16 + Math.min(sim.pathIdx[i], 15)].toFixed(0)}` : '-';
      console.log(`  t=${sim.time.toFixed(1)} pos=${sim.px[i].toFixed(1)},${sim.pz[i].toFixed(1)} goal=${sim.goal[i]} pathN=${sim.pathN[i]}@${sim.pathIdx[i]} wp=${wp} idle=${sim.idle[i]} actT=${sim.actT[i].toFixed(1)} st=${sim.state[i]}`);
    }
  }
}
