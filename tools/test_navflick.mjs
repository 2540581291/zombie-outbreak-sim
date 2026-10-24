// ============================================================
//  NavCore / S7.1 验收：门口"原地闪烁"回归
//      node tools/test_navflick.mjs
//
//  症状（用户实测）：很多人卡在门口，一帧向前一帧向后，看起来在原地闪。
//  根因（两处，都已修）：
//    1. 室内/室外标记在门槛那一格来回翻转，两套目标（出口路径 vs 直接目标）
//       指向相反方向 → 每帧掉头一次；
//    2. 引导点走到之后没有推进逻辑 → 在引导点附近来回横跳。
//  修法：
//    - 8 m 内直接朝"门外那一格"走（与室内标记无关）；
//    - 引导点取 ≥3 m 外、走到 1.5 m 内立即重算，出口按"朝目标"挑；
//    - 局部跟随加"转身限速"：0.45 s 内不允许连续两次 >100° 的掉头。
//
//  门：行走个体里"20 tick 内反向 ≥6 次"的比例 < 10%（修复前 74%）
// ============================================================
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({
  seed: 20251022, population: 20000, initialZombies: 80, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 40, policeAccuracy: 0.3,
});
sim.ensureNav();
const ng = sim.navWorld.ng;
const N = sim.n;

for (let t = 0; t < 20 * 20; t++) sim.step(1 / 20, 0, 0);

const W = 20;
const prevX = new Float32Array(N), prevZ = new Float32Array(N);
const dirX = Array.from({ length: W }, () => new Float32Array(N));
const dirZ = Array.from({ length: W }, () => new Float32Array(N));
const movedFlag = Array.from({ length: W }, () => new Uint8Array(N));
for (let i = 0; i < N; i++) { prevX[i] = sim.px[i]; prevZ[i] = sim.pz[i]; }

for (let k = 0; k < W; k++) {
  sim.step(1 / 20, 0, 0);
  const dx = dirX[k], dz = dirZ[k], mf = movedFlag[k];
  for (let i = 0; i < N; i++) {
    const ddx = sim.px[i] - prevX[i], ddz = sim.pz[i] - prevZ[i];
    const d = Math.hypot(ddx, ddz);
    if (d > 1e-4) { dx[i] = ddx / d; dz[i] = ddz / d; mf[i] = 1; }
    prevX[i] = sim.px[i]; prevZ[i] = sim.pz[i];
  }
}

let flick = 0, walkers = 0;
for (let i = 0; i < N; i++) {
  if (sim.state[i] !== ST.CIV || sim.goal[i] === GOAL.NONE || sim.idle[i]) continue;
  let reversals = 0, steps = 0;
  for (let k = 1; k < W; k++) {
    if (!movedFlag[k][i] || !movedFlag[k - 1][i]) continue;
    steps++;
    const dot = dirX[k][i] * dirX[k - 1][i] + dirZ[k][i] * dirZ[k - 1][i];
    if (dot < -0.7) reversals++;      // 夹角 >135° 记一次反向
  }
  if (steps < 8) continue;
  walkers++;
  if (reversals >= 6) flick++;
}
const pct = flick / Math.max(1, walkers) * 100;
console.log(`行走中的平民 ${walkers}，逐帧来回闪 ${flick}（${pct.toFixed(1)}%）`);
ok(walkers > 500, `样本足够（${walkers} 个行走个体）`);
ok(pct < 10, `闪烁率 ${pct.toFixed(1)}% < 10%（修复前 73.7%）`);

console.log(fail === 0 ? '\n结果：全部通过 ✅' : `\n结果：${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
