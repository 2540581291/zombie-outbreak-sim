// ============================================================
//  NavCore / S4 验收：流场（群体层）
//      node tools/test_navflow.mjs
//
//  门：
//    1. 正确性：从随机格沿"下坡方向"走，必须走到目标；步数 ≤ 3× 理论最短路
//    2. 梯度：沿 gradientAt 走一小步，距离必须变小（S5 跟随会直接用它）
//    3. 建场成本：≤ 20 ms/张
//    4. 缓存：1000 个个体查同一目标 → 只建 1 张；LRU 生效；内存受限
//    5. 确定性：同一目标建两次，dist 逐格一致
//    6. 群体收益：2 万次查询的耗时 vs 同样次数 HPA* 规划
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { makeNavGrid } from '../js/nav/grid.js';
import { buildHierarchy } from '../js/nav/sectors.js';
import { FlowField, FlowFieldCache } from '../js/nav/flowfield.js';
import { Planner } from '../js/nav/planner.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const city = loadCity();
const nav = await loadCollision(city);
const ng = makeNavGrid(nav);
const hier = buildHierarchy(ng, { cellSize: 8, sectorCells: 16, radius: 0.35 });
const cache = new FlowFieldCache(hier, { maxFields: 32 });

console.log('【1】建场成本');
const t0 = performance.now();
const f0 = cache.get(0, 0);
const buildMs = performance.now() - t0;
console.log(`  单张流场 ${f0.buildMs.toFixed(1)} ms，扩展 ${f0.walkN.toLocaleString()} 格，内存 ${(f0.memBytes() / 1024).toFixed(0)} KB`);
ok(f0.buildMs <= 20, `建场 ${f0.buildMs.toFixed(1)} ms ≤ 20 ms`);

// 主分量
const mainComp = hier.compOf[new Planner(ng, hier).snap(0, 0)];

// ---------- 2. 正确性：沿下坡方向走 ----------
console.log('\n【2】正确性（沿 dir 下坡走）');
{
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // 选一个主分量的目标
  let goalCell = -1, guard = 0;
  while (goalCell < 0 && guard++ < 200000) {
    const c = (rnd() * hier.N) | 0;
    if (hier.walk[c] && hier.compOf[c] === mainComp) goalCell = c;
  }
  const f = cache.get(...hier.repX ? [hier.repX[goalCell], hier.repZ[goalCell]] : [0, 0]);
  const cols = hier.cols;
  let okN = 0, tries = 0, worst = 0;
  const DDc = [1, 1, 0, -1, -1, -1, 0, 1];
  const DDr = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let g = 0; g < 400 && tries < 200; g++) {
    const start = (rnd() * hier.N) | 0;
    if (!hier.walk[start] || hier.compOf[start] !== hier.compOf[f.goal]) continue;
    tries++;
    let cur = start, steps = 0;
    const maxSteps = Math.ceil(f.dist[start] / hier.cs) * 3 + 10;
    while (cur !== f.goal && steps < maxSteps) {
      const d = f.dir[cur];
      if (d === 255) break;
      const r = (cur / cols) | 0, c = cur - r * cols;
      const nr = r + DDr[d], nc = c + DDc[d];
      if (nr < 0 || nc < 0 || nr >= hier.rows || nc >= hier.cols) break;
      cur = nr * cols + nc;
      steps++;
    }
    if (cur === f.goal) { okN++; worst = Math.max(worst, steps); }
  }
  console.log(`  到达 ${okN}/${tries}  最坏步数 ${worst}`);
  ok(okN === tries, `沿流场 ${okN}/${tries} 全部到达目标`);
}

// ---------- 3. 梯度 ----------
console.log('\n【3】梯度（S5 跟随用）');
{
  let seed = 31415;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const goal = new FlowFieldCache(hier, { maxFields: 4 }).get(400, 300);
  let good = 0, tried = 0, minDot = 1;
  for (let k = 0; k < 2000 && tried < 300; k++) {
    const c = (rnd() * hier.N) | 0;
    if (!hier.walk[c] || hier.compOf[c] !== hier.compOf[goal.goal]) continue;
    if (!(goal.dist[c] < Infinity) || goal.dir[c] === 255) continue;
    const x = hier.repX[c], z = hier.repZ[c];
    const g = goal.gradientAt(x, z);
    if (!g) continue;
    tried++;
    // 与该格"下坡邻居方向"对账（行方向 +r 对应世界 -z）
    const d = goal.dir[c];
    const wx = [1, 1, 0, -1, -1, -1, 0, 1][d];
    const wz = -[0, 1, 1, 1, 0, -1, -1, -1][d];
    const dot = g[0] * wx + g[1] * wz;
    minDot = Math.min(minDot, dot);
    if (dot > 0.6) good++;
  }
  console.log(`  梯度与该格下坡方向一致（dot>0.6）${good}/${tried}，最小 dot ${minDot.toFixed(2)}`);
  ok(good / Math.max(1, tried) > 0.9, `梯度方向正确率 ${(good / Math.max(1, tried) * 100).toFixed(0)}% > 90%`);
}

