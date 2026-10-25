// ============================================================
//  NavCore / S3 验收：门 portal + 室内寻路
//      node tools/test_navportal.mjs
//
//  门：
//    1. portal 结构规模与内存（对比旧的 56 MB 门场）
//    2. 室内可达率：随机室内点 → 随机室外点，规划成功率 100%
//    3. 同一房间内两点（旧实现会直接返回 0 的那类）必须成功
//    4. 路径可走性：室内段半径 0.30 / 室外段半径 0.34 全采样通过
//    5. 性能：室内查询 P50 ≤ 2 ms / P95 ≤ 6 ms
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { makeNavGrid } from '../js/nav/grid.js';
import { buildHierarchy } from '../js/nav/sectors.js';
import { buildPortals } from '../js/nav/portal.js';
import { Planner } from '../js/nav/planner.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const city = loadCity();
const nav = await loadCollision(city);
const ng = makeNavGrid(nav);
const hier = buildHierarchy(ng, { cellSize: 8, sectorCells: 16, radius: 0.35 });
const planner = new Planner(ng, hier);
const P = planner.portals;

// ---------- 1. portal 结构 ----------
console.log('【1】门 portal');
console.log(`  门格 ${P.stats.doors.toLocaleString()}，其中有室外出口 ${P.stats.withOutdoor.toLocaleString()}`);
const memKB = P.memBytes() / 1024;
console.log(`  portal 常驻内存 ${memKB.toFixed(0)} KB（旧门场：7.0 M 格 × 2 × Int32 ≈ 56,000 KB）`);
ok(P.stats.withOutdoor / P.stats.doors > 0.85, `>85% 的门有室外出口（${(P.stats.withOutdoor / P.stats.doors * 100).toFixed(1)}%）`);
ok(memKB < 2048, `portal 常驻 ${memKB.toFixed(0)} KB < 2 MB（省掉 56 MB 门场）`);

// ---------- 2. 采样室内点 / 室外点 ----------
// 先在 1 m 网格上算一次连通分量：有些楼只通向封闭内院，物理上就到不了街面
// （欧洲围合式街区很常见）。这类用例不该算进"规划失败"。
console.log('\n  计算 1 m 网格连通分量…');
const comp1m = new Int32Array(ng.grid.length).fill(-1);
let nComp1m = 0;
{
  const DDc = [1, 1, 0, -1, -1, -1, 0, 1];
  const DDr = [0, 1, 1, 1, 0, -1, -1, -1];
  const st = new Int32Array(ng.grid.length);
  const cols = nav.cols, rows = nav.rows, grid = ng.grid;
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i] & 1) === 0 || comp1m[i] >= 0) continue;
    let sp = 0; st[sp++] = i; comp1m[i] = nComp1m;
    while (sp > 0) {
      const cur = st[--sp];
      const r = (cur / cols) | 0, c = cur - r * cols;
      for (let d = 0; d < 8; d++) {
        const nr = r + DDr[d], nc = c + DDc[d];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nk = nr * cols + nc;
        if (comp1m[nk] >= 0 || (grid[nk] & 1) === 0) continue;
        if (DDc[d] !== 0 && DDr[d] !== 0) {
          if ((grid[r * cols + nc] & 1) === 0 || (grid[nr * cols + c] & 1) === 0) continue;
        }
        comp1m[nk] = nComp1m; st[sp++] = nk;
      }
    }
    nComp1m++;
  }
}
console.log(`  1 m 连通分量 ${nComp1m} 个`);

let seed = 424242;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const outdoorPts = [];
let guard = 0;
while (outdoorPts.length < 200 && guard++ < 2000000) {
  const x = (rnd() - 0.5) * nav.W * 0.9, z = (rnd() - 0.5) * nav.H * 0.9;
  if (!ng.walkableR(x, z, 0.4) || ng.indoor(x, z)) continue;
  const c = planner.snap(x, z);
  if (c < 0 || hier.compOf[c] !== hier.compOf[planner.snap(0, 0)]) continue;
  outdoorPts.push([x, z]);
}

