// 诊断：复现 retro.js 的动画选择逻辑，输出真实分布
import { readFileSync } from 'node:fs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { SP, SPECIES } from '../js/species.js';

const atlas = JSON.parse(readFileSync(new URL('../assets/retro/atlas.json', import.meta.url), 'utf8'));
const F = atlas.frames;

// ---- 1. 图集结构 ----
const sampleKeys = ['guy01/walk_solid', 'guy01/walk_outline', 'girl01/idle01_solid', 'fat01/zwalk01_solid'];
console.log('=== 图集结构 ===');
for (const k of sampleKeys) {
  const v = F[k];
  console.log(`  ${k.padEnd(22)} ${v ? `${v.length} 套变体 × ${v[0].length} 帧` : '缺失'}`);
}
const allSolid = Object.keys(F).filter(k => k.endsWith('_solid')).length;
const allOutline = Object.keys(F).filter(k => k.endsWith('_outline')).length;
console.log(`  solid ${allSolid} 个 key，outline ${allOutline} 个 key`);

// ---- 2. 复现选择逻辑 ----
const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];
const IDLE_BODIES = ['guy01', 'girl01'];
const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];
const TYPE_TO_SPRITE = {
  [SP.CIV1]: 'guy01', [SP.CIV2]: 'guy02', [SP.CIV3]: 'fat01',
  [SP.POLICE]: 'police01', [SP.SOLDIER]: 'police01', [SP.ELITE]: 'police01',
  [SP.ZOMBIE]: 'guy02', [SP.TANK]: 'fat01', [SP.CHARGER]: 'guy01',
  [SP.BOOMER]: 'fat01', [SP.SPITTER]: 'girl01', [SP.APC]: 'police01',
  [SP.DOG]: 'animals_dog', [SP.CAT]: 'animals_cat',
  [SP.BEAR]: 'animals_bear', [SP.TIGER]: 'animals_tiger',
};

function pickAnim(st, sim, i, isZ) {
  if (st === ST.CORPSE) return isZ ? 'zdie01' : 'die01';
  if (st === ST.ZOMBIE) {
    const tg = sim.tgt ? sim.tgt[i] : -1;
    if (tg >= 0) {
      const dx = sim.px[tg] - sim.px[i], dz = sim.pz[tg] - sim.pz[i];
      if (dx * dx + dz * dz < 3.2 * 3.2) return 'zattack01';
    }
    return 'zwalk01';
  }
  if (st === ST.INFECTED) return 'walk';
  if (st === ST.WILD) return 'walk';
  if (st === ST.FLEE) return 'run01';
  if (st === ST.FIGHT) return 'shoot01';
  if (st === ST.POLICE || st === ST.SOLDIER) {
    if (sim.tgt && sim.tgt[i] >= 0) return 'shoot01';
    return sim.idle && sim.idle[i] ? 'idle01' : 'walk';
  }
  if (sim.idle && sim.idle[i]) return (i & 1) ? 'idle02' : 'idle01';
  return 'walk';
}

function framesOf(type, anim) {
  for (const k of [`${type}/${anim}_solid`, `${type}/walk_solid`, `${type}/idle01_solid`,
                   `fat01/${anim}_solid`, 'fat01/walk_solid']) {
    if (F[k]) return k;
  }
  return null;
}

const city = JSON.parse(readFileSync(new URL('../data/cities/berlin/city.json', import.meta.url), 'utf8'));
const nav = await loadCollision(city);
const sim = new Sim(nav);
sim.reset({ seed: 1, population: 20000, initialZombies: 150, zombieSpeed: 2.0, infectTime: 8,
  armedRate: 0.1, police: 60, policeAccuracy: 0.3, dogs: 240, cats: 160, bears: 3, tigers: 2,
  animalInfected: 0.15 });
for (let i = 0; i < 400; i++) sim.step(1 / 20, 0, 0);

const ZOMBIE_ANIMS = new Set(['zwalk01', 'zattack01', 'zdie01', 'zrise01']);
const stat = {};
let civWithZombieAnim = 0, outlineHits = 0, miss = 0;
for (let i = 0; i < sim.n; i++) {
  const st = sim.state[i];
  if (st === ST.SAVED) continue;
  const kind = sim.kind[i];
  let sprType = TYPE_TO_SPRITE[kind] || 'guy01';
  if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
    const h = (i * 2654435761) >>> 0;
    sprType = CIV_BODIES[h % CIV_BODIES.length];
    if (sim.idle[i] && !F[sprType + '/idle01_solid']) sprType = IDLE_BODIES[h % IDLE_BODIES.length];
  }
  if (st === ST.ZOMBIE && kind === SP.ZOMBIE) {
    sprType = ZOMBIE_BODIES[i % ZOMBIE_BODIES.length];
  }
  const zk = (SPECIES[kind] || {}).zombieKind;
  if (zk && st === ST.ZOMBIE) sprType = zk;

  const anim = pickAnim(st, sim, i, st === ST.ZOMBIE);
  const key = framesOf(sprType, anim);
  if (!key) { miss++; continue; }
  if (key.includes('_outline')) outlineHits++;
  const isCiv = st === ST.CIV || st === ST.INFECTED || st === ST.FLEE || st === ST.FIGHT;
  if (isCiv && ZOMBIE_ANIMS.has(anim)) civWithZombieAnim++;
  const tag = `${sprType}/${anim}`;
  stat[tag] = (stat[tag] || 0) + 1;
}

console.log('\n=== 实际动画使用分布（前 16） ===');
Object.entries(stat).sort((a, b) => b[1] - a[1]).slice(0, 16)
  .forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v}`));
console.log(`\n平民用了丧尸动画: ${civWithZombieAnim}`);
console.log(`取不到帧: ${miss}`);
console.log(`命中 outline 变体: ${outlineHits}`);
