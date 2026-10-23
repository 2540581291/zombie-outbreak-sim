// ============================================================
//  ZOS-R · 模拟内核（纯 JS，零依赖，可在 Node 里跑）
//  万物皆数组（SoA），固定步长，确定性 PRNG
// ============================================================

import { SP, TEAM, SPECIES, SPECIAL_KINDS, CIV_KINDS, ANIMAL_KINDS, WILD_KINDS } from './species.js';
import { jobOf, jobFor, ageOf, braveOf, JOB_POI, h } from './profiles.js';
import { buildFamilies } from './family.js';
import { WPN, WEAPONS, ROLE_WEAPON, skillFor, weaponOf } from './weapons.js';
import { makeStock, makeStationStock, makeHomeStock, takeWeapon, hasWeapon, stockText } from './storage.js';
import { STAGE, bodyOf, stageDur, stageAnim } from './bodymap.js';

export const ST = {
  CIV: 0,      // 平民
  FLEE: 1,     // 逃跑
  FIGHT: 2,    // 持枪还击
  POLICE: 3,   // 警察
  ZOMBIE: 4,   // 丧尸
  CORPSE: 5,   // 尸体（留在场上，会吸引丧尸）
  SOLDIER: 6,  // 士兵
  INFECTED: 7, // 潜伏期（还没变）
  SAVED: 8,    // 已被直升机救走（不渲染、不计数）
  WILD: 9,     // 野生动物：人尸双杀
};

const NMAX = 62000;

// 潜伏期两套常量（决策 3）：默认 8 秒；零号病人模式 10–30 分钟
export const INCFG = { quick: 8, long: [600, 1800] };

// 一天 24 分钟：1 模拟秒 = 1 游戏分钟，1440 秒 = 24 小时（整数关系，不用换算）
export const DAY_SECONDS = 1440;
export const TIME_SEGS = [
  { at: 0, name: '深夜' }, { at: 360, name: '早晨' }, { at: 540, name: '白天' },
  { at: 1080, name: '傍晚' }, { at: 1200, name: '夜晚' }, { at: 1380, name: '深夜' },
];

// 混乱度权重（0-100 上限）：知情值 1% → 1 点，感染值 1% → 2 点
export const CHAOS_W = { aware: 1, infect: 2, cap: 100 };

// 个体的「社会目标」：和身体状态（state）正交
export const GOAL = {
  NONE: 0,         // 原地晃
  HOME: 1,         // 回家（找家人）
  WORK: 2,         // 去上班
  FLEE: 3,         // 逃出城
  ARM_HOME: 4,     // 回家拿枪
  SHELTER: 5,      // 去警局避难（混乱度 ≥ 50%）—— 那时候才拿得到枪
  HELP: 6,         // 去医院（治不好，但人会去）
  HOLD: 7,         // 固守
  FOLLOW: 8,       // 跟着人群
  MOVE_TO: 9,      // 被玩家指挥（仅士兵）
};

// 绕墙探测角度（度）：先正前方，然后固定朝一侧偏，形成沿墙滑行
const PROBE = [0, 20, 40, 60, 80, 100, 120, 145, 170];
const DEG = Math.PI / 180;

// 咬合距离：两个身位（原版约 13px，我们按 1.8m 换算）。
// 太小会导致「差 0.8m 就永远咬不到」——人和尸都在动，一步只走 0.075m。
const BITE_R2 = 1.8 * 1.8;

