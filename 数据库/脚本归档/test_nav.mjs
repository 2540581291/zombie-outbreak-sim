// 行为验证：绕墙/走门是否真的生效
import { loadCity } from './_city.mjs';
import { loadCollision, CL } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
const P = {
  seed: 20251022, population: 20000, initialZombies: 80, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 40, policeAccuracy: 0.3,
};
sim.reset(P);

const N = sim.n;
const passedDoor = new Uint8Array(N);   // 穿过了门
const everStuck = new Uint8Array(N);
let totalMoved = 0, totalBlocked = 0;

const doorVal = (i) => {
  const c = ((sim.px[i] + nav.halfW) / nav.cell) | 0;
  const r = ((sim.pz[i] + nav.halfH) / nav.cell) | 0;
  return nav.grid[r * nav.cols + c];
};

const TICKS = 20 * 90;   // 90 秒
const t0 = performance.now();
const samples = [];
for (let t = 0; t < TICKS; t++) {
  sim.step(1 / 20, 0, 0);
  if (t % 4 === 0) {
    for (let i = 0; i < N; i++) {
      const st = sim.state[i];
      if (st === ST.CORPSE || st === ST.SAVED) continue;
      if (doorVal(i) === CL.DOOR) passedDoor[i] = 1;
      if (sim.stuck[i] > 0) everStuck[i] = 1;
      if (sim.stuck[i] > 0) totalBlocked++; else totalMoved++;
    }
  }
  if (t % 200 === 0) {
    let ci = 0, zi = 0, civ = 0, zb = 0;
    for (let i = 0; i < N; i++) {
      const st = sim.state[i];
      if (st === ST.CORPSE || st === ST.SAVED) continue;
      const indoor = (doorVal(i) & CL.INDOOR) === CL.INDOOR;
      if (st === ST.ZOMBIE) { zb++; if (indoor) zi++; } else { civ++; if (indoor) ci++; }
    }
    samples.push(`  t=${String(Math.round(t / 20)).padStart(3)}s  平民 ${civ}（室内 ${ci}）  丧尸 ${zb}（室内 ${zi}）`);
  }
}
const dt = performance.now() - t0;

let pd = 0, es = 0;
for (let i = 0; i < N; i++) { pd += passedDoor[i]; es += everStuck[i]; }

console.log(`跑了 ${TICKS / 20} 秒  平均 ${(dt / TICKS).toFixed(2)}ms/tick`);
console.log(samples.join('\n'));
console.log(`\n穿过门洞的个体：${pd} / ${N}  (${(pd / N * 100).toFixed(1)}%)`);
console.log(`曾经卡住过的个体：${es} / ${N}  (${(es / N * 100).toFixed(2)}%)`);
console.log(`移动 vs 被墙挡的比例：${(totalMoved / (totalMoved + totalBlocked) * 100).toFixed(1)}% 在动`);
console.log(`最终：平民 ${sim.stats.civ} 潜伏 ${sim.stats.infected} 丧尸 ${sim.stats.zombie} 死亡 ${sim.stats.dead}`);
