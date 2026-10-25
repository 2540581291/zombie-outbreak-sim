// ============================================================
//  NavCore / L0 验收：clearance 栅格
//      node tools/test_navgrid.mjs
//
//  门：
//    1. walkable 与旧实现 20 万随机点 100% 一致
//    2. 合成小网格上 EDT 与暴力法逐格 0 误差
//    3. 柏林 2000 随机点与暴力法 0 误差
//    4. 半径语义（走廊宽度 → walkableR）符合手算
//    5. 性能：EDT ≤ 400 ms（柏林 7.6 M 格）
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { NavGrid, makeNavGrid } from '../js/nav/grid.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ❌ ' + msg); } else console.log('  ✅ ' + msg); };

// ---------- 1. 合成网格：EDT 与暴力法逐格对比 ----------
function brute(grid, cols, rows, c, r) {
  // 最近"非可走格"（含外圈 padding）的欧氏距离
  let best = Infinity;
  for (let rr = -1; rr <= rows; rr++) {
    for (let cc = -1; cc <= cols; cc++) {
      const outside = rr < 0 || cc < 0 || rr >= rows || cc >= cols;
      const blocked = outside || (grid[rr * cols + cc] & 1) === 0;
      if (!blocked) continue;
      const d = Math.hypot(cc - c, rr - r);
      if (d < best) best = d;
    }
  }
  return best;
}

console.log('【1】合成网格（41×41 随机障碍）EDT vs 暴力法');
{
  const cols = 41, rows = 41;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = new Uint8Array(cols * rows);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() < 0.75 ? 3 : 0;
  const g = new NavGrid({ grid, cols, rows, cell: 1, halfW: cols / 2, halfH: rows / 2 });
  g.buildClearance();
  let bad = 0, maxErr = 0, checked = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if ((grid[i] & 1) === 0) continue;
      const want = Math.floor(brute(grid, cols, rows, c, r));
      const got = g.clearance[i];
      checked++;
      if (got !== want) { bad++; maxErr = Math.max(maxErr, Math.abs(got - want)); }
    }
  }
  ok(bad === 0, `${checked} 格全部一致（误差 0${bad ? `，${bad} 格不符，最大偏差 ${maxErr}` : ''}）`);
  // 障碍格必须为 0
  let blockBad = 0;
  for (let i = 0; i < grid.length; i++) if ((grid[i] & 1) === 0 && g.clearance[i] !== 0) blockBad++;
  ok(blockBad === 0, '所有障碍格 clearance = 0');
}

// ---------- 2. 合成走廊：半径语义手算 ----------
console.log('\n【2】走廊宽度 → walkableR（手算对账）');
{
  // 5 格宽走廊（列 18..22 可走），其余是墙
  const cols = 41, rows = 41;
  const grid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) grid[r * cols + c] = (c >= 18 && c <= 22) ? 3 : 0;
  }
  const g = new NavGrid({ grid, cols, rows, cell: 1, halfW: cols / 2, halfH: rows / 2 });
  g.buildClearance();
  const mid = 20 * cols + 20;
  // 中心格到最近墙格 3 格 → cl=3 → freeSpace=(3-0.5)=2.5 m
  ok(g.clearance[mid] === 3, `走廊中心 clearance=3（实际 ${g.clearance[mid]}）`);
  ok(Math.abs(g.freeSpaceIdx(mid) - 2.5) < 1e-9, `走廊中心自由距离 2.5 m（实际 ${g.freeSpaceIdx(mid)}）`);
  const cx = 20 * 1 - cols / 2 + 0.5, cz = rows / 2 - 20 * 1 - 0.5;
  ok(g.walkableR(cx, cz, 2.4) === true, '半径 2.4 m 能站（2.4 ≤ 2.5）');
  ok(g.walkableR(cx, cz, 2.6) === false, '半径 2.6 m 不能站（2.6 > 2.5）');
  // 贴墙格：cl=1 → freeSpace 0.5 m
  const near = 20 * cols + 18;
  ok(g.freeSpaceIdx(near) === 0.5, `贴墙格自由距离 0.5 m（实际 ${g.freeSpaceIdx(near)}）`);
  ok(g.walkableRIdx(near, 0.6) === false, '半径 0.6 m 站不进贴墙格');
}

