// ============================================================
//  tools/test_chain.mjs  ——  尸变链集成自检（P3 验收）
//
//    node tools/test_chain.mjs
//
//  在真 Sim 上跑两个场景：
//    A. 感染时长 6 s（人还没被咬死就先发作）→ 必须走 TURN，且转身期间一步不动
//    B. 感染时长 30 s（先被咬死）→ 必须走 DIE → 躺尸 → RISE，最后才变丧尸
// ============================================================
import { buildNav, Sim } from '../js/sim.js';
import { STAGE, DUR, BODIES } from '../js/bodymap.js';

function makeCity(size = 700, blockSize = 40, street = 22) {
  const [W, H] = [size, size];
  const buildings = [];
  for (let y = -H / 2 + street; y < H / 2 - blockSize; y += blockSize + street) {
    for (let x = -W / 2 + street; x < W / 2 - blockSize; x += blockSize + street) {
      buildings.push({ p: [[x, y], [x + blockSize, y], [x + blockSize, y + blockSize], [x, y + blockSize]], h: 12 });
    }
  }
  return { name: 'synthetic', size: [W, H], buildings, roads: [], water: [], parks: [], trees: [] };
}

const nav = buildNav(makeCity(), 2);
const sim = new Sim(nav);
const STEP = 1 / 20;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${name} ${extra}`); };

function scenario(label, infectTime, seconds) {
  sim.reset({
    seed: 777, population: 2500, initialZombies: 30, zombieSpeed: 2.0,
    infectTime, armedRate: 0.03, police: 10, policeAccuracy: 0.4,
  });

  const sawTurn = new Set(), sawRise = new Set(), sawDie = new Set();
  let turns = 0, rises = 0, dies = 0;
  let watch = -1, wSet = false, watchDone = false, wx = 0, wz = 0, watchMoved = 0, watchDur = 0;

  for (let k = 0; k < seconds * 20; k++) {
    sim.step(STEP, 0, 0);
    for (let i = 0; i < sim.n; i++) {
      const sg = sim.aStage[i];
      if (sg === STAGE.TURN && !sawTurn.has(i)) {
        sawTurn.add(i); turns++;
        if (!watchDone && watch < 0) { watch = i; watchDur = sim.aDur[i]; wSet = false; }
      }
      if (sg === STAGE.DIE && !sawDie.has(i)) { sawDie.add(i); dies++; }
      if (sg === STAGE.RISE && !sawRise.has(i)) { sawRise.add(i); rises++; }
    }
    // 观察者：转身期间位置必须一动不动
    if (watch >= 0) {
      if (sim.aStage[watch] === STAGE.TURN) {
        if (!wSet) { wx = sim.px[watch]; wz = sim.pz[watch]; wSet = true; }
        else watchMoved = Math.max(watchMoved, Math.hypot(sim.px[watch] - wx, sim.pz[watch] - wz));
      } else if (wSet) { watchDone = true; watch = -1; }
    }
  }

  const s = sim.stats;
  console.log(`\n[${label}] infectTime=${infectTime}s / ${seconds}s → civ=${s.civ} inf=${s.infected} zomb=${s.zombie} dead=${s.dead}`);
  console.log(`       进过 TURN ${turns} / DIE ${dies} / RISE ${rises}`);
  return { turns, dies, rises, watchMoved, watchDur };
}

// A：发作快，人还活着 → 站着转身
const A = scenario('A 站着变', 6, 60);
check('A 有人走 turn01', A.turns > 0, `turns=${A.turns}`);
check('A 转身期间位置不动', A.watchMoved < 1e-6, `最大位移 ${A.watchMoved.toFixed(4)} m`);
{
  const body = BODIES.find(b => Math.abs(DUR[b].turn - A.watchDur) < 1e-6) || '?';
  check('A 转身时长 = 某体型的 turn01', body !== '?', `${A.watchDur.toFixed(2)} s → ${body}`);
}

// B：发作慢，先被咬死 → 倒地 → 爬起
const B = scenario('B 先死再爬', 30, 90);
check('B 有人走 die01', B.dies > 0, `dies=${B.dies}`);
check('B 有尸体爬起 zrise01', B.rises > 0, `rises=${B.rises}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

