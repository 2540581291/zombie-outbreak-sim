import { buildNav, Sim, ST } from "../js/sim.js";
const size = 900, bs = 46, st = 26; const buildings = [];
for (let y=-size/2+st; y<size/2-bs; y+=bs+st) for (let x=-size/2+st; x<size/2-bs; x+=bs+st)
  buildings.push({ p: [[x,y],[x+bs,y],[x+bs,y+bs],[x,y+bs]], h: 12 });
const nav = buildNav({ name:'s', size:[size,size], buildings, roads:[], water:[], parks:[], trees:[] }, 2);
const sim = new Sim(nav);
sim.reset({ seed: 3, population: 8000, initialZombies: 60, zombieSpeed: 1.8, infectTime: 6, armedRate: 0.3, police: 200, policeAccuracy: 0.6 });
for (let i=0;i<20*90;i++) sim.step(1/20, 1e9, 1e9);
let maxK=0, kIdx=-1, sumK=0;
for (let i=0;i<sim.n;i++){ if(sim.killsBy[i]>maxK){maxK=sim.killsBy[i]; kIdx=i;} sumK+=sim.killsBy[i]; }
let maxI=0, iIdx=-1, sumI=0;
for (let i=0;i<sim.n;i++){ if(sim.infectBy[i]>maxI){maxI=sim.infectBy[i]; iIdx=i;} sumI+=sim.infectBy[i]; }
console.log('总击杀', sim.kills, ' killsBy 累计', sumK, ' 最高单人', maxK, 'idx', kIdx);
console.log('总感染(潜伏产生)', sumI, ' 最高单尸', maxI, 'idx', iIdx);
console.log(maxK>0 && maxI>0 ? 'PASS 击杀/传染归属已统计' : 'FAIL 没有统计到');
