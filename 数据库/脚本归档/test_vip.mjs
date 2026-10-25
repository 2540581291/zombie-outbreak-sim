import { buildNav, Sim, ST } from "../js/sim.js";
const size = 900, bs = 46, st = 26; const buildings = [];
for (let y=-size/2+st; y<size/2-bs; y+=bs+st) for (let x=-size/2+st; x<size/2-bs; x+=bs+st)
  buildings.push({ p: [[x,y],[x+bs,y],[x+bs,y+bs],[x,y+bs]], h: 12 });
const nav = buildNav({ name:'s', size:[size,size], buildings, roads:[], water:[], parks:[], trees:[] }, 2);
const sim = new Sim(nav);
const P = { seed: 11, population: 8000, initialZombies: 40, zombieSpeed: 1.6, infectTime: 6, armedRate: 0.1, police: 40, policeAccuracy: 0.3 };
sim.reset(P);
const out = []; const ok=(n,c,e='')=>out.push(`${c?'PASS':'FAIL'}  ${n}${e?'  '+e:''}`);
ok('开局经费 100 万', sim.budget === 1000000, `${sim.budget}`);
ok('生成了要员', sim.vipTotal >= 3 && sim.vipTotal <= 6, `${sim.vipTotal} 人`);
ok('要员有独立下标', sim.vips.length === sim.vipTotal);
ok('要员统计正确', sim.stats.vipAlive === sim.vipTotal, `alive=${sim.stats.vipAlive}`);

// 把要员搬到直升机落点，验证奖励
const v0 = sim.vips[0];
sim.px[v0] = 0; sim.pz[v0] = 0;
const before = sim.budget;
sim.helicopter(0, 0);
for (let i=0;i<20*6;i++) sim.step(1/20, 1e9, 1e9);
ok('要员被撤离', sim.stats.vipSaved >= 1, `saved=${sim.stats.vipSaved}`);
ok('追加了经费', sim.budget > before - 600000, `budget=${Math.round(sim.budget)}`);
ok('要员撤离进时间线', sim.events.some(e => e.text.includes('要员')), '');
const spentBefore = sim.spentTotal;
sim.budget = 2000000; sim.cd = {};
sim.spend({ id:'strike', name:'空袭 Mk82', cost:520000, cool:10 });
ok('花费被累计', sim.spentTotal === spentBefore + 520000, `${sim.spentTotal}`);
console.log(out.join('\n'));
const f = out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length-f}/${out.length} 通过`);
process.exit(f?1:0);
