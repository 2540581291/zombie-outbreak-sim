// ============================================================
//  NavCore / S6 验收：动态世界（路障）
//      node tools/test_navdyn.mjs
//
//  门：
//    1. 铺路障前：A→B 规划成功，路径穿过路障位置
//    2. 铺路障后：blockCells 局部修复 ≤ 50 ms
//    3. 规划仍成功（绕行），且新路径**不穿过任何一个路障格**
//    4. 绕行长度 > 原长度（说明真的绕了，不是直线穿过去）
//    5. 局部跟随：个体朝路障走 300 步，绝不进入路障格
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { makeNavGrid } from '../js/nav/grid.js';
import { buildHierarchy } from '../js/nav/sectors.js';
import { Portals } from '../js/nav/portal.js';
import { Planner } from '../js/nav/planner.js';
import { FlowFieldCache } from '../js/nav/flowfield.js';
import { blockCells } from '../js/nav/dynamic.js';
import { Steering } from '../js/nav/steering.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };

const city = loadCity();
const nav = await loadCollision(city);
const ng = makeNavGrid(nav);
const hier = buildHierarchy(ng, { cellSize: 8, sectorCells: 16, radius: 0.35 });
const portals = new Portals(ng, { radius: 0.35 });
const planner = new Planner(ng, hier, { portals });
const flows = new FlowFieldCache(hier, { maxFields: 8 });
const world = { ng, hier, portals, planner, flows, invalidate: () => { flows.invalidateAll(); planner.cache.clear(); } };

// ---------- 选一条街 ----------
let seed = 555;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const mainComp = hier.compOf[planner.snap(0, 0)];
let A = null, B = null;
for (let g = 0; g < 200000 && !A; g++) {
  const x = (rnd() - 0.5) * nav.W * 0.8, z = (rnd() - 0.5) * nav.H * 0.8;
  if (!ng.walkableR(x, z, 0.4) || ng.indoor(x, z)) continue;
  for (const ang of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    const x2 = x + Math.cos(ang) * 160, z2 = z + Math.sin(ang) * 160;
    if (!ng.walkableR(x2, z2, 0.4) || ng.indoor(x2, z2)) continue;
    if (!ng.losClear(x, z, x2, z2, 0.4)) continue;        // 要求直线可达（这才有"被路障切断"的意义）
    const s = planner.snap(x, z), t = planner.snap(x2, z2);
    if (s < 0 || t < 0 || hier.compOf[s] !== mainComp || hier.compOf[t] !== mainComp) continue;
    A = [x, z]; B = [x2, z2];
    break;
  }
}
if (!A) { console.log('找不到合适的测试街段'); process.exit(1); }
console.log(`测试街段 A(${A[0].toFixed(0)},${A[1].toFixed(0)}) → B(${B[0].toFixed(0)},${B[1].toFixed(0)})`);

const before = planner.plan(A[0], A[1], B[0], B[1]);
console.log('【1】铺路障前');
ok(!!before, '规划成功');
{
  let crosses = 0;
  for (let i = 1; i < before.pts.length; i++) {
    const [ax, az] = before.pts[i - 1], [bx, bz] = before.pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.3));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const X = ax + (bx - ax) * t, Z = az + (bz - az) * t;
      const k = ((nav.halfH - Z) / nav.cell) | 0;
      const c = ((X + nav.halfW) / nav.cell) | 0;
      if (nav.grid[k * nav.cols + c] & 1) crosses++;
    }
  }
  ok(crosses > 0, `原路径 ${before.cost.toFixed(0)} m（经过中点区域）`);
}

