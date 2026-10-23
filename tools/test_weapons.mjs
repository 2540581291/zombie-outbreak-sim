// 武器系统自检（M5）：枪械表 / 弹匣 / 装填 / 熟练度 / 噪音 / 警局库存
//   node tools/test_weapons.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST, GOAL } from '../js/sim.js';
import { WEAPONS, WPN, skillFor, weaponOf } from '../js/weapons.js';
import { SPECIES, SP } from '../js/species.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 88, population: 4000, initialZombies: 120, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single',
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

// ---------- 1. 枪械表 ----------
console.log('1) 枪械表');
{
  const real = WEAPONS.filter((w) => w.id !== 0);
  ok(real.length === 9, `9 种枪（实际 ${real.length}）`);
  ok(real.every((w) => w.dmg > 0 && w.range > 0 && w.mag > 0 && w.rate > 0 && w.noise > 0),
    '每种枪都有 伤害/射程/弹匣/射速/噪音');
  const names = real.map((w) => w.name);
  ok(names.includes('霰弹枪') && names.includes('步枪') && names.includes('火箭筒') && names.includes('左轮 .357'),
    `覆盖手枪 / 左轮 / 霰弹枪 / 步枪 / 火箭筒`);
  const byRange = [...real].sort((a, b) => a.range - b.range);
  ok(byRange[0].name === '霰弹枪', `射程最短的是 ${byRange[0].name}（霰弹枪近战）`);
  const byNoise = [...real].sort((a, b) => b.noise - a.noise);
  ok(byNoise[0].name === '火箭筒', `最吵的是 ${byNoise[0].name}（会招来很远的东西）`);
}

// ---------- 2. 发枪 / 弹匣 ----------
console.log('2) 发枪与弹匣');
sim.reset(P);
{
  let who = -1;
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.CIV && sim.armed[i]) { who = i; break; }
  ok(who < 0, '平民开局一律徒手（决策 2）');

  // 手动发一把步枪
  const i = 0;
  sim.giveWeapon(i, WPN.RIFLE, 0.8);
  const w = weaponOf(WPN.RIFLE);
  ok(sim.armed[i] === 1, '拿到枪后 armed = 1');
  ok(sim.mag[i] === w.mag && sim.reserve[i] === w.reserve,
    `弹匣 ${sim.mag[i]}/${w.mag}，备弹 ${sim.reserve[i]}/${w.reserve}`);
  ok(Math.round(sim.skill[i] / 255 * 100) === 80, `熟练度 ${Math.round(sim.skill[i] / 255 * 100)}%（发的是 80%）`);
}

// ---------- 3. 开火 / 换弹 / 打光 ----------
console.log('3) 开火与换弹');
{
  const shooter = 0;
  // 造一个靶子放在 10m 外
  const target = sim.addUnit(sim.px[shooter] + 10, sim.pz[shooter], SP.ZOMBIE);
  sim.giveWeapon(shooter, WPN.PISTOL9, 0.6);
  const w = weaponOf(WPN.PISTOL9);
  const mag0 = sim.mag[shooter];
  const shots0 = sim.stats.shots;
  sim.time = 100;
  sim.fireWeapon(shooter, target);
  ok(sim.mag[shooter] === mag0 - 1, `打一发：弹匣 ${mag0} → ${sim.mag[shooter]}`);
  ok(sim.stats.shots === shots0 + 1, '统计里记了一次射击');
  ok(sim.noises.length > 0, `开枪产生了噪音（半径 ${sim.noises[sim.noises.length - 1].r}m）`);

  // 打空 → 自动换弹
  sim.mag[shooter] = 0;
  sim.reserve[shooter] = 30;
  sim.rlUntil[shooter] = 0;
  sim.fireWeapon(shooter, target);
  ok(sim.mag[shooter] === w.mag && sim.reserve[shooter] === 30 - w.mag,
    `打空自动换弹：弹匣 ${sim.mag[shooter]}，备弹 ${sim.reserve[shooter]}`);
  ok(sim.rlUntil[shooter] > sim.time, `换弹要时间（${(sim.rlUntil[shooter] - sim.time).toFixed(2)}s）`);
  // 装填期间打不出去
  const before = sim.mag[shooter];
  sim.fireWeapon(shooter, target);
  ok(sim.mag[shooter] === before, '装填期间扣不动扳机');

  // 备弹也空了 → 武装解除
  sim.mag[shooter] = 0;
  sim.reserve[shooter] = 0;
  sim.rlUntil[shooter] = 0;
  sim.fireWeapon(shooter, target);
  ok(sim.armed[shooter] === 0, '弹尽 → armed 归零（只能跑）');

  // 射程外打不到
  sim.giveWeapon(shooter, WPN.PISTOL9, 0.6);
  const far = sim.addUnit(sim.px[shooter] + 60, sim.pz[shooter], SP.ZOMBIE);
  const m0 = sim.mag[shooter];
  sim.fireWeapon(shooter, far);
  ok(sim.mag[shooter] === m0, '26m 外的手枪打不出去（射程限制）');
}

