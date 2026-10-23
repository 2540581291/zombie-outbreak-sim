// 寻路验收：绕过一栋 ~40m 见方的楼（东西向 / 南北向）60 秒内到达；全城平均移动速度 ≥1.8 m/s
//   node tools/accept_path.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);

function pickBuilding(lo, hi) {
  for (const bb of city.buildings) {
    const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    if (w > lo && w < hi && h > lo && h < hi) return bb;
  }
  return null;
}

function detour(b, dir) {
  const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2, hh = (Math.max(...zs) - Math.min(...zs)) / 2;
  const sim = new Sim(nav, city);
  sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
  const ew = dir === 'ew';
  let sx = ew ? cx - hw - 12 : cx, sz = ew ? cz : cz - hh - 12;
  let gx = ew ? cx + hw + 12 : cx, gz = ew ? cz : cz + hh + 12;
  const openAt = (x, z) => {
    if (!sim.walkable(x, z) || nav.indoor(x, z)) return false;
    let k = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (sim.walkable(x + Math.cos(ang) * 1.5, z + Math.sin(ang) * 1.5)) k++;
    }
    return k >= 6;      // 必须在开阔地面上，不能是死胡同/内院
  };
  for (let k = 0; k < 25 && !openAt(sx, sz); k++) { if (ew) sx -= 2; else sz -= 2; }
  for (let k = 0; k < 25 && !openAt(gx, gz); k++) { if (ew) gx += 2; else gz += 2; }
  const i = 0;
  sim.px[i] = sx; sim.pz[i] = sz; sim.state[i] = 0;
  sim.vip[i] = 0; sim.actT[i] = 0; sim.idle[i] = 0;
  sim.setGoal(i, GOAL.MOVE_TO, gx, gz);
  const total = Math.hypot(gx - sx, gz - sz);
  let best = 1e9, arr = -1;
  for (let k = 0; k < 20 * 90; k++) {
    sim.step(1 / 20, 0, 0);
    const d = Math.hypot(sim.px[i] - gx, sim.pz[i] - gz);
    best = Math.min(best, d);
    if (d < 8) { arr = sim.time; break; }
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
      // 只统计"正在赶路"的人：idle=1 是原版节奏里的"站 25~60 秒"，站着不算速度
      if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE || sim.idle[i]) continue;
      travel += Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]);
      cnt++;
    }
  }
  return cnt ? travel / cnt / 0.5 : 0;
}

const b40 = pickBuilding(34, 56) || pickBuilding(30, 80);
const bBig = pickBuilding(60, 500);
const cases = [];
for (const [name, b] of [['40m 楼', b40], ['大楼', bBig]]) {
  if (!b) continue;
  cases.push([`${name}·东西`, detour(b, 'ew')]);
  cases.push([`${name}·南北`, detour(b, 'ns')]);
}
const spd = citySpeed();

let ok = true;
for (const [name, r] of cases) {
  const limit = name.startsWith('大楼') ? 120 : 60;
  const good = r.arr >= 0 && r.arr <= limit;
  if (!good) ok = false;
  console.log(`${name}: ${r.arr >= 0 ? '✅ ' + r.arr.toFixed(1) + 's' : '❌ 90s 未到（最近 ' + r.best.toFixed(0) + 'm）'}  ${r.total.toFixed(0)}m  限 ${limit}s`);
}
const spdOk = spd >= 1.8;
if (!spdOk) ok = false;
console.log(`全城平均速度: ${spd.toFixed(2)} m/s  ${spdOk ? '✅' : '❌（目标 ≥1.8）'}`);
console.log(ok ? '\n结果：全部通过 ✅' : '\n结果：未通过 ❌');
process.exit(ok ? 0 : 1);
