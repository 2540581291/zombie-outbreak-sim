// 寻路验收脚本：两条用例 + 全城平均速度
//   node tools/accept_path.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);

function detour(dir) {
  const sim = new Sim(nav, city);
  sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
  let b = null;
  for (const bb of city.buildings) {
    const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    // 取一栋够大的楼：起点/终点必须落在可走地面上（城市密，小店门口经常是别人的墙）
    if (w > 60 && h > 60) { b = bb; break; }
  }
  const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...zs) - Math.min(...zs)) / 2;
  const i = 0;
  const c = dir === 'ew'
    ? { sx: cx - hw - 12, sz: cz, gx: cx + hw + 12, gz: cz }
    : { sx: cx, sz: cz - hh - 12, gx: cx, gz: cz + hh + 12 };
  // 端点不可走时向外挪，直到落在可走地面
  let sx = c.sx, sz = c.sz;
  for (let k = 0; k < 40 && !(sim.walkable(sx, sz) && !nav.indoor(sx, sz)); k++) { sx += (c.sx > cx ? 2 : -2); }
  let gx2 = c.gx, gz2 = c.gz;
  for (let k = 0; k < 40 && !(sim.walkable(gx2, gz2) && !nav.indoor(gx2, gz2)); k++) { gx2 += (c.gx > cx ? 2 : -2); }
  c.sx = sx; c.sz = sz; c.gx = gx2; c.gz = gz2;
  sim.px[i] = c.sx; sim.pz[i] = c.sz; sim.state[i] = 0;
  sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
  sim.setGoal(i, GOAL.MOVE_TO, c.gx, c.gz);
  const total = Math.hypot(c.gx - c.sx, c.gz - c.sz);
  let best = 1e9, arr = -1;
  for (let k = 0; k < 20 * 120; k++) {
    sim.step(1 / 20, 0, 0);
    const d = Math.hypot(sim.px[i] - c.gx, sim.pz[i] - c.gz);
    best = Math.min(best, d);
    if (d < 10) { arr = sim.time; break; }
  }
  return { dir, total, arr, best };
}

function citySpeed() {
  const sim = new Sim(nav, city);
  sim.reset({ seed: 7, population: 4000, initialZombies: 0, police: 0, homeGunRate: 0 });
  const n = sim.n;
  const x0 = new Float32Array(n), z0 = new Float32Array(n);
  let travel = 0, cnt = 0;
  for (let w = 0; w < 30; w++) {
    for (let i = 0; i < n; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; }
    for (let t = 0; t < 10; t++) sim.step(1 / 20, 0, 0);
    for (let i = 0; i < n; i++) {
      if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE) continue;
      travel += Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]);
      cnt++;
    }
  }
  return cnt ? travel / cnt / 0.5 : 0;
}

const ew = detour('ew');
const ns = detour('ns');
const spd = citySpeed();

console.log(`东西穿楼: ${ew.arr >= 0 ? '✅ ' + ew.arr.toFixed(1) + 's' : '❌ 120s 未到（最近 ' + ew.best.toFixed(0) + 'm）'}  总距离 ${ew.total.toFixed(0)}m`);
console.log(`南北穿楼: ${ns.arr >= 0 ? '✅ ' + ns.arr.toFixed(1) + 's' : '❌ 120s 未到（最近 ' + ns.best.toFixed(0) + 'm）'}  总距离 ${ns.total.toFixed(0)}m`);
console.log(`全城平均速度: ${spd.toFixed(2)} m/s  ${spd >= 1.8 ? '✅' : '❌（目标 ≥1.8）'}`);
const pass = ew.arr >= 0 && ns.arr >= 0 && spd >= 1.8;
console.log(pass ? '\n结果：全部通过 ✅' : '\n结果：未通过 ❌');
process.exit(pass ? 0 : 1);