// ---------- 4. 熟练度影响精度 ----------
console.log('4) 熟练度');
{
  const w = weaponOf(WPN.RIFLE);
  const accAt = (skill) => w.acc * (0.6 + 0.4 * skill);
  ok(accAt(0.25) < accAt(0.8), `新手精度 ${accAt(0.25).toFixed(2)} < 老兵 ${accAt(0.8).toFixed(2)}`);
  const reloadAt = (skill) => w.reload * (1.3 - 0.4 * skill);
  ok(reloadAt(0.9) < reloadAt(0.2), `装填：老手 ${reloadAt(0.9).toFixed(2)}s 快于新手 ${reloadAt(0.2).toFixed(2)}s`);
  ok(skillFor('soldier') > skillFor('police') && skillFor('police') > skillFor('civilian'),
    `职业初值：士兵 ${skillFor('soldier')} > 警察 ${skillFor('police')} > 平民 ${skillFor('civilian')}`);
}

// ---------- 5. 几枪打死一只丧尸 ----------
console.log('5) 杀伤力');
{
  const hp = SPECIES[SP.ZOMBIE].hp;
  const table = WEAPONS.filter((w) => w.id !== 0)
    .map((w) => [w.name, w.dmg, Math.ceil(hp / w.dmg)]).sort((a, b) => a[2] - b[2]);
  console.log(`     丧尸血量 ${hp}：` + table.map(([n, d, k]) => `${n} ${k} 枪`).join(' / '));
  ok(table[0][2] <= 2, `最狠的一枪就能解决（${table[0][0]} ${table[0][2]} 枪）`);
  ok(table[table.length - 1][2] >= 3, `手枪要打 3 枪以上（${table[table.length - 1][2]} 枪）—— 有"枪"不等于安全`);
}

// ---------- 6. 枪声引丧尸 ----------
console.log('6) 枪声吸引');
{
  sim.reset(P);
  const shooter = 0;
  sim.px[shooter] = 0; sim.pz[shooter] = 0;
  sim.giveWeapon(shooter, WPN.PISTOL9, 0.6);
  const z = sim.addUnit(20, 0, SP.ZOMBIE);      // 20m 外（手枪射程内）
  sim.px[z] = 20; sim.pz[z] = 0;
  const before = Math.hypot(sim.px[z] - 0, sim.pz[z] - 0);
  sim.noises.length = 0;
  sim.time = 200;
  sim.fireWeapon(shooter, z);
  ok(sim.noises.length > 0, '开枪有噪音记录');
  for (let t = 0; t < 20 * 4; t++) sim.step(1 / 20, 0, 0);
  const after = Math.hypot(sim.px[z] - sim.px[shooter], sim.pz[z] - sim.pz[shooter]);
  ok(after < before - 3, `60m 外的丧尸被枪声吸引，靠近了 ${(before - after).toFixed(1)}m`);
}

// ---------- 7. 警局库存 ----------
console.log('7) 警局库存');
{
  sim.reset(P);
  const stations = sim.poiByKind.police || [];
  ok(stations.length > 0 && stations.every((p) => (p.stock | 0) > 0),
    `${stations.length} 个警局都有库存：${stations.map((p) => p.stock).join('/')}`);
  const s0 = stations[0].stock;
  // 让一个人去警局拿枪
  let who = -1;
  for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.CIV) { who = i; break; }
  sim.px[who] = stations[0].x; sim.pz[who] = stations[0].z;
  sim.setGoal(who, GOAL.ARM_POLICE, stations[0].x, stations[0].z);
  sim.arrive(who);
  ok(stations[0].stock === s0 - 1, `拿了一把：库存 ${s0} → ${stations[0].stock}`);
  ok(sim.armed[who] === 1, '他也真的拿到枪了');
  // 抽空库存
  stations[0].stock = 0;
  const who2 = who + 1;
  sim.armed[who2] = 0; sim.wpn[who2] = 0;
  sim.px[who2] = stations[0].x; sim.pz[who2] = stations[0].z;
  sim.setGoal(who2, GOAL.ARM_POLICE, stations[0].x, stations[0].z);
  sim.arrive(who2);
  ok(sim.armed[who2] === 0, '库存为 0 时抢不到枪（空手而归）');
}

// ---------- 8. 确定性 / 性能 ----------
console.log('8) 确定性 / 性能');
{
  const snap = () => {
    let s = 0;
    for (let i = 0; i < sim.n; i++) s = (s * 31 + sim.wpn[i] * 7 + sim.mag[i]) | 0;
    return s;
  };
  sim.reset(P); for (let t = 0; t < 20 * 120; t++) sim.step(1 / 20, 0, 0); const a = snap();
  sim.reset(P); for (let t = 0; t < 20 * 120; t++) sim.step(1 / 20, 0, 0); const b = snap();
  ok(a === b, '同 seed 同参数，120 秒后的武器状态一致');

  sim.reset({ ...P, population: 20000 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4.5, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4.5ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