// ---------- 确定性随机 ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 导航栅格（2m） ----------
export function buildNav(city, cell = 2) {
  const [W, H] = city.size;
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const grid = new Uint8Array(cols * rows).fill(1); // 1=可走
  const halfW = W / 2, halfH = H / 2;

  // 建筑挖空（先按 bbox 快速标记，再逐格判定）
  for (const b of city.buildings) {
    const p = b.p;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < p.length; i++) {
      const x = p[i][0], y = p[i][1];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    // 外扩 0.4m 防止贴墙
    const c0 = Math.max(0, Math.floor((minx + halfW - 0.4) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((maxx + halfW + 0.4) / cell));
    const r0 = Math.max(0, Math.floor((miny + halfH - 0.4) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((maxy + halfH + 0.4) / cell));
    for (let r = r0; r <= r1; r++) {
      const cy = halfH - (r + 0.5) * cell;   // z 南为正
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cell - halfW;
        if (pointInPoly(cx, cy, p)) grid[r * cols + c] = 0;
      }
    }
  }
  return { grid, cols, rows, cell, W, H, halfW, halfH };
}

function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ============================================================
export class Sim {
  constructor(nav, city) {
    this.nav = nav;
    this.city = city || null;
    // POI 按类型分桶（工作地分配要用）
    //  有些 POI 的质心会落在墙里 / 水里（多边形是环形、或节点在路中间），
    //  这里一次性把它们吸到最近的可行走格，避免"上班上到墙里"。
    this.poiByKind = {};
    // "合理"的定义：POI 必须在**楼里**（碰撞层 0x1f），不能落在空地或水上。
    //  真实标签的 POI 有时质心在院子里/马路上；推导出来的 POI 本来就在楼里。
    //  不合规的按同心圆往外找最近的"室内格"，实在没有才退到"可行走格"。
    const inBld = (x, z) => (nav.indoor ? nav.indoor(x, z) : (nav.walkable ? nav.walkable(x, z) : true));
    let snapped = 0, dropped = 0;
    // city.json 现在直接是世界坐标（z 南为正），不再需要任何翻转
    this.pois = (this.city?.pois || []).map((p) => ({ ...p }));
    for (const p of this.pois) {
      if (!inBld(p.x, p.z)) {
        let done = false;
        for (let r = 1; r <= 60 && !done; r++) {
          for (let a = 0; a < 16 && !done; a++) {
            const ang = (a / 16) * 6.2832;
            const nx = p.x + Math.cos(ang) * r, nz = p.z + Math.sin(ang) * r;
            if (inBld(nx, nz)) { p.x = nx; p.z = nz; p.snapped = 1; snapped++; done = true; }
          }
        }
        if (!done && nav.walkable) {
          for (let r = 1; r <= 60 && !done; r++) {
            for (let a = 0; a < 16 && !done; a++) {
              const ang = (a / 16) * 6.2832;
              const nx = p.x + Math.cos(ang) * r, nz = p.z + Math.sin(ang) * r;
              if (nav.walkable(nx, nz)) { p.x = nx; p.z = nz; p.snapped = 2; snapped++; done = true; }
            }
          }
        }
        if (!done) { dropped++; continue; }   // 附近什么都没有 → 这个 POI 丢掉
      }
      if (p.k === 'police' && !p.store) {
        // 警局军械库：按面积给（确定性）
        p.store = makeStationStock(p.a || 200);
      }

      (this.poiByKind[p.k] || (this.poiByKind[p.k] = [])).push(p);
    }
    this.buildCoarseGrid();
    this.poiSnapped = snapped;
    this.poiDropped = dropped;
    this.poiCount = (this.city?.pois || []).length;
    // 一次性预处理：每个可走格到最近门的步数（让被墙挡住的人会找门）
    if (typeof nav.buildDoorField === 'function' && !nav.doorDist) {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const reached = nav.buildDoorField();
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (reached) {
        console.log('[ZOS-R] 门场 ' + reached.toLocaleString() + ' 格  ' + (t1 - t0).toFixed(0) + 'ms');
      }
    }
    this.tick = 0;
    this.time = 0;
    this.n = 0;
    this.rng = mulberry32(1);
    this.tracers = [];   // {x1,z1,x2,z2,life}
    this.booms = [];     // {x,z,r,life}
    this.stats = { civ: 0, infected: 0, zombie: 0, dead: 0, police: 0, shots: 0 };

    // ---- SoA ----
    this.px = new Float32Array(NMAX);
    this.pz = new Float32Array(NMAX);
    this.heading = new Float32Array(NMAX);
    this.spd = new Float32Array(NMAX);
    this.state = new Uint8Array(NMAX);
    this.timer = new Float32Array(NMAX);
    this.panic = new Float32Array(NMAX);
    this.tx = new Float32Array(NMAX);
    this.tz = new Float32Array(NMAX);
    this.phase = new Float32Array(NMAX);
    this.cool = new Float32Array(NMAX);
    this.armed = new Uint8Array(NMAX);
    this.stam = new Float32Array(NMAX);          // 体力（逃跑会累）
    this.side = new Float32Array(NMAX);          // 绕墙偏好方向 ±1
    this.fleeT = new Float32Array(NMAX);         // 本次逃跑剩余时长
    this.fleeCd = new Float32Array(NMAX);        // 腿软期（这段时间不会再跑）
    this.actT = new Float32Array(NMAX);          // 当前活动剩余时长（走/站）
    this.idle = new Uint8Array(NMAX);            // 1 = 站着发呆
    this.stuck = new Float32Array(NMAX);         // 连续卡住的秒数
    this.kind = new Uint8Array(NMAX);            // 物种 id
    this.hp = new Float32Array(NMAX);            // 血量
    this.specialT = new Float32Array(NMAX);      // 特感能力冷却/计时
    this.nextSpecial = 8;                        // 下一次刷特感的秒数
    this.pow = new Float32Array(NMAX);           // 伤害倍率（丧尸化后增强）
    this.killsBy = new Int32Array(NMAX);         // 这个个体打死过多少丧尸
    this.infectBy = new Int32Array(NMAX);        // 这个个体传染了多少人
    this.pow.fill(1);
    this.nextWild = 45;                          // 下一次刷野生动物的秒数
    this.ammo = new Int16Array(NMAX);            // 弹药（打光就完蛋）
    this.acc = new Float32Array(NMAX);           // 个人命中率
    // ---- 武器（M5）----
    this.wpn = new Uint8Array(NMAX);             // 武器 id
    this.mag = new Uint8Array(NMAX);             // 弹匣里还有几发
    this.reserve = new Uint8Array(NMAX);         // 备弹
    this.skill = new Uint8Array(NMAX);           // 熟练度 0-255（/255）
    this.rlUntil = new Float32Array(NMAX);       // 装填完成时刻
    // ---- 感染叙事（M6）----
    this.incTot = new Float32Array(NMAX);        // 这次潜伏总共多久
    this.sick = new Uint8Array(NMAX);            // 1 = 发病（发烧，跑医院）
    this.noises = [];                            // 枪声（吸引丧尸）
    // ---- 事件与响应（M7）----
    this.alarms = [];                            // 报警队列（最多 64 条）—— 注意别和战报时间线 this.events 混了
    this.deathAlarms = [];                       // 死亡出警（500m 内只派一次）
    this.homeStocks = new Map();                 // 家庭军械库：household id → stock
    this.stationOf = new Uint16Array(NMAX);      // 警员属于哪个警局（1 起，0 = 无）
    // ---- 要员护送（M9）----
    this.escortOf = new Uint8Array(NMAX);        // 该警员在护送哪位要员（0 = 不在护送）
    this.vipStage = new Uint8Array(NMAX);        // 要员护送阶段：0 无 / 1 四人小队去警局 / 2 八人小队出城
    this.vipGoal = new Uint8Array(NMAX);         // 1 = 去警局，2 = 逃出城
    this.vipDone = new Uint8Array(NMAX);         // 1 = 已经安置好（撤离）
    this.patrol = new Uint8Array(NMAX);          // 1 = 巡警（开局 10% 散在城里）
    this.eventSeq = 0;
    // ---- 社会层（M1）：家 / 工作地 / 当前目标 ----
    this.homeX = new Float32Array(NMAX);
    this.homeZ = new Float32Array(NMAX);
    this.workX = new Float32Array(NMAX);
    this.workZ = new Float32Array(NMAX);
    this.goal = new Uint8Array(NMAX);            // GOAL.*
    this.commuteAt = new Float32Array(NMAX);     // 下次切换 家⇄工作地 的**绝对时刻**（不受分帧更新影响）
    // ---- 目标决策（M4） ----
    this.goalX = new Float32Array(NMAX);         // 目标点（FLEE/HELP/SHELTER 用）
    this.goalZ = new Float32Array(NMAX);
    this.decT = new Float32Array(NMAX);          // 下次做决定的时刻
    this.lastScore = new Float32Array(NMAX);     // 上次决策得分（做惯性用）
    this.stuckT = new Float32Array(NMAX);        // 连续几秒没靠近目标
    this.lastX = new Float32Array(NMAX);         // 上一秒的位置（算净位移）
    this.lastZ = new Float32Array(NMAX);
    this.stuckT2 = 0;
    this.wpX = new Float32Array(NMAX);           // 临时绕路点
    this.wpZ = new Float32Array(NMAX);
    this.wpT = new Float32Array(NMAX);           // 绕路点有效期（绝对时刻）
    this.freeT = new Float32Array(NMAX);         // 刚出门的"别再找门"保护期
    this.pathX = new Float32Array(NMAX * 6);     // 粗网格寻路的路点（最多 6 个）
    this.pathZ = new Float32Array(NMAX * 6);
    this.pathN = new Uint8Array(NMAX);
    this.pathIdx = new Uint8Array(NMAX);
    this.infectRate = 0;                         // 感染率（尸 + 潜伏）/ 总人口
    this.awareRate = 0;                          // 知情率（全城知道出事的人的比例）
    this.chaos = 0;                              // **混乱度 0-100**：很多规则的开关都看它
    this.martialLaw = false;                     // 感染率 > 阈值 → 平民敢去警局抢枪
    this.martialAt = 0.2;                        // 阈值（面板可调）
    // ---- 家庭（M2）：家庭 = 平民索引上的连续区间 ----
    this.hh = new Uint16Array(NMAX);             // 家庭 id
    this.tourist = new Uint8Array(NMAX);         // 1 = 旅客（无家无家属）
    this.hhStart = null; this.hhEnd = null; this.civAt = null;
    this.nHh = 0;
    // ---- 信息层（M3）：谁知道"出事了" ----
    this.aware = new Uint8Array(NMAX);           // 0 无知 / 1 听说 / 2 目击 / 3 亲历
    this.callT = new Float32Array(NMAX);         // 下次打电话的时刻
    this.callK = new Uint8Array(NMAX);           // 联系人轮转（0-1 家人 / 2-3 同事 / 4 邻居）
    this.callsLeft = new Uint8Array(NMAX);       // 还能打几通（打完了就不再传播，靠网络）
    this.nAware = 0;                             // 知晓人数
    this.heat = 0;                               // 网络热度 0-1
    this.netT = 0;
    this.infoRate = 1;                           // 传播系数（面板可调）

    // ---- 指挥系统（经费：人民币）----
    this.budget = 1000000;      // 开局 ¥1,000,000
    this.budgetMax = 8000000;   // 上限 ¥8,000,000
    this.regen = 15000;         // 每秒入账 ¥15,000
    this.spentTotal = 0;        // 累计花费
    this.vip = new Uint8Array(NMAX);   // 要员标记
    this.vips = [];                    // 要员个体下标
    this.vipTotal = 0;
    this.savedVip = 0;
    this.vipBonus = 260000;            // 救出一名要员追加 ¥260,000
    this.cd = {};               // 每个工具的冷却
    this.effects = [];          // 持续区域效果（火/警报/广播）
    this.helis = [];            // 直升机
    this.saved = 0;             // 已救出人数
    this.cured = 0;             // 已治愈人数
    this.barricaded = [];       // 被路障改掉的栅格下标（重开时恢复）

    // ---- 音频事件 & 战报数据 ----
    this.audio = [];            // 每 tick 收集，主线程取走
    this.hist = { t: [], civ: [], inf: [], zom: [], dead: [], saved: [] };
    this.events = [];           // 时间线 [{t, text, kind}]
    this.kills = 0;             // 击杀丧尸数
    this.civDeaths = 0;         // 平民死亡数（死于空袭/火）
    this.peakZombie = 0;
    this.toolUse = {};          // 工具使用次数
    this.histT = 0;             // 采样计时
    this.ms = {};               // 里程碑去重表
    this.nearZ = new Int32Array(NMAX).fill(-1); // 最近丧尸
    this.nearC = new Int32Array(NMAX).fill(-1); // 最近平民
    this.nearPoll = new Int32Array(NMAX).fill(-1); // 最近警察/士兵
    this.tgt = new Int32Array(NMAX).fill(-1);      // 丧尸的目标记忆

    // ---- 动作阶段（正交于 state；原版的 turn01 / die01 / zrise01）----
    this.aStage = new Uint8Array(NMAX);            // STAGE.*
    this.aT = new Float32Array(NMAX);              // 阶段已过秒数
    this.aDur = new Float32Array(NMAX);            // 阶段总时长（按体型）
    this.aZ = new Uint8Array(NMAX);                // 这段动画是不是丧尸版（zdie）
    this.riseAt = new Float32Array(NMAX);          // 尸变死线（绝对时刻；0 = 不会变）

    // ---- 空间哈希 ----
    this.hcell = 24;
    this.hcols = Math.ceil(nav.W / this.hcell) + 2;
    this.hrows = Math.ceil(nav.H / this.hcell) + 2;
    const nc = this.hcols * this.hrows;
    this.hCount = new Int32Array(nc);
    this.hStart = new Int32Array(nc + 1);
    this.hOrder = new Int32Array(NMAX);
  }

  // ---------- 初始化 ----------
  reset(P) {
    this.params = P;
    this.tick = 0; this.time = 0;
    this.rng = mulberry32(P.seed >>> 0);
    this.tracers.length = 0; this.booms.length = 0;
    this.nearZ.fill(-1); this.nearC.fill(-1); this.nearPoll.fill(-1); this.tgt.fill(-1);
    // 关键：全部状态清零，否则上一局的残留会让结果不可复现
    this.cool.fill(0); this.timer.fill(0); this.panic.fill(0);
    this.wpn.fill(0); this.mag.fill(0); this.reserve.fill(0); this.skill.fill(0); this.rlUntil.fill(0);
    this.incTot.fill(0); this.sick.fill(0);
    this.longInc = (P.mode || 'single') === 'stealth';
    this.noises.length = 0; this.alarms.length = 0; this.deathAlarms.length = 0; this.eventSeq = 0; this.nextDispatch = 0;
    this.homeStocks.clear();
    this.stationOf.fill(0); this.patrol.fill(0);
    this.escortOf.fill(0); this.vipStage.fill(0); this.vipGoal.fill(0); this.vipDone.fill(0);
    this.stam.fill(1); this.armed.fill(0); this.state.fill(0); this.ammo.fill(0);
    this.stuck.fill(0);
    this.side.fill(1);
    this.fleeT.fill(0);
    this.fleeCd.fill(0);
    this.nextSpecial = 8;
    this.pow.fill(1);
    // 信息层清零
    this.aware.fill(0); this.callT.fill(0); this.callK.fill(0); this.callsLeft.fill(0);
    this.goal.fill(0); this.goalX.fill(0); this.goalZ.fill(0); this.decT.fill(0); this.lastScore.fill(0); this.stuckT.fill(0);
    this.lastX.fill(0); this.lastZ.fill(0); this.stuckT2 = 0; this.wpT.fill(0); this.freeT.fill(0);
    this.pathN.fill(0); this.pathIdx.fill(0); this.pathBudget = 8; this.stuckSlice = 0;
    this.infectRate = 0; this.awareRate = 0; this.chaos = 0;
    this.martialLaw = false; this.rateT = 0;
    this.homeGunRate = P.homeGunRate == null ? 0.12 : +P.homeGunRate;
    this.chaosAt = 50;          // 混乱度到这个数 = 秩序崩溃（警戒线）
    this.nAware = 0; this.heat = 0; this.netT = 0;
    this.infoRate = P.infoRate == null ? 1 : +P.infoRate;
    // 警局军械库每局重置（枪和子弹都恢复到开局数量）
    for (const p of (this.poiByKind.police || [])) {
      if (!p.store0) p.store0 = p.store;
      p.store = makeStationStock(p.a || 200);
    }
    this.pop0 = Math.max(1, (P.population | 0));
    // 游戏时钟：默认 07:30 开局
    this.startMin = P.startMin == null ? 7 * 60 + 30 : (+P.startMin | 0);
    // 每局随机一条边作为"逃离线"：平民跑到这条线上就算撤离
    this.escapeSide = ['N', 'E', 'S', 'W'][(this.rng() * 4) | 0];
    this.nextWild = 45;
    this.actT.fill(0); this.idle.fill(0);
    // 这些也必须在开局清零：否则同一实例「重新爆发」时，警察/士兵/丧尸会带着
    // 上一局的 tx/tz/heading/phase 进来，结果和第一次跑不一致（确定性测试抓到的）
    this.tx.fill(0); this.tz.fill(0);
    this.heading.fill(0); this.phase.fill(0);
    this.specialT.fill(0); this.tgt.fill(-1);
    this.aStage.fill(0); this.aT.fill(0); this.aDur.fill(0); this.aZ.fill(0); this.riseAt.fill(0);
    this.waveLeft = 0; this.waveNext = 0; this.waveCount = 0;
    if (this.origins) this.origins.length = 0;
    this.acc.fill(0.2);
    this.killsBy.fill(0); this.infectBy.fill(0);
    this.stats.shots = 0;

    // 指挥系统复位
    this.budget = 1000000;
    this.spentTotal = 0;
    this.savedVip = 0;
    this.vip.fill(0);
    this.vips.length = 0;
    this.vipTotal = 0;
    this.cd = {};
    this.effects.length = 0;
    this.helis.length = 0;
    this.saved = 0;
    this.cured = 0;
    for (const k of this.barricaded) this.nav.grid[k] = 1;
    this.barricaded.length = 0;
    this.audio.length = 0;
    this.hist = { t: [], civ: [], inf: [], zom: [], dead: [], saved: [] };
    this.events = [];
    this.kills = 0; this.civDeaths = 0; this.peakZombie = 0;
    this.toolUse = {}; this.histT = 0; this.ms = {};
    this.pushEvent('爆发开始', 'start');

    const nav = this.nav;
    const total = nav.cols * nav.rows;
    const pop = Math.min(P.population, NMAX - 2000 - P.police);
    const nPol = Math.min(P.police, 800);

    // 收集可走格（用于均匀布点）
    let walk = 0;
    for (let i = 0; i < total; i++) if (nav.grid[i] & 1) walk++;

    let k = 0;
    const step = walk / Math.max(1, pop);
    let acc = 0, idx = 0;
    const rng = this.rng;

    // 平民
    for (let cell = 0; cell < total && k < pop; cell++) {
      if (!(nav.grid[cell] & 1)) continue;
      acc += 1;
      if (acc < step) continue;
      acc = 0;
      const c = cell % nav.cols, r = (cell / nav.cols) | 0;
      const x = (c + rng()) * nav.cell - nav.halfW;
      const z = nav.halfH - (r + rng()) * nav.cell;
      const i = k++;
      this.px[i] = x; this.pz[i] = z;
      this.heading[i] = rng() * 6.2832;
      const ck = CIV_KINDS[(rng() * CIV_KINDS.length) | 0];
      this.kind[i] = ck;
      this.hp[i] = SPECIES[ck].hp;
      this.spd[i] = SPECIES[ck].speed * (0.92 + rng() * 0.16);
      this.state[i] = ST.CIV;
      this.timer[i] = 0; this.panic[i] = 0;
      this.phase[i] = rng();
      // 决策 2：平民开局一律徒手（有枪的在家里，需要回家取）
      this.armed[i] = 0;
      this.ammo[i] = 0;
      // 原版节奏：一半人站着发呆 25~60 秒，另一半在街上走 60~140 秒
      this.idle[i] = rng() < 0.5 ? 1 : 0;
      this.actT[i] = this.idle[i] ? (25 + rng() * 35) : (60 + rng() * 80);
      this.acc[i] = 0.22;
      this.pickWander(i);
      idx++;
    }

    // ---- 家庭（M2）：先把平民切成家庭，再按家庭分配住址 ----
    const civIdx = [];
    for (let i = 0; i < k; i++) if (this.state[i] === ST.CIV) civIdx.push(i);
    buildFamilies(this, civIdx, h);

    // ---- 家庭军械库（M8）：每个家庭按哈希决定有没有枪、有多少子弹 ----
    for (let hid = 0; hid < this.nHh; hid++) {
      this.homeStocks.set(hid, makeHomeStock(h(hid, 51), rng, P.homeGunRate));
    }

    // ---- 社会层（M1）：家 / 工作地 ----
    //  家：优先挑"楼里"（可走且室内），挑不到就随便找个可走点
    //  工作地：按职业映射到 POI（护士→医院、教师→学校…），没有对应 POI 就找个室内点当写字楼
    const pickIndoor = () => {
      for (let t = 0; t < 12; t++) {
        const [x, z] = this.randWalk(rng, 1);
        if (!this.nav.indoor || this.nav.indoor(x, z)) return [x, z];
      }
      return this.randWalk(rng, 1);
    };
    let nHome = 0, nWork = 0, nPoiWork = 0, nTourist = 0;
    // 每个家庭先挑一个住址，成员共用（同一栋楼，±1.5m 抖动）
    const hhHome = new Map();
    for (let i = 0; i < k; i++) {
      if (this.state[i] !== ST.CIV) continue;
      if (this.tourist[i]) {
        // 旅客：没有家，就在出生点附近"住店"，也不通勤
        this.homeX[i] = this.px[i]; this.homeZ[i] = this.pz[i];
        this.workX[i] = this.px[i]; this.workZ[i] = this.pz[i];
        this.goal[i] = GOAL.NONE;
        this.commuteAt[i] = 1e9;
        nTourist++;
        continue;
      }
      const hid = this.hh[i];
      let base = hhHome.get(hid);
      if (!base) {
        base = pickIndoor();
        hhHome.set(hid, base);
      }
      // ±1.5m 抖动让同屋的人不至于完全重合；抖到墙里就退回基点
      let hx = base[0] + (rng() - 0.5) * 3;
      let hz = base[1] + (rng() - 0.5) * 3;
      if (!this.walkable(hx, hz)) { hx = base[0]; hz = base[1]; }
      this.homeX[i] = hx; this.homeZ[i] = hz;
      // 工作地：在该职业对应的 POI 里挑"离家最近的那个"（从 3 个候选里挑最近），
      // 这样通勤距离现实一点（原来家和工作地毫无关系，平均 1.2km，走 15 分钟）
      const kind = JOB_POI[jobFor(i, this.age[i] || ageOf(i))];
      const list = kind ? this.poiByKind[kind] : null;
      let wx, wz;
      if (list && list.length) {
        let best = null, bd = Infinity;
        for (let t = 0; t < 3; t++) {
          const p = list[(rng() * list.length) | 0];
          const d = (p.x - hx) ** 2 + (p.z - hz) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        wx = best.x + (rng() - 0.5) * 10;
        wz = best.z + (rng() - 0.5) * 10;
        if (!this.walkable(wx, wz)) { const b = pickIndoor(); wx = b[0]; wz = b[1]; }
        else nPoiWork++;
      } else {
        // 没有对应 POI：在离家 900m 内找个室内点当"写字楼"
        let ok = false;
        for (let t = 0; t < 16; t++) {
          const a2 = rng() * 6.2832, r2 = rng() * 900;
          const x2 = hx + Math.cos(a2) * r2, z2 = hz + Math.sin(a2) * r2;
          if (this.walkable(x2, z2) && (!this.nav.indoor || this.nav.indoor(x2, z2))) {
            wx = x2; wz = z2; ok = true; break;
          }
        }
        if (!ok) { const b = pickIndoor(); wx = b[0]; wz = b[1]; }
      }
      this.workX[i] = wx; this.workZ[i] = wz;

      // 55% 的人开局就在家 / 在单位（图上能看到聚落）；其余 45% 留在街上
      if (h(i, 31) < 0.55) {
        const home = h(i, 32) < 0.5;
        this.goal[i] = home ? GOAL.HOME : GOAL.WORK;
        this.px[i] = home ? hx : wx;
        this.pz[i] = home ? hz : wz;
        if (home) nHome++; else nWork++;
        this.pickWander(i);
      } else {
        this.goal[i] = GOAL.NONE;
      }
      this.commuteAt[i] = this.time + 25 + rng() * 95;
    }
    if (typeof window === 'undefined') {   // 只在 Node 里打印
      // 只在 Node 里打印（浏览器控制台另有日志），方便自检
      console.log(`[ZOS-R] 社会层：POI ${this.poiByKindCount || this.poiCount} 个，家庭 ${this.nHh} 户，`
        + `在家 ${nHome} / 在单位 ${nWork}（${nPoiWork} 人的单位是真 POI），旅客 ${nTourist}`);
    }

    // 警察（随机散布，偏市中心）
    for (let j = 0; j < nPol && k < NMAX; j++) {
      // 警察驻在警局里：出警就是把局里的人派出去，不会凭空多出人
      // 开局：90% 在警局里，10% 散在城里巡逻
      let x, z, station = -1, onPatrol = 0;
      const stations0 = this.poiByKind.police || [];
      const wantPatrol = rng() < 0.1;
      if (stations0.length && !wantPatrol) {
        station = j % stations0.length;
        const st = stations0[station];
        const a = rng() * 6.2832, r = rng() * 15;
        const sx = st.x + Math.cos(a) * r, sz = st.z + Math.sin(a) * r;
        if (this.walkable(sx, sz)) { x = sx; z = sz; }
        else { x = st.x; z = st.z; station = -1; }
      } else {
        const w = this.randWalk(rng, 0.55);
        x = w[0]; z = w[1];
        if (stations0.length) { station = j % stations0.length; onPatrol = 1; }
      }
      const i = k++;
      this.stationOf[i] = station + 1;
      this.patrol[i] = onPatrol;
      this.px[i] = x; this.pz[i] = z;
      this.heading[i] = rng() * 6.2832;
      this.kind[i] = SP.POLICE;
      this.hp[i] = SPECIES[SP.POLICE].hp;
      this.spd[i] = SPECIES[SP.POLICE].speed * (0.95 + rng() * 0.1);
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.police + (this.rng() < 0.25 ? 3 : 0), skillFor('police'));
      this.phase[i] = rng(); this.timer[i] = 0; this.cool[i] = rng();
      this.ammo[i] = 40;                       // 一个弹匣，打光就跑
      this.acc[i] = P.policeAccuracy;
      this.pickWander(i);
    }

    // ---- 指派要员（VIP）：随机挑若干平民 ----
    {
      const want = Math.max(3, Math.min(6, Math.round(pop / 4000) + 2));
      let guard = 0;
      while (this.vips.length < want && guard++ < 20000) {
        const i = (rng() * k) | 0;              // 0..k-1 全是平民
        if (this.state[i] !== ST.CIV) continue;
        if (this.vip[i]) continue;
        this.vip[i] = 1;
        this.vips.push(i);
      }
      this.vipTotal = this.vips.length;
    }

    // ---------------- 爆发模式 ----------------
    //  compass（世界坐标）：东 = +x，西 = -x，南 = +z，北 = -z（卫星图正北朝上）
    this.origins = [];
    const putZombie = (x, z) => {
      const i = k++;
      this.px[i] = x; this.pz[i] = z;
      this.heading[i] = rng() * 6.2832;
      this.kind[i] = SP.ZOMBIE;
      this.hp[i] = SPECIES[SP.ZOMBIE].hp;
      this.spd[i] = P.zombieSpeed * (0.85 + rng() * 0.3);
      this.state[i] = ST.ZOMBIE;
      this.phase[i] = rng();
    };
    /** 在 (ox,oz) 附近撒 count 只 */
    const cluster = (ox, oz, count, rad) => {
      let made = 0;
      for (let j = 0; j < count && k < NMAX; j++) {
        for (let tr = 0; tr < 40; tr++) {
          const a = rng() * 6.2832, r = Math.sqrt(rng()) * rad;
          const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
          if (this.walkable(x, z)) { putZombie(x, z); made++; break; }
        }
      }
      return made;
    };
    const MW = this.nav.W || (this.nav.halfW * 2);
    const MH = this.nav.H || (this.nav.halfH * 2);
    /** 沿某条边取一个可走点（入侵模式） */
    const edgePoint = (dir) => {
      for (let tr = 0; tr < 200; tr++) {
        const u = (rng() - 0.5) * 0.86;              // 沿边 -43%..+43%
        let x, z;
        if (dir === 'N') { x = u * MW; z = -MH / 2 + 25 + rng() * 30; }
        else if (dir === 'S') { x = u * MW; z = MH / 2 - 25 - rng() * 30; }
        else if (dir === 'E') { x = MW / 2 - 25 - rng() * 30; z = u * MH; }
        else { x = -MW / 2 + 25 + rng() * 30; z = u * MH; }
        if (this.walkable(x, z)) return [x, z];
      }
      return this.randWalk(rng, 0.5);
    };

    const mode = P.mode || 'single';
    const zCount = Math.max(0, P.initialZombies | 0);
    let first = null;

    if (mode === 'invade') {
      const dir = P.invadeDir || 'N';
      const [ex, ez] = edgePoint(dir);
      first = [ex, ez];
      // 沿边铺开一条 ~180m 宽的入侵带，向城内推进
      for (let j = 0; j < zCount && k < NMAX; j++) {
        for (let tr = 0; tr < 40; tr++) {
          const along = (rng() - 0.5) * 180;         // 沿边方向 ±90m
          const depth = rng() * 45;                  // 向内 0~45m
          let x, z;
          if (dir === 'N') { x = ex + along; z = ez + depth; }
          else if (dir === 'S') { x = ex + along; z = ez - depth; }
          else if (dir === 'E') { z = ez + along; x = ex - depth; }
          else { z = ez + along; x = ex + depth; }
          if (this.walkable(x, z)) { putZombie(x, z); break; }
        }
      }
    } else if (mode === 'multi') {
      const pts = Math.max(1, Math.min(12, P.points | 0 || 3));
      const per = Math.max(1, P.perPoint | 0 || 40);
      for (let p = 0; p < pts; p++) {
        const [ox, oz] = this.randWalk(rng, 0.88);
        if (!first) first = [ox, oz];
        cluster(ox, oz, per, 38);
      }
    } else if (mode === 'stealth') {
      // 零号病人：开场没有丧尸，只有几个潜伏者混在人群里
      const want = Math.max(1, Math.min(3, P.carriers == null ? 3 : (P.carriers | 0) || 3));
      let made = 0;
      for (let tr = 0; tr < 200000 && made < want; tr++) {
        const i = (rng() * k) | 0;
        if (this.state[i] !== ST.CIV) continue;
        this.setInfected(i, this.rollIncubation());
        this.panic[i] = 0.6;
        made++;
      }
      first = this.randWalk(rng, 0.8);
      this.pushEvent('潜伏者已潜入', 'start');
    } else if (mode === 'waves') {
      const [ox, oz] = this.randWalk(rng, 0.75);
      first = [ox, oz];
      cluster(ox, oz, Math.max(1, P.initialZombies | 0), 50);
      // 剩下的波次交给 step() 定时投放
      this.waveLeft = Math.max(0, Math.min(12, P.waves | 0 || 4));
      this.waveEvery = Math.max(5, P.waveInterval | 0 || 40);
      this.waveNext = this.waveEvery;
      this.waveCount = Math.max(1, P.waveCount | 0 || 40);
    } else if (mode === 'apocalypse') {
      // 全城随机：不聚集，撒满整张图
      for (let j = 0; j < zCount && k < NMAX; j++) {
        for (let tr = 0; tr < 20; tr++) {
          const [x, z] = this.randWalk(rng, 1);
          if (this.walkable(x, z)) { putZombie(x, z); break; }
        }
      }
      first = this.randWalk(rng, 0.2);
    } else {
      // single：默认，随机一处
      const [ox, oz] = this.randWalk(rng, 0.7);
      first = [ox, oz];
      cluster(ox, oz, zCount, 55);
    }
    this.origin = first || [0, 0];
    this.origins.push(this.origin);
    // 动物：数量由开局参数决定，其中一部分一开始就是感染者
    const spawnList = [
      [SP.DOG, P.dogs | 0], [SP.CAT, P.cats | 0],
      [SP.BEAR, P.bears | 0], [SP.TIGER, P.tigers | 0],
    ];
    for (const [kind, count] of spawnList) {
      const asp = SPECIES[kind];
      for (let j = 0; j < count && k < NMAX; j++) {
        let x = 0, z = 0, ok = false;
        for (let tr = 0; tr < 60; tr++) {
          const [nx, nz] = this.randWalk(rng, 1);
          x = nx; z = nz; ok = true; break;
        }
        if (!ok) continue;
        const i = k++;
        this.px[i] = x; this.pz[i] = z;
        this.heading[i] = rng() * 6.2832;
        this.kind[i] = kind;
        this.hp[i] = asp.hp;
        this.spd[i] = asp.speed * (0.9 + rng() * 0.2);
        this.phase[i] = rng();
        this.pow[i] = 1;
        const wild = asp.team === TEAM.WILD;
        this.state[i] = wild ? ST.WILD : ST.CIV;
        this.idle[i] = 0; this.actT[i] = 10 + rng() * 40;
        // 初始感染：按感染率抽签
        if (rng() < (P.animalInfected || 0)) {
          if (wild) {
            this.state[i] = ST.ZOMBIE;
            this.hp[i] = asp.hpZombie || asp.hp;
            this.spd[i] = asp.speed * (asp.zombieSpeedMul || 1);
            this.pow[i] = asp.zombiePow || 1;
          } else {
            this.state[i] = ST.INFECTED;
            this.incTot[i] = this.rollIncubation() * 0.6;
            this.timer[i] = this.incTot[i];
          }
        }
        this.pickWander(i);
      }
    }
    this.n = k;
    this.countStats();
  }

  randWalk(rng, spread = 1) {
    const nav = this.nav;
    for (let t = 0; t < 400; t++) {
      let c, r;
      if (spread < 1) {
        const cxp = nav.cols / 2 + (rng() - 0.5) * nav.cols * spread;
        const czp = nav.rows / 2 + (rng() - 0.5) * nav.rows * spread;
        c = Math.max(0, Math.min(nav.cols - 1, cxp | 0));
        r = Math.max(0, Math.min(nav.rows - 1, czp | 0));
      } else {
        c = (rng() * nav.cols) | 0;
        r = (rng() * nav.rows) | 0;
      }
      if (nav.grid[r * nav.cols + c] & 1) {
        return [(c + 0.5) * nav.cell - nav.halfW, nav.halfH - (r + 0.5) * nav.cell];
      }
    }
    return [0, 0];
  }

  pickWander(i) {
    const rng = this.rng;
    const nav = this.nav;
    // 拒绝采样：目标必须落在可走格上，否则人会一直朝墙里走
    for (let t = 0; t < 8; t++) {
      const a = rng() * 6.2832, d = 20 + rng() * 90;
      let x = this.px[i] + Math.cos(a) * d;
      let z = this.pz[i] + Math.sin(a) * d;
      if (x < -nav.halfW + 8) x = -nav.halfW + 8;
      if (x > nav.halfW - 8) x = nav.halfW - 8;
      if (z < -nav.halfH + 8) z = -nav.halfH + 8;
      if (z > nav.halfH - 8) z = nav.halfH - 8;
      if (this.walkable(x, z)) { this.tx[i] = x; this.tz[i] = z; return; }
    }
    this.tx[i] = this.px[i];
    this.tz[i] = this.pz[i];
  }

  // ---------- 栅格工具 ----------
  walkable(x, z) {
    const nav = this.nav;
    // 网格第 0 行 = 南，而世界 z 也是南为正 → r = (halfH - z)/cell
    if (typeof nav.walkable === 'function') return nav.walkable(x, z);
    const c = ((x + nav.halfW) / nav.cell) | 0;
    const r = ((nav.halfH - z) / nav.cell) | 0;
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return false;
    return (nav.grid[r * nav.cols + c] & 1) !== 0;
  }

  // ---------- 粗网格寻路（tier B） ----------
  //  1m 网格做全局 A* 太贵（20 万人同时问路），所以压成 4m 粗网格做 BFS，
  //  只在"目标直线走不通"或"卡住了"的时候算一次，每帧限 40 条。
  buildCoarseGrid() {
    const nav = this.nav, cs = 4;
    this.cs = cs;
    this.gw = Math.ceil(nav.cols / cs);
    this.gh = Math.ceil(nav.rows / cs);
    const g = new Uint8Array(this.gw * this.gh);
    const cnt = new Uint8Array(this.gw * this.gh);
    for (let r = 0; r < nav.rows; r++) {
      const base = ((r / cs) | 0) * this.gw;
      for (let c = 0; c < nav.cols; c++) {
        if (nav.grid[r * nav.cols + c] & 1) cnt[base + ((c / cs) | 0)]++;
      }
    }
    // 一个 4×4 块至少 12/16 可走才算通 —— 否则"有一格能走"就算通，
    // 寻路会直接穿墙，人在墙间蹭（实测：中位速度只有 0.3 m/s）
    for (let k = 0; k < g.length; k++) if (cnt[k] >= 12) g[k] = 1;
    this.cgrid = g;
    this.came = new Int32Array(this.gw * this.gh);
    this.cseen = new Int32Array(this.gw * this.gh);
    this.cq = new Int32Array(this.gw * this.gh);
    this.cstamp = 0;
    this.pathBudget = 40;
  }

  ccell(x, z) {
    const nav = this.nav, cs = this.cs;
    const c = Math.floor((x + nav.halfW) / (nav.cell * cs));
    const r = Math.floor((nav.halfH - z) / (nav.cell * cs));
    if (c < 0 || r < 0 || c >= this.gw || r >= this.gh) return -1;
    return r * this.gw + c;
  }

  /** 从 (sx,sz) 到 (tx,tz) 出一条折线，最多 6 个路点；走不通返回 0 */
  planPath(i, tx, tz) {
    if (!this.cgrid || this.pathBudget <= 0) return 0;
    const s = this.ccell(this.px[i], this.pz[i]);
    const t = this.ccell(tx, tz);
    if (s < 0 || t < 0) return 0;
    if (!this.cgrid[t]) {
      // 目标在墙里/屋外：找它附近 3 格内最近的可行走粗格
      const gw = this.gw, tc = t % gw, tr = (t / gw) | 0;
      let best = -1;
      for (let dr = -3; dr <= 3 && best < 0; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
          const r2 = tr + dr, c2 = tc + dc;
          if (r2 < 0 || c2 < 0 || r2 >= this.gh || c2 >= gw) continue;
          const k = r2 * gw + c2;
          if (this.cgrid[k]) { best = k; break; }
        }
      }
      if (best < 0) return 0;
      this.planPath.to = best;
    }
    const goal = this.planPath.to !== undefined ? this.planPath.to : t;
    this.planPath.to = undefined;
    if (s === goal) return 0;

    const gw = this.gw, gh = this.gh;
    const stamp = ++this.cstamp;
    let head = 0, tail = 0;
    this.cq[tail++] = goal;
    this.cseen[goal] = stamp;
    this.came[goal] = -1;
    let found = false;
    while (head < tail && tail < 2500) {
      const cur = this.cq[head++];
      if (cur === s) { found = true; break; }
      const cr = (cur / gw) | 0, cc = cur - cr * gw;
      for (let k = 0; k < 4; k++) {
        const nr = cr + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const nc = cc + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nr < 0 || nc < 0 || nr >= gh || nc >= gw) continue;
        const nk = nr * gw + nc;
        if (this.cseen[nk] === stamp || !this.cgrid[nk]) continue;
        this.cseen[nk] = stamp;
        this.came[nk] = cur;
        this.cq[tail++] = nk;
      }
    }
    if (!found) return 0;
    this.pathBudget--;
    // 回溯 → 每隔 4 个粗格（16m）取一个路点
    let cur = s, n = 0;
    const step = 4;
    let hop = 0;
    while (cur >= 0 && n < 6) {
      if (hop % step === 0) {
        const cr = (cur / gw) | 0, cc = cur - cr * gw;
        this.pathX[i * 6 + n] = (cc + 0.5) * this.nav.cell * this.cs - this.nav.halfW;
        this.pathZ[i * 6 + n] = this.nav.halfH - (cr + 0.5) * this.nav.cell * this.cs;
        n++;
      }
      cur = this.came[cur];
      hop++;
    }
    this.pathN[i] = n;
    this.pathIdx[i] = 0;
    this.pathMade = (this.pathMade || 0) + 1;
    return n;
  }

  // ---------- 目标决策（M4） ----------
  /** 家里还活着的成员数（不含自己） */
  familyAlive(i) {
    if (!this.hhStart || !this.civAt || this.hh[i] >= this.nHh) return 0;
    const hid = this.hh[i];
    let n = 0;
    for (let p = this.hhStart[hid]; p <= this.hhEnd[hid]; p++) {
      const j = this.civAt[p];
      if (j === i) continue;
      const st = this.state[j];
      if (st !== ST.CORPSE && st !== ST.SAVED && st !== ST.ZOMBIE) n++;
    }
    return n;
  }

  /** 最近的某类 POI（工作地用不到，这里给医院/警局用） */
  nearestPoi(kind, x, z) {
    const list = this.poiByKind[kind];
    if (!list || !list.length) return null;
    let best = null, bd = Infinity;
    for (const p of list) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** 目标 → 世界坐标（没有目标点就返回 null，表示"原地/按通勤逻辑"） */
  goalPoint(i, g) {
    if (g === GOAL.HOME) return [this.homeX[i], this.homeZ[i]];
    if (g === GOAL.WORK) return [this.workX[i], this.workZ[i]];
    if (g === GOAL.FLEE || g === GOAL.HELP || g === GOAL.SHELTER || g === GOAL.MOVE_TO
        || g === GOAL.ARM_HOME) return [this.goalX[i], this.goalZ[i]];
    return null;
  }

  setGoal(i, g, x, z) {
    if (g === GOAL.ARM_HOME) { x = this.homeX[i]; z = this.homeZ[i]; }
    this.goal[i] = g;
    if (x !== undefined) { this.goalX[i] = x; this.goalZ[i] = z; }
  }

  /** 现在几点（游戏分钟 0..1439） */
  get clockMin() {
    return (this.startMin + Math.floor(this.time)) % DAY_SECONDS;
  }

  /** 第几天（从 1 开始） */
  get dayIndex() {
    return 1 + Math.floor((this.startMin + Math.floor(this.time)) / DAY_SECONDS);
  }

  /** 当前时段名（深夜/早晨/白天/傍晚/夜晚） */
  get segName() {
    const m = this.clockMin;
    let name = '深夜';
    for (const t of TIME_SEGS) if (m >= t.at) name = t.name;
    return name;
  }

  /** 夜色 0..1：白天 0，19:00 起变暗，23:00 全黑，05:00 起变亮，06:30 天亮 */
  get nightFactor() {
    const h = this.clockMin / 60;
    if (h >= 6.5 && h < 19) return 0;
    if (h >= 19 && h < 23) return (h - 19) / 4;
    if (h >= 23 || h < 5) return 1;
    if (h >= 5 && h < 6.5) return 1 - (h - 5) / 1.5;
    return 0;
  }

  /** 撤离口在哪里（给 UI 用）：返回 {name, x, z} —— 边的中点 */
  escapeLine() {
    const nav = this.nav, m = 30;
    const map = {
      N: { name: '北', x: 0, z: -nav.halfH + m },
      S: { name: '南', x: 0, z: nav.halfH - m },
      W: { name: '西', x: -nav.halfW + m, z: 0 },
      E: { name: '东', x: nav.halfW - m, z: 0 },
    };
    return map[this.escapeSide] || map.N;
  }

  /** 是否已经站到逃离线上（离那条边 60m 内） */
  onEscapeLine(i) {
    const nav = this.nav, b = 60;
    switch (this.escapeSide) {
      case 'N': return this.pz[i] <= -nav.halfH + b;
      case 'S': return this.pz[i] >= nav.halfH - b;
      case 'W': return this.px[i] <= -nav.halfW + b;
      case 'E': return this.px[i] >= nav.halfW - b;
      default: return false;
    }
  }

  /** 朝逃离线的目标点（垂直投影：走最短路） */
  escapePoint(i) {
    const nav = this.nav, m = 40;
    switch (this.escapeSide) {
      case 'N': return [this.px[i], -nav.halfH + m];
      case 'S': return [this.px[i], nav.halfH - m];
      case 'W': return [-nav.halfW + m, this.pz[i]];
      case 'E': return [nav.halfW - m, this.pz[i]];
      default: return [0, 0];
    }
  }

  /** 逃跑方向：背离最近的丧尸 / 丧尸群重心，取地图边上的一个点 */
  fleePoint(i) {
    const nav = this.nav;
    let dx = 0, dz = 0;
    const z = this.nearZ[i];
    if (z >= 0) { dx = this.px[i] - this.px[z]; dz = this.pz[i] - this.pz[z]; }
    else if (this.origin) { dx = this.px[i] - this.origin[0]; dz = this.pz[i] - this.origin[1]; }
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // 往这个方向一直走到地图边缘（**从当前位置算**，不是从原点 —— 之前算错，目标点跑到地图外了）
    const halfW = nav.halfW, halfH = nav.halfH, M = 60;
    const px0 = this.px[i], pz0 = this.pz[i];
    const tx = dx > 1e-6 ? (halfW - M - px0) / dx : (dx < -1e-6 ? (-halfW + M - px0) / dx : Infinity);
    const tz = dz > 1e-6 ? (halfH - M - pz0) / dz : (dz < -1e-6 ? (-halfH + M - pz0) / dz : Infinity);
    const t = Math.max(0, Math.min(tx, tz));
    return [px0 + dx * t, pz0 + dz * t];
  }

  /**
   * 决策：按"效用打分"选一个目标（每 1~2 秒一次，分帧错开）。
   * 分数不是玄学，每一项都对应规划里的 w1..w6：
   *   安全(离丧尸多远) / 信息(知不知道) / 距离 / 家庭 / 性格 / 从众
   */
  decide(i) {
    const st = this.state[i];
    if (st !== ST.CIV && st !== ST.FLEE && st !== ST.FIGHT && st !== ST.INFECTED) return;
    const aware = this.aware[i];
    const brave = braveOf(i);
    const near = this.zDanger(i);          // 0..1，越近越危险（只看感知 + 附近的枪声）
    const fam = this.familyAlive(i);
    const homeD = Math.hypot(this.homeX[i] - this.px[i], this.homeZ[i] - this.pz[i]);
    const gun = this.homeHasGun(i) && !this.armed[i];
    const friend = this.nearFriends(i);    // 附近同类的人数（从众）

    let best = this.goal[i], bs = -1;
    const consider = (g, sc) => { if (sc > bs) { bs = sc; best = g; } };

    // 发病的人：不管知不知道外面出事了，都会往医院跑（这是零号病人的核心叙事）
    if (this.sick[i] && this.state[i] === ST.INFECTED) {
      const hp = this.nearestPoi('hospital', this.px[i], this.pz[i]);
      if (hp) {
        if (this.goal[i] !== GOAL.HELP) this.setGoal(i, GOAL.HELP, hp.x, hp.z);
        return;
      }
    }

    if (near > 0.25) {
      // 附近有丧尸：先保命，再看牵挂
      consider(GOAL.FLEE, 1.0 + (1 - brave) * 0.7 + near * 0.4);
      if (fam > 0) consider(GOAL.HOME, 0.75 + (1 - brave) * 0.5 + (homeD < 500 ? 0.35 : 0) - homeD / 4000);
      if (gun) consider(GOAL.ARM_HOME, 0.55 + brave * 0.8 + (homeD < 300 ? 0.3 : 0) - homeD / 5000);
      // 混乱度 ≥ 50%：优先去警局避难（到了那儿、而且混乱度够了，才拿得到枪）
      if (this.chaos >= 50) consider(GOAL.SHELTER, 0.9 + (1 - brave) * 0.4);
      consider(GOAL.HOLD, 0.35 + (1 - brave) * 0.7);
      if (this.state[i] === ST.INFECTED) consider(GOAL.HELP, 1.1);
      consider(GOAL.FOLLOW, 0.25 + Math.min(1, friend / 12) * 0.5);
    } else if (aware >= 1) {
      // 只是听说：半信半疑 —— 有家人的往家走，没牵挂的往城外跑，
      // 有枪的回家拿枪，胆小的固守，也有人压根不信
      const famW = Math.min(1, fam / 2);
      // 家越远越不想回（走 3 公里不如直接跑）
      consider(GOAL.HOME, 0.30 + 0.45 * famW + (1 - brave) * 0.2 + (homeD < 400 ? 0.1 : 0)
        - Math.min(0.35, homeD / 3000));
      consider(GOAL.FLEE, 0.28 + this.heat * 0.35 + (fam === 0 ? 0.3 : 0) + brave * 0.15);
      consider(GOAL.HOLD, 0.22 + (1 - brave) * 0.45 + (homeD < 80 ? 0.25 : 0));
      if (gun) consider(GOAL.ARM_HOME, 0.30 + brave * 0.5 + (homeD < 500 ? 0.15 : 0));
      if (this.chaos >= 50) consider(GOAL.SHELTER, 0.55 + (1 - brave) * 0.5);
      if (this.state[i] === ST.INFECTED) consider(GOAL.HELP, 0.9);
      consider(GOAL.NONE, 0.30);       // 有人就是不信/不动
    } else {
      // 什么都不知道：照常通勤
      consider(GOAL.HOME, 0.5);
      consider(GOAL.WORK, 0.5);
      consider(GOAL.NONE, 0.3);
    }

    // 惯性：已经选定的目标给一点加分，否则人会在两个目标之间每秒横跳
    // 混乱度 ≥ 50%：全城的人都想往警局跑（不管他知不知道、看没看见）
    if (this.chaos >= 50) {
      const pp = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (pp) {
        const d = Math.hypot(pp.x - this.px[i], pp.z - this.pz[i]);
        consider(GOAL.SHELTER, 1.25 - Math.min(0.45, d / 4000));
      }
    }

    // 惯性：当前目标加一点分。没有这个，人会在"回家"和"逃"之间每 1.5 秒横跳，
    // 走 15 秒往家、再 15 秒往城外，30 秒净位移约等于 0（测试里表现为"卡住")
    const cur = this.goal[i];
    if (cur !== GOAL.NONE && best !== cur) {
      const momentum = cur === GOAL.FLEE ? 0.10 : 0.14;
      if (bs - momentum <= this.lastScore[i]) best = cur;
    }
    this.lastScore[i] = bs;

    if (best === this.goal[i] && best !== GOAL.FLEE && best !== GOAL.NONE) {
      // 目标没变就不用重复设点（尤其是逃跑点，别每帧重算）
      return;
    }
    let gx, gz;
    if (best === GOAL.FLEE) { const p = this.escapePoint(i); gx = p[0]; gz = p[1]; }
    else if (best === GOAL.HELP) {
      const h = this.nearestPoi('hospital', this.px[i], this.pz[i]);
      if (h) { gx = h.x; gz = h.z; }
      else { const p = this.fleePoint(i); gx = p[0]; gz = p[1]; }
    } else if (best === GOAL.SHELTER) {
      const p = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (p) { gx = p.x; gz = p.z; } else { const q = this.fleePoint(i); gx = q[0]; gz = q[1]; }
    } else if (best === GOAL.ARM_HOME) { gx = this.homeX[i]; gz = this.homeZ[i]; }
    else if (best === GOAL.FOLLOW) { const q = this.escapePoint(i); gx = q[0]; gz = q[1]; }
    const changed = best !== this.goal[i];
    this.setGoal(i, best, gx, gz);
    // 承诺：换了目标就 8~14 秒内不再改主意（逃的话更长）
    this.decT[i] = this.time + (changed
      ? (best === GOAL.FLEE ? 14 : 8 + this.rng() * 6)
      : 1.0 + this.rng() * 1.2);
  }

  /** 到达目标点之后干什么 */
  arrive(i) {
    const g = this.goal[i];
    if (g === GOAL.ARM_HOME) {
      // 从**自家的军械库**里拿：有几把枪、几发子弹都是开局就定好的
      if (!this.armed[i] && this.hhStart && this.hh[i] < this.nHh) {
        const stock = this.homeStocks.get(this.hh[i]);
        const got = stock ? takeWeapon(stock, this.rng) : null;
        if (got) {
          this.giveWeapon(i, got.id, skillFor('civilian') + (this.rng() - 0.5) * 0.2);
          // 弹匣装满，剩下的进备弹（受这户人家实际的子弹数限制）
          const w = weaponOf(got.id);
          const total = got.rounds;
          this.mag[i] = Math.min(w.mag, total);
          this.reserve[i] = Math.max(0, Math.min(255, total - this.mag[i]));
          this.ammo[i] = this.mag[i];
        }
      }
      this.setGoal(i, GOAL.HOLD, this.homeX[i], this.homeZ[i]);
      this.idle[i] = 1;
      this.actT[i] = 8 + this.rng() * 10;
      return;
    }
    if (g === GOAL.SHELTER) {
      // 到警局避难：**混乱度 ≥ 50% 才拿得到枪**（低于 50% 时警察还在岗，军械库不给平民开）
      const poi = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (!this.armed[i] && this.chaos >= 50 && poi && poi.store) {
        const got = takeWeapon(poi.store, this.rng);
        if (got) {
          this.giveWeapon(i, got.id, skillFor('civilian') + (this.rng() - 0.5) * 0.2);
          const w = weaponOf(got.id);
          this.mag[i] = Math.min(w.mag, got.rounds);
          this.reserve[i] = Math.max(0, Math.min(255, got.rounds - this.mag[i]));
          this.ammo[i] = this.mag[i];
        }
      }
      this.setGoal(i, GOAL.HOLD, this.px[i], this.pz[i]);
      this.idle[i] = 1;
      this.actT[i] = 30 + this.rng() * 60;      // 就守在警局
      return;
    }
    if (g === GOAL.HOME) {
      // 到家顺手把家里的枪拿上（如果他家本来就有枪）
      if (!this.armed[i] && this.homeHasGun(i)) {
        const stock = this.homeStocks.get(this.hh[i]);
        const got = stock ? takeWeapon(stock, this.rng) : null;
        if (got) {
          this.giveWeapon(i, got.id, skillFor('civilian') + (this.rng() - 0.5) * 0.2);
          const w = weaponOf(got.id);
          this.mag[i] = Math.min(w.mag, got.rounds);
          this.reserve[i] = Math.max(0, Math.min(255, got.rounds - this.mag[i]));
          this.ammo[i] = this.mag[i];
        }
      }
      // 家里人还活着 → 一起固守；没人 → 转头逃
      const fam = this.familyAlive(i);
      if (fam > 0) {
        this.setGoal(i, GOAL.HOLD, this.homeX[i], this.homeZ[i]);
        // 在家的人也跟着一起固守（团聚）
        if (this.hhStart && this.hh[i] < this.nHh) {
          const hid = this.hh[i];
          for (let p = this.hhStart[hid]; p <= this.hhEnd[hid]; p++) {
            const j = this.civAt[p];
            if (j !== i && this.state[j] === ST.CIV && this.goal[j] === GOAL.NONE) {
              this.setGoal(j, GOAL.HOLD, this.homeX[j], this.homeZ[j]);
            }
          }
        }
      } else {
        const p = this.fleePoint(i);
        this.setGoal(i, GOAL.FLEE, p[0], p[1]);
      }
      this.idle[i] = 1;
      this.actT[i] = 20 + this.rng() * 40;
      return;
    }
    if (g === GOAL.FLEE) {
      // 跑到**指定的那条逃离线**才算撤离（其它三条边不算，那边是尸潮来的方向）
      if (this.onEscapeLine(i)) {
        this.state[i] = ST.SAVED;
        this.saved++;
        this.pushEvent(`有人从${this.escapeLine().name}侧撤离`, 'start');
      } else {
        const p = this.escapePoint(i);
        this.setGoal(i, GOAL.FLEE, p[0], p[1]);
      }
      return;
    }
    // HELP / HOLD / FOLLOW：到了就在原地待着（医院治不好人，只是有人愿意来）
    this.idle[i] = 1;
    this.actT[i] = 15 + this.rng() * 30;
  }

  /** 危险度 0..1：感知到丧尸 → 越高越危险；没看见但听到枪声也有一点 */
  zDanger(i) {
    const z = this.nearZ[i];
    if (z < 0) return 0;
    const d = Math.hypot(this.px[i] - this.px[z], this.pz[i] - this.pz[z]);
    return Math.max(0, Math.min(1, 1 - d / 40));
  }

  /** 附近同类人数（粗算，用于从众项） */
  nearFriends(i) {
    // 用空间哈希里同格附近的人头数近似，避免额外遍历
    const nav = this.nav, cell = this.hcell;
    const c = ((this.px[i] + nav.halfW) / cell) | 0;
    const r = ((this.pz[i] + nav.halfH) / cell) | 0;
    if (c < 0 || r < 0 || c >= this.hcols || r >= this.hrows) return 0;
    return this.hCount[r * this.hcols + c];
  }

  // ---------- 信息层（M3） ----------
  setAware(i, level) {
    if (level <= this.aware[i]) return false;
    const first = !this.aware[i];
    if (first) this.nAware++;
    this.aware[i] = level;
    if (level >= 2 && this.state[i] === ST.CIV) this.panic[i] = Math.min(1, this.panic[i] + 0.4);
    if (first) {
      // 刚知道的人：过几秒开始打电话，一共打 3~4 通（打完就不打了，剩下的靠网络）
      this.callsLeft[i] = 3 + (Math.floor(h(i, 71) * 2) | 0);
      this.callT[i] = this.time + 3 + this.rng() * 8;
    }
    return true;
  }

  /** 联系人：0/1 家人（真实家庭）、2/3 同事、4 邻居 */
  callContact(i, k) {
    const n = this.n;
    if (k < 2 && this.hh && this.hhStart && this.civAt && this.hh[i] < this.nHh) {
      const hid = this.hh[i];
      const a = this.hhStart[hid], b = this.hhEnd[hid];
      const size = b - a + 1;
      if (size > 1) {
        const self = i - this.civAt[a];
        const j = this.civAt[a + ((self + 1 + k) % size)];
        if (j !== undefined && j !== i) return j;
      }
    }
    const j = (Math.floor(h(i, 60 + k) * n) + 1) | 0;
    return j < n ? j : -1;
  }

  stepInfo(dt) {
    const t = this.time, n = this.n;
    // ---- 电话：轮转处理，每帧最多 600 次 ----
    let budget = 600;
    for (let i = 0; i < n && budget > 0; i++) {
      if (this.aware[i] < 1 || this.callsLeft[i] === 0) continue;
      if (this.callT[i] > t) continue;
      const st = this.state[i];
      if (st === ST.ZOMBIE || st === ST.CORPSE || st === ST.SAVED || st === ST.WILD) continue;
      this.callT[i] = t + 18 + this.rng() * 16;    // 半小时内打几通：现实节奏，不是刷屏
      this.callsLeft[i]--;
      budget--;
      const k = this.callK[i];
      this.callK[i] = (k + 1) % 5;
      const j = this.callContact(i, k);
      if (j < 0 || this.aware[j] >= this.aware[i]) continue;
      const sj = this.state[j];
      if (sj !== ST.CIV && sj !== ST.FLEE && sj !== ST.FIGHT && sj !== ST.INFECTED && sj !== ST.POLICE) continue;
      const p = (k < 2 ? 0.6 : (k < 4 ? 0.35 : 0.25)) * (this.aware[i] >= 2 ? 1.25 : 1);
      if (this.rng() < p * this.infoRate) this.setAware(j, 1);
    }

    // ---- 卡住检测：每秒看一次净位移，连续 12 秒没靠近目标就认命固守 ----
    if (t >= this.stuckT2) {
      const nav = this.nav;
      this.stuckT2 = t + 1;
      // 分三片轮转：每人每 3 秒检查一次，省一半以上开销
      const slice = this.stuckSlice | 0;
      this.stuckSlice = (slice + 1) % 3;
      for (let i = slice; i < n; i += 3) {
        if (this.state[i] !== ST.CIV) continue;
        const g = this.goal[i];
        if (g === GOAL.NONE || g === GOAL.HOLD) continue;
        const gp = this.goalPoint(i, g);
        if (!gp) continue;
        const d = Math.hypot(gp[0] - this.px[i], gp[1] - this.pz[i]);
        if (d < 8) { this.stuckT[i] = 0; continue; }
        // 目标在楼里、已经站在楼外十几米处：算"到了"（不然会在一堵墙上蹭一整天）
        if (d < 14 && nav.indoor && nav.indoor(gp[0], gp[1])) {
          this.stuckT[i] = 0;
          this.arrive(i);
          continue;
        }
        const moved = Math.hypot(this.px[i] - this.lastX[i], this.pz[i] - this.lastZ[i]);
        this.lastX[i] = this.px[i]; this.lastZ[i] = this.pz[i];
        if (moved < 2) {
          this.stuckT[i] += 1;
          // 第 2 秒：换一侧沿墙走（Bug 算法在墙角打转时，换边就能绕出去）
          if (this.stuckT[i] === 2) {
            // 第 2 秒：先换一侧沿墙走，同时规划一条粗网格路径（两者都试）
            this.side[i] = -(this.side[i] || 1);
            const gp3 = this.goalPoint(i, this.goal[i]);
            if (gp3) this.planPath(i, gp3[0], gp3[1]);
          }
          // 第 5 秒：还不行就随机抖一下方向，打破对称
          else if (this.stuckT[i] === 5) { this.side[i] = -(this.side[i] || 1); }

          else if (this.stuckT[i] >= 3) {
            // 卡住 3 秒：往目标方向偏一点找个路点绕一下（廉价版的"局部寻路"）
            const gp2 = this.goalPoint(i, this.goal[i]);
            if (gp2) {
              const base = Math.atan2(gp2[1] - this.pz[i], gp2[0] - this.px[i]);
              for (let k = 0; k < 6; k++) {
                const a = base + (this.rng() - 0.5) * 1.8;
                const r = 40 + this.rng() * 50;
                const x = this.px[i] + Math.cos(a) * r, z = this.pz[i] + Math.sin(a) * r;
                if (this.walkable(x, z)) { this.wpX[i] = x; this.wpZ[i] = z; this.wpT[i] = this.time + 12; break; }
              }
            }
            if (this.stuckT[i] > 12) {
              this.stuckT[i] = 0;
              this.setGoal(i, GOAL.HOLD, this.px[i], this.pz[i]);
              this.idle[i] = 1;
              this.actT[i] = 10 + this.rng() * 20;
            }
          }
        } else this.stuckT[i] = 0;
      }
    }

    this.stepVip(dt);

    // ---- 自动出警：没人处理的报警，从最近警局派人过去（和玩家调度同一段代码）----
    if (this.alarms.length) {
      for (const e of this.alarms) {
        if (e.ack) continue;
        if (e.ids && e.ids.length) {
          for (const id of e.ids) {
            if (this.state[id] === ST.POLICE || this.state[id] === ST.SOLDIER) {
              if (Math.hypot(this.px[id] - e.x, this.pz[id] - e.z) < 50) { e.ack = true; break; }
            }
          }
        }
        if (this.time >= this.nextDispatch && !e.responders && this.time - e.t < 180) {
          const r = this.dispatchPolice(e.x, e.z, 2);
          if (r.ok) {
            e.responders = r.n;
            e.ids = r.ids || [];
            this.nextDispatch = this.time + 4;
          }
          break;
        }
      }
    }

    // ---- 感染率 / 戒严（每秒一次）----
    if (t >= this.rateT) {
      this.rateT = t + 1;
      const s = this.stats;
      this.infectRate = (s.zombie + s.infected) / Math.max(1, this.pop0 || this.n);
      this.awareRate = this.nAware / Math.max(1, this.n);
      // 混乱度 = 知情值×1 + 感染值×2，上限 100
      const was = this.martialLaw;
      this.chaos = Math.min(CHAOS_W.cap,
        this.awareRate * 100 * CHAOS_W.aware + this.infectRate * 100 * CHAOS_W.infect);
      // 50% 是"秩序崩溃"的分水岭（原来的 20% 感染率阈值改成它）
      this.martialLaw = this.chaos >= this.chaosAt;
      if (this.martialLaw && !was) this.pushEvent('秩序崩溃：混乱度达到 50%', 'start');
    }

    // ---- 网络：热度随知晓率涨，每 2 秒刷一波 ----
    if (t >= this.netT) {
      this.netT = t + 2;
      const frac = this.nAware / Math.max(1, n);
      // 3% 的人知道时热度约 0.4；10% 时基本满
      const target = Math.min(1, frac * 6);
      this.heat += (target - this.heat) * 0.12;
      const K = Math.floor(this.heat * this.heat * 18 * this.infoRate);
      for (let c = 0; c < K; c++) {
        const j = (this.rng() * n) | 0;
        if (this.aware[j] === 0 && this.state[j] === ST.CIV) this.setAware(j, 1);
      }
    }
  }

  // ---------- 空间哈希 ----------
  rebuildHash() {
    const hc = this.hcols, hr = this.hrows, cell = this.hcell;
    const nav = this.nav;
    this.hCount.fill(0);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const s = this.state[i];
      if (s === ST.CORPSE || s === ST.SAVED) continue;
      const c = ((this.px[i] + nav.halfW) / cell) | 0;
      const r = ((this.pz[i] + nav.halfH) / cell) | 0;
      if (c < 0 || r < 0 || c >= hc || r >= hr) continue;
      this.hCount[r * hc + c]++;
    }
    let s = 0;
    for (let k = 0; k < hc * hr; k++) { this.hStart[k] = s; s += this.hCount[k]; }
    this.hStart[hc * hr] = s;

    // 用 hCount 作为游标
    const cur = this.hCount;
    for (let k = 0; k < hc * hr; k++) cur[k] = this.hStart[k];
    for (let i = 0; i < n; i++) {
      const st = this.state[i];
      if (st === ST.CORPSE || st === ST.SAVED) continue;
      const c = ((this.px[i] + nav.halfW) / cell) | 0;
      const r = ((this.pz[i] + nav.halfH) / cell) | 0;
      if (c < 0 || r < 0 || c >= hc || r >= hr) continue;
      this.hOrder[cur[r * hc + c]++] = i;
    }
  }

  // 在半径内找最近的目标（状态集合）
  // want: 1=丧尸 2=平民 3=警察 4=健康平民
  // 有碰撞层时顺带查视线：墙挡住看不见；窗/围栏不挡（只对刷新最近距离的候选做，省开销）
  findNearest(i, want, maxR) {
    const hc = this.hcols, hr = this.hrows, cell = this.hcell;
    const nav = this.nav;
    const hasLos = typeof nav.los === 'function';
    const cx = ((this.px[i] + nav.halfW) / cell) | 0;
    const cz = ((this.pz[i] + nav.halfH) / cell) | 0;
    const rad = Math.max(1, Math.ceil(maxR / cell));
    const r2 = maxR * maxR;
    let best = -1, bd = r2;
    const x0 = this.px[i], z0 = this.pz[i];
    for (let r = cz - rad; r <= cz + rad; r++) {
      if (r < 0 || r >= hr) continue;
      for (let c = cx - rad; c <= cx + rad; c++) {
        if (c < 0 || c >= hc) continue;
        const k = r * hc + c;
        const e = this.hStart[k + 1];
        for (let p = this.hStart[k]; p < e; p++) {
          const j = this.hOrder[p];
          if (j === i) continue;
          const st = this.state[j];
          const ok = want === 1 ? (st === ST.ZOMBIE)
            : want === 2 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED)
              : want === 4 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT)
                : want === 5 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                st === ST.INFECTED || st === ST.WILD)          // 丧尸的猎物：人和野兽
                  : want === 6 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                  st === ST.POLICE || st === ST.SOLDIER || st === ST.ZOMBIE)
                    : (st === ST.POLICE);
          if (!ok) continue;
          if (this.aStage[j]) continue;      // 正在转身/倒地的不是有效目标
          const dx = this.px[j] - x0, dz = this.pz[j] - z0;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            // 12m 内算贴身感知，不做视线检查
            if (hasLos && d2 > 144 && !nav.los(x0, z0, this.px[j], this.pz[j])) continue;
            bd = d2; best = j;
          }
        }
      }
    }
    return best;
  }

  // ---------- 移动（绕墙 + 走门） ----------
  // 策略：正前方 → 按固定一侧逐步加角度探测（Bug 算法，不会来回抖）
  //       全被堵 → 沿"门场"梯度朝最近的门走
  //       真动不了 → 换目标（连卡 0.6 秒就翻边/换点）
  move(i, dx, dz, speed, dt) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const nav = this.nav;
    const stepLen = Math.min(speed * dt, nav.cell * 0.8);
    const base = Math.atan2(dz, dx);
    const side = this.side[i] || 1;
    const ox = this.px[i], oz = this.pz[i];

    for (let k = 0; k < PROBE.length; k++) {
      const a = base + PROBE[k] * side * DEG;
      const ux = Math.cos(a), uz = Math.sin(a);
      const nx = ox + ux * stepLen;
      const nz = oz + uz * stepLen;
      if (!this.walkable(nx, nz)) continue;
      this.px[i] = nx; this.pz[i] = nz;
      // 落地校验：Float32 存储会把探测点舍入，极少数会跨过格子边界落进墙里
      if (!this.walkable(this.px[i], this.pz[i])) {
        this.px[i] = ox; this.pz[i] = oz;
        continue;
      }
      this.heading[i] = a;
      // 步态：一个完整周期走 stride 米。人 1.45m、狗 0.8m、熊 2.4m
      const sp0 = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
      const stride = 1.45 * (sp0.scale || 1);
      this.phase[i] = (this.phase[i] + (speed / stride) * dt) % 1;
      this.stuck[i] = 0;
      return true;
    }

    // 被墙围住了：朝最近的门走
    const g = nav.doorGradient ? nav.doorGradient(ox, oz) : null;
    if (g) {
      const a = Math.atan2(g.z, g.x);
      const nx = ox + Math.cos(a) * stepLen;
      const nz = oz + Math.sin(a) * stepLen;
      if (this.walkable(nx, nz)) {
        this.px[i] = nx; this.pz[i] = nz;
        if (this.walkable(this.px[i], this.pz[i])) {
          this.heading[i] = a;
          const sp1 = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
          this.phase[i] = (this.phase[i] + (speed / (1.45 * (sp1.scale || 1))) * dt) % 1;
          this.stuck[i] = 0;
          return true;
        }
        this.px[i] = ox; this.pz[i] = oz;
      }
    }

    // 彻底动不了
    this.stuck[i] += dt;
    if (this.stuck[i] > 0.6) {
      this.side[i] = -side;       // 先翻边，下个 tick 往另一侧绕
      this.stuck[i] = 0;
      this.pickWander(i);
    }
    return false;
  }

  // ---------- 主 tick ----------
  step(dt, camX, camZ) {
    this.tick++;
    this.time += dt;

    // 特感投放：疫情越严重，刷得越快、类型越狠
    this.nextSpecial -= dt;
    if (this.nextSpecial <= 0 && this.n < NMAX - 60) {
      const zc = this.stats.zombie;
      if (zc >= 15) {
        const lvl = zc < 60 ? 0 : (zc < 220 ? 1 : 2);
        const pool = lvl === 0 ? [SP.CHARGER, SP.BOOMER]
          : lvl === 1 ? [SP.CHARGER, SP.BOOMER, SP.SPITTER, SP.TANK]
            : SPECIAL_KINDS.concat([SP.TANK, SP.TANK]);
        this.spawnSpecial(pool[(this.rng() * pool.length) | 0]);
        this.nextSpecial = 26 - lvl * 7 + this.rng() * 10;
      } else {
        this.nextSpecial = 4;
      }
    }

    // 连环爆发：定时在别处再开一个点
    if (this.waveLeft > 0) {
      this.waveNext -= dt;
      if (this.waveNext <= 0) {
        this.waveLeft--;
        this.waveNext = this.waveEvery;
        const [wx, wz] = this.randWalk(this.rng, 0.9);
        this.origins.push([wx, wz]);
        for (let j = 0; j < this.waveCount; j++) {
          let ok = false;
          for (let tr = 0; tr < 30; tr++) {
            const a = this.rng() * 6.2832, r = Math.sqrt(this.rng()) * 45;
            const x = wx + Math.cos(a) * r, z = wz + Math.sin(a) * r;
            if (this.walkable(x, z)) {
              const idx = this.addUnit(x, z, SP.ZOMBIE);
              if (idx >= 0) this.spd[idx] = (this.params.zombieSpeed || 2) * (0.85 + this.rng() * 0.3);
              ok = true; break;
            }
          }
          if (!ok) break;
        }
        this.pushEvent('新的爆发点', 'start');
        this.pushAudio('groan', wx, wz, 1.2);
      }
    }

    this.pathBudget = 8;       // 每帧恢复寻路预算（BFS 很贵，宁少勿多）
    this.stepInfo(dt);
    this.rebuildHash();

    const P = this.params;
    const n = this.n;
    const rng = this.rng;
    const far2 = 520 * 520;
    const doPerception = (i) => ((i + this.tick) % 3) === 0;

    for (let i = 0; i < n; i++) {
      let st = this.state[i];
      if (st === ST.SAVED) continue;

      const dxc = this.px[i] - camX, dzc = this.pz[i] - camZ;
      const far = dxc * dxc + dzc * dzc > far2;
      if (far && ((i + this.tick) & 3) !== 0) continue; // 视口外 5Hz
      // 视口外只更新 1/4 的帧 → 步长按 4 倍补偿，否则远处的人会"慢动作"
      const cdt = far ? dt * 4 : dt;

      if (this.fleeCd[i] > 0) this.fleeCd[i] -= dt;

      // 不可打断的动作（turn01 / die01 / zrise01）：先推进，再决定要不要冻结
      if (this.aStage[i]) {
        this.tickStage(i, cdt);
        if (this.aStage[i]) continue;      // 还在播 → 不移动、不寻敌、不被咬
        st = this.state[i];                // 阶段可能刚把 state 改成 ZOMBIE，必须刷新
      }
      // 尸体：躺够了就爬起来（和"活着转身"共用同一个绝对死线）
      if (st === ST.CORPSE || this.state[i] === ST.CORPSE) {
        if (this.riseAt[i] > 0 && this.time >= this.riseAt[i]) {
          this.riseAt[i] = 0;
          this.beginRise(i);
        }
        continue;
      }

      // ---- 感知（staggered）----
      if (doPerception(i)) {
        if (st === ST.ZOMBIE) {
          this.nearC[i] = this.findNearest(i, 4, 60);
        } else if (st === ST.POLICE) {
          this.nearZ[i] = this.findNearest(i, 1, 46);
          // 警察有电台，默认知道；但零号病人模式下连他们也不知道（还没发生任何事）
          if (!this.longInc && this.aware[i] < 3) this.setAware(i, 3);
        } else if (st === ST.WILD) {
          const wsp = SPECIES[this.kind[i]] || SPECIES[SP.BEAR];
          this.nearC[i] = this.findNearest(i, 6, wsp.range || 90);
        } else if (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED) {
          this.nearZ[i] = this.findNearest(i, 1, 26);
          // 目击：真的看见了 → 知晓度 2（之后才开始打电话 / 上网）
          if (this.nearZ[i] >= 0 && this.aware[i] < 2) this.setAware(i, 2);
          // 85% 的人有手机：看到丧尸会打 110（同一片 60 秒内只报一次）
          if (this.nearZ[i] >= 0 && h(i, 81) < 0.85 && this.rng() < 0.25) {
            this.reportEvent(this.px[i], this.pz[i], 1);
          }
        }
      }

      switch (st) {
        // ---------------- 平民 ----------------
        case ST.CIV: {
          // ---- 目标决策（M4）：每 1~2 秒一次，错峰 ----
          if (this.time >= this.decT[i]) {
            this.decT[i] = this.time + 0.9 + this.rng() * 1.1;
            this.decide(i);
          }
          // 持枪且看见丧尸 → 还击（原有的 FIGHT 状态负责开枪）
          if (this.armed[i] && this.nearZ[i] >= 0 && this.zDanger(i) > 0.3 && this.state[i] === ST.CIV) {
            this.state[i] = ST.FIGHT;
            this.panic[i] = 1;
            break;
          }
          // 什么都不知道 / 没目标 → 照常通勤
          if (this.goal[i] === GOAL.NONE && this.time >= this.commuteAt[i]) {
            this.commuteAt[i] = this.time + 70 + this.rng() * 110;
            this.goal[i] = h(i, 33) < 0.5 ? GOAL.HOME : GOAL.WORK;
            this.idle[i] = 0;
            this.actT[i] = 0;
          }
          if (this.goal[i] !== GOAL.NONE) {
            const gp = this.goalPoint(i, this.goal[i]);
            if (gp) {
              // 有粗网格路径 → 沿路点走（这是唯一能绕过楼群堵截的办法）
              if (this.pathN[i] > 0) {
                const k = this.pathIdx[i];
                const wx = this.pathX[i * 6 + k], wz = this.pathZ[i * 6 + k];
                const wdx = wx - this.px[i], wdz = wz - this.pz[i];
                if (wdx * wdx + wdz * wdz < 25) {
                  this.pathIdx[i]++;
                  if (this.pathIdx[i] >= this.pathN[i]) this.pathN[i] = 0;
                } else {
                  const wmul = this.goal[i] === GOAL.FLEE ? 1.6 : 0.92;
                  this.move(i, wdx, wdz, this.spd[i] * wmul, cdt);
                  break;
                }
              }
              let ax = gp[0], az = gp[1];
              // 有绕路点就先走绕路点
              if (this.wpT[i] > this.time) {
                const wd = Math.hypot(this.wpX[i] - this.px[i], this.wpZ[i] - this.pz[i]);
                if (wd > 6) { ax = this.wpX[i]; az = this.wpZ[i]; }
                else this.wpT[i] = 0;
              }
              const adx = ax - this.px[i], adz = az - this.pz[i];
              if (adx * adx + adz * adz > 30) {     // 还没到 → 往目标走
                this.idle[i] = 0;
                // 自己在屋里、目标又还远 → 先沿"门场"找门出去。
                //  注意：不能要求"目标在屋外"，回家时目标也在（另一栋）屋里，
                //  以前这条件一挡，人就在自家墙上原地打转（56% 的"卡住"都是这个）
                const nav = this.nav;
                if (nav.doorGradient && nav.indoor) {
                  const meIn = nav.indoor(this.px[i], this.pz[i]);
                  // 刚跨出门的 3 秒里不要再看门场 —— 否则会"出门→直线→又被吸回门口"，
                  // 每秒只挪 0.15m，看起来就是原地卡住（这是实测抓到的）
                  if (meIn) this.freeT[i] = 0;
                  else if (this.freeT[i] === 0) this.freeT[i] = this.time + 3;
                  const tgtIn = nav.indoor(ax, az);
                  const d2g = adx * adx + adz * adz;
                  const useGrad = (meIn || (tgtIn && d2g < 3600)) && this.time > this.freeT[i];
                  if (useGrad) {
                    const g = nav.doorGradient(this.px[i], this.pz[i]);
                    if (g) { this.move(i, g.x, g.z, this.spd[i] * 0.9, cdt); break; }
                  }
                }
                // 逃命是跑，不是散步
                const mul = this.goal[i] === GOAL.FLEE ? 1.6 : 0.92;
                const ox = this.px[i], oz = this.pz[i];
                this.move(i, adx, adz, this.spd[i] * mul, cdt);
                // 卡住（被关在没门的屋里）：别一直原地跑，认命固守
                if (Math.abs(this.px[i] - ox) < 1e-3 && Math.abs(this.pz[i] - oz) < 1e-3) {
                  this.stuckT[i] += cdt;
                  if (this.stuckT[i] > 8) {
                    this.stuckT[i] = 0;
                    this.setGoal(i, GOAL.HOLD, this.px[i], this.pz[i]);
                    this.idle[i] = 1;
                    this.actT[i] = 10 + this.rng() * 20;
                  }
                } else this.stuckT[i] = 0;
                break;
              }
              this.arrive(i);
            }
          }

          // 到了 / 没目标：走 / 站 循环（原版节奏：站 25~60 秒 → 走 60~140 秒 → 再站）
          this.actT[i] -= cdt;
          if (this.actT[i] <= 0) {
            if (this.idle[i]) { this.idle[i] = 0; this.actT[i] = 60 + rng() * 80; this.pickWander(i); }
            else { this.idle[i] = 1; this.actT[i] = 25 + rng() * 35; }
          }
          if (this.idle[i]) break;          // 站着不动 —— 丧尸能走到跟前咬他
          const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
          if (tx * tx + tz * tz < 4) { this.idle[i] = 1; this.actT[i] = 15 + rng() * 25; break; }
          this.move(i, tx, tz, this.spd[i], cdt);
          break;
        }
        // ---------------- 逃跑 ----------------
        case ST.FLEE: {
          this.fleeT[i] -= dt;
          if (this.fleeT[i] <= 0) {
            // 跑不动了：回去继续走，同时进入腿软期（丧尸终于能追上）
            this.state[i] = ST.CIV;
            this.panic[i] = 0;
            this.fleeCd[i] = 3 + rng() * 2;
            break;
          }
          const z = this.nearZ[i];
          if (z >= 0) {
            const ax = this.px[i] - this.px[z], az = this.pz[i] - this.pz[z];
            // 逃离 + 侧向扰动（避免所有人一条直线）
            const s = this.pz[i] > this.pz[z] ? 1 : -1;
            // 体力：狂奔会累
            this.stam[i] = Math.max(0.45, this.stam[i] - dt * 0.09);
            const sp = this.spd[i] * (1.0 + 0.55 * this.panic[i]) * this.stam[i];
            this.move(i, ax - az * 0.55 * s, az + ax * 0.55 * s, sp, dt);
            this.panic[i] = Math.min(1.4, this.panic[i] + dt * 0.6);
          } else {
            this.stam[i] = Math.min(1, this.stam[i] + dt * 0.12);
            this.panic[i] -= dt * 0.35;
            if (this.panic[i] <= 0) { this.state[i] = ST.CIV; this.panic[i] = 0; break; }
            const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
            if (tx * tx + tz * tz < 4) this.pickWander(i);
            this.move(i, tx, tz, this.spd[i] * 1.4, dt);
          }
          break;
        }
        // ---------------- 持枪还击 ----------------
        case ST.FIGHT: {
          const z = this.nearZ[i];
          if (z < 0) {
            this.state[i] = ST.CIV;
            break;
          }
          const dx = this.px[z] - this.px[i], dz = this.pz[z] - this.pz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 > 30 * 30) { this.state[i] = ST.FLEE; break; }
          this.heading[i] = Math.atan2(dz, dx);
          this.cool[i] -= dt;
          if (this.cool[i] <= 0) {
            const w = weaponOf(this.wpn[i]);
            if (!this.armed[i] || (this.mag[i] <= 0 && this.reserve[i] <= 0)) {
              this.state[i] = ST.FLEE; this.panic[i] = 1.4; break;
            }
            this.cool[i] = (w.rate || 0.5) * (1 + rng() * 0.25);
            this.fireWeapon(i, z);
          }
          // 后撤一步
          if (d2 < 12 * 12) this.move(i, -dx, -dz, this.spd[i] * 0.9, dt);
          break;
        }
        // ---------------- 潜伏 ----------------
        case ST.INFECTED: {
          this.timer[i] -= cdt;    // 潜伏倒计时按真实时间走（远处 5Hz 更新时步长已补偿）
          // ---- 发病阶段（M6）：潜伏期最后 40% 开始发烧 ----
          if (!this.sick[i] && this.incTot[i] > 0 && this.timer[i] < this.incTot[i] * 0.4) {
            this.sick[i] = 1;
            this.panic[i] = 0.8;
            this.decT[i] = 0;      // 立刻重新决策 → 去医院
          }
          // 发病了会往医院跑（医院治不好，但人会去）
          if (this.time >= this.decT[i]) {
            this.decT[i] = this.time + 2 + this.rng() * 3;
            this.decide(i);
          }
          if (this.goal[i] === GOAL.HELP) {
            const gp = this.goalPoint(i, GOAL.HELP);
            if (gp) {
              const dx = gp[0] - this.px[i], dz = gp[1] - this.pz[i];
              if (dx * dx + dz * dz > 36) {
                // 发烧的人走得慢（0.4 倍），但方向明确：去医院
                this.move(i, dx, dz, this.spd[i] * (this.sick[i] ? 0.4 : 0.55), cdt);
                break;
              }
            }
          }
          // 野兽被感染后会继续乱跑，到点才变丧尸
          const z = this.nearZ[i];
          if (z >= 0) {
            const ax = this.px[i] - this.px[z], az = this.pz[i] - this.pz[z];
            this.move(i, ax, az, this.spd[i] * 0.7, dt);
          } else {
            const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
            if (tx * tx + tz * tz < 4) this.pickWander(i);
            this.move(i, tx, tz, this.spd[i] * 0.55, dt);
          }
          // 到点：活着就站着转（turn01），转身期间不能动；播完在 tickStage 里变丧尸
          if (this.time >= this.riseAt[i]) this.beginTurn(i);
          break;
        }
        // ---------------- 丧尸 / 野兽 ----------------
        case ST.WILD:
        case ST.ZOMBIE: {
          // 枪声：附近开枪的地方比乱逛更值得去（24 条噪音，O(24) 很便宜）
          if (this.noises.length) {
            for (let ni = 0; ni < this.noises.length; ni++) {
              const nz = this.noises[ni];
              if (this.time - nz.t > 6) continue;
              const nx = nz.x - this.px[i], nzz = nz.z - this.pz[i];
              const nd2 = nx * nx + nzz * nzz;
              if (nd2 < nz.r * nz.r && nd2 > 4) {
                this.tx[i] = nz.x; this.tz[i] = nz.z;
                this.idle[i] = 0;
                this.actT[i] = 4 + (i % 3);
                break;
              }
            }
          }
          const isWild = st === ST.WILD;
          // 目标记忆：一旦盯上就追到 90m 或目标不再是健康人
          let c = this.tgt[i];
          if (c >= 0) {
            const cs = this.state[c];
            if (!(cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT ||
                  (isWild && (cs === ST.ZOMBIE || cs === ST.POLICE || cs === ST.SOLDIER)))) c = -1;
            else {
              const ddx = this.px[c] - this.px[i], ddz = this.pz[c] - this.pz[i];
              if (ddx * ddx + ddz * ddz > 90 * 90) c = -1;
            }
          }
          if (c < 0 && this.nearC[i] >= 0) c = this.nearC[i];
          this.tgt[i] = c;

          if (c >= 0) {
            const dx = this.px[c] - this.px[i], dz = this.pz[c] - this.pz[i];
            const d2 = dx * dx + dz * dz;
            const sp = SPECIES[this.kind[i]] || SPECIES[SP.ZOMBIE];
            const biteR2 = (sp.biteR || 1.8) * (sp.biteR || 1.8);
            if (d2 < biteR2) {
              const cs = this.state[c];
              // 野兽咬人/咬尸：只掉血，不传播感染
              if (isWild) {
                this.hp[c] -= (sp.dmg || 2);
                this.panic[c] = 1.4;
                this.pushAudio('bite', this.px[c], this.pz[c], 1);
                if (this.hp[c] <= 0) this.killAgent(c, i);
                this.tgt[i] = -1;
                break;
              }
              // ST.INFECTED 也算：被咬过但还没发作的人，原版里仍然会被继续咬
              if (cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT || cs === ST.INFECTED) {
                // 正在转身/倒地的人不该再被咬（原版：状态 6/7 没有 LiveHuman 位）
                if (this.aStage[c]) { this.tgt[i] = -1; break; }
                const vsp = SPECIES[this.kind[c]] || SPECIES[SP.CIV1];
                this.hp[c] -= (sp.dmg || 2) * (this.pow[i] || 1);
                this.panic[c] = 1.4;
                this.stam[c] = 1;
                this.tgt[i] = -1;
                this.pushAudio('bite', this.px[c], this.pz[c], 1);
                this.pushAudio('scream', this.px[c], this.pz[c], 1);

                // 坦克的拍击会把人打飞
                if (sp.special === 'tank') {
                  const kx = this.px[c] - this.px[i], kz = this.pz[c] - this.pz[i];
                  const kl = Math.hypot(kx, kz) || 1;
                  this.px[c] += (kx / kl) * 3.5;
                  this.pz[c] += (kz / kl) * 3.5;
                  if (!this.walkable(this.px[c], this.pz[c])) {
                    this.px[c] -= (kx / kl) * 3.5; this.pz[c] -= (kz / kl) * 3.5;
                  }
                }

                if (this.hp[c] <= 0) {
                  // 咬死：先倒地（die01），死线照走 —— 到点从尸体上爬起来
                  const wait = this.rollIncubation();
                  this.killAgent(c, i);
                  this.riseAt[c] = this.time + wait;
                  this.infectBy[i] = (this.infectBy[i] || 0) + 1;
                } else if (cs !== ST.INFECTED && vsp.infectable !== false &&
                           this.rng() < (vsp.infectChance == null ? 1 : vsp.infectChance)) {
                  // 只认第一次被咬：已经潜伏的人不重置死线（原版也是"首次被咬时刻 + 感染时长"）
                  this.setInfected(c, this.rollIncubation());
                  this.cool[c] = 0;
                  this.infectBy[i] = (this.infectBy[i] || 0) + 1;
                } else {
                  // 士兵/重装兵：不会感染，只是挨打
                  this.state[c] = ST.FLEE;
                  this.fleeT[c] = 2;
                }
              }
            } else if (sp.special === 'spit' && d2 < 26 * 26) {
              // 喷吐者：保持距离，远程喷酸
              this.cool[i] -= dt;
              if (this.cool[i] <= 0) {
                this.cool[i] = 2.4;
                this.fireWeapon(i, c);
              }
              if (d2 < 10 * 10) this.move(i, -dx, -dz, this.spd[i] * 0.8, dt);
            } else {
              // 冲锋者：离得远时加速直线扑上来
              let spd2 = this.spd[i];
              if (sp.special === 'charge' && d2 > 64) spd2 *= 1.6;
              this.move(i, dx, dz, spd2, dt);
            }
          } else {
            const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
            if (tx * tx + tz * tz < 4) this.pickWander(i);
            this.move(i, tx, tz, this.spd[i] * 0.55, dt);
          }
          break;
        }
        // ---------------- 警察 ----------------
        case ST.SOLDIER:      // 士兵和警察共用一套行为（以前士兵没有 case，是"隐形"的）
        case ST.POLICE: {
          // ---- 护送任务最高优先级：要员在哪我就在哪（混乱 50% 回局的规则也压不住）----
          if (this.escortOf[i]) {
            const v = this.vips[this.escortOf[i] - 1];
            if (this.vipDone[v] || this.state[v] === ST.CORPSE || this.state[v] === ST.SAVED) {
              this.escortOf[i] = 0;          // 任务结束，归建
            } else {
              const ex = this.px[v] - this.px[i], ez = this.pz[v] - this.pz[i];
              const ed2 = ex * ex + ez * ez;
              if (ed2 > 144) {               // 离要员 12m 以上 → 贴上去
                this.move(i, ex, ez, this.spd[i] * 1.05, cdt);
              }
              const zz = this.nearZ[i];      // 边跑边打
              if (zz >= 0 && this.cool[i] <= 0) { this.cool[i] = 0.45; this.fireWeapon(i, zz); }
              break;
            }
          }
          // ---- 混乱度驱动的警察纪律（优先级最高）----
          const si = this.stationOf[i] - 1;
          if (si >= 0) {
            const st = this.poiByKind.police[si];
            const dHome = Math.hypot(st.x - this.px[i], st.z - this.pz[i]);
            const mustReturn = this.chaos >= 50 || (this.chaos >= 20 && this.patrol[i]);
            if (mustReturn && this.goal[i] !== GOAL.MOVE_TO) {
              // 回局：直接设目标点（不占用"被调度"的 MOVE_TO 语义会在下一帧被覆盖，所以用 HOLD）
              this.setGoal(i, GOAL.HOLD, st.x, st.z);
            }
            if (mustReturn && dHome > 18) {
              this.move(i, st.x - this.px[i], st.z - this.pz[i], this.spd[i], cdt);
              const zz = this.nearZ[i];
              if (zz >= 0 && this.cool[i] <= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zz); }
              break;
            }
            // 平静期：驻局的警员也不许乱跑，离局 45m 就往回走（否则开局半小时全飘走了）
            if (!mustReturn && !this.patrol[i]
                && this.goal[i] !== GOAL.MOVE_TO && dHome > 45) {
              this.move(i, st.x - this.px[i], st.z - this.pz[i], this.spd[i] * 0.6, cdt);
              if (this.cool[i] <= 0) {
                const zx = this.nearZ[i];
                if (zx >= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zx); }
              }
              break;
            }
            if (mustReturn && dHome <= 18) {
              // 到局 = 坚守，不再听任何社会决策
              this.idle[i] = 1;
              if (this.cool[i] <= 0) {
                const zz = this.nearZ[i];
                if (zz >= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zz); }
              }
              break;
            }
          }
          // 出警 / 被调度：往目标点走，路上看见丧尸还是会打
          if (this.goal[i] === GOAL.MOVE_TO) {
            const gp = this.goalPoint(i, GOAL.MOVE_TO);
            if (gp) {
              const dx = gp[0] - this.px[i], dz = gp[1] - this.pz[i];
              if (dx * dx + dz * dz > 36) {
                this.move(i, dx, dz, this.spd[i], cdt);
                const zz = this.nearZ[i];
                if (zz >= 0 && this.cool[i] <= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zz); }
                break;
              }
            }
          }
          const z = this.nearZ[i];
          if (z >= 0) {
            const dx = this.px[z] - this.px[i], dz = this.pz[z] - this.pz[i];
            this.heading[i] = Math.atan2(dz, dx);
            this.cool[i] -= dt;
            if (this.cool[i] <= 0) {
              if (this.ammo[i] <= 0) { this.state[i] = ST.FLEE; this.panic[i] = 1.4; this.stam[i] = 1; break; }
              this.ammo[i]--;
              const msp = SPECIES[this.kind[i]] || SPECIES[SP.POLICE];
              this.cool[i] = msp.rate * (0.85 + rng() * 0.3);
              this.shoot(i, z, this.acc[i], msp.range || 30);
            }
            const d2 = dx * dx + dz * dz;
            if (d2 > 18 * 18) this.move(i, dx, dz, this.spd[i], dt);
            else if (d2 < 8 * 8) this.move(i, -dx, -dz, this.spd[i] * 0.8, dt);
          } else {
            const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
            if (tx * tx + tz * tz < 9) this.pickWander(i);
            this.move(i, tx, tz, this.spd[i] * 0.75, dt);
          }
          break;
        }
      }
    }

    // 事件老化
    for (let k = this.tracers.length - 1; k >= 0; k--) {
      this.tracers[k].life -= dt;
      if (this.tracers[k].life <= 0) this.tracers.splice(k, 1);
    }
    for (let k = this.booms.length - 1; k >= 0; k--) {
      this.booms[k].life -= dt;
      if (this.booms[k].life <= 0) this.booms.splice(k, 1);
    }

    // ---------- 指挥点数回复 ----------
    this.budget = Math.min(this.budgetMax, this.budget + this.regen * dt);
    for (const k in this.cd) {
      if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    }

    this.updateEffects(dt);
    this.updateHelis(dt);

    this.countStats();

    // ---- 每秒采样 & 里程碑 ----
    this.histT += dt;
    if (this.histT >= 1) {
      this.histT -= 1;
      const h = this.hist;
      h.t.push(this.time); h.civ.push(this.stats.civ); h.inf.push(this.stats.infected);
      h.zom.push(this.stats.zombie); h.dead.push(this.stats.dead); h.saved.push(this.saved);
      if (h.t.length > 3600) for (const k in h) h[k].shift();
      this.peakZombie = Math.max(this.peakZombie, this.stats.zombie);
      this.milestone('inf1', this.stats.infected > 0 || this.stats.zombie > this.params.initialZombies,
        '出现首例人传人', 'bad');
      this.milestone('inf100', this.stats.infected >= 100 || this.stats.zombie >= 100, '感染人数破百', 'bad');
      this.milestone('inf1000', this.stats.zombie >= 1000, '尸潮破千', 'bad');
      this.milestone('half', this.stats.civ < this.params.population * 0.5, '平民损失过半', 'bad');
      this.milestone('zomwin', this.stats.zombie > this.stats.civ && this.stats.civ > 0, '丧尸数量超过活人', 'bad');
      this.milestone('inf25', this.stats.infected >= 25, '潜伏者超过 25 人', 'bad');
      this.milestone('dead500', this.stats.dead >= 500, '死亡人数破 500', 'bad');
      this.milestone('saved100', this.saved >= 100, '累计救出 100 人', 'good');
      this.milestone('kills500', this.kills >= 500, '击毙丧尸 500 只', 'good');
    }
  }

  // ============================================================
  //  指挥工具
  // ============================================================
  pushAudio(type, x, z, g) {
    if (this.audio.length < 40) this.audio.push({ type, x, z, g: g || 1 });
  }

  pushEvent(text, kind) {
    if (this.events.length > 200) return;
    this.events.push({ t: this.time, text, kind: kind || '' });
  }

  milestone(key, cond, text, kind) {
    if (this.ms[key] || !cond) return;
    this.ms[key] = 1;
    this.pushEvent(text, kind);
  }

  canUse(tool) {
    if (this.cd[tool.id] > 0) return false;
    return this.budget >= tool.cost;
  }

  spend(tool) {
    this.budget -= tool.cost;
    this.spentTotal = (this.spentTotal || 0) + tool.cost;
    this.cd[tool.id] = tool.cool || 0;
    this.toolUse[tool.id] = (this.toolUse[tool.id] || 0) + 1;
    this.pushEvent('动用「' + tool.name + '」', 'tool');
  }

  // 新增一个个体（部署用 / 特感投放用）
  addUnit(x, z, kind) {
    if (this.n >= NMAX) return -1;
    const i = this.n++;
    this.px[i] = x; this.pz[i] = z;
    this.heading[i] = this.rng() * 6.2832;
    this.phase[i] = this.rng();
    this.timer[i] = 0; this.cool[i] = this.rng() * 0.5;
    this.panic[i] = 0; this.stam[i] = 1;
    this.armed[i] = 1;
    this.tgt[i] = -1; this.nearZ[i] = -1; this.nearC[i] = -1;
    this.fleeCd[i] = 0; this.fleeT[i] = 0; this.stuck[i] = 0; this.side[i] = 1;
    this.stationOf[i] = 0;   // 新单位默认不属于任何警局（否则会继承上一局同下标的归属）

    // 传入数字就是物种 id（特感 / 载具）
    if (typeof kind === 'number') {
      const sp = SPECIES[kind] || SPECIES[SP.ZOMBIE];
      this.kind[i] = kind;
      this.hp[i] = sp.hp;
      this.spd[i] = sp.speed;
      this.ammo[i] = sp.team === TEAM.HUMAN ? 999 : 0;
      this.acc[i] = sp.acc || 0;
      this.state[i] = sp.team === TEAM.HUMAN
        ? (kind === SP.ELITE ? ST.SOLDIER : ST.POLICE)
        : ST.ZOMBIE;
      this.pickWander(i);
      return i;
    }

    if (kind === 'soldier') {
      this.kind[i] = SP.SOLDIER;
      this.state[i] = ST.SOLDIER;
      this.hp[i] = SPECIES[SP.SOLDIER].hp;
      this.spd[i] = SPECIES[SP.SOLDIER].speed;
      this.ammo[i] = 60;
      this.acc[i] = 0.65;
    } else if (kind === 'elite') {
      this.kind[i] = SP.ELITE;
      this.state[i] = ST.SOLDIER;
      this.hp[i] = SPECIES[SP.ELITE].hp;
      this.spd[i] = SPECIES[SP.ELITE].speed;
      this.ammo[i] = 240;
      this.acc[i] = 0.72;
    } else if (kind === 'apc') {
      this.kind[i] = SP.APC;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.soldier, skillFor('soldier'));
      this.hp[i] = SPECIES[SP.APC].hp;
      this.spd[i] = SPECIES[SP.APC].speed;
      this.ammo[i] = 9999;
      this.acc[i] = 0.6;
    } else if (kind === 'swat') {
      this.kind[i] = SP.POLICE;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.elite, skillFor('elite'));
      this.hp[i] = SPECIES[SP.POLICE].hp;
      this.spd[i] = 2.7 + this.rng() * 0.3;
      this.ammo[i] = 80;
      this.acc[i] = 0.55;
    } else {
      this.kind[i] = SP.POLICE;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.police + (this.rng() < 0.25 ? 3 : 0), skillFor('police'));
      this.hp[i] = SPECIES[SP.POLICE].hp;
      this.spd[i] = 2.4 + this.rng() * 0.4;
      this.ammo[i] = 40;
      this.acc[i] = this.params.policeAccuracy;
    }
    this.pickWander(i);
    return i;
  }

  /** 在现有丧尸群附近投放一只特感 */
  spawnSpecial(kind) {
    let anchor = -1;
    for (let t = 0; t < 60 && anchor < 0; t++) {
      const j = (this.rng() * this.n) | 0;
      if (this.state[j] === ST.ZOMBIE) anchor = j;
    }
    if (anchor < 0) return -1;
    for (let t = 0; t < 30; t++) {
      const a = this.rng() * 6.2832, r = 6 + this.rng() * 45;
      const x = this.px[anchor] + Math.cos(a) * r;
      const z = this.pz[anchor] + Math.sin(a) * r;
      if (this.walkable(x, z)) {
        const i = this.addUnit(x, z, kind);
        if (i >= 0) {
          this.pushEvent('出现特感：' + SPECIES[kind].name, 'danger');
          this.pushAudio('groan', x, z, 2);
        }
        return i;
      }
    }
    return -1;
  }

  // 在某点附近找一个可走位置
  spotNear(x, z, r) {
    for (let t = 0; t < 60; t++) {
      const a = this.rng() * 6.2832, d = Math.sqrt(this.rng()) * r;
      const nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
      if (this.walkable(nx, nz)) return [nx, nz];
    }
    return [x, z];
  }

  deploy(kind, x, z, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const [ax, az] = this.spotNear(x, z, 14);
      const i = this.addUnit(ax, az, kind);
      if (i >= 0) out.push(i);
    }
    return out;
  }

  // 直升机撤离
  helicopter(x, z) {
    this.helis.push({ x, z, t: 0, state: 0, loadT: 0, rescued: 0 });
    this.effects.push({ type: 'heli', x, z, r: 48, life: 4.6, max: 4.6 });
  }

  fire(x, z, r, dur) {
    this.effects.push({ type: 'fire', x, z, r, life: dur, max: dur });
  }

  siren(x, z, r, dur) {
    this.effects.push({ type: 'siren', x, z, r, life: dur, max: dur });
  }

  rally(x, z, r, dur) {
    this.effects.push({ type: 'rally', x, z, r, life: dur, max: dur });
  }

  vaccine(x, z, r) {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== ST.INFECTED) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z;
      if (dx * dx + dz * dz < r * r) {
        this.state[i] = ST.CIV;
        this.timer[i] = 0;
        this.panic[i] = 0;
        n++;
      }
    }
    this.cured += n;
    this.effects.push({ type: 'cure', x, z, r, life: 0.9, max: 0.9 });
    return n;
  }

  resupply(x, z, r) {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s !== ST.POLICE && s !== ST.SOLDIER && !this.armed[i]) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z;
      if (dx * dx + dz * dz < r * r) {
        this.ammo[i] = (s === ST.SOLDIER) ? 60 : (s === ST.POLICE ? 40 : 14);
        n++;
      }
    }
    this.effects.push({ type: 'supply', x, z, r, life: 0.9, max: 0.9 });
    return n;
  }

  // 路障：沿 angle 方向铺一段 60m 长、5m 厚的不可走区域
  barricade(x, z, angle) {
    const nav = this.nav;
    const halfLen = 30, halfThick = 2.6;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const ext = halfLen + halfThick;
    const c0 = Math.max(0, Math.floor((x - ext + nav.halfW) / nav.cell));
    const c1 = Math.min(nav.cols - 1, Math.ceil((x + ext + nav.halfW) / nav.cell));
    const r0 = Math.max(0, Math.floor((z - ext + nav.halfH) / nav.cell));
    const r1 = Math.min(nav.rows - 1, Math.ceil((z + ext + nav.halfH) / nav.cell));
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      const wz = nav.halfH - (r + 0.5) * nav.cell - z;
      for (let c = c0; c <= c1; c++) {
        const wx = (c + 0.5) * nav.cell - nav.halfW - x;
        // 旋转到墙体本地坐标
        const u = wx * ca + wz * sa;
        const v = -wx * sa + wz * ca;
        if (Math.abs(u) <= halfLen && Math.abs(v) <= halfThick) {
          const k = r * nav.cols + c;
          if (nav.grid[k] === 1) { nav.grid[k] = 0; this.barricaded.push(k); n++; }
        }
      }
    }
    this.effects.push({ type: 'wall', x, z, r: halfLen, life: 1.2, max: 1.2, angle });
    return n;
  }

  // ---------- 持续效果 ----------
  updateEffects(dt) {
    for (let k = this.effects.length - 1; k >= 0; k--) {
      const e = this.effects[k];
      e.life -= dt;

      if (e.type === 'fire') {
        const r2 = e.r * e.r;
        for (let i = 0; i < this.n; i++) {
          const s = this.state[i];
          if (s === ST.CORPSE || s === ST.SAVED) continue;
          const dx = this.px[i] - e.x, dz = this.pz[i] - e.z;
          if (dx * dx + dz * dz > r2) continue;
          if (s === ST.ZOMBIE || s === ST.INFECTED) {
            if (this.rng() < dt * 3.5) { this.state[i] = ST.CORPSE; }
          } else if (s === ST.CIV || s === ST.FLEE || s === ST.FIGHT) {
            if (this.rng() < dt * 0.7) {
              this.state[i] = ST.CORPSE;
              this.civDeaths++;
              this.pushAudio('scream', this.px[i], this.pz[i], 1);
            }
          }
        }
      } else if (e.type === 'siren') {
        const r2 = e.r * e.r;
        for (let i = 0; i < this.n; i++) {
          if (this.state[i] !== ST.ZOMBIE) continue;
          const dx = this.px[i] - e.x, dz = this.pz[i] - e.z;
          if (dx * dx + dz * dz < r2) {
            this.tgt[i] = -1;
            this.tx[i] = e.x; this.tz[i] = e.z;
          }
        }
      } else if (e.type === 'rally') {
        const r2 = e.r * e.r;
        for (let i = 0; i < this.n; i++) {
          const s = this.state[i];
          if (s !== ST.CIV && s !== ST.FLEE && s !== ST.FIGHT) continue;
          const dx = this.px[i] - e.x, dz = this.pz[i] - e.z;
          if (dx * dx + dz * dz < r2) {
            this.tx[i] = e.x + (this.px[i] - e.x) * 0.15;
            this.tz[i] = e.z + (this.pz[i] - e.z) * 0.15;
            if (s === ST.FLEE && this.nearZ[i] < 0) this.state[i] = ST.CIV;
          }
        }
      }

      if (e.life <= 0) this.effects.splice(k, 1);
    }
  }

  // ---------- 直升机 ----------
  updateHelis(dt) {
    for (let k = this.helis.length - 1; k >= 0; k--) {
      const h = this.helis[k];
      h.t += dt;
      if (h.state === 0 && h.t >= 1.2) { h.state = 1; h.t = 0; h.loadT = 0; }
      if (h.state === 1) {
        h.loadT += dt;
        if (h.loadT >= 0.2) {
          h.loadT = 0;
          let take = 0;
          for (let i = 0; i < this.n && take < 5; i++) {
            const s = this.state[i];
            if (s !== ST.CIV && s !== ST.FLEE && s !== ST.FIGHT && s !== ST.INFECTED) continue;
            const dx = this.px[i] - h.x, dz = this.pz[i] - h.z;
            if (dx * dx + dz * dz < 48 * 48) {
              this.state[i] = ST.SAVED;
              if (this.vip[i]) {
                this.savedVip++;
                this.budget = Math.min(this.budgetMax, this.budget + this.vipBonus);
                this.pushEvent('撤离要员成功，追加经费 ¥' + (this.vipBonus / 10000).toFixed(0) + ' 万', 'good');
              }
              take++;
            }
          }
          h.rescued += take;
          this.saved += take;
        }
        if (h.t >= 3.2) { h.state = 2; h.t = 0; }
      }
      if (h.state === 2 && h.t >= 1.4) this.helis.splice(k, 1);
    }
  }


  // ---------- 事件与响应（M7） ----------
  /** 报警：80m / 60 秒内同一片区域只报一次（否则会刷屏） */
  reportEvent(x, z, sev) {
    const now = this.time;
    for (const e of this.alarms) {
      if (now - e.t < 60 && Math.hypot(e.x - x, e.z - z) < 80) return null;
    }
    const ev = { id: ++this.eventSeq, x, z, t: now, sev: sev || 1, ack: false, responders: 0 };
    this.alarms.push(ev);
    if (this.alarms.length > 64) this.alarms.shift();
    this.pushEvent('报警：第 ' + ev.id + ' 起', 'start');
    return ev;
  }

  /** 某个警局还有几个"闲在局里"的警员（没被派出去 = 目标是 NONE/没在执行命令） */
  idleAt(stationIdx) {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== ST.POLICE) continue;
      if (this.stationOf[i] !== stationIdx + 1) continue;
      if (this.goal[i] === GOAL.MOVE_TO) continue;      // 已经出警了
      n++;
    }
    return n;
  }

  // ---------- 要员护送（M9） ----------
  /**
   * 派一支护送小队去接要员。
   * 混乱度 > 20%：4 人小队，护送到**警察局**；
   * 混乱度 > 80%：8 人小队，护送**逃出城**（撤离线）。
   */
  sendEscort(vipIdx, n, goalKind) {
    const x = this.px[vipIdx], z = this.pz[vipIdx];
    const r = this.dispatchPolice(x, z, n);
    if (!r.ok) return false;
    const slot = this.vips.indexOf(vipIdx) + 1;    // 存"第几个要员"，不能存个体下标（Uint8 会溢出）
    if (slot > 0) for (const i of (r.ids || [])) this.escortOf[i] = slot;
    this.vipGoal[vipIdx] = goalKind;
    this.pushEvent(`派出 ${r.n} 人护送要员（${goalKind === 1 ? '去警局' : '撤离'}）`, 'start');
    return true;
  }

  /** 每秒检查一次要员状态（触发护送 / 检查到达 / 失败回退） */
  stepVip(dt) {
    if (!this.vips || !this.vips.length) return;
    const chaos = this.chaos;
    for (const v of this.vips) {
      if (this.vipDone[v]) continue;
      const st = this.state[v];
      if (st === ST.CORPSE || st === ST.SAVED) { this.vipDone[v] = 1; continue; }

      // 触发护送
      if (chaos >= 80 && this.vipStage[v] < 2) {
        const need = 8 - (this.vipStage[v] === 1 ? 4 : 0);
        if (this.sendEscort(v, need, 2)) this.vipStage[v] = 2;
      } else if (chaos >= 20 && this.vipStage[v] === 0) {
        if (this.sendEscort(v, 4, 1)) this.vipStage[v] = 1;
      }
      if (!this.vipGoal[v]) continue;

      // 目的地
      let dx = 0, dz = 0, arrived = false;
      if (this.vipGoal[v] === 1) {
        const stn = this.nearestPoi('police', this.px[v], this.pz[v]);
        if (!stn) continue;
        dx = stn.x; dz = stn.z;
        arrived = Math.hypot(dx - this.px[v], dz - this.pz[v]) < 30;
      } else {
        const p = this.escapePoint(v);
        dx = p[0]; dz = p[1];
        arrived = this.onEscapeLine(v);
      }

      if (arrived) {
        // 送到警局 / 逃出城：要员安全，小队解散归建
        this.state[v] = ST.SAVED;
        this.vipDone[v] = 1;
        this.savedVip = (this.savedVip || 0) + 1;
        const slot2 = this.vips.indexOf(v) + 1;
        for (let i = 0; i < this.n; i++) {
          if (this.escortOf[i] === slot2) { this.escortOf[i] = 0; this.goal[i] = GOAL.NONE; }
        }
        this.pushEvent(`要员已${this.vipGoal[v] === 1 ? '送抵警察局' : '撤离城区'}`, 'start');
        continue;
      }

      // 等护送队到位再走（小队还没到就原地等，别自己跑没影）
      const slot = this.vips.indexOf(v) + 1;
      let nearEscort = false, escortAlive = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.escortOf[i] !== slot) continue;
        escortAlive++;
        if ((this.px[i] - this.px[v]) ** 2 + (this.pz[i] - this.pz[v]) ** 2 < 625) nearEscort = true;
      }
      if (escortAlive === 0) {
        // 护送队全灭了：要员自己跑（往撤离线）
        this.vipGoal[v] = 2;
        const p2 = this.escapePoint(v);
        this.setGoal(v, GOAL.MOVE_TO, p2[0], p2[1]);
      } else if (nearEscort) {
        this.setGoal(v, GOAL.MOVE_TO, dx, dz);
      } else {
        this.goal[v] = GOAL.NONE;     // 原地等小队
      }
      this.decT[v] = 1e9;
    }
  }

  /** 这户人家有没有枪（看军械库，不看哈希） */
  homeHasGun(i) {
    if (!this.hhStart || !this.civAt || this.hh[i] >= this.nHh) return false;
    return hasWeapon(this.homeStocks.get(this.hh[i]));
  }

  /**
   * 有人死了 → 报警 → 派 2 个警察过去。
   * **500m 内不管死多少次，只派一次、只派 2 个人**（同一片区的死亡合并成一件事）。
   * 混乱度 ≥ 50 时不派（警察要回局坚守）。
   */
  reportDeath(x, z) {
    if (this.chaos >= 50) return null;
    for (const a of this.deathAlarms) {
      if (this.time - a.t < 180 && Math.hypot(a.x - x, a.z - z) < 500) return null;
    }
    this.deathAlarms.push({ x, z, t: this.time });
    if (this.deathAlarms.length > 32) this.deathAlarms.shift();
    const r = this.dispatchPolice(x, z, 2);
    this.pushEvent(r.ok ? '有人死亡：派 2 名警员前往' : '有人死亡：附近警局已无可用警力', 'start');
    return r;
  }

  /** 找最近的、局里还有人可派的警局 */
  nearestStation(x, z, need) {
    const list = this.poiByKind.police || [];
    let best = null, bd = Infinity, bn = 0;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      const n = this.idleAt(k);
      if (n < (need || 1)) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; bn = n; }
    }
    return best ? { poi: best, dist: Math.sqrt(bd), idle: bn } : null;
  }

  /**
   * 出警 / 调度：从最近的警局派人，**先在警局门口生成，再走过去**（没有瞬移）。
   * 返回 { ok, n, station, dist } —— 玩家调度和自动出警走同一段代码。
   */
  dispatchPolice(x, z, n) {
    const want = Math.max(1, n | 0 || 1);
    const st = this.nearestStation(x, z, want);
    if (!st) return { ok: false, n: 0, reason: 'no-station' };
    // 从**局里现有的警员**里挑最近的几个派出去（不新建单位）
    const si = (this.poiByKind.police || []).indexOf(st.poi);
    const pool = [];
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== ST.POLICE) continue;
      if (this.stationOf[i] !== si + 1) continue;
      if (this.goal[i] === GOAL.MOVE_TO) continue;
      if (this.escortOf[i]) continue;        // 正在护送要员的，不能被别的任务抢走
      pool.push([i, Math.hypot(this.px[i] - x, this.pz[i] - z)]);
    }
    pool.sort((a, b) => a[1] - b[1]);
    const made = [];
    for (let k = 0; k < want && k < pool.length; k++) {
      const i = pool[k][0];
      this.setGoal(i, GOAL.MOVE_TO, x, z);
      this.decT[i] = 1e9;          // 警察不听"社会决策"，只听调度
      made.push(i);
    }
    this.pushEvent(`出警 ${made.length} 人（${st.dist.toFixed(0)}m 外警局）`, 'start');
    return { ok: made.length > 0, n: made.length, station: st.poi, dist: st.dist, ids: made, idle: pool.length };
  }

  /** 命令士兵移动到某点（只有士兵接受命令，警察不行） */
  orderMove(i, x, z) {
    if (this.state[i] !== ST.SOLDIER) return false;
    this.setGoal(i, GOAL.MOVE_TO, x, z);
    this.wpT[i] = 0;
    this.pathN[i] = 0;
    return true;
  }

  /** 抽一个潜伏时长：快速模式固定 8 段，零号病人模式 10–30 分钟 */
  rollIncubation() {
    if (!this.longInc) return INCFG.quick * (0.4 + this.rng() * 1.2);
    const [a, b] = INCFG.long;
    return a + this.rng() * (b - a);
  }

  /** 发一把枪（带初始熟练度） */
  giveWeapon(i, id, skill01) {
    const w = weaponOf(id);
    if (!w || w.id === 0) return;
    this.wpn[i] = id;
    this.mag[i] = w.mag;
    this.reserve[i] = w.reserve;
    this.skill[i] = Math.round(Math.max(0, Math.min(1, skill01)) * 255);
    this.armed[i] = 1;
    this.acc[i] = 0.4 + skill01 * 0.4;
  }

  /** 开火：查弹匣 / 装填 / 射程 / 精度（受熟练度影响）/ 噪音 */
  fireWeapon(i, to) {
    const w = weaponOf(this.wpn[i]);
    if (w.id === 0 || !this.armed[i]) return false;
    const t = this.time;
    if (this.rlUntil[i] > t) return false;                 // 装填中
    if (this.mag[i] <= 0) {
      if (this.reserve[i] > 0) {
        const need = Math.min(w.mag, this.reserve[i]);
        this.reserve[i] -= need;
        this.mag[i] = need;
        // 熟练度越高装填越快
        this.rlUntil[i] = t + w.reload * (1.3 - 0.4 * (this.skill[i] / 255));
        this.pushAudio('reload', this.px[i], this.pz[i], 0.5);
      } else {
        this.armed[i] = 0;                                 // 打光了
      }
      return false;
    }
    const dx = this.px[to] - this.px[i], dz = this.pz[to] - this.pz[i];
    const d2 = dx * dx + dz * dz;
    if (d2 > w.range * w.range) return false;
    this.mag[i]--;
    this.ammo[i] = this.mag[i];                            // 兼容旧字段
    const sk = this.skill[i] / 255;
    const acc = w.acc * (0.6 + 0.4 * sk);
    this.shoot(i, to, acc, w.range, w.dmg);
    this.addNoise(this.px[i], this.pz[i], w.noise);
    return true;
  }

  /** 枪声：丧尸会被吸过来 */
  addNoise(x, z, r) {
    this.noises.push({ x, z, t: this.time, r });
    if (this.noises.length > 24) this.noises.shift();
  }

  shoot(from, to, acc, range, dmgIn) {
    const dx = this.px[to] - this.px[from], dz = this.pz[to] - this.pz[from];
    if (dx * dx + dz * dz > range * range) return;
    const hit = this.rng() < acc;
    if (this.tracers.length < 200) {
      this.tracers.push({
        x1: this.px[from], z1: this.pz[from],
        x2: this.px[to] + (hit ? 0 : (this.rng() - 0.5) * 6),
        z2: this.pz[to] + (hit ? 0 : (this.rng() - 0.5) * 6),
        life: 0.07, hit,
      });
    }
    this.stats.shots++;
    this.pushAudio('shot', this.px[from], this.pz[from], 0.55 + acc);
    if (!hit) return;

    // 伤害制：不同枪械威力不同，特感要打好几枪
    const dmg = dmgIn != null ? dmgIn : ((SPECIES[this.kind[from]] || SPECIES[SP.CIV1]).dmg || 5);
    this.hp[to] -= dmg;
    this.pushAudio('hit', this.px[to], this.pz[to], 0.8);
    if (this.hp[to] <= 0) {
      this.killAgent(to, from);
    }
  }

  // ---------------- 动作阶段（尸变链） ----------------
  /**
   * 感染：记倒计时 + **绝对死线**。
   * 原版用的是"首次被咬时刻 + 感染时长"，不是倒计时 —— 因为人死了以后这条钟还得继续走，
   * 而倒地动画期间没有人会去减它。
   */
  setInfected(i, seconds) {
    this.state[i] = ST.INFECTED;
    this.incTot[i] = seconds;
    this.timer[i] = seconds;
    this.riseAt[i] = this.time + seconds;
  }

  /** 站着变：turn01，播完才真的变丧尸。 */
  beginTurn(i) {
    if (this.aStage[i]) return;                       // 已经在播了，别叠
    const body = bodyOf(i, this.kind[i], false);      // 用**还是人**时的体型
    this.aStage[i] = STAGE.TURN;
    this.aT[i] = 0;
    this.aZ[i] = 0;
    this.aDur[i] = stageDur(body, STAGE.TURN, false);
    this.riseAt[i] = 0;
    this.timer[i] = 0;
    this.sick[i] = 0;
    this.panic[i] = 0;
    this.pushAudio('groan', this.px[i], this.pz[i], 0.9);
  }

  /** 倒地：die01 / zdie01，期间不动。 */
  beginDie(i, wasZombie) {
    const body = bodyOf(i, this.kind[i], !!wasZombie);
    this.aStage[i] = STAGE.DIE;
    this.aT[i] = 0;
    this.aZ[i] = wasZombie ? 1 : 0;
    this.aDur[i] = stageDur(body, STAGE.DIE, !!wasZombie);
  }

  /** 尸体爬起来：zrise01。 */
  beginRise(i) {
    const body = bodyOf(i, this.kind[i], false);      // 尸体还是"人"的体型；动物会退到 walk
    this.aStage[i] = STAGE.RISE;
    this.aT[i] = 0;
    this.aZ[i] = 0;
    this.aDur[i] = stageDur(body, STAGE.RISE, false);
    this.pushAudio('groan', this.px[i], this.pz[i], 0.7);
  }

  /**
   * 推进阶段；播完就回调。dt 要用 cdt（视口外 1/4 帧率时要 4 倍补偿），
   * 否则远处的人变丧尸会比近处慢 4 倍。
   */
  tickStage(i, dt) {
    const st = this.aStage[i];
    if (!st) return;
    const t = this.aT[i] + dt;
    if (t < this.aDur[i]) { this.aT[i] = t; return; }
    this.aT[i] = this.aDur[i];
    this.aStage[i] = 0;
    if (st === STAGE.TURN || st === STAGE.RISE) this.becomeZombie(i);
  }

  /** 从"人"变成丧尸：血、速度、伤害按物种；动物走强化分支。 */
  becomeZombie(i) {
    const zsp = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
    this.state[i] = ST.ZOMBIE;
    this.aStage[i] = 0;
    this.riseAt[i] = 0;
    if (zsp.hpZombie) {
      // 动物尸变：狗/猫/熊/虎变丧尸后更凶
      this.hp[i] = zsp.hpZombie;
      this.spd[i] = zsp.speed * (zsp.zombieSpeedMul || 1);
      this.pow[i] = zsp.zombiePow || 1;
    } else {
      this.kind[i] = SP.ZOMBIE;
      this.hp[i] = SPECIES[SP.ZOMBIE].hp;
      this.spd[i] = this.params.zombieSpeed * (0.85 + this.rng() * 0.3);
    }
    this.nearC[i] = -1;
    this.tgt[i] = -1;
    this.sick[i] = 0;
    this.pushAudio('groan', this.px[i], this.pz[i], 1);
  }

  /** 打死一个单位：丧尸/特感算击杀，人类算误伤 */
  killAgent(i, by) {
    const sp = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
    if (sp.special === 'boom') this.boomBurst(i);
    const wasZombie = sp.team === TEAM.ZOMBIE;
    this.state[i] = ST.CORPSE;
    this.timer[i] = 0;
    this.hp[i] = 0;
    this.beginDie(i, wasZombie);          // 倒地动画（原版 die01 / zdie01）
    if (wasZombie) {
      this.kills++;
      if (by >= 0) this.killsBy[by] = (this.killsBy[by] || 0) + 1;
    } else if (this.stats) {
      this.stats.civKilled = (this.stats.civKilled || 0) + 1;
      this.reportDeath(this.px[i], this.pz[i]);
    }
  }

  /** 自爆者死亡：范围内所有活人立刻感染 */
  boomBurst(i) {
    const R = 16;
    this.booms.push({ x: this.px[i], z: this.pz[i], r: R, life: 0.7 });
    this.pushAudio('boom', this.px[i], this.pz[i], 1.6);
    for (let j = 0; j < this.n; j++) {
      const st = this.state[j];
      if (st === ST.CORPSE || st === ST.INFECTED || st === ST.ZOMBIE) continue;
      const sp = SPECIES[this.kind[j]];
      if (!sp || sp.team !== TEAM.HUMAN || !sp.infectable) continue;
      const dx = this.px[j] - this.px[i], dz = this.pz[j] - this.pz[i];
      if (dx * dx + dz * dz < R * R) {
        this.setInfected(j, this.params.infectTime);
        this.hp[j] = Math.max(1, this.hp[j] - 4);
        this.panic[j] = 1.4;
      }
    }
  }

  // ---------- 空袭 ----------
  strike(x, z, r = 42) {
    this.booms.push({ x, z, r, life: 0.9 });
    this.pushAudio('boom', x, z, 2.2);
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === ST.CORPSE) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z;
      if (dx * dx + dz * dz < r * r) {
        const wasZ = (SPECIES[this.kind[i]] || {}).team === TEAM.ZOMBIE;
        if (s === ST.CIV || s === ST.FLEE || s === ST.FIGHT || s === ST.INFECTED) this.civDeaths++;
        else if (s === ST.ZOMBIE) this.kills++;
        this.state[i] = ST.CORPSE;
        this.timer[i] = 0;
        this.beginDie(i, wasZ);
      }
    }
    this.countStats();
  }

  countStats() {
    const s = this.stats;
    s.civ = 0; s.infected = 0; s.zombie = 0; s.dead = 0; s.police = 0; s.saved = 0; s.sick = 0;
    s.vipAlive = 0; s.vipSaved = 0; s.vipLost = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      switch (this.state[i]) {
        case ST.CIV: case ST.FLEE: case ST.FIGHT: s.civ++; break;
        case ST.INFECTED: s.infected++; s.civ++; if (this.sick[i]) s.sick++; break;
        case ST.ZOMBIE: s.zombie++; break;
        case ST.CORPSE: s.dead++; break;
        case ST.POLICE: s.police++; break;
        case ST.SOLDIER: s.police++; break;
        case ST.SAVED: s.saved = (s.saved || 0) + 1; break;
      }
    }
    for (let k = 0; k < this.vips.length; k++) {
      const i = this.vips[k];
      const st = this.state[i];
      if (st === ST.SAVED) s.vipSaved++;
      else if (st === ST.CORPSE) s.vipLost++;
      else s.vipAlive++;
    }
  }

  outcome() {
    const s = this.stats;
    if (s.zombie === 0 && s.infected === 0) return s.civ > 0 ? 'CLEARED' : 'EMPTY';
    if (s.civ === 0) return 'FALLEN';
    if (this.time > 60 && s.zombie > 0 && s.civ > 0) return null;
    return null;
  }
}
























