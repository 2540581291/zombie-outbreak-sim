// ============================================================================
//  proposal/test_turnchain.mjs
//  node proposal/test_turnchain.mjs
//  用 1 个个体 + 固定 50ms 步长，验证 turnchain.js 的两条路径、时间表、帧号。
//  这里的 step() 就是我建议在 sim.js 里写的那段接线（§3.3 的伪代码）。
// ============================================================================
import { A, attach, setInfected, beginTurn, beginDie, beginRise, tick, blocked, frameOf, stageDur, BODY_ID } from './turnchain.js';

const DT = 1 / 20;
const ST = { CIV: 0, INFECTED: 1, ZOMBIE: 2, CORPSE: 3 };   // 简化版状态码

function makeSim(bodyName) {
  const n = 1;
  const sim = {
    time: 0, n,
    state: new Int8Array(n),
    timer: new Float32Array(n),
    hp: new Float32Array(n),
    log: [], zombies: 0,
  };
  sim.body = new Uint8Array(n).fill(BODY_ID[bodyName]);
  attach(sim);
  return sim;
}

function log(sim, msg) { sim.log.push([sim.time.toFixed(2), msg]); }

function becomeZombie(sim, i) {
  sim.state[i] = ST.ZOMBIE;
  sim.zombies++;
  log(sim, 'ZOMBIE');
}

// ---- 我建议的 step 接线（顺序很重要）------------------------------------
function step(sim, biteNow) {
  sim.time += DT;
  const i = 0;
  const st = sim.state[i];

  // 1) 咬（sim.js 现在的 1720-1757 里那块，只改两行）
  if (biteNow && st !== ST.ZOMBIE) {
    sim.hp[i] -= 2;
    if (sim.hp[i] <= 0) {
      sim.state[i] = ST.CORPSE;
      beginDie(sim, i, false);            // ← 原来是瞬间变 CORPSE
      log(sim, 'die01 开始');
    } else if (st === ST.CIV) {
      setInfected(sim, i, 10);            // ← 10 s = 原版默认感染时长
      log(sim, 'infected');
    }
  }

  // 2) 阶段推进（放在这个人自己 update 的最前面）
  if (blocked(sim, i)) {
    tick(sim, i, DT, (stage) => {
      if (stage === A.TURN) { log(sim, 'turn01 播完'); becomeZombie(sim, i); }
      else if (stage === A.RISE) { log(sim, 'zrise01 播完'); becomeZombie(sim, i); }
      else if (stage === A.DIE) log(sim, 'die01 播完→躺尸');
    });
    return;
  }

  // 3) 潜伏 / 尸体（原版是同一个绝对时钟的两个出口）
  if (st === ST.INFECTED) {
    sim.timer[i] -= DT;
    if (sim.time >= sim.riseAt[i]) {      // 人还活着 → 站着转身
      sim.timer[i] = 0;
      beginTurn(sim, i);
      log(sim, 'turn01 开始');
    }
  } else if (st === ST.CORPSE) {
    if (sim.riseAt[i] > 0 && sim.time >= sim.riseAt[i]) {   // 已经躺够 → 爬起来
      sim.riseAt[i] = 0;
      beginRise(sim, i);
      log(sim, 'zrise01 开始');
    }
  }
}

function run(body, seconds, bites) {
  const sim = makeSim(body);
  sim.state[0] = ST.CIV;
  sim.hp[0] = 10;
  let k = 0;
  for (let t = 0; t < seconds; t += DT, k++) {
    const hit = bites.some(b => Math.abs(sim.time + DT - b) < DT / 2);
    step(sim, hit);
  }
  return sim;
}

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${name} ${extra}`); };

console.log('A · 只咬一口就脱身（guy01，咬在 t=0.5，感染 10 s）');
{
  const sim = run('guy01', 30, [0.5]);
  console.log('    事件:', JSON.stringify(sim.log));
  const at = +sim.log.find(e => e[1] === 'ZOMBIE')[0];
  check('走的是 turn01（活着变）', sim.log.some(e => e[1] === 'turn01 开始'));
  check('成丧尸时刻 ≈ 17.85 s', Math.abs(at - 17.85) < 0.1, `实际 ${at.toFixed(2)}`);
}

console.log('B · 连咬 5 口（每 2 s 一口，咬在 0.5/2.5/4.5/6.5/8.5）');
{
  const sim = run('guy01', 30, [0.5, 2.5, 4.5, 6.5, 8.5]);
  console.log('    事件:', JSON.stringify(sim.log));
  const at = +sim.log.find(e => e[1] === 'ZOMBIE')[0];
  check('走的是 die01 → 躺尸 → zrise01', sim.log.some(e => e[1] === 'die01 开始') && sim.log.some(e => e[1] === 'zrise01 开始'));
  check('成丧尸时刻 ≈ 18.70 s', Math.abs(at - 18.70) < 0.1, `实际 ${at.toFixed(2)}`);
  check('没有出现 turn01', !sim.log.some(e => e[1] === 'turn01 开始'));
}

console.log('C · 丧尸被打死（zdie01）→ 只躺，不再复活');
{
  const sim = makeSim('guy01');
  sim.state[0] = ST.CORPSE;
  beginDie(sim, 0, true);
  for (let k = 0; k < Math.round(10 / DT); k++) { sim.time += DT; tick(sim, 0, DT, null); }
  check('阶段归零（=躺平）', sim.aStage[0] === 0);
  check('没有变成丧尸', sim.zombies === 0);
}

console.log('D · 帧号：一次性动画首帧 0、末帧 n-1、不越界');
{
  const N = 25, MS = 150;                       // guy01 die01
  const sim = makeSim('guy01');
  sim.state[0] = ST.CORPSE;
  beginDie(sim, 0, false);
  const seen = [];
  for (let k = 0; k < Math.round(4.0 / DT); k++) {
    sim.time += DT;
    const f = frameOf(sim, 0, N, MS);
    if (f >= 0) seen.push(f);
    tick(sim, 0, DT, null);
  }
  check('首帧/末帧/上界', seen[0] === 0 && seen.at(-1) === N - 1 && Math.max(...seen) <= N - 1,
    `首 ${seen[0]} 末 ${seen.at(-1)} 共 ${seen.length} 次采样`);
}

console.log('E · 时长表（6 体型 × 4 段）');
{
  const rows = [
    ['guy01', A.TURN, 7.35], ['guy01', A.RISE, 6.45], ['guy01', A.DIE, 3.75],
    ['guy02', A.DIE, 6.84], ['guy02', A.TURN, 1.20],
    ['girl01', A.TURN, 4.20], ['girl02', A.TURN, 5.80], ['fat01', A.TURN, 6.90],
    ['police01', A.TURN, 6.00], ['police01', A.RISE, 7.80], ['fat01', A.RISE, 2.00],
  ];
  let ok = true;
  for (const [b, s, want] of rows) if (Math.abs(stageDur(b, s, false) - want) > 1e-6) ok = false;
  check('11 项时长与原版一致', ok);
  check('丧尸倒地用 zdie 时长（guy02 = 1.65）', Math.abs(stageDur('guy02', A.DIE, true) - 1.65) < 1e-6);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
