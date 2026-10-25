import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { SPECIES } from '../js/species.js';
const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 5, population: 20000, initialZombies: 150, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 240, cats: 160, bears: 3, tigers: 2, animalInfected: 0.15 });
const N = sim.n;
const cnt = {};
for (let i = 0; i < N; i++) {
  const k = sim.kind[i], st = sim.state[i];
  if (k < 12) continue;
  const key = `${SPECIES[k].name}/${st === 9 ? '野兽' : st === 4 ? '丧尸' : st === 7 ? '潜伏' : '平民'}`;
  cnt[key] = (cnt[key] || 0) + 1;
}
console.log('开局动物构成：', cnt);
for (let m = 1; m <= 3; m++) {
  for (let i = 0; i < 20 * 60; i++) sim.step(1/20, 0, 0);
  const c = {};
  for (let i = 0; i < sim.n; i++) {
    const k = sim.kind[i], st = sim.state[i];
    if (k < 12 || st === ST.CORPSE) continue;
    const key = `${SPECIES[k].name}/${st === 9 ? '野兽' : st === 4 ? '丧尸' : st === 7 ? '潜伏' : '平民'}`;
    c[key] = (c[key] || 0) + 1;
  }
  console.log(`${m} 分钟：`, c, ' 僵尸总数', sim.stats.zombie, ' 野兽', sim.stats.wild);
}
