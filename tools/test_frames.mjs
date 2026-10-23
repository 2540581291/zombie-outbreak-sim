// 帧覆盖自检：确认渲染器要的每一组（体型 × 动画）在图集里都有，
// 并且 solid / outline 一一对齐（F3 切换不跳动作的前提）。
//   node tools/test_frames.mjs
import { readFileSync } from 'node:fs';

const atlas = JSON.parse(readFileSync(new URL('../assets/retro/atlas.json', import.meta.url), 'utf8'));
const F = atlas.frames;
const has = (k) => !!F[k];
// F[k] = [ [rect, rect, …] 每套变体 ] —— 比较要用「单套帧数」，不能把 5 套配色加在一起
const nVar = (k) => (Array.isArray(F[k][0]) ? F[k].length : 1);
const framesPer = (k) => (Array.isArray(F[k][0]) ? F[k][0].length : F[k].length);

let fail = 0;
const check = (ok, msg) => {
  if (!ok) { fail++; console.log('  ✗ ' + msg); }
};

// 与 js/retro.js 里的常量保持一致
const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];
const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];
const POLICE = 'police01';
const ANIMALS = ['animals_dog', 'animals_cat', 'animals_bear', 'animals_tiger'];
const ANIMALS_Z = ANIMALS.map((a) => a + '_z');

console.log('=== F1 站立帧：5 种平民体型都要有 idle01 / idle02 ===');
for (const b of CIV_BODIES) {
  for (const a of ['idle01', 'idle02']) {
    check(has(`${b}/${a}_solid`), `${b} 缺 ${a}_solid`);
  }
}

console.log('=== F2/F5 死亡与奔跑：平民/警察有 die01、动物有 die01 + run01 ===');
for (const b of [...CIV_BODIES, POLICE]) check(has(`${b}/die01_solid`), `${b} 缺 die01_solid`);
for (const b of ANIMALS) {
  check(has(`${b}/die01_solid`), `${b} 缺 die01_solid`);
  check(has(`${b}/run01_solid`), `${b} 缺 run01_solid`);
  check(has(`${b}/idle01_solid`), `${b} 缺 idle01_solid`);
}

console.log('=== F2 丧尸：4 种体型都要有 zwalk01 / zattack01 / zdie01 ===');
for (const b of ZOMBIE_BODIES) {
  for (const a of ['zwalk01', 'zattack01', 'zdie01']) {
    check(has(`${b}/${a}_solid`), `${b} 缺 ${a}_solid`);
  }
}

console.log('=== F3 对齐：每个 solid 动画都要有同帧数的 outline ===');
let pairs = 0;
for (const k of Object.keys(F)) {
  if (!k.endsWith('_solid')) continue;
  const ok = k.replace(/_solid$/, '_outline');
  if (!has(ok)) { check(false, `${k} 没有对应 outline`); continue; }
  const cs = framesPer(k), co = framesPer(ok);
  check(cs === co, `${k} 单套 ${cs} 帧 ≠ outline ${co} 帧（切换会跳帧）`);
  pairs++;
}

console.log('=== 变体数量：outline 必须只有 1 套（纯绿，不能被衣服配色染） ===');
for (const k of Object.keys(F)) {
  if (!k.endsWith('_outline')) continue;
  check(nVar(k) === 1, `${k} 有 ${nVar(k)} 套变体`);
}

console.log(`\n体型/动画对齐 ${pairs} 对，帧总数 ${atlas.count}，图集 ${atlas.w}×${atlas.h}`);
if (fail === 0) console.log('全部通过 ✓');
else { console.log(`${fail} 项失败 ✗`); process.exit(1); }
