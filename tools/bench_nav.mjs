// ============================================================
//  NavCore / S0 基线：寻路子系统统一基准
//      node tools/bench_nav.mjs            # 人读表格
//      node tools/bench_nav.mjs --json     # 机器读（回归对比用）
//      node tools/bench_nav.mjs --city tokyo
//
//  两块：
//    A. 规划器微基准：随机 OD 的「成功率 / 单次耗时 P50·P95 / 路径长 · 直线长」
//       —— 这是 S2（HPA*）、S4（流场）唯一可以直接对账的指标。
//    B. 群体基准：20k 人跑 60 s 的 tick 耗时、平均速度、卡住率、穿门率。
//
//  S1 之后的每个阶段都必须拿这份输出与基线比。
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';

const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes('--json');
const cityArg = ARGS.indexOf('--city');

const city = loadCity(cityArg >= 0 ? ARGS[cityArg + 1] : undefined);
const nav = await loadCollision(city);
const out = { tag: process.env.ZOS_TAG || 'baseline', city: process.env.ZOS_CITY || 'berlin', at: new Date().toISOString() };

// ---------------- A. 规划器微基准 ----------------
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const sim = new Sim(nav, city);
  sim.reset({ seed: 1, population: 1, initialZombies: 0, police: 0, homeGunRate: 0 });
  sim.pathBudget = 1e9;                       // 微基准不受预算限制

  const pts = [];
  while (pts.length < 300) {
    const x = (rnd() - 0.5) * nav.W * 0.9, z = (rnd() - 0.5) * nav.H * 0.9;
    if (!nav.walkable(x, z) || nav.indoor(x, z)) continue;
    pts.push([x, z]);
  }
  const times = [], ratios = [];
  let okN = 0, tries = 0;
  for (let k = 0; k + 1 < pts.length && tries < 400; k += 2) {
    const [sx, sz] = pts[k], [gx, gz] = pts[k + 1];
    const straight = Math.hypot(gx - sx, gz - sz);
    if (straight < 150) continue;             // 只看跨街区的中长途
    tries++;
    sim.px[0] = sx; sim.pz[0] = sz; sim.pathN[0] = 0; sim.pathIdx[0] = 0;
    const t0 = performance.now();
    const n = sim.planPath(0, gx, gz);
    const dt = performance.now() - t0;
    times.push(dt);
    if (n <= 0) continue;
    okN++;
    let len = 0, lx = sx, lz = sz;
    for (let j = 0; j < sim.pathN[0]; j++) {
      const wx = sim.pathX[j], wz = sim.pathZ[j];
      len += Math.hypot(wx - lx, wz - lz); lx = wx; lz = wz;
    }
    len += Math.hypot(gx - lx, gz - lz);
    ratios.push(len / straight);
  }
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  };
  out.planner = {
    tries,
    ok: okN,
    okRate: +(okN / Math.max(1, tries)).toFixed(3),
    msP50: +q(times, 0.5).toFixed(3),
    msP95: +q(times, 0.95).toFixed(3),
    msMax: +(Math.max(0, ...times)).toFixed(3),
    lenRatioP50: +q(ratios, 0.5).toFixed(3),
    lenRatioP95: +q(ratios, 0.95).toFixed(3),
    lenRatioMax: ratios.length ? +Math.max(...ratios).toFixed(3) : 0,
  };
}

// ---------------- B. 群体基准 ----------------
{
  const sim = new Sim(nav, city);
  const P = {
    seed: 20251022, population: 20000, initialZombies: 80, zombieSpeed: 2.0,
    infectTime: 8, armedRate: 0.1, police: 40, policeAccuracy: 0.3,
  };
  sim.reset(P);
  const N = sim.n;
  const doorSeen = new Uint8Array(N), stuckSeen = new Uint8Array(N);
  const x0 = new Float32Array(N), z0 = new Float32Array(N);
  const doorVal = (i) => {
    const c = ((sim.px[i] + nav.halfW) / nav.cell) | 0;
    const r = ((sim.pz[i] + nav.halfH) / nav.cell) | 0;
    return nav.grid[r * nav.cols + c];
  };
  const TICKS = 20 * 60;
  const tickMs = [];
  let travel = 0, travelN = 0, blockedSamples = 0, moveSamples = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t % 20 === 0) { for (let i = 0; i < N; i++) { x0[i] = sim.px[i]; z0[i] = sim.pz[i]; } }
    const t0 = performance.now();
    sim.step(1 / 20, 0, 0);
    tickMs.push(performance.now() - t0);
    if (t % 20 === 19) {
      for (let i = 0; i < N; i++) {
        const st = sim.state[i];
        if (st === ST.CORPSE || st === ST.SAVED) continue;
        if (sim.stuck[i] > 0) { blockedSamples++; stuckSeen[i] = 1; } else moveSamples++;
        if (st === ST.CIV && sim.goal[i] !== 0 && !sim.idle[i]) {
          travel += Math.hypot(sim.px[i] - x0[i], sim.pz[i] - z0[i]);
          travelN++;
        }
      }
    }
    if (t % 4 === 0) for (let i = 0; i < N; i++) if (doorVal(i) === 0x0f) doorSeen[i] = 1;
  }
  const cnt = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
  out.crowd = {
    population: N,
    ticks: TICKS,
    tickMsP50: +q(tickMs, 0.5).toFixed(2),
    tickMsP95: +q(tickMs, 0.95).toFixed(2),
    tickMsMean: +(tickMs.reduce((a, b) => a + b, 0) / TICKS).toFixed(2),
    avgSpeed: travelN ? +(travel / travelN / 1).toFixed(2) : 0,     // 每 1 s 窗口的位移 = m/s
    stuckPct: +(cnt(stuckSeen) / N * 100).toFixed(2),
    doorPct: +(cnt(doorSeen) / N * 100).toFixed(2),
    blockedSamplesPct: +(blockedSamples / Math.max(1, blockedSamples + moveSamples) * 100).toFixed(2),
    final: { civ: sim.stats.civ, infected: sim.stats.infected, zombie: sim.stats.zombie, dead: sim.stats.dead },
  };
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const p = out.planner, c = out.crowd;
  console.log(`\n=== NavCore 基线（${out.city}）${out.tag} ===`);
  console.log('\n[A] 规划器（随机 OD，≥150 m）');
  console.log(`  样本        ${p.tries} 组`);
  console.log(`  成功率      ${(p.okRate * 100).toFixed(1)}%`);
  console.log(`  单次耗时    P50 ${p.msP50} ms   P95 ${p.msP95} ms   max ${p.msMax} ms`);
  console.log(`  路径/直线   P50 ${p.lenRatioP50}   P95 ${p.lenRatioP95}   max ${p.lenRatioMax}`);
  console.log('\n[B] 群体（20k @ 20 Hz，60 s）');
  console.log(`  tick        P50 ${c.tickMsP50} ms   P95 ${c.tickMsP95} ms   mean ${c.tickMsMean} ms`);
  console.log(`  平均速度    ${c.avgSpeed} m/s`);
  console.log(`  曾卡住      ${c.stuckPct}%      穿门 ${c.doorPct}%      瞬时被挡 ${c.blockedSamplesPct}%`);
  console.log(`  结局        平民 ${c.final.civ} 潜伏 ${c.final.infected} 丧尸 ${c.final.zombie} 死亡 ${c.final.dead}`);
}
