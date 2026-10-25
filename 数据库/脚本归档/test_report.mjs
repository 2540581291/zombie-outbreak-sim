import { buildNav, Sim, ST } from "../js/sim.js";
const size = 800, bs = 46, st = 26; const buildings = [];
for (let y=-size/2+st; y<size/2-bs; y+=bs+st) for (let x=-size/2+st; x<size/2-bs; x+=bs+st)
  buildings.push({ p: [[x,y],[x+bs,y],[x+bs,y+bs],[x,y+bs]], h: 12 });
const nav = buildNav({ name:'s', size:[size,size], buildings, roads:[], water:[], parks:[], trees:[] }, 2);
const sim = new Sim(nav);
sim.reset({ seed: 7, population: 4000, initialZombies: 50, zombieSpeed: 1.8, infectTime: 6, armedRate: 0.1, police: 40, policeAccuracy: 0.35 });
const out = [];
const ok = (n,c,e='') => out.push(`${c?'PASS':'FAIL'}  ${n}${e?'  '+e:''}`);
let audioSeen = { shot:0, scream:0, groan:0, bite:0 };
for (let i=0;i<20*90;i++) {
  sim.step(1/20, 1e9, 1e9);
  for (const a of sim.audio) if (audioSeen[a.type] !== undefined) audioSeen[a.type]++;
  sim.audio.length = 0;
}
ok('有枪声音频事件', audioSeen.shot > 0, `${audioSeen.shot}`);
ok('有尖叫声频事件', audioSeen.scream > 0, `${audioSeen.scream}`);
ok('有低吼音频事件', audioSeen.groan > 0, `${audioSeen.groan}`);
ok('曲线有采样', sim.hist.t.length >= 80, `${sim.hist.t.length} 点`);
ok('曲线长度一致', sim.hist.civ.length === sim.hist.t.length);
ok('有击杀计数', sim.kills > 0, `${sim.kills}`);
ok('有时间线事件', sim.events.length >= 2, `${sim.events.length} 条`);
ok('首个事件是爆发开始', sim.events[0].text === '爆发开始');
sim.budget = 200; sim.cd = {};
sim.spend({ id:'strike', name:'空袭 Mk82', cost:40, cool:10 });
ok('工具使用被记录', sim.toolUse.strike === 1);
ok('工具使用进时间线', sim.events.some(e=>e.kind==='tool'));
sim.strike(0,0,45);
ok('空袭有爆炸音频', sim.audio.some(a=>a.type==='boom'));
console.log(out.join('\n'));
const f = out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length-f}/${out.length} 通过`);
process.exit(f?1:0);