// ---------- 铺路障：以中点为中心，垂直于 A→B 方向，60 m 长 5 m 厚 ----------
console.log('\n【2】铺路障（60 m × 5 m，垂直切过街段）');
const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
const halfLen = 30, halfThick = 2.5;
const ca = Math.cos(ang), sa = Math.sin(ang);
const ext = halfLen + halfThick;
const c0 = Math.max(0, Math.floor((mx - ext + nav.halfW) / nav.cell));
const c1 = Math.min(nav.cols - 1, Math.ceil((mx + ext + nav.halfW) / nav.cell));
const r0 = Math.max(0, Math.floor((nav.halfH - (mz + ext)) / nav.cell));
const r1 = Math.min(nav.rows - 1, Math.ceil((nav.halfH - (mz - ext)) / nav.cell));
const blocked = [];
for (let r = r0; r <= r1; r++) {
  const wz = nav.halfH - (r + 0.5) * nav.cell - mz;
  for (let c = c0; c <= c1; c++) {
    const wx = (c + 0.5) * nav.cell - nav.halfW - mx;
    const u = wx * ca + wz * sa;      // 沿 A→B 方向
    const v = -wx * sa + wz * ca;     // 垂直 A→B（路障要横切街道，所以长度卡在 v 上）
    if (Math.abs(u) <= halfThick && Math.abs(v) <= halfLen) {
      const k = r * nav.cols + c;
      if (nav.grid[k] & 1) { nav.grid[k] = 0; blocked.push(k); }
    }
  }
}
console.log(`  堵掉 ${blocked.length} 个 1 m 格`);
const t0 = performance.now();
const rep = blockCells(world, blocked);
const ms = performance.now() - t0;
console.log(`  局部修复：${rep.cells8} 个 8 m 格、${rep.clusters} 个簇、${ms.toFixed(1)} ms`);
ok(ms <= 50, `局部修复 ${ms.toFixed(1)} ms ≤ 50 ms`);

// ---------- 规划仍成功，且不穿路障 ----------
console.log('\n【3】路障后的规划');
const after = planner.plan(A[0], A[1], B[0], B[1]);
ok(!!after, '规划成功（绕行）');
let badSamples = 0, total = 0;
if (after) {
  for (let i = 1; i < after.pts.length; i++) {
    const [ax, az] = after.pts[i - 1], [bx, bz] = after.pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.3));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const X = ax + (bx - ax) * t, Z = az + (bz - az) * t;
      const k = ((nav.halfH - Z) / nav.cell) | 0;
      const c = ((X + nav.halfW) / nav.cell) | 0;
      total++;
      if (nav.grid[k * nav.cols + c] === 0) badSamples++;
    }
  }
}
ok(badSamples === 0, `新路径不穿路障（采样 ${total}，穿墙 ${badSamples}）`);
if (after) {
  console.log(`  长度 ${before.cost.toFixed(0)} m → ${after.cost.toFixed(0)} m`);
  ok(after.cost > before.cost + 5, `绕行 +${(after.cost - before.cost).toFixed(0)} m（> 5 m）`);
}

// ---------- 局部跟随检查 ----------
console.log('\n【4】局部跟随不穿路障');
{
  const N = 300;
  const px = new Float32Array(N), pz = new Float32Array(N);
  const heading = new Float32Array(N), phase = new Float32Array(N), stuck = new Float32Array(N);
  const lastDir = new Float32Array(N), lastDirT = new Float32Array(N);
  const lastVX = new Float32Array(N), lastVZ = new Float32Array(N);
  const side = new Int8Array(N).fill(1);
  const steer = new Steering(ng, { px, pz, heading, phase, stuck, lastDir, lastDirT, lastVX, lastVZ, side, radius: 0.35 });
  // 从路障正前方 25 m 处，直冲路障
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 40 - 20;                     // 沿路障长度方向铺开
    px[i] = mx + Math.cos(ang) * t - Math.sin(ang) * 25;
    pz[i] = mz + Math.sin(ang) * t + Math.cos(ang) * 25;
    if (!ng.walkableR(px[i], pz[i], 0.35)) px[i] = -9999;   // 落墙里的样本不计
  }
  let inside = 0, moved = 0;
  for (let step = 0; step < 300; step++) {
    steer.time = step * 0.05;
    for (let i = 0; i < N; i++) {
      if (px[i] === -9999) continue;
      const dx = mx - px[i], dz = mz - pz[i];
      if (steer.step(i, dx, dz, 2.2, 0.05)) moved++;
    }
  }
  for (let i = 0; i < N; i++) {
    if (px[i] === -9999) continue;
    const k = ((nav.halfH - pz[i]) / nav.cell) | 0;
    const c = ((px[i] + nav.halfW) / nav.cell) | 0;
    if (nav.grid[k * nav.cols + c] === 0) inside++;
  }
  console.log(`  ${N} 个个体冲 300 步（${moved} 次移动），停在路障格里的 ${inside} 个`);
  ok(inside === 0, '没有任何个体停在路障格里');
  ok(moved > N * 100, `确实在走（${moved} 次位移）`);
}

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
