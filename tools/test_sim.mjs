// ============================================================
//  ZOS-R · 无渲染自检：模拟内核跑批（node tools/test_sim.mjs）
// ============================================================
import { buildNav, Sim } from '../js/sim.js';

function makeCity(size = 1400, blockSize = 46, street = 26) {
  // 合成街区：规则的矩形建筑阵列
  const [W, H] = [size, size];
  const buildings = [];
  for (let y = -H / 2 + street; y < H / 2 - blockSize; y += blockSize + street) {
    for (let x = -W / 2 + street; x < W / 2 - blockSize; x += blockSize + street) {
      const w = blockSize, h = blockSize;
      buildings.push({
        p: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        h: 12 + ((x * 7 + y * 13) % 17 + 17) % 17,
      });
    }
  }
  return {
    name: 'synthetic',
    size: [W, H],
    buildings,
    roads: [],
    water: [],
    parks: [],
    trees: [],
  };
}

const city = makeCity();
const t0 = performance.now();
const nav = buildNav(city, 2);
const tNav = performance.now() - t0;

let walkable = 0;
for (let i = 0; i < nav.grid.length; i++) if (nav.grid[i]) walkable++;

console.log(`nav: ${nav.cols}x${nav.rows} = ${(nav.cols * nav.rows).toLocaleString()} cells, ` +
  `walkable ${(walkable / nav.grid.length * 100).toFixed(1)}%, ${tNav.toFixed(0)}ms`);

const sim = new Sim(nav);

function run(pop, police, z0, label) {
  const P = { seed: 12345, population: pop, initialZombies: z0, police, homeGunRate: 0.12 };
  const tA = performance.now();
  sim.reset(P);
  const tReset = performance.now() - tA;
  const n0 = sim.n;

  const TICKS = 400; // 20 秒
  const tB = performance.now();
  for (let i = 0; i < TICKS; i++) sim.step(1 / 20, 0, 0);
  const tStep = performance.now() - tB;

  const s = sim.stats;
  console.log(
    `[${label}] agents=${n0.toLocaleString()} reset=${tReset.toFixed(0)}ms  ` +
    `tick=${(tStep / TICKS).toFixed(2)}ms  ` +
    `(${(n0 * 20 / 1000 / (tStep / TICKS) * 1).toFixed(0)}k upd/s)  ` +
    `civ=${s.civ} inf=${s.infected} zomb=${s.zombie} dead=${s.dead} police=${s.police}`
  );
  return { tStep, n0 };
}

// 小规模
run(12000, 80, 30, '12k');
// 目标规模
run(45000, 200, 60, '45k');
// 压力
run(60000, 300, 80, '60k');

// 确定性检查
const { createHash } = await import('node:crypto');
function hashState() {
  const h = createHash('sha1');
  const buf = Buffer.from(sim.px.buffer, 0, sim.n * 4);
  h.update(buf);
  const buf2 = Buffer.from(sim.state.buffer, 0, sim.n);
  h.update(buf2);
  return h.digest('hex').slice(0, 12);
}
const P = {
  seed: 777, population: 20000, initialZombies: 40, police: 100, homeGunRate: 0.1,
};
sim.reset(P); for (let i = 0; i < 200; i++) sim.step(1 / 20, 0, 0);
const h1 = hashState();
sim.reset(P); for (let i = 0; i < 200; i++) sim.step(1 / 20, 0, 0);
const h2 = hashState();
console.log(`determinism: ${h1} vs ${h2} -> ${h1 === h2 ? 'PASS ✓' : 'FAIL ✗'}`);
