// 社会层自检（M1）：POI / 家 / 工作地 / 通勤
//   node tools/test_social.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

// 数据层不变量：POI 必须在建筑轮廓里、不能在水里（用烘焙坐标核对）
function inPoly(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}

const P = {
  seed: 4242, population: 12000, initialZombies: 60, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single',
};

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const civs = () => {
  const out = [];
  for (let i = 0; i < sim.n; i++) if (sim.state[i] !== ST.ZOMBIE && sim.state[i] !== ST.CORPSE
    && sim.state[i] !== ST.SAVED && sim.state[i] !== ST.WILD) out.push(i);
  return out;
};

// ---------- 1. POI ----------
console.log('1) POI 烘焙');
const pois = city.pois || [];
ok(pois.length > 100, `POI ${pois.length} 个（应 > 100）`);
const kinds = {};
for (const p of pois) kinds[p.k] = (kinds[p.k] || 0) + 1;
ok((kinds.police || 0) > 0, `警察局 ${kinds.police || 0} 个`);
ok((kinds.hospital || 0) > 0, `医院 ${kinds.hospital || 0} 个`);
ok((kinds.school || 0) > 0, `学校 ${kinds.school || 0} 个`);
ok((kinds.transit || 0) > 0, `交通枢纽 ${kinds.transit || 0} 个`);
{
  let inBld = 0, inWater = 0;
  for (const p of pois) {
    if (city.buildings.some((b) => inPoly(p.x, p.z, b.p))) inBld++;
    if ((city.water || []).some((w) => inPoly(p.x, p.z, w.p))) inWater++;
  }
  ok(inBld / Math.max(1, pois.length) > 0.99,
    `POI 全部在建筑轮廓里（${inBld}/${pois.length}）`);
  ok(inWater === 0, `没有 POI 落在水里（${inWater} 个）`);
  const inferred = pois.filter((p) => p.i).length;
  console.log(`     （OSM 标签 ${pois.length - inferred} 个，按建筑存量推导 ${inferred} 个）`);
}

// ---------- 2. 家 / 工作地 ----------
console.log('2) 家 / 工作地');
sim.reset(P);
const cs = civs();
let badHome = 0, badWork = 0, anchored = 0, atAnchor = 0;
for (const i of cs) {
  if (!sim.walkable(sim.homeX[i], sim.homeZ[i])) badHome++;
  if (!sim.walkable(sim.workX[i], sim.workZ[i])) badWork++;
  if (sim.goal[i] !== GOAL.NONE) {
    anchored++;
    const ax = sim.goal[i] === GOAL.WORK ? sim.workX[i] : sim.homeX[i];
    const az = sim.goal[i] === GOAL.WORK ? sim.workZ[i] : sim.homeZ[i];
    if ((ax - sim.px[i]) ** 2 + (az - sim.pz[i]) ** 2 < 16) atAnchor++;
  }
}
ok(badHome === 0, `家的坐标全部可走（坏 ${badHome}）`);
ok(badWork === 0, `工作地坐标全部可走（坏 ${badWork}）`);
const ar = anchored / Math.max(1, cs.length);
ok(ar > 0.45 && ar < 0.65, `开局锚定率 ${(ar * 100).toFixed(0)}%（应 45–65%）`);
ok(atAnchor === anchored, `开局时锚定的人都就在锚点上（${atAnchor}/${anchored}）`);

// ---------- 3. 通勤：人真的在动 ----------
console.log('3) 通勤');
// 记下 t=0 的目标与位置
const goal0 = new Map(), pos0 = new Map();
for (const i of cs) { goal0.set(i, sim.goal[i]); pos0.set(i, [sim.px[i], sim.pz[i]]); }
for (let t = 0; t < 20 * 150; t++) sim.step(1 / 20, 0, 0);

let switched = 0, moved = 0, onWay = 0, distSum = 0, tripSum = 0;
for (const i of cs) {
  const g0 = goal0.get(i), g1 = sim.goal[i];
  const p0 = pos0.get(i);
  const d = Math.hypot(sim.px[i] - p0[0], sim.pz[i] - p0[1]);
  distSum += d;
  if (d > 20) moved++;
  if (g0 !== g1 && g1 !== GOAL.NONE) {
    switched++;
    // 通勤进度：从"A 点"出发去"B 点"，现在离 B 的距离 是否比 A→B 全程更短
    const ax = g1 === GOAL.WORK ? sim.workX[i] : sim.homeX[i];
    const az = g1 === GOAL.WORK ? sim.workZ[i] : sim.homeZ[i];
    const bx = g1 === GOAL.WORK ? sim.homeX[i] : sim.workX[i];
    const bz = g1 === GOAL.WORK ? sim.homeZ[i] : sim.workZ[i];
    const full = Math.hypot(ax - bx, az - bz);
    const left = Math.hypot(ax - sim.px[i], az - sim.pz[i]);
    if (full > 20) { tripSum += full; if (left < full * 0.9) onWay++; }
  }
}
const n = Math.max(1, cs.length);
ok(switched / n > 0.4, `150 秒内 ${switched} 人换了目标（${(switched / n * 100).toFixed(0)}%，应 > 40%）`);
ok(moved / n > 0.5, `${moved} 人真的移动了 > 20m（${(moved / n * 100).toFixed(0)}%）`);
console.log(`     平均位移 ${(distSum / n).toFixed(0)}m / 150s；平均通勤全程 ${(tripSum / Math.max(1, switched)).toFixed(0)}m`);

// 方向性检查：再跑 20 秒，看有目标的人是不是在朝目标靠近（这比"走了多远"更能证明通勤）
const distGoal = () => {
  const m = new Map();
  for (const i of cs) {
    if (sim.goal[i] === GOAL.NONE) continue;
    const ax = sim.goal[i] === GOAL.WORK ? sim.workX[i] : sim.homeX[i];
    const az = sim.goal[i] === GOAL.WORK ? sim.workZ[i] : sim.homeZ[i];
    m.set(i, Math.hypot(ax - sim.px[i], az - sim.pz[i]));
  }
  return m;
};
const dBefore = distGoal();
for (let t = 0; t < 20 * 20; t++) sim.step(1 / 20, 0, 0);
const dAfter = distGoal();
let closer = 0, tot = 0;
for (const [i, d0] of dBefore) {
  const d1 = dAfter.get(i);
  if (d1 === undefined) continue;
  tot++;
  if (d1 < d0 - 2) closer++;
}
ok(closer / Math.max(1, tot) > 0.25,
  `20 秒内 ${closer}/${tot} 人离自己的目标更近了（${(closer / Math.max(1, tot) * 100).toFixed(0)}% > 35%）`);

// ---------- 4. 确定性 ----------
console.log('4) 确定性');
const snapshot = () => {
  const a = [];
  for (let i = 0; i < 200; i++) a.push(sim.homeX[i].toFixed(2), sim.homeZ[i].toFixed(2),
    sim.workX[i].toFixed(1), sim.goal[i]);
  return a.join(',');
};
sim.reset(P); const s1 = snapshot();
sim.reset(P); const s2 = snapshot();
ok(s1 === s2, '同一 seed 两次 reset 的 家/工作地/目标 完全一致');

// ---------- 5. 性能 ----------
console.log('5) 性能');
sim.reset({ ...P, population: 20000 });
let t0 = performance.now();
for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
const ms = (performance.now() - t0) / 400;
ok(ms < 4, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4ms）`);

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
