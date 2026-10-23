// 家庭系统自检（M2）：分组 / 同姓 / 关系 / 旅客 / 独居 / 确定性
//   node tools/test_family.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
import { Sim, ST } from '../js/sim.js';
import { membersOf, kinText, ageOfAgent } from '../js/family.js';
import { profileFor } from '../js/people.js';
import { ageOf } from '../js/profiles.js';

const city = loadCity();
const nav = await loadCollision(city);
const sim = new Sim(nav, city);

const P = {
  seed: 777, population: 12000, initialZombies: 60, zombieSpeed: 2.0,
  infectTime: 8, armedRate: 0.1, police: 60, policeAccuracy: 0.3,
  dogs: 0, cats: 0, bears: 0, tigers: 0, animalInfected: 0, mode: 'single',
};
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

sim.reset(P);
const civs = sim.civAt;

// ---------- 1. 分组 ----------
console.log('1) 家庭分组');
{
  let total = 0, bySize = [0, 0, 0, 0, 0, 0], bad = 0;
  for (let hid = 0; hid < sim.nHh; hid++) {
    const mem = membersOf(sim, hid);
    total += mem.length;
    if (mem.length < 1 || mem.length > 5) bad++;
    bySize[mem.length]++;
  }
  ok(bad === 0, `家庭规模全部在 1–5 人（异常 ${bad}）`);
  ok(total === civs.length, `成员总数 ${total} = 平民数 ${civs.length}（没有漏掉或重复）`);
  const pct = (n) => (n / Math.max(1, sim.nHh) * 100).toFixed(0);
  const want = [10, 30, 28, 22, 10];
  const got = [1, 2, 3, 4, 5].map((n) => bySize[n] / Math.max(1, sim.nHh) * 100);
  console.log(`     规模分布 ${got.map((v) => v.toFixed(0)).join('/')}%（目标 ${want.join('/')}%）`);
  ok(got.every((v, k) => Math.abs(v - want[k]) < 8), '规模分布与目标分布相符（每档误差 < 8 个点）');
  console.log(`     1 人户 ${bySize[1]}（${pct(bySize[1])}%），家庭总数 ${sim.nHh}`);
}

// ---------- 2. 同户同姓、不重名 ----------
console.log('2) 同姓 / 不重名');
{
  let badSur = 0, badName = 0;
  for (let hid = 0; hid < sim.nHh; hid++) {
    const mem = membersOf(sim, hid);
    const names = mem.map((i) => profileFor(sim, i).name);
    const sur = new Set(names.map((n) => n.split('·')[1]));
    if (sur.size > 1) badSur++;
    if (new Set(names).size !== names.length) badName++;
  }
  ok(badSur === 0, `同户同姓（异常 ${badSur} 户）`);
  ok(badName === 0, `同户不重名（异常 ${badName} 户）`);
}

// ---------- 3. 同户同住址 ----------
console.log('3) 住址共享');
{
  let bad = 0, worst = 0;
  for (let hid = 0; hid < sim.nHh; hid++) {
    const mem = membersOf(sim, hid);
    if (mem.length < 2) continue;
    // 旅客没有共同住址
    if (sim.tourist[mem[0]]) continue;
    const x0 = sim.homeX[mem[0]], z0 = sim.homeZ[mem[0]];
    for (const i of mem) {
      const d = Math.hypot(sim.homeX[i] - x0, sim.homeZ[i] - z0);
      worst = Math.max(worst, d);
      if (d > 6) { bad++; break; }
    }
  }
  ok(bad === 0, `同户住址相距 ≤ 6m（异常 ${bad} 户，最大 ${worst.toFixed(1)}m）`);
}