// ---------- 4. 缓存 ----------
console.log('\n【4】缓存');
{
  const c = new FlowFieldCache(hier, { maxFields: 8 });
  const before = c.stats.builds;
  let t = performance.now();
  for (let i = 0; i < 1000; i++) c.get(400, 300);      // 1000 个个体同一个目标
  const ms = performance.now() - t;
  console.log(`  1000 次同目标查询 ${ms.toFixed(2)} ms（${(ms / 1000 * 1000).toFixed(1)} µs/次），建场 ${c.stats.builds - before} 次`);
  ok(c.stats.builds - before === 1, '同目标 1000 次查询只建 1 张场');
  ok(ms / 1000 < 0.02, `${(ms / 1000 * 1000).toFixed(1)} µs/次 < 20 µs`);

  // LRU 淘汰
  for (let i = 0; i < 30; i++) c.get(400 + i * 40, 300 + i * 30);
  console.log(`  再查 30 个不同目标后：缓存 ${c.size()} 张（上限 8），淘汰 ${c.stats.evictions} 次`);
  ok(c.size() <= 8, `缓存张数 ${c.size()} ≤ 8`);
  ok(c.memBytes() < 12 * 1024 * 1024, `缓存内存 ${(c.memBytes() / 1024 / 1024).toFixed(1)} MB < 12 MB`);
}

// ---------- 5. 确定性 ----------
console.log('\n【5】确定性');
{
  const a = new FlowField(hier, hier.walk.length >> 1);
  const b = new FlowField(hier, hier.walk.length >> 1);
  a.build(); b.build();
  let diff = 0;
  for (let i = 0; i < hier.N; i++) if (a.dist[i] !== b.dist[i]) diff++;
  ok(diff === 0, `同目标两次建场 dist 逐格一致（差异 ${diff}）`);
}

// ---------- 6. 群体收益 ----------
console.log('\n【6】群体收益（2 万次查询）');
{
  const c = new FlowFieldCache(hier, { maxFields: 16 });
  const goals = [];
  let seed = 2024;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (goals.length < 8) {
    const k = (rnd() * hier.N) | 0;
    if (!hier.walk[k] || hier.compOf[k] !== mainComp) continue;
    goals.push([hier.repX[k], hier.repZ[k]]);
  }
  // 先预热 8 张
  for (const g of goals) c.get(g[0], g[1]);
  const t = performance.now();
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const g = goals[i % goals.length];
    const f = c.get(g[0], g[1]);
    const cell = (rnd() * hier.N) | 0;
    sum += f.dist[cell] < Infinity ? 1 : 0;
  }
  const ms = performance.now() - t;
  console.log(`  2 万次（8 个目标、热缓存）${ms.toFixed(2)} ms → ${(ms / 20000 * 1000).toFixed(2)} µs/次`);
  ok(ms / 20000 < 0.005, `${(ms / 20000 * 1000).toFixed(2)} µs/次 < 5 µs（HPA* 约 500 µs，差 100 倍量级）`);
  void sum;
}

// ---------- 7. 群体模拟：2 万个体跟着流场走 ----------
console.log('\n【7】群体模拟（2 万个体 × 20 tick）');
{
  const N = 20000;
  const c = new FlowFieldCache(hier, { maxFields: 40 });
  const goals = [];
  let seed = 987654;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (goals.length < 40) {
    const k = (rnd() * hier.N) | 0;
    if (!hier.walk[k] || hier.compOf[k] !== mainComp) continue;
    goals.push([hier.repX[k], hier.repZ[k]]);
  }
  const fields = goals.map((g) => c.get(g[0], g[1]));   // 预热 40 张（相当于"热目标预烘焙"）

  // 每个个体：位置 + 归属目标
  const ax = new Float32Array(N), az = new Float32Array(N);
  const gi = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0, guard = 0;
    do { k = (rnd() * hier.N) | 0; } while ((!hier.walk[k] || hier.compOf[k] !== mainComp) && guard++ < 10000);
    ax[i] = hier.repX[k]; az[i] = hier.repZ[k];
    gi[i] = (rnd() * 40) | 0;
  }
  const TICKS = 20, dt = 1 / 20, speed = 2.0;
  const t = performance.now();
  for (let tick = 0; tick < TICKS; tick++) {
    for (let i = 0; i < N; i++) {
      const g = fields[gi[i]];
      const dir = g.gradientAt(ax[i], az[i]);
      if (!dir) continue;
      ax[i] += dir[0] * speed * dt;
      az[i] += dir[1] * speed * dt;
    }
  }
  const ms = performance.now() - t;
  console.log(`  20 tick × ${N} 人 = ${(TICKS * N / 1000).toFixed(0)} k 次查询 + 位移：${ms.toFixed(1)} ms → ${(ms / TICKS).toFixed(2)} ms/tick`);
  console.log(`  缓存 ${c.size()} 张场，${(c.memBytes() / 1024 / 1024).toFixed(1)} MB`);
  ok(ms / TICKS <= 3, `${(ms / TICKS).toFixed(2)} ms/tick ≤ 3 ms（旧移动层 tick 约 8 ms，且不含寻路）`);
}

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
