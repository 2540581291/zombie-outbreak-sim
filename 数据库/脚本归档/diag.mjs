import { buildNav, Sim, ST } from '../js/sim.js';

const size = 900, bs = 46, st = 26;
const buildings = [];
for (let y = -size / 2 + st; y < size / 2 - bs; y += bs + st)
  for (let x = -size / 2 + st; x < size / 2 - bs; x += bs + st)
    buildings.push({ p: [[x, y], [x + bs, y], [x + bs, y + bs], [x, y + bs]], h: 12 });

const city = { name: 's', size: [size, size], buildings, roads: [], water: [], parks: [], trees: [] };
const nav = buildNav(city, 2);
const sim = new Sim(nav);

for (const zspd of [1.2, 1.6, 2.0, 2.6]) {
  const P = {
    seed: 5, population: 4000, initialZombies: 60, zombieSpeed: zspd,
    infectTime: 6, armedRate: 0, police: 0, policeAccuracy: 0,
  };
  sim.reset(P);
  let z0 = 0;
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.ZOMBIE) z0++;
  let line = `zspd=${zspd} spawn zombies=${z0} `;
  for (let t = 1; t <= 6; t++) {
    for (let i = 0; i < 20 * 30; i++) sim.step(1 / 20, 1e9, 1e9);
    let withTgt = 0, sumD = 0;
    for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.ZOMBIE && sim.tgt[i] >= 0) {
      withTgt++;
      sumD += Math.hypot(sim.px[sim.tgt[i]] - sim.px[i], sim.pz[sim.tgt[i]] - sim.pz[i]);
    }
    line += `| ${t * 30}s z=${sim.stats.zombie} inf=${sim.stats.infected} ` +
      `tgt=${withTgt} d=${withTgt ? (sumD / withTgt).toFixed(1) : 0} `;
  }
  console.log(line);
}