// ---------- 4. 旅客 / 独居 ----------
console.log('4) 旅客与独居');
{
  let tour = 0, single = 0;
  for (const i of civs) {
    if (sim.tourist[i]) { tour++; continue; }
  }
  for (let hid = 0; hid < sim.nHh; hid++) {
    const mem = membersOf(sim, hid);
    if (mem.length === 1 && !sim.tourist[mem[0]]) single++;   // 独居 ≠ 旅客
  }
  const tp = tour / civs.length * 100, sp = single / sim.nHh * 100;
  ok(Math.abs(tp - 3) < 1.5, `旅客 ${tp.toFixed(1)}%（目标 3%）`);
  ok(Math.abs(sp - 10) < 5, `单人户 ${sp.toFixed(1)}%（目标 10%）`);
  // 旅客没有家属
  let bad = 0;
  for (const i of civs) {
    if (!sim.tourist[i]) continue;
    if (membersOf(sim, sim.hh[i]).length !== 1) bad++;
  }
  ok(bad === 0, `旅客都是独自一户（异常 ${bad}）`);
}

// ---------- 5. 关系合理 ----------
console.log('5) 关系推断');
{
  let coupleOk = 0, coupleBad = 0, kidOk = 0, kidBad = 0;
  for (let hid = 0; hid < sim.nHh; hid++) {
    const mem = membersOf(sim, hid);
    if (sim.tourist[mem[0]] || mem.length < 2) continue;
    const ages = mem.map((i) => ageOfAgent(sim, i, ageOf));
    const adults = mem.filter((i, k) => ages[k] >= 18);
    if (adults.length >= 2) {
      const d = Math.abs(ageOfAgent(sim, adults[0], ageOf) - ageOfAgent(sim, adults[1], ageOf));
      if (d < 15) coupleOk++; else coupleBad++;
    }
    for (let k = 0; k < mem.length; k++) {
      if (ages[k] >= 18) continue;
      const hasParent = mem.some((j, m) => j !== mem[k] && ages[m] >= 18
        && ages[m] - ages[k] >= 17);
      if (hasParent) kidOk++; else kidBad++;
    }
  }
  ok(coupleBad === 0 || coupleOk > coupleBad * 8,
    `成年两人户里 ${coupleOk} 户年龄差 < 15（配偶），${coupleBad} 户像室友`);
  ok(kidBad === 0, `每个未成年人都有一位成年家属且相差 ≥ 17 岁（异常 ${kidBad}）`);
}

// ---------- 6. 档案文案 ----------
console.log('6) 档案里的家庭文案');
{
  const samples = [];
  for (let k = 0; k < 300; k++) {
    const i = civs[(k * 37) % civs.length];
    samples.push(kinText(sim, i, (j) => ageOfAgent(sim, j, ageOf), (j) => profileFor(sim, j).name));
  }
  const kinds = { 配偶: 0, 子女: 0, 父母: 0, 独居: 0, 旅客: 0, 家人: 0 };
  for (const t of samples) for (const k of Object.keys(kinds)) if (t.includes(k)) kinds[k]++;
  console.log(`     抽样 300 人：${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  ok(samples.every((t) => t && t.length > 0), '文案都不为空');
  ok(kinds.配偶 > 0 && kinds.子女 > 0, '既有配偶也有子女（说明关系推断在工作）');
  ok(kinds.独居 > 0 || kinds.旅客 > 0, '独居 / 旅客 也出现了');
}

// ---------- 7. 确定性 ----------
console.log('7) 确定性');
{
  const snap = () => {
    const a = [];
    for (let hid = 0; hid < Math.min(300, sim.nHh); hid++) {
      for (const i of membersOf(sim, hid)) a.push(i, sim.hh[i], sim.age[i]);
    }
    return a.join(',');
  };
  sim.reset(P); const s1 = snap();
  sim.reset(P); const s2 = snap();
  ok(s1 === s2, '同一 seed 两次 reset 的家庭切分 / 年龄完全一致');
}

// ---------- 8. 性能 ----------
console.log('8) 性能');
{
  sim.reset({ ...P, population: 20000 });
  const t0 = performance.now();
  for (let t = 0; t < 400; t++) sim.step(1 / 20, 0, 0);
  const ms = (performance.now() - t0) / 400;
  ok(ms < 4, `20k 个体 tick ${ms.toFixed(2)}ms（预算 4ms）`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
