// ============================================================
//  指挥工具自检（node tools/test_tools.mjs）
// ============================================================
import { buildNav, Sim, ST } from '../js/sim.js';
import { TOOLS, TOOL_BY_ID } from '../js/tools.js';

const size = 900, bs = 46, st = 26;
const buildings = [];
for (let y = -size / 2 + st; y < size / 2 - bs; y += bs + st)
  for (let x = -size / 2 + st; x < size / 2 - bs; x += bs + st)
    buildings.push({ p: [[x, y], [x + bs, y], [x + bs, y + bs], [x, y + bs]], h: 12 });
const city = { name: 's', size: [size, size], buildings, roads: [], water: [], parks: [], trees: [] };
const nav = buildNav(city, 2);
const sim = new Sim(nav);

const P = {
  seed: 2024, population: 6000, initialZombies: 40, zombieSpeed: 1.7,
  infectTime: 6, armedRate: 0.1, police: 40, policeAccuracy: 0.3,
};
sim.reset(P);
const runTicks = (s, n) => { for (let i = 0; i < n; i++) s.step(1 / 20, 1e9, 1e9); };

const log = [];
const ok = (name, cond, extra = '') =>
  log.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

// ---------- 1. 工具表完整性 ----------
ok('工具数量 = 13（含查看）', TOOLS.length === 13, `实际 ${TOOLS.length}`);
ok('每个工具有 apply', TOOLS.every(t => typeof t.apply === 'function'));

// ---------- 2. 预算与冷却 ----------
sim.reset(P);
const before = sim.budget;
const tool = TOOL_BY_ID.police;
ok('初始买得起警察', sim.canUse(tool));
sim.spend(tool);
ok('扣点数', Math.abs(sim.budget - (before - tool.cost)) < 1e-6, `${sim.budget.toFixed(1)}`);
ok('冷却生效', sim.cd[tool.id] > 0 && !sim.canUse(tool));
runTicks(sim, 20 * 8);
ok('冷却会走完', sim.cd[tool.id] === 0);
ok('点数会回复', sim.budget > before - tool.cost, `${sim.budget.toFixed(1)}`);

// ---------- 3. 部署 ----------
sim.reset(P);
const n0 = sim.n;
sim.deploy('police', 0, 0, 6);
sim.deploy('swat', 20, 0, 4);
sim.deploy('soldier', -20, 0, 8);
ok('部署增加个体', sim.n === n0 + 18, `${n0} -> ${sim.n}`);
let pol = 0, sol = 0;
for (let i = n0; i < sim.n; i++) {
  if (sim.state[i] === ST.POLICE) pol++;
  if (sim.state[i] === ST.SOLDIER) sol++;
}
ok('警察/特警计数', pol === 10, `police=${pol}`);
ok('士兵计数', sol === 8, `soldier=${sol}`);
ok('士兵命中率更高', (() => {
  let a = 0; for (let i = n0; i < sim.n; i++) if (sim.state[i] === ST.SOLDIER) a = sim.acc[i];
  return a > 0.6;
})());
ok('部署的兵有弹药', (() => {
  for (let i = n0; i < sim.n; i++) if (sim.ammo[i] <= 0) return false;
  return true;
})());

// ---------- 4. 直升机撤离 ----------
sim.reset(P);
runTicks(sim, 20 * 3);
const savedBefore = sim.saved;
sim.helicopter(0, 0);
ok('直升机入场', sim.helis.length === 1);
runTicks(sim, 20 * 6);
ok('直升机有救人', sim.saved > savedBefore, `救出 ${sim.saved}`);
ok('直升机离场', sim.helis.length === 0);
let ghost = 0;
for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.SAVED) ghost++;
ok('被救个体变成 SAVED', ghost === sim.saved, `saved=${sim.saved} ghosts=${ghost}`);

// ---------- 5. 疫苗 ----------
sim.reset(P);
// 手动制造 30 个潜伏者
let inf = 0;
for (let i = 0; i < sim.n && inf < 30; i++) {
  if (sim.state[i] === ST.CIV) { sim.state[i] = ST.INFECTED; sim.timer[i] = 999; inf++; 
    sim.px[i] = 0 + (inf % 5) * 3; sim.pz[i] = (inf % 7) * 3; }
}
const curedN = sim.vaccine(6, 6, 80);
ok('疫苗治愈了潜伏者', curedN > 0, `治愈 ${curedN}`);

// ---------- 6. 路障 ----------
sim.reset(P);
let blocked = 0;
for (let i = 0; i < nav.grid.length; i++) if (nav.grid[i] === 0) blocked++;
const made = sim.barricade(0, 0, Math.PI / 2);
let after = 0;
for (let i = 0; i < nav.grid.length; i++) if (nav.grid[i] === 0) after++;
ok('路障写入栅格', made > 50 && after === blocked + made, `新增 ${made} 格`);
sim.reset(P);
let restored = 0;
for (let i = 0; i < nav.grid.length; i++) if (nav.grid[i] === 0) restored++;
ok('重开后栅格恢复', restored === blocked, `${restored} vs ${blocked}`);

// ---------- 7. 火区 / 警报 / 广播 ----------
sim.reset(P);
sim.fire(0, 0, 40, 5);
sim.siren(100, 100, 200, 5);
sim.rally(-100, -100, 120, 5);
ok('三个持续效果已注册', sim.effects.length === 3);
runTicks(sim, 20 * 6);
ok('效果到期自动清除', sim.effects.length === 0, `剩 ${sim.effects.length}`);

// 火区确实会烧死丧尸
sim.reset(P);
let zBefore = sim.stats.zombie;
sim.fire(sim.origin[0], sim.origin[1], 60, 6);
runTicks(sim, 20 * 6);
ok('火区烧掉丧尸', sim.stats.zombie < zBefore, `${zBefore} -> ${sim.stats.zombie}`);

// ---------- 8. 弹药补给 ----------
sim.reset(P);
for (let i = 0; i < sim.n; i++) if (sim.state[i] === ST.POLICE) sim.ammo[i] = 0;
const fed = sim.resupply(0, 0, 999);
ok('补给补到了人', fed > 0, `${fed} 人`);

// ---------- 9. 全部工具都能真实调用一遍 ----------
sim.reset(P);
let crashed = null;
for (const t of TOOLS) {
  try {
    sim.budget = 999; sim.cd = {};
    sim.spend(t);
    t.apply(sim, 0, 0, { angle: 0.7 });
  } catch (e) { crashed = t.id + ': ' + e.message; }
}
ok('12 个工具全部可执行', !crashed, crashed || '');
runTicks(sim, 20 * 10);
ok('大量特效下不崩', true);

console.log(log.join('\n'));
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails}/${log.length} 通过`);
process.exit(fails ? 1 : 0);