// ---------- 3. 真实城市：一致性与暴力法抽查 ----------
console.log('\n【3】柏林实数据');
const city = loadCity();
const nav = await loadCollision(city);
const t0 = performance.now();
const ng = makeNavGrid(nav);
const ms = performance.now() - t0;
console.log(`  格 ${nav.cols}×${nav.rows} = ${(nav.grid.length / 1e6).toFixed(2)} M   格宽 ${nav.cell} m`);
console.log(`  clearance 构建 ${ms.toFixed(0)} ms（${(nav.grid.length / ms / 1000).toFixed(1)} M 格/秒）`);

{
  // 3a. 与旧 walkable 一致
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let bad = 0, n = 200000;
  for (let k = 0; k < n; k++) {
    const x = (rnd() - 0.5) * nav.W, z = (rnd() - 0.5) * nav.H;
    if (ng.walkable(x, z) !== nav.walkable(x, z)) bad++;
  }
  ok(bad === 0, `${n} 随机点 walkable 与旧实现一致${bad ? `（${bad} 处不符）` : ''}`);
}

{
  // 3b. 暴力法抽查（窗口 24，超出窗口跳过）
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const R = 24, cols = nav.cols, rows = nav.rows, grid = nav.grid;
  let bad = 0, checked = 0, maxErr = 0;
  const hist = new Map();
  while (checked < 2000) {
    const c = 4 + ((rnd() * (cols - 8)) | 0);
    const r = 4 + ((rnd() * (rows - 8)) | 0);
    const i = r * cols + c;
    if ((grid[i] & 1) === 0) continue;
    let best2 = Infinity;
    for (let dr = -R; dr <= R; dr++) {
      const rr = r + dr;
      for (let dc = -R; dc <= R; dc++) {
        const cc = c + dc;
        const outside = rr < 0 || cc < 0 || rr >= rows || cc >= cols;
        const blocked = outside || (grid[rr * cols + cc] & 1) === 0;
        if (!blocked) continue;
        const d2 = dr * dr + dc * dc;
        if (d2 < best2) best2 = d2;
      }
    }
    if (best2 > R * R) continue;                 // 窗口外还有更近的，跳过
    checked++;
    const want = Math.floor(Math.sqrt(best2));
    const got = ng.clearance[i];
    hist.set(got, (hist.get(got) || 0) + 1);
    if (got !== want) { bad++; maxErr = Math.max(maxErr, Math.abs(got - want)); }
  }
  ok(bad === 0, `${checked} 点与暴力法零误差${bad ? `（${bad} 处不符，最大偏差 ${maxErr}）` : ''}`);
  console.log('     clearance 分布：' + [...hist.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`).join('  '));
}

// ---------- 4. 半径可用面积（信息性 + 合理性门） ----------
{
  const st = ng.clearanceStats([0.5, 1.0, 1.5, 2.0, 3.0]);
  const walk = st.walkable;
  const pct = (n) => (n / walk * 100).toFixed(1) + '%';
  console.log(`  可走格 ${walk.toLocaleString()}（占全图 ${(walk / st.total * 100).toFixed(1)}%）`);
  const labels = ['<0.5', '0.5–1.0', '1.0–1.5', '1.5–2.0', '2.0–3.0', '≥3.0'];
  st.buckets.forEach((n, k) => console.log(`     自由距离 ${labels[k].padEnd(8)} ${pct(n)}`));
  // 人（半径 0.35）应该绝大多数地方能站；半径 1.0 的应该显著少
  let stand = 0;
  for (let i = 0; i < ng.grid.length; i++) if (ng.walkableRIdx(i, 0.35)) stand++;
  const loss = (walk - stand) / walk;
  ok(loss < 0.15, `半径 0.35 m 可站面积 ${(stand / walk * 100).toFixed(1)}%（损失 ${(loss * 100).toFixed(1)}%，门 <15%）`);
}

// ---------- 5. 性能门 ----------
console.log('\n【5】性能');
ok(ms <= 400, `clearance 构建 ${ms.toFixed(0)} ms ≤ 400 ms`);

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