// 随机室内点：只取"有门可出、且与某个室外点在同一 1 m 分量"的（即物理可达）
const indoorPts = [];
const indoorGoals = [];
guard = 0;
while (indoorPts.length < 100 && guard++ < 3000000) {
  const x = (rnd() - 0.5) * nav.W * 0.9, z = (rnd() - 0.5) * nav.H * 0.9;
  if (!ng.indoor(x, z) || !ng.walkable(x, z)) continue;
  const ex = P.exitsFrom(x, z, 1, 4000);
  if (!ex.length) continue;
  const ci = comp1m[ng.idx(x, z)];
  const g = outdoorPts.find(([gx, gz]) => comp1m[ng.idx(gx, gz)] === ci);
  if (!g) continue;                       // 物理到不了街面 → 不算失败用例
  indoorPts.push([x, z]);
  indoorGoals.push(g);
}
console.log(`  采样：室内点 ${indoorPts.length}（有门 + 1 m 分量可达），室外点 ${outdoorPts.length}`);

// ---------- 3. 室内 → 室外 ----------
console.log('\n【2】室内 → 室外');
const times = [];
let okN = 0, invalid = 0;
const fails = {};
for (let i = 0; i < indoorPts.length; i++) {
  const [sx, sz] = indoorPts[i];
  const [gx, gz] = indoorGoals[i] || outdoorPts[i % outdoorPts.length];
  const t0 = performance.now();
  const r = planner.plan(sx, sz, gx, gz);
  times.push(performance.now() - t0);
  if (!r) { fails[planner.lastFail] = (fails[planner.lastFail] || 0) + 1; continue; }
  okN++;
  // 可走性：每 0.3 m 采样（室内允许 0.30，室外 0.34）
  let bad = false;
  for (let k = 1; k < r.pts.length && !bad; k++) {
    const [ax, az] = r.pts[k - 1], [bx, bz] = r.pts[k];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.3));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const X = ax + (bx - ax) * t, Z = az + (bz - az) * t;
      const rad = ng.indoor(X, Z) ? 0.30 : 0.34;
      if (!ng.walkableR(X, Z, rad)) { bad = true; break; }
    }
  }
  if (bad) invalid++;
  if (Math.hypot(r.pts[0][0] - sx, r.pts[0][1] - sz) > 0.01) bad = true;
  if (Math.hypot(r.pts[r.pts.length - 1][0] - gx, r.pts[r.pts.length - 1][1] - gz) > 0.01) bad = true;
}
console.log(`  成功 ${okN}/${indoorPts.length}  路径类型 ${JSON.stringify(fails)}`);
ok(okN === indoorPts.length, `室内可达率 ${(okN / indoorPts.length * 100).toFixed(1)}% = 100%`);
ok(invalid === 0, `路径可走性：越界 ${invalid} 条`);

// ---------- 4. 同一房间内（旧实现 s===goal 直接放弃的那类） ----------
console.log('\n【3】同一房间内两点');
let sameOk = 0, sameTry = 0;
for (let i = 0; i < indoorPts.length && sameTry < 60; i++) {
  const [ax, az] = indoorPts[i];
  // 用"出门折线"上的中间点当第二个室内点 —— 它和起点在同一个房间
  const ex = P.exitsFrom(ax, az, 1, 3000);
  if (!ex.length || ex[0].points.length < 4) continue;
  const mid = ex[0].points[Math.floor(ex[0].points.length / 2)];
  const [bx, bz] = mid;
  if (Math.hypot(bx - ax, bz - az) < 3) continue;
  const route = P.roomRoute(ax, az, bx, bz, 6000);
  if (!route) continue;
  sameTry++;
  const r = planner.plan(ax, az, bx, bz);
  if (r && r.pts.length >= 2) sameOk++;
}
console.log(`  同房间用例 ${sameTry} 组`);
ok(sameTry > 0 && sameOk === sameTry, `同房间内 ${sameOk}/${sameTry} 全部成功（旧实现此处返回 0 无路径）`);

// ---------- 5. 性能 ----------
console.log('\n【4】性能');
console.log(`  室内→室外 P50 ${q(times, 0.5).toFixed(2)} ms  P95 ${q(times, 0.95).toFixed(2)} ms  max ${Math.max(...times).toFixed(2)} ms`);
ok(q(times, 0.5) <= 2.0, `P50 ${q(times, 0.5).toFixed(2)} ms ≤ 2 ms`);
ok(q(times, 0.95) <= 6.0, `P95 ${q(times, 0.95).toFixed(2)} ms ≤ 6 ms`);

console.log('\n  规划器统计 ' + JSON.stringify(planner.stats));
console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
