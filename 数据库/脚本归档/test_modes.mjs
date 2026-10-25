// 爆发模式自检：六种模式的出生点分布是否符合预期
//   node tools/test_modes.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { SP } from '../js/species.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
const base = {
  seed: 2025, population: 12000, initialZombies: 120, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0,
};
const halfW = nav.halfW, halfH = nav.halfH;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

const zombies = () => {
  const out = [];
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.ZOMBIE) out.push(i);
  return out;
};
const stats = (list, get) => {
  const v = list.map(get);
  const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length));
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v) };
};

// ---------- single ----------
console.log('1) 单点爆发');
sim.reset({ ...base, mode: 'single' });
let z = zombies();
ok(Math.abs(z.length - 120) <= 40, `丧尸 ${z.length}（≈120）`);
{
  const sx = stats(z, (i) => sim.px[i]);
  ok(sx.sd < 45, `x 标准差 ${sx.sd.toFixed(1)}m（聚集，应 < 45）`);
}

// ---------- invade ----------
console.log('2) 僵尸入侵（四个方向）');
for (const [dir, where] of [['N', '北'], ['S', '南'], ['E', '东'], ['W', '西']]) {
  sim.reset({ ...base, mode: 'invade', invadeDir: dir });
  z = zombies();
  const sx = stats(z, (i) => sim.px[i]);
  const sz = stats(z, (i) => sim.pz[i]);
  let pass;
  if (dir === 'N') pass = sz.mean < -halfH * 0.5;
  if (dir === 'S') pass = sz.mean > halfH * 0.5;
  if (dir === 'E') pass = sx.mean > halfW * 0.5;
  if (dir === 'W') pass = sx.mean < -halfW * 0.5;
  ok(pass && z.length > 60,
    `${where}：${z.length} 只，质心 x=${sx.mean.toFixed(0)} z=${sz.mean.toFixed(0)}（地图 ±${halfW.toFixed(0)} / ±${halfH.toFixed(0)}）`);
}

// ---------- multi ----------
console.log('3) 多点爆发');
sim.reset({ ...base, mode: 'multi', points: 4, perPoint: 30 });
z = zombies();
ok(Math.abs(z.length - 120) <= 50, `丧尸 ${z.length}（4×30=120）`);
{
  // 用 200m 网格数簇
  const cells = new Set();
  for (const i of z) cells.add(`${Math.round(sim.px[i] / 200)},${Math.round(sim.pz[i] / 200)}`);
  ok(cells.size >= 3, `散布在 ${cells.size} 个 200m 网格（应 ≥3）`);
  const sx = stats(z, (i) => sim.px[i]);
  // 4 个点位是随机撒的；单点爆发的 x 标准差约 30m，这里只要明显大于它即可
  ok(sx.sd > 150, `x 标准差 ${sx.sd.toFixed(0)}m（分散；单点约 30m，应 > 150）`);
}

// ---------- stealth ----------
console.log('4) 潜伏渗透');
sim.reset({ ...base, mode: 'stealth', carriers: 3 });
z = zombies();
let infected = 0;
for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.INFECTED) infected++;
ok(z.length === 0, `开场丧尸 ${z.length}（应为 0）`);
ok(infected >= 1 && infected <= 3, `零号病人 ${infected} 人（1–3，长潜伏）`);
{
  // 零号病人模式是长潜伏（10–30 分钟），3 分钟时应该还很安静
  for (let t = 0; t < 20 * 180; t++) sim.step(1 / 20, 0, 0);
  ok(zombies().length === 0, `3 分钟后丧尸 ${zombies().length}（长潜伏期，应为 0）`);
}

// ---------- waves ----------
console.log('5) 连环爆发');
sim.reset({ ...base, mode: 'waves', initialZombies: 40, waves: 3, waveInterval: 10, waveCount: 40 });
const z0 = zombies().length;
ok(Math.abs(z0 - 40) <= 25, `开场丧尸 ${z0}（≈40）`);
{
  for (let t = 0; t < 20 * 12; t++) sim.step(1 / 20, 0, 0);   // 12 秒
  const z1 = zombies().length;
  ok(z1 > z0 + 20, `12 秒后 ${z1}（应明显增多，波次在投放）`);
  ok(sim.origins.length >= 2, `爆发点 ${sim.origins.length} 个（应 ≥2）`);
}

// ---------- apocalypse ----------
console.log('6) 末日降临');
sim.reset({ ...base, mode: 'apocalypse', initialZombies: 600 });
z = zombies();
{
  const sx = stats(z, (i) => sim.px[i]);
  ok(z.length > 400, `丧尸 ${z.length}（≈600）`);
  ok(sx.sd > 500, `x 标准差 ${sx.sd.toFixed(0)}m（全城散布，应 > 500）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
