import { buildNav, Sim, ST } from '../js/sim.js';
import { SP, SPECIES } from '../js/species.js';
const size=800,bs=46,st=26,buildings=[];
for(let y=-size/2+st;y<size/2-bs;y+=bs+st)for(let x=-size/2+st;x<size/2-bs;x+=bs+st)
 buildings.push({p:[[x,y],[x+bs,y],[x+bs,y+bs],[x,y+bs]],h:12});
const nav=buildNav({name:'s',size:[size,size],buildings,roads:[],water:[],parks:[],trees:[]},2);
const sim=new Sim(nav);
sim.reset({seed:3,population:200,initialZombies:1,zombieSpeed:0.0,police:1,homeGunRate:0});
let pol=-1,z=-1;
for(let i=0;i<sim.n;i++){ if(pol<0&&sim.state[i]===ST.POLICE)pol=i; if(z<0&&sim.state[i]===ST.ZOMBIE)z=i; }
console.log('police 物种表 dmg =',SPECIES[sim.kind[pol]].dmg,'  丧尸 hp =',sim.hp[z]);
let shots=0,hits=0;
const orig=sim.shoot.bind(sim);
sim.shoot=function(f,t,acc,r,d){ const before=sim.hp[t]; orig(f,t,1.0,r,d); shots++; if(sim.hp[t]<before)hits++; };
for(let k=0;k<20*40 && sim.state[z]===ST.ZOMBIE;k++){
  sim.px[z]=sim.px[pol]+8; sim.pz[z]=sim.pz[pol]; sim.nearZ[pol]=z; sim.step(1/20,0,0);
}
console.log('40s：开枪',shots,'命中',hits,'→ 丧尸 hp',sim.hp[z],' state',sim.state[z],'(4=丧尸 5=尸体)');
