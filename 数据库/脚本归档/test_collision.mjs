// 验证碰撞层接入后的模拟：不穿墙 / 有人进屋 / 视线被挡 / 确定性 / 性能
import { loadCity } from './_city.mjs';
import { loadCollision, collisionStats, CL } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';

const city = loadCity();

const t0 = performance.now();
const nav = await loadCollision(city);
const tLoad = performance.now() - t0;
if (!nav) { console.log('没有 collision 字段，先跑 pipeline/bake_pbf.py'); process.exit(1); }

const st = collisionStats(nav);
console.log(`碰撞层 ${nav.cols}×${nav.rows} @${nav.cell}m  加载 ${tLoad.toFixed(0)}ms`);
console.log(`  取值分布 ${st.text}`);

// ---- 视线抽查：随便找一对隔墙的点 ----
let blocked = 0, tested = 0;
for (let i = 0; i < 3000 && tested < 200; i++) {
  const x1 = (Math.random() - 0.5) * nav.W * 0.9;
  const z1 = (Math.random() - 0.5) * nav.H * 0.9;
  const x2 = (Math.random() - 0.5) * nav.W * 0.9;
  const z2 = (Math.random() - 0.5) * nav.H * 0.9;
  if (Math.hypot(x2 - x1, z2 - z1) < 60) continue;
  tested++;
  if (!nav.los(x1, z1, x2, z2)) blocked++;
}
console.log(`  视线抽查 ${tested} 对：被挡 ${blocked} 对 (${(blocked / tested * 100).toFixed(0)}%)`);

// ---- 室内点占比 ----
let inCells = 0, walkCells = 0;
for (let i = 0; i < nav.grid.length; i++) {
  if (nav.grid[i] & 1) { walkCells++; if ((nav.grid[i] & CL.INDOOR) === CL.INDOOR) inCells++; }
}
console.log(`  可走格 ${walkCells.toLocaleString()}，其中室内 ${inCells.toLocaleString()} (${(inCells / walkCells * 100).toFixed(1)}%)`);

// ---- 跑模拟 ----
const sim = new Sim(nav);
const P = {
  seed: 4242, population: 20000, initialZombies: 60, zombieSpeed: 1.6,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
};
sim.reset(P);

// 出生点统计
let indoorSpawn = 0;
for (let i = 0; i < sim.n; i++) if (nav.indoor(sim.px[i], sim.pz[i])) indoorSpawn++;
console.log(`  出生 ${sim.n} 人，其中在室内 ${indoorSpawn} (${(indoorSpawn / sim.n * 100).toFixed(1)}%)`);

const TICKS = 400;
const tA = performance.now();
for (let i = 0; i < TICKS; i++) sim.step(1 / 20, 0, 0);
const tStep = performance.now() - tA;
console.log(`  tick 平均 ${(tStep / TICKS).toFixed(2)}ms  (${TICKS} 步 / ${(TICKS / 20).toFixed(0)} 秒)`);

// ---- 穿墙检查：所有活人必须站在可走格上 ----
let inWall = 0;
for (let i = 0; i < sim.n; i++) {
  if (sim.state[i] === ST.CORPSE || sim.state[i] === ST.SAVED) continue;
  if (!nav.walkable(sim.px[i], sim.pz[i])) inWall++;
}
console.log(`  站在墙里的活体：${inWall} 个 ${inWall === 0 ? '✓' : '✗ 有穿墙！'}`);

const s = sim.stats;
console.log(`  20 秒后：平民 ${s.civ} 潜伏 ${s.infected} 丧尸 ${s.zombie} 死亡 ${s.dead}`);

// ---- 确定性 ----
const crypto = await import('node:crypto');
function hash() {
  const h = crypto.createHash('sha1');
  h.update(Buffer.from(sim.px.buffer, 0, sim.n * 4));
  h.update(Buffer.from(sim.state.buffer, 0, sim.n));
  return h.digest('hex').slice(0, 12);
}
sim.reset(P); for (let i = 0; i < 200; i++) sim.step(1 / 20, 0, 0);
const h1 = hash();
sim.reset(P); for (let i = 0; i < 200; i++) sim.step(1 / 20, 0, 0);
const h2 = hash();
console.log(`  确定性 ${h1} vs ${h2} -> ${h1 === h2 ? 'PASS ✓' : 'FAIL ✗'}`);
