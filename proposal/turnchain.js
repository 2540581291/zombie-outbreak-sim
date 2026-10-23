// ============================================================================
//  proposal/turnchain.js  ——  尸变链条原型（设计稿，**没有**被 index.html 引入）
//
//  目的：把原版 2009 的「被咬 → 转身 / 倒地 → 爬起」四段动画，接到我们现有的
//  SoA 数据结构上，且不改动 sim.js 里 state 的语义（state 继续表示"社会身份"）。
//
//  用法（接入时）：把下面的 attach/tick/beginX 直接搬进 sim.js，
//  三个接线点见 设计方案_尸变链条接入.md §3.3。
// ============================================================================

/** 正交于 state 的「动作阶段」：只影响"能不能动 / 画哪支动画 / 多久"。 */
export const A = {
  NORMAL: 0,   // 正常（交给现有的 walk/run/shoot/zwalk 逻辑）
  TURN: 1,     // 感染发作·原地转身（turn01），期间冻结
  DIE: 2,      // 倒地（die01 / zdie01），期间冻结，播完转"躺尸"
  RISE: 3,     // 尸体爬起（zrise01），期间冻结，播完变丧尸
};

export const BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01', 'police01'];
export const BODY_ID = Object.fromEntries(BODIES.map((b, i) => [b, i]));

// 原版时长 = 帧数 × 帧长，全部来自反编译：
//   _qk83()  → 帧数      _br451() → 帧长(ms)
// police01 没有自己的 zwalk/zattack/zdie，原版直接复用 guy01 的那几支。
export const DUR = {
  guy01:    { walk: 1.20, die: 3.75, turn: 7.35, rise: 6.45, zdie: 3.75, zwalk: 1.60, zattack: 1.20 },
  guy02:    { walk: 1.20, die: 6.84, turn: 1.20, rise: 3.30, zdie: 1.65, zwalk: 1.20, zattack: 1.20 },
  girl01:   { walk: 1.60, die: 3.75, turn: 4.20, rise: 3.45, zdie: 2.40, zwalk: 1.20, zattack: 1.60 },
  girl02:   { walk: 1.60, die: 3.75, turn: 5.80, rise: 3.90, zdie: 2.40, zwalk: 1.20, zattack: 1.60 },
  fat01:    { walk: 1.76, die: 4.20, turn: 6.90, rise: 2.00, zdie: 3.75, zwalk: 1.20, zattack: 1.60 },
  police01: { walk: 0.80, die: 3.75, turn: 6.00, rise: 7.80, zdie: 3.75, zwalk: 1.60, zattack: 1.20 },
};

/** 每个阶段用的动画名（不含 _solid 后缀）。 */
export function animName(stage, wasZombie) {
  switch (stage) {
    case A.TURN: return 'turn01';
    case A.DIE:  return wasZombie ? 'zdie01' : 'die01';
    case A.RISE: return 'zrise01';
    default:     return null;
  }
}

/** 阶段时长（秒）。body 用数字（BODY_ID）或字符串都行。 */
export function stageDur(body, stage, wasZombie) {
  const b = DUR[typeof body === 'number' ? BODIES[body] : body] || DUR.guy01;
  switch (stage) {
    case A.TURN: return b.turn;
    case A.DIE:  return wasZombie ? b.zdie : b.die;
    case A.RISE: return b.rise;
    default:     return 0;
  }
}

// ---------------------------------------------------------------------------
//  数据：在 sim 上挂 4 个数组（NMAX = 62k 时 ≈ 62k × 10B ≈ 0.6 MB，可忽略）
// ---------------------------------------------------------------------------
export function attach(sim) {
  const n = sim.state.length;
  sim.aStage = new Uint8Array(n);      // A.*
  sim.aT = new Float32Array(n);        // 阶段已过时间（秒，跟 sim 时钟走）
  sim.aDur = new Float32Array(n);      // 阶段总时长（秒）
  sim.aZ = new Uint8Array(n);          // 这段动画是不是"丧尸版"（zdie/zrise）
  sim.riseAt = new Float32Array(n);    // 尸变死线（绝对时刻，单位 = sim.time）
  if (!sim.body) sim.body = new Uint8Array(n);   // 体型（渲染和时长共用！）
}

/**
 * 被感染时调一次（替换现有 5 处 `state=INFECTED; timer=...` 的写法）。
 * 关键：除了人活着时的倒计时，再记一个**绝对死线** riseAt。
 * 原版用的是"首次被咬时刻 + 感染时长"的绝对值，所以人死了以后这条时钟照走 ——
 * 用倒计时的话，倒地动画期间谁去减它就成了问题（原版根本不需要减）。
 */
export function setInfected(sim, i, seconds) {
  sim.timer[i] = seconds;
  sim.riseAt[i] = sim.time + seconds;
  sim.state[i] = 1;                    // ST.INFECTED，接入时用真的常量
}

// ---------------------------------------------------------------------------
//  三个进入点
// ---------------------------------------------------------------------------
export function beginTurn(sim, i) {
  sim.aStage[i] = A.TURN;
  sim.aT[i] = 0;
  sim.aZ[i] = 0;
  sim.aDur[i] = stageDur(sim.body[i], A.TURN, false);
}

export function beginDie(sim, i, wasZombie) {
  sim.aStage[i] = A.DIE;
  sim.aT[i] = 0;
  sim.aZ[i] = wasZombie ? 1 : 0;
  sim.aDur[i] = stageDur(sim.body[i], A.DIE, !!wasZombie);
}

export function beginRise(sim, i) {
  sim.aStage[i] = A.RISE;
  sim.aT[i] = 0;
  sim.aZ[i] = 1;
  sim.aDur[i] = stageDur(sim.body[i], A.RISE, true);
}

// ---------------------------------------------------------------------------
//  每步推进；完成时回调，让 sim 去做真正的状态迁移
//    onDone(stage, i) 里应该：
//      TURN / RISE → becomeZombie(i)      （= 现有 sim.js:1653-1668 那段）
//      DIE         → 什么都不做（已经躺在尸体层）
// ---------------------------------------------------------------------------
export function tick(sim, i, dt, onDone) {
  const st = sim.aStage[i];
  if (st === A.NORMAL) return;
  let t = sim.aT[i] + dt;
  if (t >= sim.aDur[i]) {
    t = sim.aDur[i];
    sim.aStage[i] = A.NORMAL;
    sim.aT[i] = t;
    if (onDone) onDone(st, i);
    return;
  }
  sim.aT[i] = t;
}

/** 这个人在做"不可打断的动画"吗？—— 是就跳过移动/寻敌/被咬。 */
export function blocked(sim, i) {
  return sim.aStage[i] !== A.NORMAL;
}

// ---------------------------------------------------------------------------
//  渲染：帧号
//    count = 该动画在 atlas 里的帧数      ms = 该动画的帧长
//    返回 -1 表示"不是阶段动画"，交给原来的步态相位逻辑
// ---------------------------------------------------------------------------
export function frameOf(sim, i, count, ms) {
  const st = sim.aStage[i];
  if (st === A.NORMAL) return -1;
  const f = Math.floor((sim.aT[i] * 1000) / ms);
  return f >= count ? count - 1 : f;   // 一次性动画：末帧定格
}
