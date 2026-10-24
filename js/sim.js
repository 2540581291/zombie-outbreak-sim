// ============================================================
//  ZOS-R · 模拟内核（纯 JS，零依赖，可在 Node 里跑）
//  万物皆数组（SoA），固定步长，确定性 PRNG
// ============================================================

import { SP, TEAM, SPECIES, SPECIAL_KINDS, CIV_KINDS, ANIMAL_SHARE, ANIMAL_DOG_SHARE } from './species.js';
import { jobOf, jobFor, ageOf, braveOf, JOB_POI, h, attrFor } from './profiles.js';
import { buildFamilies } from './family.js';
import { WPN, WEAPONS, ROLE_WEAPON, skillFor, weaponOf } from './weapons.js';
import { makeStock, makeStationStock, makeHomeStock, takeWeapon, hasWeapon, stockText, ammoCount, weaponCount } from './storage.js';
import { STAGE, bodyOf, stageDur, stageAnim } from './bodymap.js';
import { getNavWorld } from './nav/index.js';

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

const NMAX = 160000;

// 潜伏期两套常量（决策 3）：默认 8 秒；零号病人模式 10–30 分钟
// 潜伏时长区间（秒）。实际值 = 区间 × (面板「咬伤潜伏」/ 90)，再按年龄体质加权。
// bite = 被咬；contact = 间接接触（自爆喷溅等）
export const INCFG = { bite: [60, 120], contact: [360, 1440] };

// 一天 24 分钟：1 模拟秒 = 1 游戏分钟，1440 秒 = 24 小时（整数关系，不用换算）
export const DAY_SECONDS = 1440;
export const TIME_SEGS = [
  { at: 0, name: '深夜' }, { at: 360, name: '早晨' }, { at: 540, name: '白天' },
  { at: 1080, name: '傍晚' }, { at: 1200, name: '夜晚' }, { at: 1380, name: '深夜' },
];

// 混乱度权重（0-100 上限）：知情值 1% → 1 点，感染值 1% → 2 点
export const CHAOS_W = { aware: 0.5, infect: 2, cap: 100 };   // 知情值算半个混乱

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

// ---------- 政府行动：机构代码 ----------
// 工作地 POI 种类 → 机构编号（sim.jobKind 里存的就是它）
export const INST = { NONE: 0, GOV: 1, HOSP: 2, SCHOOL: 3 };
const JOB_KIND_CODE = { gov: INST.GOV, hospital: INST.HOSP, school: INST.SCHOOL };

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
    // ---- POI 不再读 OSM 标签，改为按"城市面积 × 密度"从建筑里生成 ----
    this.pois = this.generatePois();
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
    this.poiSnapped = snapped;
    this.poiDropped = dropped;
    this.poiCount = this.pois.length;   // 现在用的是生成出来的 POI，不是 city.json 里那批
    // 导航世界按需建（第一次移动时）：EDT + 8 m 分层 + 门 portal ≈ 0.8 s，不能每局重建
    this._navTried = false;
    this.tick = 0;
    this.time = 0;
    this.n = 0;
    this.rng = mulberry32(1);
    this.tracers = [];   // {x1,z1,x2,z2,life}
    this.booms = [];     // {x,z,r,life}
    this.stats = { civ: 0, infected: 0, zombie: 0, dead: 0, police: 0, shots: 0, hits: 0 };

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
    this.fleeDir = new Float32Array(NMAX);       // 逃跑方向（弧度，锁定后保持，避免来回翻转）
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
    // ---- 四个性格属性（P0.1）----
    this.trust = new Uint8Array(NMAX);           // 政府信任 0-100
    this.familyDuty = new Uint8Array(NMAX);      // 家庭责任
    this.willpower = new Uint8Array(NMAX);       // 意志
    this.courage = new Uint8Array(NMAX);         // 勇猛
    this.infRoute = new Uint8Array(NMAX);        // 感染路线：0 无 / 1 咬伤 / 2 接触
    this.ill = new Uint8Array(NMAX);             // 1 = 有普通病（要去看医生）
    this.arrGoal = new Uint8Array(NMAX);         // 已经对哪个目标执行过 arrive（防止每帧重复触发）
    this.chainStep = new Uint8Array(NMAX);       // 行动链：0 无 / 1 接家人 / 2 取枪 / 3 避难或撤离
    this.exposedAt = new Float32Array(NMAX);     // 上一次被"接触类感染者"贴住的时刻（0 = 没被贴）
    this.expStart = new Float32Array(NMAX);      // 这段连续接触是什么时候开始的
    this.escortOf = new Uint8Array(NMAX);        // 该警员在护送哪位要员（0 = 不在护送）
    this.boostT = new Float32Array(NMAX);        // 加速到期时间（护送 / 出警 30 秒内 ×2）
    this.wallT = new Float32Array(NMAX);         // 连续被卡住的累计秒数（旧指标，保留兼容）
    this.anchorT = new Float32Array(NMAX);       // 上次取样时间
    this.anchorX = new Float32Array(NMAX);       // 取样时的位置
    this.anchorZ = new Float32Array(NMAX);
    this.ghostT = new Float32Array(NMAX);        // 穿墙到期时间（卡 5 秒 → 3 秒无视碰撞）
    // ---- 政府行动（面板）：机构归属 + 清剿任务 ----
    this.jobKind = new Uint8Array(NMAX);         // 工作地类型：0 其它 / 1 政府 / 2 医院 / 3 学校
    this.workPoi = new Uint16Array(NMAX);        // 工作地是第几个 POI（+1，0 = 没有）
    this.purgeT = new Float32Array(NMAX);        // 清剿任务到期时间（期间"对人开火"）
    this.vipStage = new Uint8Array(NMAX);        // 要员护送阶段：0 无 / 1 四人小队去警局 / 2 八人小队出城
    this.vipGoal = new Uint8Array(NMAX);         // 1 = 去警局，2 = 逃出城
    this.vipDone = new Uint8Array(NMAX);         // 1 = 已经安置好（撤离）
    this.vipStation = new Uint8Array(NMAX);      // 1 = 已经送进警察局（还没撤离）
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
    this.pathX = new Float32Array(NMAX * 16);    // 粗网格寻路的路点（最多 16 个）
    this.pathZ = new Float32Array(NMAX * 16);
    this.forcePlan = new Uint8Array(NMAX); // 1 = 下一次决策必须规划路径（卡住过）
    this.pathBlock = new Uint8Array(NMAX);  // 连续走不到当前路点的次数（超过就跳过它）
    this.lastDir = new Float32Array(NMAX); // 上一次实际迈步方向（沿墙滑行时保持，避免来回抖）
    this.lastDirT = new Float32Array(NMAX);
    this.lastVX = new Float32Array(NMAX);  // 上一帧方向的单位向量（S5 局部跟随用，省掉 atan2）
    this.lastVZ = new Float32Array(NMAX);
    // ---- NavCore（S5）：室内出门引导（每 2 秒刷新一次，代替旧的 56 MB 门场）----
    this.guideX = new Float32Array(NMAX);
    this.guideZ = new Float32Array(NMAX);
    this.guideT = new Float32Array(NMAX);
    this.guideOK = new Uint8Array(NMAX);
    this.exitT = new Float32Array(NMAX);   // "出门中"（含跨门槛那一格）的截止时刻
    this.wasIn = new Uint8Array(NMAX);     // 上一帧是否在室内（用来判"刚出门"）
    this.flipT = new Float32Array(NMAX);   // 上一次 180° 掉头的时刻（转身限速用）
    this.nudgeT = new Float32Array(NMAX);   // 原有代码只写过没分配（旧路径走不到，S5 后走到了）
    this._navTried = false;
    this.navWorld = null;
    this.steer = null;
    this.armHome = new Uint8Array(NMAX);  // 1 = 正在回家补弹（这条 goal 不被 decide 覆盖）
    this.pet = new Uint8Array(NMAX);      // 动物：1 = 家养（绑主人家），0 = 野生
    this.fleeMode = new Uint8Array(NMAX); // 逃跑大类：0 无 / 1 即时（只为离开 40m）/ 2 有目标
    this.fleeGoal = new Uint8Array(NMAX); // 有目标逃跑的目标：0 回家 / 1 警局 / 2 逃离城区
    this.stationLost = new Uint8Array(NMAX); // 1 = 亲眼确认过警局沦陷，不再选"去警局"
    this.lockT = new Float32Array(NMAX);   // 下次锁敌时间（每 60s 一次）
    this.lockOn = new Uint8Array(NMAX);    // 目标来自锁敌（允许远距离追击）
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
    this.barricadeVal = [];     // 对应的原值（不能写死成 1：路面是 0x03、门是 0x0f）

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
    this.lockT.fill(0); this.lockOn.fill(0);
    this.fleeMode.fill(0); this.fleeGoal.fill(0); this.stationLost.fill(0);
    this.pet.fill(0);
    this.armHome.fill(0);
    this.forcePlan.fill(0);
    this.lastDir.fill(0); this.lastDirT.fill(0); this.lastVX.fill(0); this.lastVZ.fill(0);
    this.pathBlock.fill(0);
    this.guideX.fill(0); this.guideZ.fill(0); this.guideT.fill(0); this.guideOK.fill(0);
    this.exitT.fill(0); this.wasIn.fill(0); this.flipT.fill(0);
    this.nudgeT.fill(0);
    // 关键：全部状态清零，否则上一局的残留会让结果不可复现
    this.cool.fill(0); this.timer.fill(0); this.panic.fill(0);
    this.wpn.fill(0); this.mag.fill(0); this.reserve.fill(0); this.skill.fill(0); this.rlUntil.fill(0);
    this.incTot.fill(0); this.sick.fill(0);
    this.longInc = (P.mode || 'single') === 'stealth';
    this.noises.length = 0; this.alarms.length = 0; this.deathAlarms.length = 0; this.eventSeq = 0; this.nextDispatch = 0;
    this.homeStocks.clear();
    this.stationOf.fill(0); this.patrol.fill(0);
    this.boostT.fill(0);
    this.wallT.fill(0);
    this.ghostT.fill(0);
    this.jobKind.fill(0);
    this.workPoi.fill(0);
    this.purgeT.fill(0);
    this.govOrders = {
      schoolClosed: false, hospitalClosed: false,
      schoolSince: 0, hospSince: 0, hospEvacAt: 0, purgeAt: 0, guardAt: 0, schoolGuardAt: 0,
      curfew: false, curfewSince: 0, curfewOnAt: 0,
      evacuate: false, evacSince: 0,
      // 冷却初值给 -1e9：游戏一开始就该允许第一次触发，否则前 10 分钟什么都等不到
      cd: { purge: -1e9, guard: -1e9, schoolGuard: -1e9, policeALL: -1e9, evac: -1e9 },
    };
    this.govLog = [];          // 政府/机构的自动决策日志（面板显示）
    this.govHist = [];         // 每 10 秒采样一次局势曲线（面板显示趋势）
    this.govHistT = 0;
    this.stationHist = [];      // 每个警局的弹药存量采样（军械库曲线）
    this.govT = 0;             // 下一次评估的倒计时
    this.duties = new Map();   // 在外执行的派遣：id -> { x, z, what, dest, why, t }
    this.anchorT.fill(0);
    this.anchorX.fill(0);
    this.anchorZ.fill(0);
    this.escortOf.fill(0); this.vipStage.fill(0); this.vipGoal.fill(0); this.vipDone.fill(0); this.vipStation.fill(0);
    this.trust.fill(0); this.familyDuty.fill(0); this.willpower.fill(0); this.courage.fill(0);
    this.infRoute.fill(0); this.exposedAt.fill(0); this.expStart.fill(0);
    this.ill.fill(0); this.chainStep.fill(0); this.arrGoal.fill(0);
    this.lastSaved = 0; this.budgetBack = 0;
    this.stam.fill(1); this.armed.fill(0); this.state.fill(0); this.ammo.fill(0);
    this.stuck.fill(0);
    this.side.fill(1);
    this.fleeDir.fill(0);
    this.fleeCd.fill(0);
    this.nextSpecial = 8;
    this.pow.fill(1);
    // 信息层清零
    this.aware.fill(0); this.callT.fill(0); this.callK.fill(0); this.callsLeft.fill(0);
    this.goal.fill(0); this.goalX.fill(0); this.goalZ.fill(0); this.decT.fill(0); this.lastScore.fill(0); this.stuckT.fill(0);
    this.lastX.fill(0); this.lastZ.fill(0); this.stuckT2 = 0; this.wpT.fill(0); this.freeT.fill(0);
    this.pathN.fill(0); this.pathIdx.fill(0); this.pathBudget = 8; this.stuckSlice = 0;
    this.preyBudget = 8;
    this.tgtCount = new Int16Array(NMAX);   // 每个目标被多少丧尸同时盯着（本 tick）       // 锁敌扫描预算也要重置，否则第二次 reset 起手值不同 → 非确定性
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
      p.initAmmo = ammoCount(p.store);
      p.initGuns = weaponCount(p.store);
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
    this.killsBy.fill(0); this.infectBy.fill(0);
    this.stats.shots = 0; this.stats.hits = 0;

    // 指挥系统复位
    this.budget = 1000000;
    this.spentTotal = 0;
    this.savedVip = 0;
    this.vip.fill(0);
    this.vips.length = 0;
    this.vipTotal = 0;
    this.vips.length = 0; this.vipGov = null;   // 要员列表也要清，否则第二次 reset 就没要员了（非确定性）
    this.cd = {};
    this.effects.length = 0;
    this.helis.length = 0;
    this.saved = 0;
    this.cured = 0;
    for (let i = 0; i < this.barricaded.length; i++) this.nav.grid[this.barricaded[i]] = this.barricadeVal[i];
    const hadBarricade = this.barricaded.length > 0;
    this.barricaded.length = 0;
    this.barricadeVal.length = 0;
    // 路障期间 8 m 图被局部改过 → 重开时整张导航图重建一次（一次性 0.6 s）
    if (hadBarricade && this.navWorld) {
      try { this.navWorld.rebuildAll(); } catch (e) { console.warn('[ZOS-R] 导航图重建失败：', e); }
    }
    this.audio.length = 0;
    this.hist = { t: [], civ: [], inf: [], zom: [], dead: [], saved: [] };
    this.events = [];
    this.kills = 0; this.civDeaths = 0; this.peakZombie = 0;
    this.toolUse = {}; this.histT = 0; this.ms = {};
    this.pushEvent('爆发开始', 'start');

    const nav = this.nav;
    const total = nav.cols * nav.rows;
    const pop = Math.min(P.population, NMAX - 2000 - P.police);
    const nPol = Math.min(P.police, 10000);   // 警察上限跟着滑杆走

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
      // 人和动物共用这一个循环：先按比例抽是不是动物，再抽具体种类
      const ck = rng() < ANIMAL_SHARE
        ? (rng() < ANIMAL_DOG_SHARE ? SP.DOG : SP.CAT)
        : CIV_KINDS[(rng() * CIV_KINDS.length) | 0];
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
      this.pickWander(i);
      idx++;
    }

    // ---- 家庭（M2）：先把平民切成家庭，再按家庭分配住址 ----
    const civIdx = [];
    for (let i = 0; i < k; i++) if (this.state[i] === ST.CIV && !this.isAnimal(i)) civIdx.push(i);
    buildFamilies(this, civIdx, h);

    // ---- 家庭军械库（M8）：每个家庭按哈希决定有没有枪、有多少子弹 ----
    for (let hid = 0; hid < this.nHh; hid++) {
      this.homeStocks.set(hid, makeHomeStock(h(hid, 51), rng, P.homeGunRate));
    }

    // 3% 的人有普通病（不是感染）：爆发前去过医院，医院门口本来就会有人
    for (let i = 0; i < k; i++) {
      if (this.state[i] === ST.CIV && h(i, 91) < 0.03) this.ill[i] = 1;
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
      if (this.isAnimal(i)) {
        // 动物没有家和工作地，就地在街上晃
        this.homeX[i] = this.px[i]; this.homeZ[i] = this.pz[i];
        this.workX[i] = this.px[i]; this.workZ[i] = this.pz[i];
        this.goal[i] = GOAL.NONE;
        this.commuteAt[i] = 1e9;
        continue;
      }
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
      this.jobKind[i] = JOB_KIND_CODE[kind] || 0;   // 政府行动面板按这个统计雇员
      const list = kind ? this.poiByKind[kind] : null;
      let wx, wz;
      if (list && list.length) {
        let best = null, bd = Infinity, bestIdx = 0;
        for (let t = 0; t < 3; t++) {
          const ri = (rng() * list.length) | 0;
          const p = list[ri];
          const d = (p.x - hx) ** 2 + (p.z - hz) ** 2;
          if (d < bd) { bd = d; best = p; bestIdx = ri; }
        }
        this.workPoi[i] = bestIdx + 1;       // 记下"在哪家医院/学校/政府上班"（面板按机构明细用）
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
    // 家养动物：绑一个主人家庭，家 = 那户的住址（活动范围锁在附近）
    //   注意：家养/野生的抽签也放在这里 —— 如果出生时就写 this.pet[i]，
    //   出生阶段的 pickWander 会去读上一次 reset 残留的 homeX，导致随机数消耗不一样，
    //   同一个 seed 两次开局的动物数量都会不同（确定性就崩了）。
    for (let i = 0; i < k; i++) {
      const kk = this.kind[i];
      if (kk !== SP.DOG && kk !== SP.CAT) continue;
      this.pet[i] = h(i, 92) < 0.45 ? 0 : 1;   // 0 野生 / 1 家养
    }
    if (hhHome.size) {
      for (let i = 0; i < k; i++) {
        if (!this.pet[i]) continue;
        const hid = (h(i, 93) * hhHome.size) | 0;
        let base = null;
        let n = 0;
        for (const v of hhHome.values()) { if (n++ === hid) { base = v; break; } }
        if (!base) { for (const v of hhHome.values()) { base = v; break; } }
        if (!base) continue;
        let hx = base[0] + (rng() - 0.5) * 6, hz = base[1] + (rng() - 0.5) * 6;
        if (!this.walkable(hx, hz)) { hx = base[0]; hz = base[1]; }
        this.homeX[i] = hx; this.homeZ[i] = hz;
        this.px[i] = hx; this.pz[i] = hz;
      }
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
      this.pickWander(i);
    }

    // ---- 指派要员（VIP）：随机挑若干平民 ----
    {
      const want = Math.max(3, Math.min(6, Math.round(pop / 4000) + 2));
      let guard = 0;
      while (this.vips.length < want && guard++ < 20000) {
        const i = (rng() * k) | 0;              // 0..k-1 全是平民
        if (this.state[i] !== ST.CIV) continue;
        if (this.isAnimal(i)) continue;
        if (this.vip[i]) continue;
        this.vip[i] = 1;
        this.vips.push(i);
      }
      this.vipTotal = this.vips.length;
      // 政府至少有一位要员：把第一位要员安置在政府大楼里
      const gov = (this.poiByKind.gov || [])[0];
      if (gov && this.vips.length) {
        const v = this.vips[0];
        this.px[v] = gov.x; this.pz[v] = gov.z;
        this.homeX[v] = gov.x; this.homeZ[v] = gov.z;
        this.goal[v] = GOAL.HOLD;
        this.idle[v] = 1;
        this.actT[v] = 1e9;              // 待在政府不走
        this.chainStep[v] = 0;
        this.vipGov = v;                 // 记录一下，方便 UI/日志
      }
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
      this.spd[i] = SPECIES[SP.ZOMBIE].speed * (0.85 + rng() * 0.3);
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
      // 沿**整条边**均匀涌入（原来只有中间 180m 宽的一条带）
      const hw = (this.nav.W || this.nav.halfW * 2) / 2;
      const hh = (this.nav.H || this.nav.halfH * 2) / 2;
      const alongMax = (dir === 'N' || dir === 'S') ? hw : hh;
      const inset = 25;                 // 离边界的距离
      const bandDeep = 70;              // 向内铺 0~70m 的厚度
      // 记录一个代表点（边的中点）给 origin/UI 用
      first = dir === 'N' ? [0, -hh + inset] : dir === 'S' ? [0, hh - inset]
        : dir === 'E' ? [hw - inset, 0] : [-hw + inset, 0];
      for (let j = 0; j < zCount && k < NMAX; j++) {
        for (let tr = 0; tr < 40; tr++) {
          const along = (rng() * 2 - 1) * (alongMax - inset * 2);   // 整条边（留边距）
          const depth = rng() * bandDeep;
          let x, z;
          if (dir === 'N') { x = along; z = -hh + inset + depth; }
          else if (dir === 'S') { x = along; z = hh - inset - depth; }
          else if (dir === 'E') { z = along; x = hw - inset - depth; }
          else { z = along; x = -hw + inset + depth; }
          if (this.walkable(x, z)) { putZombie(x, z); break; }
        }
      }
    } else if (mode === 'multi') {
      // 多点爆发：每处按"总数的 1/点数"分，不再用绝对值
      const pts = Math.max(1, Math.min(12, P.points | 0 || 3));
      const per = Math.max(1, Math.round(zCount / pts));
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
        this.setInfected(i, this.incubationFor(i, 2), 2);
        this.panic[i] = 0.6;
        made++;
      }
      first = this.randWalk(rng, 0.8);
      this.pushEvent('潜伏者已潜入', 'start');
    } else if (mode === 'waves') {
      // 连环爆发：总人数按"波数"平均分，每波数量 = 总数 / 波数
      const nWaves = Math.max(1, Math.min(12, P.waves | 0 || 4));
      const perWave = Math.max(1, Math.round(zCount / nWaves));
      const [ox, oz] = this.randWalk(rng, 0.75);
      first = [ox, oz];
      cluster(ox, oz, perWave, 50);          // 第 1 波立刻出现
      this.waveLeft = nWaves - 1;            // 其余波次交给 step() 定时投放
      this.waveEvery = Math.max(5, P.waveInterval | 0 || 40);
      this.waveNext = this.waveEvery;
      this.waveCount = perWave;              // 每波数量（比例算出来的）
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
    this.n = k;
    this.assignAttributes();
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
      // 先在近处试（楼里走动的人只能在楼内晃），不行再放大半径
      const a = rng() * 6.2832, d = t < 5 ? (3 + rng() * 9) : (14 + rng() * 40);
      // 家养动物围绕主人家门口晃；其它人围绕自己当前位置
      const cxp = this.pet[i] ? this.homeX[i] : this.px[i];
      const czp = this.pet[i] ? this.homeZ[i] : this.pz[i];
      let x = cxp + Math.cos(a) * d;
      let z = czp + Math.sin(a) * d;
      if (x < -nav.halfW + 8) x = -nav.halfW + 8;
      if (x > nav.halfW - 8) x = nav.halfW - 8;
      if (z < -nav.halfH + 8) z = -nav.halfH + 8;
      if (z > nav.halfH - 8) z = nav.halfH - 8;
      // 目标必须走得到（能看见），否则人会一直朝墙里走
      if (this.walkable(x, z) && this.losClear(this.px[i], this.pz[i], x, z)) {
        this.tx[i] = x; this.tz[i] = z; return;
      }
    }
    this.tx[i] = this.px[i];
    this.tz[i] = this.pz[i];
  }

  /** 两点之间是否全程可走（每 ~2m 采样）。用于视线拉直 / 闲逛选点 / 判断要不要寻路 */
  losClear(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    // 采样间隔 2m → 0.6m：格子是 1m，2m 采样会"穿透"1m 厚的薄墙，
    // 于是人以为直线可达、从不寻路，直接顶着墙走（实测卡在墙前 40 秒）。
    const n = Math.min(256, Math.max(1, Math.ceil(d / 0.6)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.walkable(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  /**
   * 这个人**当前真正在走的路线**（世界坐标数组）：
   *   自己 → （在屋里就先到门口）→ 剩余路点 → 目标点
   * UI 用它画折线；不做任何寻路计算。
   */
  routeOf(i) {
    const out = [];
    if (!this || i < 0 || i >= this.n) return out;
    const nav = this.nav;
    const sx = this.px[i], sz = this.pz[i];
    out.push([sx, sz]);
    if (nav && nav.indoor && nav.doorPoint && nav.indoor(sx, sz)) {
      const dp = nav.doorPoint(sx, sz);
      if (dp) out.push([dp.x, dp.z]);
    }
    const n = this.pathN[i] | 0;
    for (let k = this.pathIdx[i] | 0; k < n && out.length < 18; k++) {
      out.push([this.pathX[i * 16 + k], this.pathZ[i * 16 + k]]);
    }
    const gp = this.goalPoint(i, this.goal[i]);
    if (gp) {
      const last = out[out.length - 1];
      if (Math.hypot(gp[0] - last[0], gp[1] - last[1]) > 1.5) out.push(gp);
    }
    return out;
  }

  /** 单个 1 m 格是否可走（位域 bit0）。想判"半径 r 站得下"用 navWorld.ng.walkableR */
  walkable(x, z) {
    const nav = this.nav;
    if (typeof nav.walkable === 'function') return nav.walkable(x, z);
    const c = ((x + nav.halfW) / nav.cell) | 0;
    const r = ((nav.halfH - z) / nav.cell) | 0;
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return false;
    return (nav.grid[r * nav.cols + c] & 1) !== 0;
  }

  /**
   * 出路径（S7b 之后走 HPA* 规划器）：把折线写进 pathX/pathZ（最多 16 个路点）。
   *
   * 和旧的 4 m 粗格 A* 的区别：
   *   - 8 邻接 + 分层（sector/portal），长距离不会撞展开上限
   *   - 进门/出门由 portal 处理，室内起点不再"被判无路"
   *   - 路径都是 clearance 校验过的，不会穿墙
   *
   * 预算是硬的：每帧最多 pathBudget 次（规划 P50 ≈ 0.5 ms）。
   */
  planPath(i, tx, tz) {
    this.ensureNav();
    const NW = this.navWorld;
    if (!NW || this.pathBudget <= 0) return 0;
    const r = NW.planner.plan(this.px[i], this.pz[i], tx, tz);
    if (!r || r.pts.length < 2) return 0;
    this.pathBudget--;
    const n = Math.min(16, r.pts.length - 1);
    for (let k = 0; k < n; k++) {
      this.pathX[i * 16 + k] = r.pts[k + 1][0];
      this.pathZ[i * 16 + k] = r.pts[k + 1][1];
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
  /** 室内点 → 它最近的门（门口空地）。室内目标一律"走到门口就算到"，
   *  这样人不会为了穿到楼对面而贴墙、也不会钻进去出不来。
   *
   *  S7：不再依赖 56 MB 的 1 m 门场，改用 NavCore 的 8 m 门锚点场（476 KB, O(1)）。 */
  doorOf(x, z) {
    const nav = this.nav;
    if (!nav || !nav.indoor || !nav.indoor(x, z)) return null;   // 本来就在户外
    if (this.ensureNav()) {
      const a = this.navWorld.doorAnchor(x, z);
      if (a) return a;
    }
    if (nav.doorPoint) {                        // 兜底（NavCore 没起来时）
      const dp = nav.doorPoint(x, z);
      return dp ? [dp.x, dp.z] : null;
    }
    return null;
  }

  /**
   * 种族/身份：卡片顶部最显眼的那一行。
   * 人类 / 丧尸 / 已感染的活人 / 狗 / 丧尸狗 / 猫 / 丧尸猫 / 尸体
   */
  speciesOf(i) {
    const st = this.state[i];
    const kind = this.kind[i] || 0;
    const dog = kind === 12, cat = kind === 13;
    const dead = st === ST.CORPSE;
    const zomb = st === ST.ZOMBIE;
    const inf = st === ST.INFECTED;
    if (dog) return { label: zomb ? '丧尸狗' : '狗', cls: zomb ? 'zomb' : 'civ', pet: this.pet[i] ? 1 : 0 };
    if (cat) return { label: zomb ? '丧尸猫' : '猫', cls: zomb ? 'zomb' : 'civ', pet: this.pet[i] ? 1 : 0 };
    if (zomb) return { label: '丧尸', cls: 'zomb', from: '人类尸变' };
    if (dead) return { label: '尸体', cls: 'dead', from: '已死亡' };
    if (inf) return { label: '已感染的活人', cls: 'inf', from: '未尸变' };
    if (kind === 3 || kind === 4 || kind === 5 || kind === 11) {
      const t = kind === 4 ? '士兵' : kind === 5 ? '重装兵' : kind === 11 ? '装甲车组' : '警察';
      return { label: '人类', cls: 'civ', from: t };
    }
    if (st === ST.WILD) return { label: '野兽', cls: 'warn' };
    return { label: '人类', cls: 'civ' };
  }

  /**
   * 这个人此刻具体在干什么（卡片用）。返回 { tag, name, detail }。
   * 之前卡片只显示"平民/丧尸/警察"这种大类，警察的巡逻/执勤/护送全混在一起，
   * 这里按分支实际条件拆开。
   */
  statusOf(i) {
    const st = this.state[i];
    const kind = this.kind[i] || 0;
    const D = (x, z) => Math.hypot(x - this.px[i], z - this.pz[i]);
    const sp = SPECIES[kind] || {};
    // ---- 丧尸 / 野兽 ----
    if (st === ST.ZOMBIE || st === ST.WILD) {
      const t = this.tgt[i];
      const wild = st === ST.WILD;
      if (t >= 0) {
        const d = D(this.px[t], this.pz[t]);
        const biteR = sp.biteR || 1.8;
        if (d <= biteR) return { tag: 'zomb', name: wild ? '撕咬' : '撕咬猎物', detail: `${d.toFixed(1)}m 内` };
        if (this.lockOn[i]) return { tag: 'zomb', name: '锁敌追猎', detail: `锁定 ${Math.round(d)}m 外，跨越全城也不放弃` };
        return { tag: 'zomb', name: wild ? '扑向目标' : '追击猎物', detail: `${Math.round(d)}m` };
      }
      const wait = Math.max(0, Math.ceil((this.lockT[i] || 0) - this.time));
      return { tag: 'zomb', name: '游荡寻食', detail: wait > 0 ? `${wait}s 后再次搜敌` : '正在搜敌' };
    }
    // ---- 潜伏期 ----
    if (st === ST.INFECTED) {
      const left = Math.max(0, Math.ceil((this.riseAt[i] || 0) - this.time));
      return { tag: 'inf', name: '潜伏（未尸变）', detail: `约 ${left}s 后尸变` };
    }
    // ---- 警 / 军 ----
    if (st === ST.POLICE || st === ST.SOLDIER) {
      const force = st === ST.SOLDIER ? '部队' : '警队';
      const si = (this.stationOf[i] || 0) - 1;
      const stn = si >= 0 ? (this.poiByKind.police || [])[si] : null;
      const dHome = stn ? D(stn.x, stn.z) : 0;
      if (this.escortOf && this.escortOf[i]) {
        const v = this.vips ? this.vips[this.escortOf[i] - 1] : -1;
        const dv = (v >= 0) ? D(this.px[v], this.pz[v]) : 0;
        return { tag: 'pol', name: '护送要员', detail: dv > 12 ? `距要员 ${Math.round(dv)}m，正在贴身` : '在要员身边' };
      }
      if (this.ammo[i] <= 0 && this.mag[i] <= 0 && this.reserve[i] <= 0) {
        return { tag: 'pol', name: '回局补弹', detail: stn ? `距${force}驻地 ${Math.round(dHome)}m` : '没有归属驻地' };
      }
      if (this.goal[i] === GOAL.MOVE_TO) {
        const gp = this.goalPoint(i, GOAL.MOVE_TO);
        if (gp) {
          const d = D(gp[0], gp[1]);
          if (d > 6) return { tag: 'pol', name: '出警途中', detail: `距现场 ${Math.round(d)}m` };
        }
      }
      const mustReturn = this.chaos >= 50 || (this.chaos >= 20 && this.patrol[i]);
      if (mustReturn && dHome > 18) return { tag: 'pol', name: '奉命撤回', detail: `距驻地 ${Math.round(dHome)}m` };
      if (mustReturn && dHome <= 18) return { tag: 'pol', name: '驻防戒备', detail: '在驻地附近待命' };
      if (this.nearZ[i] >= 0) {
        const d = D(this.px[this.nearZ[i]], this.pz[this.nearZ[i]]);
        if (d < 30) return { tag: 'pol', name: '现场交火', detail: `${Math.round(d)}m 外有目标` };
      }
      if (this.patrol[i]) return { tag: 'pol', name: '街面巡逻', detail: `距驻地 ${Math.round(dHome)}m` };
      if (dHome > 45) return { tag: 'pol', name: '离开驻地', detail: `距驻地 ${Math.round(dHome)}m，正在归位` };
      return { tag: 'pol', name: '驻地待命', detail: `距驻地 ${Math.round(dHome)}m` };
    }
    // ---- 平民 / 逃跑 / 交战 ----
    if (this.fleeMode && this.fleeMode[i] === 2) {
      const fg = this.fleeGoal[i];
      const txt = fg === 0 ? '回家躲避' : fg === 1 ? '去警局避难' : '逃离城区';
      if (this.stationLost && this.stationLost[i]) return { tag: 'flee', name: '有目标逃跑', detail: '警局已沦陷，改道' };
      return { tag: 'flee', name: '有目标逃跑', detail: txt };
    }
    if (st === ST.FLEE) {
      const fg = this.fleeGoal ? this.fleeGoal[i] : 0;
      const txt = fg === 0 ? '回家' : fg === 1 ? '去警局' : fg === 2 ? '出城' : '离开这里';
      return { tag: 'flee', name: '惊慌逃跑', detail: `方向：${txt}` };
    }
    if (this.armHome && this.armHome[i]) {
      const d = D(this.homeX[i], this.homeZ[i]);
      return { tag: 'civ', name: '回家补弹', detail: `距家 ${Math.round(d)}m` };
    }
    if (this.goal[i] === GOAL.SHELTER) {
      const gp = this.goalPoint(i, GOAL.SHELTER);
      return { tag: 'civ', name: '去警局避难', detail: gp ? `还有 ${Math.round(D(gp[0], gp[1]))}m` : '' };
    }
    if (this.goal[i] === GOAL.ARM_HOME) return { tag: 'civ', name: '回家取枪', detail: `距家 ${Math.round(D(this.homeX[i], this.homeZ[i]))}m` };
    if (this.goal[i] === GOAL.HOME) return { tag: 'civ', name: '回家', detail: `还有 ${Math.round(D(this.homeX[i], this.homeZ[i]))}m` };
    if (this.goal[i] === GOAL.WORK) return { tag: 'civ', name: '去单位', detail: `还有 ${Math.round(D(this.workX[i], this.workZ[i]))}m` };
    if (this.goal[i] === GOAL.HOLD) return { tag: 'civ', name: '待在原地', detail: '' };
    if (this.idle[i]) return { tag: 'civ', name: '驻足', detail: `还剩 ${Math.max(0, Math.ceil(this.actT[i]))}s` };
    if (kind === 12 || kind === 13) return { tag: 'animal', name: this.pet[i] ? '在住处附近活动' : '四处觅食', detail: '' };
    return { tag: 'civ', name: '闲逛', detail: '' };
  }

  /** 行程一行：任何情况下都给一句话（卡片里"行程"永远有内容） */
  itineraryOf(i) {
    const st = this.state[i];
    if (st === ST.CORPSE) return '—（已死亡）';
    if (st === ST.SAVED) return '已从撤离口离开城区';
    if (st === ST.ZOMBIE || st === ST.WILD) {
      const t = this.tgt[i];
      if (t >= 0) return `追向 (${this.px[t].toFixed(0)}, ${this.pz[t].toFixed(0)})`;
      return '无目标，正在游荡';
    }
    if (st === ST.POLICE || st === ST.SOLDIER) {
      const si = (this.stationOf[i] || 0) - 1;
      const stn = si >= 0 ? (this.poiByKind.police || [])[si] : null;
      const bits = [];
      if (stn) bits.push(`驻地 ${stn.n || '警局'}（${Math.round(Math.hypot(stn.x - this.px[i], stn.z - this.pz[i]))}m）`);
      if (this.goal[i] === GOAL.MOVE_TO) {
        const gp = this.goalPoint(i, GOAL.MOVE_TO);
        if (gp) bits.push(`前往 (${gp[0].toFixed(0)}, ${gp[1].toFixed(0)})`);
      }
      bits.push(`${this.pathN[i]} 个路点`);
      return bits.join(' · ');
    }
    const g = this.goal[i];
    const gp = g !== GOAL.NONE ? this.goalPoint(i, g) : null;
    if (!gp) return this.idle[i] ? '原地停留' : '无固定行程';
    const d = Math.hypot(gp[0] - this.px[i], gp[1] - this.pz[i]);
    return `(${gp[0].toFixed(0)}, ${gp[1].toFixed(0)}) · 还有 ${Math.round(d)}m · ${this.pathN[i]} 个路点`;
  }

  goalPoint(i, g) {
    if (g === GOAL.HOME) return this.doorOf(this.homeX[i], this.homeZ[i]) || [this.homeX[i], this.homeZ[i]];
    if (g === GOAL.WORK) return this.doorOf(this.workX[i], this.workZ[i]) || [this.workX[i], this.workZ[i]];
    if (g === GOAL.FLEE || g === GOAL.HELP || g === GOAL.SHELTER || g === GOAL.MOVE_TO
        || g === GOAL.ARM_HOME) return [this.goalX[i], this.goalZ[i]];
    return null;
  }

  setGoal(i, g, x, z) {
    if (g === GOAL.ARM_HOME) {
      this.chainStep[i] = 3; x = this.homeX[i]; z = this.homeZ[i]; }
    if (this.goal[i] !== g) this.arrGoal[i] = 0;
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
  /** 四个属性 → 0..1（没赋值时按 50 兜底） */
  attrOf(i) {
    return {
      trust: (this.trust[i] || 50) / 100,
      family: (this.familyDuty[i] || 50) / 100,
      will: (this.willpower[i] || 50) / 100,
      courage: (this.courage[i] || 45) / 100,
    };
  }

  /**
   * 打分：所有候选目标 + 每一项的贡献。
   * **decide() 和 explain() 都调这里** —— 保证面板显示的就是真跑的。
   */
  /** 给每个个体发四个属性（身份定基准 + 年龄修正 + 个人噪声） */
  assignAttributes() {
    for (let i = 0; i < this.n; i++) {
      const st = this.state[i];
      const k = this.kind[i];
      let role = 'civilian';
      if (st === ST.POLICE || st === ST.SOLDIER) role = k === SP.SOLDIER ? 'soldier' : 'police';
      if (this.vip && this.vip[i]) role = 'vip';
      const a = attrFor(i, role);
      this.trust[i] = a.trust;
      this.familyDuty[i] = a.family;
      this.willpower[i] = a.will;
      this.courage[i] = a.courage;
    }
  }

  scoreGoals(i) {
    const A = this.attrOf(i);
    const awareNow = this.aware[i];
    const chaosNow = this.chaos || 0;
    const nearNow = this.zDanger(i);

    // ---------- 日常层（P2.1 / 2.4）----------
    // 一无所知 + 混乱度 < 15 + 附近没丧尸 → 过正常日子，不参与危机打分
    if (awareNow === 0 && chaosNow < 15 && nearNow < 0.05) {
      const m = this.clockMin;
      const atWork = m >= 6 * 60 && m < 18 * 60;      // 06:00–18:00 在单位/学校
      const sickNow = this.ill[i] && this.state[i] !== ST.INFECTED;
      const candDaily = new Map();
      const addD = (g, k, v) => {
        let c = candDaily.get(g);
        if (!c) { c = { goal: g, score: 0, parts: [] }; candDaily.set(g, c); }
        c.score += v; c.parts.push({ k, v });
      };
      if (sickNow) {
        addD(GOAL.HELP, '要看病（压过上班）', 2.2);
        addD(atWork ? GOAL.WORK : GOAL.HOME, '日程', 0.6);
      } else {
        addD(atWork ? GOAL.WORK : GOAL.HOME, '日程（' + (atWork ? '上班/上学时段' : '回家/休息时段') + '）', 2.0);
        addD(atWork ? GOAL.HOME : GOAL.WORK, '反向行程', 0.3);
      }
      addD(GOAL.NONE, '闲晃', 0.4);
      const list = [...candDaily.values()].sort((a, b) => b.score - a.score);
      return {
        candidates: list, best: list[0].goal, bestScore: list[0].score,
        excluded: [], daily: true,
        ctx: { attr: A, near: nearNow, fam: this.familyAlive(i), homeD: 0,
               gun: false, friend: 0, chaos: chaosNow, aware: awareNow, infected: false },
      };
    }

    // ---------- 危机层 ----------
    const aware = this.aware[i];
    const near = this.zDanger(i);            // 0..1，越近越危险
    const fam = this.familyAlive(i);
    const homeD = Math.hypot(this.homeX[i] - this.px[i], this.homeZ[i] - this.pz[i]);
    const gun = this.homeHasGun(i) && !this.armed[i];
    const friend = this.nearFriends(i);
    const chaos = this.chaos || 0;
    const infected = this.state[i] === ST.INFECTED;

    const cand = new Map();
    const add = (g, k, v) => {
      let c = cand.get(g);
      if (!c) { c = { goal: g, score: 0, parts: [] }; cand.set(g, c); }
      c.score += v;
      c.parts.push({ k, v });
    };

    // 恐慌系数：混乱度低的时候，人不会成群结队地逃或者跟人群走
    const panic = Math.min(1, chaos / 40);

    // ---- 基线（保证兜底，不会出现"全 0 发呆"）----
    add(GOAL.FLEE, '基线', 0.35 * (0.35 + 0.65 * panic));
    add(GOAL.HOME, '基线', 0.40);
    add(GOAL.ARM_HOME, '基线', 0.25);
    add(GOAL.SHELTER, '基线', 0.20);
    add(GOAL.HOLD, '基线', 0.10);
    add(GOAL.FOLLOW, '基线', 0.15 * (0.35 + 0.65 * panic));
    add(GOAL.WORK, '基线', 0.30);
    // 政府命令：学校停课 → 学生/教职工不用去学校；医院停止收治 → 别再往医院跑
    if (this.govOrders.schoolClosed && this.jobKind[i] === INST.SCHOOL) add(GOAL.WORK, '学校停课', -1.20);
    if (this.govOrders.curfew) {
      add(GOAL.HOME, '宵禁', 0.55);
      add(GOAL.NONE, '宵禁', -0.80);
      add(GOAL.FOLLOW, '宵禁', -0.60);
    }
    if (this.govOrders.hospitalClosed) add(GOAL.HELP, '医院停止收治', -1.50);
    add(GOAL.NONE, '基线', 0.20);

    // ---- 属性项 ----
    add(GOAL.FLEE, '勇猛低（怕死）', (1 - A.courage) * 0.35 * panic);
    add(GOAL.FLEE, '信任低（不信体制）', (1 - A.trust) * 0.20 * panic);
    add(GOAL.FLEE, fam === 0 ? '没牵挂' : '有牵挂', (fam === 0 ? 0.15 : -A.family * 0.20) * panic);

    add(GOAL.HOME, '家庭责任', A.family * 0.60);
    add(GOAL.HOME, '家太远', -Math.min(0.35, homeD / 3000));

    add(GOAL.ARM_HOME, '勇猛', A.courage * 0.50);
    add(GOAL.ARM_HOME, '信任低', (1 - A.trust) * 0.20);

    // 去警局避难需要"知道出事了"：一无所知的人不会主动去避难所
    if (aware >= 1 || chaos >= 20) {
      add(GOAL.SHELTER, '政府信任', A.trust * 0.70);
      add(GOAL.SHELTER, '勇猛低', (1 - A.courage) * 0.15);
    } else {
      add(GOAL.SHELTER, '还没听说（不去避难）', -0.20);
    }

    add(GOAL.HOLD, '意志', A.will * 0.50);
    add(GOAL.HOLD, homeD > 150 ? '不在家附近（守不住）' : '就在家附近', homeD > 150 ? -0.45 : 0.35);
    add(GOAL.HOLD, '勇猛低', (1 - A.courage) * 0.20);

    add(GOAL.FOLLOW, '意志低', (1 - A.will) * 0.40 * panic);
    add(GOAL.FOLLOW, '附近人多', Math.min(1, friend / 12) * 0.30 * panic);

    // ---- 处境项 ----
    if (near > 0.25) {
      add(GOAL.FLEE, '附近有丧尸', 0.55 + near * 0.4);
      if (fam > 0) add(GOAL.HOME, '附近有丧尸（仍想回家）', 0.25 + (homeD < 500 ? 0.2 : 0));
      if (gun) add(GOAL.ARM_HOME, '附近有丧尸 + 有枪', 0.30 + (homeD < 300 ? 0.2 : 0));
      add(GOAL.HOLD, '附近有丧尸', 0.15);
    }
    if (chaos >= 50) {
      const pp = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (pp) {
        const d = Math.hypot(pp.x - this.px[i], pp.z - this.pz[i]);
        add(GOAL.SHELTER, '混乱度 ≥ 50%', 0.95 - Math.min(0.45, d / 4000));
      }
    }
    if (aware >= 1) {
      add(GOAL.HOME, '听说了（回家看看）', 0.10);
      add(GOAL.FLEE, '听说了 + 网络热度', this.heat * 0.25);
    }
    if (infected) add(GOAL.HELP, '已被感染（去医院）', this.sick[i] ? 1.6 : 0.5);

    // ---- 三步行动链的约束（P2.3）：让链真的驱动行为，而不只是贴标签 ----
    const atHome = homeD < 60;
    if (this.chainStep[i] === 0 && fam > 0 && !atHome) {
      // 家里还有人，却想直接跑 / 直接进避难所 → 扣分，先把人接上
      add(GOAL.SHELTER, '还没接家人', -0.55);
      add(GOAL.FLEE, '还没接家人', -0.45);
    }
    if (atHome && this.chainStep[i] <= 1 && this.homeHasGun(i) && !this.armed[i] && chaos >= 20) {
      // 人在家、家里有枪、还没拿：先拿枪再走（第二步）
      add(GOAL.ARM_HOME, '先取枪再走', 0.85);
      add(GOAL.SHELTER, '先取枪再走', -0.45);
      add(GOAL.FLEE, '先取枪再走', -0.35);
    }

    // ---- 前置条件不满足 → 直接从候选里移除（并记原因，供 explain 用）----
    const excluded = [];
    if (!gun) excluded.push({ goal: GOAL.ARM_HOME, why: '家里没有枪' });
    if (infected) excluded.push({ goal: GOAL.WORK, why: '已感染，不会再上班' });

    // ---- 排序 ----
    let list = [...cand.values()];
    const filtered = list.filter((c) => !excluded.some((e) => e.goal === c.goal));
    filtered.sort((a, b) => b.score - a.score);
    if (!filtered.length) filtered.push({ goal: GOAL.FLEE, score: 0.5, parts: [{ k: '兜底', v: 0.5 }] });

    return {
      candidates: filtered,
      best: filtered[0].goal,
      bestScore: filtered[0].score,
      excluded,
      ctx: { attr: A, near, fam, homeD, gun, friend, chaos, aware, infected },
    };
  }

  decide(i) {
    const st = this.state[i];
    if (st !== ST.CIV && st !== ST.FLEE && st !== ST.FIGHT && st !== ST.INFECTED) return;
    // 回家补弹：这条 goal 要粘住，直到到家拿到子弹
    if (this.armHome[i]) {
      if (this.goal[i] !== GOAL.ARM_HOME) this.setGoal(i, GOAL.ARM_HOME, this.homeX[i], this.homeZ[i]);
      // 家通常是"楼里的点"，人进不去 —— 目标改成家门口，走到门口就算到家
      const dpA = this.doorOf(this.homeX[i], this.homeZ[i]);
      if (dpA) { this.goalX[i] = dpA[0]; this.goalZ[i] = dpA[1]; }
      return;
    }
    // 玩家/系统下达的移动命令（右键点地、出警）优先：没走到之前不被社会决策覆盖
    if (this.goal[i] === GOAL.MOVE_TO) {
      const gp = this.goalPoint(i, GOAL.MOVE_TO);
      if (gp && Math.hypot(gp[0] - this.px[i], gp[1] - this.pz[i]) < 6) {
        this.setGoal(i, GOAL.NONE);
      } else {
        // 命令目标看不见时才寻路（以前这里直接 return，导致"右键点地"永远没有路径）
        if (gp && this.pathN[i] === 0 && !this.losClear(this.px[i], this.pz[i], gp[0], gp[1])) {
          this.planPath(i, gp[0], gp[1]);
        }
        return;
      }
    }

    // ---- 逃跑（有目标）大类：一旦进入就粘住，直到到达或主动放弃 ----
    if (this.fleeMode[i] === 2) {
      this.applyFleeGoal(i);
      return;
    }
    // 触发条件：① 亲眼看见（aware>=2）  ② 混乱度 >= 50
    if (!this.armed[i] && (this.aware[i] >= 2 || this.chaos >= 50)) {
      const A = this.attrOf(i);
      const fam = this.familyAlive(i);
      // 三种目标各打一个分，取最高的（性格决定）
      const sHome = fam > 0 ? A.family * 1.10 + 0.15 : -1;
      const sPolice = A.trust * 1.60 + (1 - A.courage) * 0.50;
      const sEscape = (1 - A.family) * 0.28 + (1 - A.trust) * 0.30 + A.courage * 0.16 + (fam === 0 ? 0.30 : 0);
      let fg = 2;
      let bs = this.stationLost[i] ? -1 : sPolice;   // 确认过警局沦陷 → 警局项直接作废
      if (sHome > bs) { fg = 0; bs = sHome; }
      if (sEscape > bs) { fg = 2; bs = sEscape; }
      this.fleeMode[i] = 2;
      this.fleeGoal[i] = fg;
      this.applyFleeGoal(i);
      return;
    }

    // ---- 政府命令（行动面板下达）：学校停课 / 医院停止收治 ----
    if (this.govOrders.schoolClosed && this.jobKind[i] === INST.SCHOOL && this.goal[i] === GOAL.WORK) {
      this.setGoal(i, GOAL.HOME, this.homeX[i], this.homeZ[i]);
      return;
    }
    if (this.govOrders.hospitalClosed && this.goal[i] === GOAL.HELP) {
      this.setGoal(i, GOAL.HOME, this.homeX[i], this.homeZ[i]);
      return;
    }

    // 发病的人：不管知不知道外面出事了，都会往医院跑（零号病人的核心叙事）
    if (this.sick[i] && this.state[i] === ST.INFECTED && !this.govOrders.hospitalClosed) {
      const hp = this.nearestPoi('hospital', this.px[i], this.pz[i]);
      if (hp) {
        if (this.goal[i] !== GOAL.HELP) this.setGoal(i, GOAL.HELP, hp.x, hp.z);
        return;
      }
    }

    const r = this.scoreGoals(i);
    let best = r.best, bs = r.bestScore;

    // 惯性：当前目标加一点分，避免每秒横跳
    const cur = this.goal[i];
    if (cur !== GOAL.NONE && best !== cur) {
      const momentum = cur === GOAL.FLEE ? 0.10 : 0.14;
      if (bs - momentum <= this.lastScore[i]) best = cur;
    }
    this.lastScore[i] = bs;

    if (best === this.goal[i] && best !== GOAL.FLEE && best !== GOAL.NONE) return;
    let gx, gz;
    if (best === GOAL.FLEE) { const p = this.escapePoint(i); gx = p[0]; gz = p[1]; }
    else if (best === GOAL.HELP) {
      const h = this.nearestPoi('hospital', this.px[i], this.pz[i]);
      if (h) { gx = h.x; gz = h.z; } else { const p = this.fleePoint(i); gx = p[0]; gz = p[1]; }
    } else if (best === GOAL.SHELTER) {
      const p = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (p) { gx = p.x; gz = p.z; } else { const q = this.fleePoint(i); gx = q[0]; gz = q[1]; }
    } else if (best === GOAL.ARM_HOME) { gx = this.homeX[i]; gz = this.homeZ[i]; }
    else if (best === GOAL.FOLLOW) { const q = this.escapePoint(i); gx = q[0]; gz = q[1]; }
    const changed = best !== this.goal[i];
    this.setGoal(i, best, gx, gz);
    // 行动链步骤：1 接家人 / 2 取枪 / 3 避难或撤离
    if (best === GOAL.HOME) this.chainStep[i] = this.chainStep[i] === 0 ? 1 : this.chainStep[i];
    else if (best === GOAL.ARM_HOME) this.chainStep[i] = 2;
    else if (best === GOAL.SHELTER || best === GOAL.FLEE) this.chainStep[i] = 3;
    this.decT[i] = this.time + (changed ? (best === GOAL.FLEE ? 14 : 8 + this.rng() * 6) : 1.0 + this.rng() * 1.2);
  }

  /** 给面板用：为什么他现在在做这件事（和 decide 同一个打分函数） */
  explain(i) {
    const r = this.scoreGoals(i);
    const NAMES = ['无', '回家', '上班', '逃', '回家取枪', '去警局', '去医院', '固守', '跟随', '被指挥'];
    return {
      goal: this.goal[i],
      goalName: NAMES[this.goal[i]] || '—',
      candidates: r.candidates.slice(0, 4).map((c) => ({ goal: c.goal, name: NAMES[c.goal], score: c.score, parts: c.parts })),
      excluded: r.excluded.map((e) => ({ goal: e.goal, name: NAMES[e.goal], why: e.why })),
      ctx: r.ctx,
      attr: r.ctx.attr,
    };
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
      // 已经有枪但打空了：从自家军械库补弹（不再只是"有枪就不给"）
      else if (this.armed[i] && this.mag[i] <= 0 && this.reserve[i] <= 0 &&
               this.hhStart && this.hh[i] < this.nHh) {
        const stock2 = this.homeStocks.get(this.hh[i]);
        const wid = this.wpn[i], w2 = weaponOf(wid);
        const avail = stock2 && stock2.a ? (stock2.a[wid] || 0) : 0;
        const got = Math.min(w2.mag * 3, avail);
        if (got > 0) {
          stock2.a[wid] = avail - got;
          this.mag[i] = Math.min(w2.mag, got);
          this.reserve[i] = Math.max(0, Math.min(255, got - this.mag[i]));
          this.ammo[i] = this.mag[i];
          this.rlUntil[i] = this.time + w2.reload;
        }
      }
      this.armHome[i] = 0;
      this.setGoal(i, GOAL.HOLD, this.homeX[i], this.homeZ[i]);
      this.idle[i] = 1;
      this.actT[i] = 5 + this.rng() * 8;
      return;
    }
    if (g === GOAL.SHELTER) {
      this.chainStep[i] = 3;
      // 到警局避难：**混乱度 ≥ 50% 才拿得到枪**（低于 50% 时警察还在岗，军械库不给平民开）
      const poi = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (!this.armed[i] && this.chaos >= 50 && poi && poi.store) {
        const got = takeWeapon(poi.store, this.rng);
        if (got) {
          // 记账：这个所的枪是被平民拿走的（面板要显示"哪个所被掏空、被谁掏空"）
          if (!poi.taken) poi.taken = { civ: 0, cop: 0, guns: 0, ammo: 0 };
          poi.taken.civ += got.rounds; poi.taken.guns += 1; poi.taken.ammo += got.rounds;
          this.giveWeapon(i, got.id, skillFor('civilian') + (this.rng() - 0.5) * 0.2);
          const w = weaponOf(got.id);
          this.mag[i] = Math.min(w.mag, got.rounds);
          this.reserve[i] = Math.max(0, Math.min(255, got.rounds - this.mag[i]));
          this.ammo[i] = this.mag[i];
        }
      }
      this.setGoal(i, GOAL.HOLD, this.px[i], this.pz[i]);
      this.idle[i] = 1;
      this.actT[i] = 12 + this.rng() * 20;      // 就守在警局
      return;
    }
    if (g === GOAL.HOME) {
      // 链式推进：到家之后先看家里有没有枪，再决定去避难还是固守
      if (this.homeHasGun(i) && !this.armed[i] && this.chaos >= 20) {
        this.setGoal(i, GOAL.ARM_HOME, this.homeX[i], this.homeZ[i]);
        this.chainStep[i] = 2;
        return;
      }
      this.chainStep[i] = 3;
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

  /**
   * 混乱度 > 80 之后，"潜伏期（还没变）的人"在**判定上**等同于丧尸：
   * 警察/士兵/持枪平民会把他当威胁。外观上他仍然是正常人（能不能看出来是另一回事）。
   */
  zombieLike(j) {
    const st = this.state[j];
    if (st === ST.ZOMBIE) return true;
    return this.chaos > 80 && st === ST.INFECTED;
  }

  /**
   * 按面积密度生成 POI（不看任何 OSM 标签）：
   *   目标数量 = max(最少数量, 城市面积 km² × 密度)
   *   从建筑面积 >= 门槛 的楼里挑，警察局/医院优先挑大楼，
   *   彼此还要满足最小间距，避免挤在一起。
   * 随机种子 = 城市尺寸的哈希 → 同一张地图每次结果一致。
   */
  generatePois() {
    const nav = this.nav;
    const city = this.city || {};
    const W = nav.W || nav.halfW * 2, H = nav.H || nav.halfH * 2;
    const km2 = (W * H) / 1e6;
    // 每 km² 数量 + 最少数量
    const DENS = {
      police: [0.55, 2], hospital: [0.40, 2], fire: [0.25, 1],
      school: [0.80, 3], market: [1.20, 4], transit: [0.40, 2],
      pharmacy: [0.60, 2], gov: [0.20, 1],
    };
    // 最小间距（米）与最小建筑面积（m²）
    const MIN_D = { police: 700, hospital: 800, fire: 700, school: 450, market: 250, transit: 600, pharmacy: 200, gov: 700 };
    const MIN_A = { police: 250, hospital: 400, fire: 150, school: 300, market: 120, transit: 250, pharmacy: 80, gov: 300 };
    const BIG = new Set(['police', 'hospital', 'gov', 'transit', 'fire']);
    const CAP = { gov: 1 };        // 政府最多 1 个

    // 候选：楼 → 面积 + 内部点（用多边形质心，凹形会被后面的吸附兜住）
    const cand = [];
    for (const b of (city.buildings || [])) {
      const pts = b.p || [];
      if (pts.length < 3) continue;
      let a2 = 0, cx = 0, cz = 0;
      for (let k = 0; k < pts.length; k++) {
        const [x0, z0] = pts[k], [x1, z1] = pts[(k + 1) % pts.length];
        const cr = x0 * z1 - x1 * z0;
        a2 += cr; cx += (x0 + x1) * cr; cz += (z0 + z1) * cr;
      }
      const area = Math.abs(a2) / 2;
      if (area < 80) continue;
      if (Math.abs(a2) < 1e-6) continue;
      cand.push({ a: area, x: cx / (3 * a2), z: cz / (3 * a2) });
    }
    if (!cand.length) return [];
    cand.sort((p, q) => q.a - p.a);

    // 确定性随机（城市尺寸的哈希）
    let seed = 2166136261;
    const key = `${Math.round(W)}x${Math.round(H)}`;
    for (let i = 0; i < key.length; i++) { seed ^= key.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const out = [];
    const taken = [];
    const KIND_NAME = {
      police: '警察局', hospital: '医院', fire: '消防站', school: '学校',
      market: '超市', transit: '车站', pharmacy: '药店', gov: '政府',
    };
    for (const kind in DENS) {
      const [dens, minN] = DENS[kind];
      let want = Math.max(1, minN, Math.round(km2 * dens));     // 每种至少 1 个（防 bug）
      if (CAP[kind]) want = Math.min(want, CAP[kind]);          // 再套上限
      // 大楼优先（只在前 40% 里挑），但别把候选池压得太小
      const pool = BIG.has(kind) ? cand.slice(0, Math.max(40, Math.round(cand.length * 0.4))) : cand;
      let made = 0;
      // 三档松弛：先按正常规则，凑不够就放宽间距，再不够就放宽面积，
      // 最后兜底"最大的一栋楼"—— 保证每种至少 1 个，绝不出现"政府 0 个"。
      for (let pass = 0; pass < 3 && made < want; pass++) {
        const relaxD = pass >= 1 ? 0 : MIN_D[kind];
        const relaxA = pass >= 2 ? 0 : MIN_A[kind];
        for (let attempt = 0; attempt < pool.length * 3 && made < want; attempt++) {
          const c = pool[(rnd() * pool.length) | 0];
          if (c.a < relaxA) continue;
          if (taken.indexOf(c) >= 0) continue;
          let clash = false;
          if (relaxD > 0) {
            for (const t of taken) {
              if (Math.hypot(t.x - c.x, t.z - c.z) < relaxD) { clash = true; break; }
            }
          }
          if (clash) continue;
          taken.push(c);
          out.push({ k: kind, x: c.x, z: c.z, n: KIND_NAME[kind] + ' ' + (made + 1) + ' 号', a: c.a });
          made++;
        }
      }
    }
    return out;
  }

  /** 把"有目标逃跑"落到具体目标上；到警局发现沦陷就改道 */
  applyFleeGoal(i) {
    const fg = this.fleeGoal[i];
    if (fg === 1) {
      const poi = this.nearestPoi('police', this.px[i], this.pz[i]);
      if (poi) {
        const d = Math.hypot(poi.x - this.px[i], poi.z - this.pz[i]);
        // 到了警局门口：如果这里已经被丧尸占满，就标记"沦陷"，改道回家/出城
        if (d < 18 && this.policeNear(poi.x, poi.z, 50) === 0) {
          this.stationLost[i] = 1;
          this.fleeGoal[i] = this.familyAlive(i) > 0 ? 0 : 2;
          this.applyFleeGoal(i);
          return;
        }
        if (this.goal[i] !== GOAL.SHELTER || d < 18) this.setGoal(i, GOAL.SHELTER, poi.x, poi.z);
        return;
      }
      this.fleeGoal[i] = this.familyAlive(i) > 0 ? 0 : 2;
      this.applyFleeGoal(i);
      return;
    }
    if (fg === 0) {
      if (this.goal[i] !== GOAL.HOME) this.setGoal(i, GOAL.HOME, this.homeX[i], this.homeZ[i]);
      return;
    }
    const p = this.escapePoint(i);
    this.setGoal(i, GOAL.FLEE, p[0], p[1]);
  }

  /** 某点半径 r 内还有多少警察/士兵（警局"沦陷"的判据：50m 内一个警察都没有） */
  policeNear(x, z, r) {
    let n = 0;
    const r2 = r * r;
    for (let j = 0; j < this.n; j++) {
      const st = this.state[j];
      if (st !== ST.POLICE && st !== ST.SOLDIER) continue;
      const dx = this.px[j] - x, dz = this.pz[j] - z;
      if (dx * dx + dz * dz <= r2) n++;
    }
    return n;
  }

  /** 全城最近的"非丧尸单位"（平民/警察/士兵/动物）。带每帧预算，避免同时扫全城 */
  nearestPrey(i) {
    if (!(this.preyBudget > 0)) return -1;
    this.preyBudget--;
    let best = -1, bd = Infinity;
    const x = this.px[i], z = this.pz[i];
    for (let j = 0; j < this.n; j++) {
      const st = this.state[j];
      if (st === ST.ZOMBIE || st === ST.CORPSE || st === ST.SAVED) continue;
      if (this.aStage[j] === 2 || this.aStage[j] === 3) continue;   // 正在倒地/爬起的不算
      const dx = this.px[j] - x, dz = this.pz[j] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = j; }
    }
    return best;
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
            // 只有到目标的直线走不通时才值得花预算寻路（开阔街上直接走就行）
      if (gp3 && (this.forcePlan[i] || !this.losClear(this.px[i], this.pz[i], gp3[0], gp3[1]))) {
        this.planPath(i, gp3[0], gp3[1]);
        this.forcePlan[i] = 0;      // 规划过一次就清标记
      }
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
          const r = this.dispatchPolice(e.x, e.z, 2, { dest: '事发地点', why: '目击丧尸' });
          if (r.ok) {
            e.responders = r.n;
            e.ids = r.ids || [];
            this.nextDispatch = this.time + 4;
          }
          break;
        }
      }
    }

    // ---- 接触传染（每秒一次）----
    this.spreadContact();

    // ---- 预算回款（P3.2）：每撤出一个人，返还 ¥200 ----
    if (this.saved > (this.lastSaved || 0)) {
      const d = this.saved - (this.lastSaved || 0);
      this.lastSaved = this.saved;
      this.budget = Math.min(this.budgetMax, this.budget + d * 200);
      this.budgetBack = (this.budgetBack || 0) + d * 200;
    }

    // ---- 感染率 / 戒严（每秒一次）----
    if (t >= this.rateT) {
      this.rateT = t + 1;
      const s = this.stats;
      this.infectRate = (s.zombie + s.infected) / Math.max(1, this.pop0 || this.n);
      this.awareRate = this.nAware / Math.max(1, this.n);
      // 武力状态（0-100）：武装人数 × 40% + 警察存活 × 40% + 弹药存量 × 20%
      let armedN = 0, polN = 0, ammoN = 0;
      for (let i = 0; i < this.n; i++) {
        const st2 = this.state[i];
        if (st2 === ST.CORPSE || st2 === ST.ZOMBIE) continue;
        if (this.armed[i]) { armedN++; ammoN += (this.mag[i] || 0) + (this.reserve[i] || 0); }
        if (st2 === ST.POLICE || st2 === ST.SOLDIER) polN++;
      }
      const popAlive = Math.max(1, this.stats.civ + this.stats.police);
      this.force = Math.min(100, Math.round(
        Math.min(1, armedN / Math.max(1, popAlive * 0.15)) * 40 +
        Math.min(1, polN / Math.max(1, (this.params && this.params.police) || 60)) * 40 +
        Math.min(1, ammoN / Math.max(1, popAlive * 8)) * 20));

      // 卫生状态（0-100）：尸体堆积和感染率会把城市拖垮
      const corpses = this.stats.dead || 0;
      const sanitRaw = 100 - Math.min(45, corpses / Math.max(1, this.pop0) * 300)
                            - Math.min(45, this.infectRate * 100 * 4);
      this.sanit = Math.max(0, Math.round(sanitRaw));

      // 混乱度 = 知情值×0.5 + 感染值×2，上限 100
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
          const ok = want === 1 ? (st === ST.ZOMBIE || (this.chaos > 80 && st === ST.INFECTED))
              : want === 4 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED ||
                              st === ST.POLICE || st === ST.SOLDIER)
                : want === 5 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                st === ST.INFECTED || st === ST.WILD)          // 丧尸的猎物：人和野兽
                  : want === 6 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                  st === ST.POLICE || st === ST.SOLDIER || st === ST.ZOMBIE)
                    // want 7 = 清剿：除了自己人（警察/士兵）以外全打，人和尸都算
                    : want === 7 ? (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT ||
                                    st === ST.INFECTED || st === ST.ZOMBIE || st === ST.WILD)
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
  /**
   * 找"最近的室外可走点"方向（门场失效时的兜底）。
   * 24 个方向 × 4 个半径，只在室内且门场为空时调用。
   */
  exitProbe(i) {
    const nav = this.nav;
    if (!nav.indoor) return null;
    if (!nav.indoor(this.px[i], this.pz[i])) return null;
    let best = null, bd = 1e9;
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let q = 0; q < 4; q++) {
        const d = 4 + q * 6;
        const x = this.px[i] + ca * d, z = this.pz[i] + sa * d;
        if (!this.walkable(x, z)) continue;
        if (nav.indoor(x, z)) continue;
        // 检查这条直线是不是真的通（每 1.5m 探一次），否则会一头撞在墙上
        let clear = true;
        for (let m = 1.5; m < d; m += 1.5) {
          if (!this.walkable(this.px[i] + ca * m, this.pz[i] + sa * m)) { clear = false; break; }
        }
        if (!clear) continue;
        if (d < bd) { bd = d; best = [ca, sa]; }
        break;
      }
    }
    return best;
  }

  /**
   * 统一"朝某方向走"：只要人在屋里，就先跟着门场出门；
   * 门场给不出方向（这栋楼没有连通的门）就自己探一个最近的出口。
   */
  /**
   * 把"站在不可通行格子上"的个体挪到最近的空地。
   * 手绘墙之后必须调一次，否则被墙盖住的人会永远卡死在里面。
   * 返回被挪动的人数。
   */
  evictFromWalls() {
    let moved = 0;
    const nav = this.nav;
    const maxR = 40;                 // 最多找 40 米
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] === ST.CORPSE) continue;
      if (this.walkable(this.px[i], this.pz[i])) continue;
      let ok = false;
      for (let d = 1; d <= maxR && !ok; d += 1) {
        for (let k = 0; k < 12; k++) {
          const a = (k * Math.PI) / 6;
          const x = this.px[i] + Math.cos(a) * d;
          const z = this.pz[i] + Math.sin(a) * d;
          if (this.walkable(x, z)) {
            this.px[i] = x; this.pz[i] = z;
            this.pathN[i] = 0; this.pathIdx[i] = 0;
            this.stuckT[i] = 0; this.stuck[i] = 0;
            ok = true; moved++;
            break;
          }
        }
      }
      // 实在找不到（整片都被涂成墙）：挪到地图中心附近
      if (!ok) { this.px[i] = 0; this.pz[i] = 0; moved++; }
    }
    return moved;
  }

  // ============================================================
  //  NavCore 接线（S5）：局部跟随换成 clearance 感知的 context steering
  //  —— 行为层不变，只是"落地"这一步换了实现
  // ============================================================

  /** 懒加载：第一次真正要移动时才建导航世界（建图约 0.7 s，不能放进每局 reset） */
  ensureNav() {
    if (this._navTried) return this.steer;
    this._navTried = true;
    if (this.navOpt === false) return null;
    try {
      this.navWorld = getNavWorld(this.nav);
      this.steer = this.navWorld.makeSteering({
        px: this.px, pz: this.pz, heading: this.heading,
        phase: this.phase, stuck: this.stuck,
        lastDir: this.lastDir, lastDirT: this.lastDirT,
        lastVX: this.lastVX, lastVZ: this.lastVZ, flipT: this.flipT, side: this.side,
        stride: null,
      });
    } catch (e) {
      console.warn('[ZOS-R] NavCore 初始化失败，回退旧移动算法：', e);
      this.navWorld = null;
      this.steer = null;
    }
    return this.steer;
  }

  /**
   * 室内出门引导（S7.1 重写）：
   *
   * 以前的三个毛病，直接造成了"在门口来回前后闪"：
   *  1. 只取"最近的那个门"——如果那扇门朝向建筑物的背面，人出门后
   *     目标方向正好反向，于是又被拉回楼里，来回一步一个来回；
   *  2. 引导点是"路径上第 4 个点"——人走到那个点后没有推进逻辑，
   *     方向每帧反转，看起来就是原地闪烁；
   *  3. 每 3 秒才刷新一次，中间全靠硬撑。
   *
   * 现在：出口按"室内距离 + 出口到目标的直线距离"挑（朝目标那一侧的门优先），
   * 引导点取**至少 3 m 之外**的第一个路点，走到 1.5 m 内立刻重算。
   */
  indoorWaypoint(i) {
    const t = this.time;
    const wdx = this.guideX[i] - this.px[i], wdz = this.guideZ[i] - this.pz[i];
    const near = (wdx * wdx + wdz * wdz) < 2.25;          // 1.5 m
    if (this.guideOK[i] && t < this.guideT[i] && !near) {
      return [this.guideX[i], this.guideZ[i]];
    }
    // 预算必须**先判后扣**：否则 guideOK=0 的个体会绕过预算，每 tick 都做一次 BFS
    if (this.guideBudget <= 0) return this.guideOK[i] ? [this.guideX[i], this.guideZ[i]] : null;
    this.guideBudget--;
    this.guideT[i] = t + 2.5 + this.rng() * 1.5;

    // 目标点只在这里算（每次重算一次，不是每 tick 每人都算）
    const gp2 = this.goalPoint(i, this.goal[i]);
    const gx = gp2 ? gp2[0] : this.px[i];
    const gz = gp2 ? gp2[1] : this.pz[i];

    const P = this.navWorld.portals;
    const ex = P.exitsFrom(this.px[i], this.pz[i], 2, 400);
    if (!ex.length) { this.guideOK[i] = 0; return null; }

    // 出口打分：室内走到门口的距离 + 出门后到目标的直线距离（朝目标那一侧优先）
    let best = ex[0], bestScore = Infinity;
    for (const e of ex) {
      const dOut = Math.hypot(e.outdoor[0] - gx, e.outdoor[1] - gz);
      const sc = e.cost + dOut * 0.5;
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    const pts = best.points;
    if (!pts.length) return null;                          // 已经站在门上了，交给直走
    // 取"离我至少 3 m"的第一个路点；没有就取最后一个
    let k = pts.length - 1;
    for (let j = 0; j < pts.length; j++) {
      const d2 = (pts[j][0] - this.px[i]) ** 2 + (pts[j][1] - this.pz[i]) ** 2;
      if (d2 >= 9) { k = j; break; }
    }
    this.guideX[i] = pts[k][0];
    this.guideZ[i] = pts[k][1];
    this.guideOK[i] = 1;
    return [this.guideX[i], this.guideZ[i]];
  }

  moveSmart(i, dx, dz, speed, dt, gx, gz) {
    const NW = this.ensureNav() ? this.navWorld : null;
    if (NW) {
      const ng = NW.ng;
      const inNow = ng.indoor(this.px[i], this.pz[i]);
      if (inNow) {
        this.exitT[i] = this.time + 1.5;                   // 记住"还在出门路上"
      } else if (this.wasIn[i]) {
        this.freeT[i] = this.time + 2.5;                   // 刚跨出门
      }
      this.wasIn[i] = inNow ? 1 : 0;

      // ① 在楼里 / 刚跨到门槛那一格（那一格不算室内）→ 先想办法出去
      if (inNow || this.time < this.exitT[i]) {
        // ①a 已经贴到门口（8 m 内）：直接朝"门外那一格"走。
        //     关键是这一格**与室内/室外标记无关**——人一脚踩在门槛上时
        //     室内标记会来回翻转，如果两套目标分别指向"门里"和"门外"，
        //     就会变成每帧掉头一次（实测 74% 的行走个体在闪，大多在门里）。
        const a = NW.doorAnchor(this.px[i], this.pz[i]);
        if (a) {
          const ax2 = a[0] - this.px[i], az2 = a[1] - this.pz[i];
          const d2 = Math.hypot(ax2, az2);
          if (d2 < 8 && (d2 < 1.2 || ng.losClear(this.px[i], this.pz[i], a[0], a[1], 0.3))) {
            if (!inNow && d2 < 1.5) {
              // 已经站在门外了：结束"出门"状态，别再围着门口那一点打转
              this.exitT[i] = 0;
              this.guideOK[i] = 0;
            } else {
              return this.move(i, ax2, az2, speed, dt);
            }
          }
        }
        // ①b 还在楼里深处：沿出口路径走
        const wp = this.indoorWaypoint(i);
        if (wp) return this.move(i, wp[0] - this.px[i], wp[1] - this.pz[i], speed, dt);
      }
      // ② 刚出门：期望方向如果会把我们送回楼里，就沿墙侧向绕
      if (this.time < this.freeT[i]) {
        const d = Math.hypot(dx, dz);
        if (d > 1e-6) {
          const ux = dx / d, uz = dz / d;
          if (ng.indoor(this.px[i] + ux * 2.2, this.pz[i] + uz * 2.2)) {
            const c1x = -uz, c1z = ux, c2x = uz, c2z = -ux;
            const k1 = ng.walkableR(this.px[i] + c1x * 2.2, this.pz[i] + c1z * 2.2, NW.radius);
            const k2 = ng.walkableR(this.px[i] + c2x * 2.2, this.pz[i] + c2z * 2.2, NW.radius);
            let px2 = 0, pz2 = 0, found = false;
            if (k1 && !k2) { px2 = c1x; pz2 = c1z; found = true; }
            else if (k2 && !k1) { px2 = c2x; pz2 = c2z; found = true; }
            else if (k1 && k2) {
              const tdx = (gx === undefined ? this.px[i] + dx : gx) - this.px[i];
              const tdz = (gz === undefined ? this.pz[i] + dz : gz) - this.pz[i];
              const tl = Math.hypot(tdx, tdz) || 1;
              const d1 = c1x * tdx / tl + c1z * tdz / tl;
              const d2 = c2x * tdx / tl + c2z * tdz / tl;
              px2 = d1 >= d2 ? c1x : c2x;
              pz2 = d1 >= d2 ? c1z : c2z;
              found = true;
            }
            if (found) { dx = px2; dz = pz2; }
          }
        }
      }
      return this.move(i, dx, dz, speed, dt);
    }
    // NavCore 没起来（极端兜底）：室内就自己探最近的出口，否则直走
    if (this.nav.indoor && this.nav.indoor(this.px[i], this.pz[i])) {
      const e = this.exitProbe(i);
      if (e) { this.move(i, e[0], e[1], speed, dt); return true; }
    }
    return this.move(i, dx, dz, speed, dt);
  }

  move(i, dx, dz, speed, dt) {
    // 护送要员 / 出警执行任务：30 秒内速度翻倍（在 move 里统一加，所有路径都覆盖）
    if (this.boostT[i] > this.time) speed *= 2;

    // ---- 穿墙脱困：连续 5 秒走不动 → 给 3 秒"幽灵"窗口，期间无视碰撞直线穿过 ----
    if (this.ghostT[i] > this.time) {
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        const nav0 = this.nav;
        let nx = this.px[i] + (dx / d) * speed * dt;
        let nz = this.pz[i] + (dz / d) * speed * dt;
        nx = Math.max(-nav0.halfW + 3, Math.min(nav0.halfW - 3, nx));
        nz = Math.max(-nav0.halfH + 3, Math.min(nav0.halfH - 3, nz));
        this.px[i] = nx; this.pz[i] = nz;
        this.heading[i] = Math.atan2(dz, dx);
        const sp0 = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
        const stride = 1.45 * (sp0.scale || 1);
        this.phase[i] = (this.phase[i] + (speed / stride) * dt) % 1;
        this.stuck[i] = 0;
        return true;
      }
      return false;
    }

    if (this.ensureNav()) {
      // ---- 卡死判定：看"位移"而不是"这一帧有没有动" ----
      // 打转的人每帧都在动（steer 永远返回 true），只看 moved 永远判断不出来。
      // 每 5 秒取一次样：这 5 秒里净位移 < 3m → 认定卡死 → 开 3 秒穿墙。
      // 只对"确实在赶路"的个体做卡死判定：站着待命/原地晃的人不该被传走
      const going = speed > 0.3 && (dx * dx + dz * dz) > 1 &&
                    this.goal[i] !== GOAL.NONE && this.goal[i] !== GOAL.HOLD;
      if (!going) {
        this.anchorT[i] = 0;
      } else if (this.anchorT[i] === 0) {
        this.anchorT[i] = this.time; this.anchorX[i] = this.px[i]; this.anchorZ[i] = this.pz[i];
      } else if (this.time - this.anchorT[i] >= 5) {
        const ax = this.px[i] - this.anchorX[i], az = this.pz[i] - this.anchorZ[i];
        // 双重条件：5 秒挪不到 3m  **并且** 正前方 1.2m 就是墙 —— 只有真被墙挡住才开幽灵，
        // 单纯走得慢（排队、等人、潜伏去医院）不算，否则会变成大批人穿墙
        const dl = Math.hypot(dx, dz) || 1;
        const bx = this.px[i] + (dx / dl) * 1.2, bz = this.pz[i] + (dz / dl) * 1.2;
        const blockedAhead = !this.walkable(bx, bz);
        if (ax * ax + az * az < 9 && blockedAhead) this.ghostT[i] = this.time + 3;
        this.anchorT[i] = this.time; this.anchorX[i] = this.px[i]; this.anchorZ[i] = this.pz[i];
      }
      this.steer.time = this.time;
      const moved = this.steer.step(i, dx, dz, speed, dt);
      if (!moved && this.stuck[i] > 0.6) {
        this.stuck[i] = 0;
        this.pathN[i] = 0;
        this.decT[i] = 0;
        this.forcePlan[i] = 1;
        this.guideOK[i] = 0;       // 下个 tick 重新找出口
      }
      return moved;
    }
    return this.moveFallback(i, dx, dz, speed, dt);
  }

  /** 极端兜底（NavCore 起不来时）：只保证"朝目标走一步、不撞墙"，没有绕障能力 */
  moveFallback(i, dx, dz, speed, dt) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return false;
    const step = Math.min(speed * dt, this.nav.cell * 0.8);
    const nx = this.px[i] + (dx / d) * step;
    const nz = this.pz[i] + (dz / d) * step;
    if (!this.walkable(nx, nz)) { this.stuck[i] += dt; return false; }
    this.px[i] = nx; this.pz[i] = nz;
    this.heading[i] = Math.atan2(dz, dx);
    this.stuck[i] = 0;
    return true;
  }

  // ---------- 主 tick ----------
  step(dt, camX, camZ) {
    this.tick++;
    // 每个 tick 重算"谁被多少丧尸盯着"——用来让追猎目标分散开
    this.tgtCount.fill(0);
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
              if (idx >= 0) this.spd[idx] = SPECIES[SP.ZOMBIE].speed * (0.85 + this.rng() * 0.3);
              ok = true; break;
            }
          }
          if (!ok) break;
        }
        this.pushEvent('新的爆发点', 'start');
        this.pushAudio('groan', wx, wz, 1.2);
      }
    }

    this.updateGov(dt);        // 政府/机构的自动调度（玩家只读，没有操作权）

    this.pathBudget = 4;       // 每帧恢复寻路预算（HPA* 约 0.5-2 ms/次，40 会把 tick 吃掉）
    this.guideBudget = 24;     // 每帧室内出门引导预算（BFS 不便宜，必须分帧摊开）
    this.preyBudget = 8;       // 每帧锁敌扫描预算（一次扫全城 n 个，8/帧 ≈ 160/s）
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
        } else if (st === ST.POLICE || st === ST.SOLDIER) {
          // 士兵看得更远（步枪 + 训练），警察 46m、士兵 60m
          // 清剿任务期间：人和尸都打（want 7），否则只打丧尸
          this.nearZ[i] = this.findNearest(i, this.purgeT[i] > this.time ? 7 : 1,
            st === ST.SOLDIER ? 80 : 50);
          // 警察有电台，默认知道；但零号病人模式下连他们也不知道（还没发生任何事）
          // 警察有电台，但只有"城里真的还有丧尸"时他们才知道
          if (!this.longInc && this.stats.zombie > 0 && this.aware[i] < 3) this.setAware(i, 3);
        } else if (st === ST.WILD) {
          const wsp = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
          this.nearC[i] = this.findNearest(i, 6, wsp.range || 90);
        } else if (st === ST.CIV || st === ST.FLEE || st === ST.FIGHT || st === ST.INFECTED) {
          this.nearZ[i] = this.findNearest(i, 1, 40);
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
          // 看见丧尸（15 m 内）就跑：腿软期（fleeCd）内不重复触发
          if (!this.armed[i] && this.nearZ[i] >= 0 && this.fleeCd[i] <= 0) {
            const z = this.nearZ[i];
            const fdx = this.px[z] - this.px[i], fdz = this.pz[z] - this.pz[i];
            if (fdx * fdx + fdz * fdz < 15 * 15) {
              this.state[i] = ST.FLEE;
                  this.panic[i] = 1;
              break;
            }
          }
          // 什么都不知道 / 没目标 → 照常通勤
          // 走到撤离口（穿过那条绿线）就算撤离成功：标记 SAVED，从地图上消失
          if (this.goal[i] === GOAL.FLEE && this.onEscapeLine && this.onEscapeLine(i)) {
            this.state[i] = ST.SAVED;
            this.goal[i] = GOAL.NONE;
            this.aStage[i] = 0;
            break;
          }
          if (this.goal[i] === GOAL.NONE && !this.isAnimal(i) && this.time >= this.commuteAt[i]) {
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
                const wmul0 = this.goal[i] === GOAL.FLEE ? 1.6 : 1.0;
                let k = this.pathIdx[i];
                const wx = this.pathX[i * 16 + k], wz = this.pathZ[i * 16 + k];
                const wdx = wx - this.px[i], wdz = wz - this.pz[i];
                const wd2 = wdx * wdx + wdz * wdz;
                // 到了（1.5m 内）：推进到下一个路点
                if (wd2 < 6.25) {
                  this.pathIdx[i]++;
                  if (this.pathIdx[i] >= this.pathN[i]) this.pathN[i] = 0;
                  break;
                }
                // 下一个路点"看得见" → 直接跳过当前这个（少走一次拐弯）
                // 往前看最多 3 个路点：最远的那个如果中心线可见就一次性跳过去
                //   （路点每 4~8m 一个，少拐几次能明显减少"净位移打折"）
                {
                  let jumped = -1;
                  for (let j = Math.min(k + 3, this.pathN[i] - 1); j > k; j--) {
                    const nx2 = this.pathX[i * 16 + j], nz2 = this.pathZ[i * 16 + j];
                    if (this.losClear(this.px[i], this.pz[i], nx2, nz2)) { jumped = j; break; }
                  }
                  if (jumped > k) {
                    this.pathIdx[i] = jumped;
                    const jx = this.pathX[i * 16 + jumped], jz = this.pathZ[i * 16 + jumped];
                    this.move(i, jx - this.px[i], jz - this.pz[i], this.spd[i] * wmul0, cdt);
                    break;
                  }
                }
                // 朝当前路点走；**连续走不动就跳过这个路点**
                //   （实测有些路径的第 1 个路点根本到不了，人就永远卡在起点不动）
                const okMove = this.move(i, wdx, wdz, this.spd[i] * wmul0, cdt);
                if (okMove) this.pathBlock[i] = 0;
                else if (++this.pathBlock[i] > 6) {
                  this.pathBlock[i] = 0;
                  this.pathIdx[i]++;
                  if (this.pathIdx[i] >= this.pathN[i]) this.pathN[i] = 0;
                }
                break;
              }
              let ax = gp[0], az = gp[1];
              // 有绕路点就先走绕路点
              if (this.wpT[i] > this.time) {
                const wd = Math.hypot(this.wpX[i] - this.px[i], this.wpZ[i] - this.pz[i]);
                if (wd > 6) { ax = this.wpX[i]; az = this.wpZ[i]; }
                else this.wpT[i] = 0;
              }
              const adx = ax - this.px[i], adz = az - this.pz[i];
              // "到了"的判定看**真正的目标点**（gp），不看绕行用的小路点：
              // 目标多半是门口，门口再往里是墙、进不去，人会绕着楼转圈找那 5 米，
              // 所以 12m 内就算到，停下来说话/发呆，不再绕圈。
              const gdx = gp[0] - this.px[i], gdz = gp[1] - this.pz[i];
              const atGoal = (gdx * gdx + gdz * gdz) < 144;
              if (!atGoal && adx * adx + adz * adz > 30) {     // 还没到 → 往目标走
                this.idle[i] = 0;
                // 逃命是跑，不是散步
                const mul = this.goal[i] === GOAL.FLEE ? 1.6 : 1.0;
                const ox = this.px[i], oz = this.pz[i];
                this.moveSmart(i, adx, adz, this.spd[i] * mul, cdt, gp[0], gp[1]);
                // 卡住（被关在没门的屋里）：别一直原地跑，认命固守
                if (Math.abs(this.px[i] - ox) < 1e-3 && Math.abs(this.pz[i] - oz) < 1e-3) {
                  this.stuckT[i] += cdt;
                  if (this.stuckT[i] > 6) {
                    this.stuckT[i] = 0;
                    const hd = Math.hypot(this.homeX[i] - this.px[i], this.homeZ[i] - this.pz[i]);
                    if (hd < 90) {
                      // 真的就在自家附近：固守是合理的
                      this.setGoal(i, GOAL.HOLD, this.px[i], this.pz[i]);
                      this.idle[i] = 1;
                      this.actT[i] = 6 + this.rng() * 10;
                    } else if (this.nav.indoor && this.nav.indoor(this.px[i], this.pz[i])) {
                      // 人在屋里出不去：直接探最近的出口，强行往外走
                      const e = this.exitProbe(i);
                      this.freeT[i] = 0;
                      if (e) { this.move(i, e[0] * 4, e[1] * 4, this.spd[i], 0.6); }
                      this.idle[i] = 0;
                      this.actT[i] = 0.5;
                    } else {
                      // 只是被墙角别住了，不是"到家了"：换一侧、清掉门场记忆、重新找路，
                      // 绝不就此认命（以前这里直接转固守，人就永久不动了）
                      this.side[i] = -(this.side[i] || 1);
                      this.freeT[i] = 0;
                      this.pickWander(i);
                      this.goal[i] = GOAL.NONE;
                      this.arrGoal[i] = 0;
                      this.idle[i] = 0;
                      this.actT[i] = 0.5 + this.rng() * 1.5;
                      this.nudgeT[i] = this.time + 3;
                    }
                  }
                } else this.stuckT[i] = 0;
                break;
              }
              // 只在"刚到达"这一帧跑一次 arrive（以前每帧都跑，idle/actT 被反复重置，
              // 表现就是所有人站在原地不动 —— 这是"AI 太蠢"的主因）
              if (this.arrGoal[i] !== this.goal[i]) {
                this.arrGoal[i] = this.goal[i];
                this.arrive(i);
              }
            }
          }

          // 到了 / 没目标：走 / 站 循环（原版节奏：站 25~60 秒 → 走 60~140 秒 → 再站）
          this.actT[i] -= cdt;
          if (this.actT[i] <= 0) {
            if (this.idle[i]) { this.idle[i] = 0; this.actT[i] = 8 + rng() * 14; this.pickWander(i); }
            else { this.idle[i] = 1; this.actT[i] = 2 + rng() * 4; }
          }
          if (this.idle[i]) {
            // 站着也别完全冻住：朝自己的闲逛点慢慢挪（原版街上的人都在晃）
            const ddx = this.tx[i] - this.px[i], ddz = this.tz[i] - this.pz[i];
            if (ddx * ddx + ddz * ddz > 9) this.moveSmart(i, ddx, ddz, this.spd[i] * 0.5, cdt);
            break;
          }
          const tx = this.tx[i] - this.px[i], tz = this.tz[i] - this.pz[i];
          if (tx * tx + tz * tz < 4) { this.idle[i] = 1; this.actT[i] = 2 + rng() * 5; break; }
          this.moveSmart(i, tx, tz, this.spd[i], cdt);
          break;
        }
        // ---------------- 逃跑 ----------------
        case ST.FLEE: {
          // 逃跑大类：有目标逃跑（2）在受到威胁时进入逃跑状态，但模式不变
          if (this.fleeMode[i] !== 2) this.fleeMode[i] = 1;
          // 结束条件只有一个：感知半径内（平民 40m）已经没有丧尸了。
          // 不是"跑够几秒就回去上班"—— 丧尸还在旁边就继续跑。
          const z = this.nearZ[i];
          if (z < 0) {
            // 即时逃跑到此结束；有目标逃跑则回到"继续赶路"（接着去他的目标）
            if (this.fleeMode[i] === 1) this.fleeMode[i] = 0;
            this.state[i] = ST.CIV;
            this.panic[i] = 0;
            this.fleeCd[i] = 2 + rng() * 2;   // 惊魂未定，短时间内不再触发逃跑
            this.stam[i] = Math.min(1, this.stam[i] + 0.25);
            break;
          }
          // 方向：把 40m 内**所有**丧尸的排斥向量叠加。
          // 为什么不是"只背离最近那只"：左右各一只、距离差不多时，
          // 最近的那只每帧都可能换人 → 方向每帧 180° 翻转 → 人在原地抖。
          // 叠加之后，两侧夹击的合力接近 0，此时改走**垂直方向**从侧缝钻出去。
          let rx = 0, rz = 0, sumW = 0;
          if (this.forEachNear) {
            this.forEachNear(this.px[i], this.pz[i], 40, (j) => {
              if (this.state[j] !== ST.ZOMBIE) return;
              const dx = this.px[i] - this.px[j], dz = this.pz[i] - this.pz[j];
              const d2 = dx * dx + dz * dz;
              if (d2 < 0.04) return;
              const w = 1 / d2;                 // 越近排斥越强
              rx += dx * w; rz += dz * w; sumW += w;
            });
          }
          if (sumW === 0) {                     // 兜底：用最近那只
            rx = this.px[i] - this.px[z]; rz = this.pz[i] - this.pz[z]; sumW = 1;
          }
          const rlen = Math.hypot(rx, rz);
          if (rlen > sumW * 0.0012) {
            // 合力够明确：就用它，并记住这个方向
            this.fleeDir[i] = Math.atan2(rz, rx);
          } else {
            // 四周对称包围：合力抵消，改用**记住的那个方向**（没有就按 side 选侧向）
            let a = this.fleeDir[i];
            if (!a) {
              const ax = this.px[i] - this.px[z], az = this.pz[i] - this.pz[z];
              a = Math.atan2(az, ax) + Math.PI / 2 * (this.side[i] || 1);
              this.fleeDir[i] = a;
            }
            // 这个方向可能正好是墙：绕一圈 8 个方向，挑一个真能走的
            let ok = false, best = a;
            for (let k = 0; k < 8; k++) {
              const a2 = a + k * (Math.PI / 4) * (this.side[i] || 1);
              if (this.walkable(this.px[i] + Math.cos(a2) * 3, this.pz[i] + Math.sin(a2) * 3)) {
                best = a2; ok = true; break;
              }
            }
            if (ok) this.fleeDir[i] = best;
            rx = Math.cos(best); rz = Math.sin(best);
          }
          // 体力：狂奔会累，但不会累到走不动（下限 0.65）
          this.stam[i] = Math.max(0.65, this.stam[i] - dt * 0.055);
          const sp = this.spd[i] * (1.0 + 0.90 * this.panic[i]) * this.stam[i];
          if (!this.move(i, rx, rz, sp, dt)) {
            // 这个方向走不动（被堵住）：把记住的方向拧 70°，下次换个方向挤出去
            this.fleeDir[i] = (this.fleeDir[i] || Math.atan2(rz, rx)) + 1.22;
            this.side[i] = -(this.side[i] || 1);
          }
          this.panic[i] = Math.min(1.4, this.panic[i] + dt * 0.6);
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
          this.cool[i] -= cdt;   // 用 cdt：远处个体 5Hz 更新时 dt 已放大 4 倍
          if (this.cool[i] <= 0) {
            const w = weaponOf(this.wpn[i]);
            if (!this.armed[i] || (this.mag[i] <= 0 && this.reserve[i] <= 0)) {
              // 家里有枪且不在"有目标逃跑"状态 → 先回家补弹（ARM_HOME 链），
              // 只有没家底 / 正在逃命时才掉头就跑
              if (this.armed[i] && this.homeHasGun(i) && this.fleeMode[i] !== 2) {
                this.state[i] = ST.CIV;
                this.armHome[i] = 1;
                this.setGoal(i, GOAL.ARM_HOME, this.homeX[i], this.homeZ[i]);
                {
                  const dpH = this.doorOf(this.homeX[i], this.homeZ[i]);
                  if (dpH) { this.goalX[i] = dpH[0]; this.goalZ[i] = dpH[1]; }
                }
                break;
              }
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
          // 死线优先：到点就地转身。必须放在最前面 —— 下面"去医院"那条分支会 break，
          // 放在末尾的话发烧的人一路走向医院，永远轮不到变身。
          if (this.time >= this.riseAt[i]) { this.beginTurn(i); break; }
          // 带枪的人（警察/士兵/持枪平民）在潜伏期里仍然会还击 —— 不会因为被咬就当场缴械
          if (this.armed[i] && this.nearZ[i] >= 0) {
            const zz = this.nearZ[i];
            const zdx = this.px[zz] - this.px[i], zdz = this.pz[zz] - this.pz[i];
            this.heading[i] = Math.atan2(zdz, zdx);
            this.cool[i] -= cdt;
            if (this.cool[i] <= 0 && zdx * zdx + zdz * zdz < 30 * 30) {
              this.cool[i] = 0.55;
              this.fireWeapon(i, zz);
            }
          }
          this.timer[i] -= cdt;    // 潜伏倒计时按真实时间走（远处 5Hz 更新时步长已补偿）
          // ---- 发病阶段（M6）：潜伏期最后 40% 开始发烧 ----
          if (!this.sick[i] && this.state[i] === ST.INFECTED) {
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
          // 到点的情况在上面已经处理过了（转身期间不能动；播完在 tickStage 里变丧尸）
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
          if (this.cool[i] > 0) this.cool[i] -= cdt;   // 用 cdt：远处个体 5Hz 更新时 dt 已放大 4 倍   // 咬合冷却（原版是 2 s；我们 1 s）
          // 目标记忆：一旦盯上就追到 90m 或目标不再是健康人
          let c = this.tgt[i];
          if (c >= 0) {
            const cs = this.state[c];
            if (!(cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT || cs === ST.INFECTED ||
                  cs === ST.POLICE || cs === ST.SOLDIER ||
                  (isWild && cs === ST.ZOMBIE))) {
              c = -1; this.lockOn[i] = 0;
            }
            else {
              const ddx = this.px[c] - this.px[i], ddz = this.pz[c] - this.pz[i];
              // 锁敌目标允许跨远距离追杀；普通目标超过 90m 就丢
              const leash = this.lockOn[i] ? 1e9 : 90;
              if (ddx * ddx + ddz * ddz > leash * leash) c = -1;
            }
          }
          if (c < 0 && this.nearC[i] >= 0) c = this.nearC[i];
          // ---- 近处猎物优先：已经在追一个人时，如果身边有个更近的活人，就改追他 ----
          //   不加这条会出现"一大群丧尸追同一个人，旁边 3 米的人视而不见"：
          //   目标一旦记住就只按 90m 的缰绳放，不会主动换。
          //   滞回：新目标必须近得多（<60%）而且够近（<15m）才换，避免来回横跳。
          // ---- 目标分散：同一个猎物最多被 5 只盯（锁敌除外）----
          //   否则会出现"上百只丧尸围猎同一个人"，而旁边的人没人管。
          if (c >= 0 && !this.lockOn[i] && this.tgtCount[c] >= 5) {
            // 在这只丧尸周围 35m 里挑一个"被盯得最少"的活人，而不是永远选最近那个
            // （最近那个往往就是已经被上百只围住的那位）
            let best = -1, bestN = 99, bestD = 1e9;
            this.forEachNear(this.px[i], this.pz[i], 35, (j) => {
              const js = this.state[j];
              if (!(js === ST.CIV || js === ST.FLEE || js === ST.FIGHT || js === ST.INFECTED)) return;
              const cnt = this.tgtCount[j];
              const d = Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
              if (cnt < bestN || (cnt === bestN && d < bestD)) { bestN = cnt; bestD = d; best = j; }
            });
            if (best >= 0 && best !== c && bestN <= this.tgtCount[c]) c = best;
          }
          if (c >= 0) this.tgtCount[c]++;
          if (c >= 0 && !this.lockOn[i] && this.nearC[i] >= 0 && this.nearC[i] !== c) {
            const nc = this.nearC[i];
            const dCur = Math.hypot(this.px[c] - this.px[i], this.pz[c] - this.pz[i]);
            const dNew = Math.hypot(this.px[nc] - this.px[i], this.pz[nc] - this.pz[i]);
            if (dNew < 15 && dNew < dCur * 0.6) c = nc;
          }
          // 锁敌：**注意力范围（60m）里真的一个活人都没有**时，每 60 秒抓一个"全城最近的人"。
          // 注意不能只看缓存的 nearC（它每 3 tick 才刷一次，可能过时），
          // 真要锁之前现场再确认一次 60m 内是空的；只要有人就不锁，直接用他。
          if (c < 0 && this.time >= this.lockT[i]) {
            const near = this.findNearest(i, 4, 60);
            if (near >= 0) {
              c = near;
              this.nearC[i] = near;
            } else {
              this.lockT[i] = this.time + 60;
              const j = this.nearestPrey(i);
              if (j >= 0) { c = j; this.lockOn[i] = 1; }
            }
          }
          this.tgt[i] = c;

          if (c >= 0) {
            const dx = this.px[c] - this.px[i], dz = this.pz[c] - this.pz[i];
            const d2 = dx * dx + dz * dz;
            const sp = SPECIES[this.kind[i]] || SPECIES[SP.ZOMBIE];
            const biteR2 = (sp.biteR || 1.8) * (sp.biteR || 1.8);
            if (d2 < biteR2 && this.cool[i] <= 0) {
              this.cool[i] = 1.0;                     // 两口之间隔 1 秒
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
              // 警察(3) / 士兵(6) 也必须能被打：之前漏了，等于给他们锁血
              if (cs === ST.CIV || cs === ST.FLEE || cs === ST.FIGHT || cs === ST.INFECTED ||
                  cs === ST.POLICE || cs === ST.SOLDIER) {
                // 正在转身/倒地的人不该再被咬（原版：状态 6/7 没有 LiveHuman 位）
                if (this.aStage[c]) { this.tgt[i] = -1; break; }
                const vsp = SPECIES[this.kind[c]] || SPECIES[SP.CIV1];
                // 伤害规则：普通丧尸一律 20（不管它生前是什么职业）；
                //   特殊感染者（坦克/冲锋者/喷吐者/自爆者）用自己的 dmg；
                //   动物变的丧尸走 zombiePow 倍率（犬 2.4、猫 2.0）
                const zKind = this.kind[i];
                const isAnimalZ = zKind >= 12;
                const biteDmg = sp.special ? (sp.dmg || 20)
                              : isAnimalZ ? (sp.dmg || 5)
                              : 20;
                this.hp[c] -= biteDmg * (this.pow[i] || 1);
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
                  // 咬死：先倒地（die01），**倒地动画一播完就立刻爬起来变丧尸**。
                  // 被咬但没死的那条路（下面 else-if）才走 60~120 s 的潜伏计时。
                  this.killAgent(c, i);
                  this.riseAt[c] = this.time + 1e-3;   // 死线 = 现在（>0 才算"会复活"）
                  this.infectBy[i] = (this.infectBy[i] || 0) + 1;
                } else if (cs !== ST.INFECTED && vsp.infectable !== false &&
                           this.rng() < (vsp.infectChance == null ? 1 : vsp.infectChance)) {
                  // 只认第一次被咬：已经潜伏的人不重置死线（原版也是"首次被咬时刻 + 感染时长"）
                  this.setInfected(c, this.incubationFor(c, 1), 1);
                  this.cool[c] = 0;
                  this.infectBy[i] = (this.infectBy[i] || 0) + 1;
                  this.growFromKill(i);          // 每感染一个人，自己 +50 血
                } else if (cs !== ST.INFECTED) {
                  // 真的不会感染的人（士兵/重装）或抵抗成功：挨一口然后跑
                  // 注意：已经潜伏的人**不能**改状态，否则感染计时会被踢掉
                  this.state[c] = ST.FLEE;
                  this.panic[c] = 1.4;
                }
              }
            } else if (sp.special === 'spit' && d2 < 26 * 26) {
              // 喷吐者：保持距离，远程喷酸
              this.cool[i] -= cdt;   // 用 cdt：远处个体 5Hz 更新时 dt 已放大 4 倍
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
          // 开火冷却每帧递减（原来只有"锁定目标"那条分支递减，
          // 结果回局/驻守/赶路的警察 cool 永远停在初始随机值上 → 一辈子不开枪）
          if (this.cool[i] > 0) this.cool[i] -= cdt;
          // ---- 弹药见底 → 先回警局补给（不看有没有目标）----
          //   触发条件：**弹匣空了，且备弹连一匣都凑不齐**（这是"弹匣空了就回所"的合理版本；
          //   以前要弹匣+备弹全打光才回，等于四条弹匣打满才想起来补给）
          //   优先级：有目标逃跑（fleeMode 2）> 补给 > 原地待命
          if (this.needsAmmo(i) && this.fleeMode[i] !== 2) {
            const siR = this.stationOf[i] - 1;
            const stR = siR >= 0 ? (this.poiByKind.police || [])[siR] : null;
            if (stR) {
              const dxR = stR.x - this.px[i], dzR = stR.z - this.pz[i];
              const ddR = Math.hypot(dxR, dzR);
              if (ddR > 16) {
                this.setGoal(i, GOAL.SHELTER, stR.x, stR.z);
                this.move(i, dxR, dzR, this.spd[i] * 1.05, cdt);
                break;
              }
              if (this.tryRefill(i)) break;
            }
          }
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
              const zz = this.nearZ[i];
              if (zz >= 0) {
                // 有威胁：先转身、够近就停下打，再继续往回走
                const zdx = this.px[zz] - this.px[i], zdz = this.pz[zz] - this.pz[i];
                this.heading[i] = Math.atan2(zdz, zdx);
                if (this.cool[i] <= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zz); }
                if (zdx * zdx + zdz * zdz < 12 * 12) break;    // 12m 内先解决眼前的
              }
              this.move(i, st.x - this.px[i], st.z - this.pz[i], this.spd[i], cdt);
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
                const zz = this.nearZ[i];
                if (zz >= 0) {
                  const zdx = this.px[zz] - this.px[i], zdz = this.pz[zz] - this.pz[i];
                  this.heading[i] = Math.atan2(zdz, zdx);
                  if (this.cool[i] <= 0) { this.cool[i] = 0.5; this.fireWeapon(i, zz); }
                  if (zdx * zdx + zdz * zdz < 12 * 12) break;  // 12m 内先打，不赶路
                }
                this.move(i, dx, dz, this.spd[i], cdt);
                break;
              }
            }
          }
          const z = this.nearZ[i];
          if (z >= 0) {
            const dx = this.px[z] - this.px[i], dz = this.pz[z] - this.pz[i];
            this.heading[i] = Math.atan2(dz, dx);
            if (this.cool[i] <= 0) {
              if (this.needsAmmo(i)) {
                // 打不动了：先回警局补给（弹药是共用的），但"有目标逃跑"优先级更高
                if (this.fleeMode[i] !== 2) {
                  const si2 = this.stationOf[i] - 1;
                  const st2 = si2 >= 0 ? (this.poiByKind.police || [])[si2] : null;
                  if (st2) {
                    const dx2 = st2.x - this.px[i], dz2 = st2.z - this.pz[i];
                    const dd = Math.hypot(dx2, dz2);
                    if (dd > 16) {
                      this.setGoal(i, GOAL.SHELTER, st2.x, st2.z);
                      this.move(i, dx2, dz2, this.spd[i] * 1.05, cdt);
                      break;
                    }
                    if (this.tryRefill(i)) break;
                  }
                }
                this.state[i] = ST.FLEE; this.panic[i] = 1.4; this.stam[i] = 1; break;
              }
              this.ammo[i]--;
              const msp = SPECIES[this.kind[i]] || SPECIES[SP.POLICE];
              this.cool[i] = msp.rate * (0.85 + rng() * 0.3);
              this.shoot(i, z, this.shotAccuracy(i), msp.range || 30);
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
    this.fleeCd[i] = 0; this.stuck[i] = 0; this.side[i] = 1;
    this.stationOf[i] = 0;   // 新单位默认不属于任何警局（否则会继承上一局同下标的归属）

    // 传入数字就是物种 id（特感 / 载具）
    if (typeof kind === 'number') {
      const sp = SPECIES[kind] || SPECIES[SP.ZOMBIE];
      this.kind[i] = kind;
      this.hp[i] = sp.hp;
      this.spd[i] = sp.speed;
      this.ammo[i] = sp.team === TEAM.HUMAN ? 999 : 0;
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
      // 以前这里只写了 ammo=60，**没有发枪**（wpn 还是 0 = 徒手），
      // 所以伞兵/政府派出的士兵从头到尾一枪打不出来。补上发枪。
      this.giveWeapon(i, ROLE_WEAPON.soldier, skillFor('soldier'));
      this.ammo[i] = 60;
    } else if (kind === 'elite') {
      this.kind[i] = SP.ELITE;
      this.state[i] = ST.SOLDIER;
      this.giveWeapon(i, ROLE_WEAPON.elite, skillFor('elite'));
      this.hp[i] = SPECIES[SP.ELITE].hp;
      this.spd[i] = SPECIES[SP.ELITE].speed;
      this.ammo[i] = 240;
    } else if (kind === 'apc') {
      this.kind[i] = SP.APC;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.soldier, skillFor('soldier'));
      this.hp[i] = SPECIES[SP.APC].hp;
      this.spd[i] = SPECIES[SP.APC].speed;
      this.ammo[i] = 9999;
    } else if (kind === 'swat') {
      this.kind[i] = SP.POLICE;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.elite, skillFor('elite'));
      this.hp[i] = SPECIES[SP.POLICE].hp;
      this.spd[i] = 2.7 + this.rng() * 0.3;
      this.ammo[i] = 80;
    } else {
      this.kind[i] = SP.POLICE;
      this.state[i] = ST.POLICE;
      this.giveWeapon(i, ROLE_WEAPON.police + (this.rng() < 0.25 ? 3 : 0), skillFor('police'));
      this.hp[i] = SPECIES[SP.POLICE].hp;
      this.spd[i] = 2.4 + this.rng() * 0.4;
      this.ammo[i] = 40;
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
    const blocked = [];   // 记下改掉的格子，交给 NavCore 做局部修复（S6）
    for (let r = r0; r <= r1; r++) {
      const wz = nav.halfH - (r + 0.5) * nav.cell - z;
      for (let c = c0; c <= c1; c++) {
        const wx = (c + 0.5) * nav.cell - nav.halfW - x;
        // 旋转到墙体本地坐标
        const u = wx * ca + wz * sa;
        const v = -wx * sa + wz * ca;
        if (Math.abs(u) <= halfLen && Math.abs(v) <= halfThick) {
          const k = r * nav.cols + c;
          // 注意：可走格的位域值不是 1（路面是 0x03、门 0x0f、室内 0x1f），
          // 旧代码写 === 1 在城市数据上永远不成立 —— 路障其实一格都没堵住。
          if (nav.grid[k] & 1) { this.barricadeVal.push(nav.grid[k]); nav.grid[k] = 0; this.barricaded.push(k); blocked.push(k); n++; }
        }
      }
    }
    this.effects.push({ type: 'wall', x, z, r: halfLen, life: 1.2, max: 1.2, angle });
    // ---- S6：让导航层立刻知道这几格被堵了 ----
    if (this.ensureNav() && blocked.length) {
      this.navWorld.blockCells(blocked);
      this.pathN.fill(0); this.pathIdx.fill(0); this.guideOK.fill(0);
    }
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
    if (slot > 0) for (const i of (r.ids || [])) { this.escortOf[i] = slot; this.boostT[i] = this.time + 30; }
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
      } else if (chaos >= 20 && this.vipStage[v] === 0 && !this.vipStation[v]) {
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
        const slot2 = this.vips.indexOf(v) + 1;
        if (this.vipGoal[v] === 1 && !this.vipStation[v]) {
          // 第一阶段：送进警察局 —— 只是"安全了"，**还没撤离**。
          // 之后混乱度冲到 80% 才会派八人小队把他送出城。
          this.vipStation[v] = 1;
          this.vipStage[v] = 0;       // 归零：80% 时重新派一支满编 8 人队
          this.vipGoal[v] = 0;
          this.goal[v] = GOAL.NONE;
          this.decT[v] = 1e9;
          for (let i = 0; i < this.n; i++) {
            if (this.escortOf[i] === slot2) { this.escortOf[i] = 0; this.goal[i] = GOAL.NONE; }
          }
          this.pushEvent('要员已进入警察局待命（等撤离令）', 'start');
          continue;
        }
        // 第二阶段：真的出城了（只有"目标是撤离"才算；送进警局那次不算）
        if (this.vipGoal[v] !== 2) continue;
        this.state[v] = ST.SAVED;
        this.vipDone[v] = 1;
        this.savedVip = (this.savedVip || 0) + 1;
        for (let i = 0; i < this.n; i++) {
          if (this.escortOf[i] === slot2) { this.escortOf[i] = 0; this.goal[i] = GOAL.NONE; }
        }
        this.pushEvent('要员已撤离城区', 'start');
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
    const r = this.dispatchPolice(x, z, 2, { dest: '报案地点', why: '有人死亡' });
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
  dispatchPolice(x, z, n, info) {
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
      this.boostT[i] = this.time + 30;   // 出警 30 秒内速度翻倍
      // 记入"在外执勤名单"（面板显示谁去了哪儿）
      if (this.duties) {
        this.duties.set(i, {
          x, z, what: '出警', dest: (info && info.dest) || '现场',
          why: (info && info.why) || '', t: this.time,
        });
      }
      made.push(i);
    }
    this.pushEvent(`出警 ${made.length} 人（${st.dist.toFixed(0)}m 外警局）`, 'start');
    return { ok: made.length > 0, n: made.length, station: st.poi, dist: st.dist, ids: made, idle: pool.length };
  }

  // ================= 政府行动（面板）=================
  // 设计：所有"派人"的动作都走 dispatchTo 这一条路——
  //   警察：从最近的警局抽调现有警员（不凭空生成）
  //   士兵：从政府大楼门口刷出来，然后走过去
  // 这样"派军队去医院"和"派警察去医院"除了出发点不同，行为链路完全一致。

  // ---------- 弹药：携带上限 / 补给 ----------

  /**
   * 一个人最多带多少发：**以武器表为准**（mag + reserve）。
   *   手枪 15+45=60 · 步枪 30+90=120 · 突击步枪 30+120=150 · 轻机枪 100+200=300
   * 补给时补到这个总数为止，不会越补越多。
   * （以前第二处补给写的是 `min(255, reserve+got)`，如果哪天放宽触发条件，
   *   一个人能被堆到 255 备弹 + 满弹匣 = 270+ 发，和出厂值对不上。）
   */
  carryCap(i) {
    const w = weaponOf(this.wpn[i]);
    return w && w.id ? (w.mag + w.reserve) : 0;
  }

  /** 还打得动吗：弹匣空、且备弹连一匣都凑不齐 → 该回所补给了 */
  needsAmmo(i) {
    const w = weaponOf(this.wpn[i]);
    if (!w || w.id === 0) return false;
    return this.mag[i] <= 0 && this.reserve[i] < w.mag;
  }

  /** 在局里补一次：补到 mag×4 为止，先装满弹匣、剩下进备弹 */
  tryRefill(i) {
    const si = this.stationOf[i] - 1;
    const st = si >= 0 ? (this.poiByKind.police || [])[si] : null;
    if (!st || !st.store) return false;
    const wid = this.wpn[i], w = weaponOf(wid);
    if (!w || !w.id) return false;
    const cap = this.carryCap(i);
    const carry = this.mag[i] + this.reserve[i];
    const want = cap - carry;
    if (want <= 0) return false;
    const avail = st.store.a[wid] || 0;
    const got = Math.min(want, avail);
    if (got <= 0) return false;
    st.store.a[wid] = avail - got;
    if (!st.taken) st.taken = { civ: 0, cop: 0, guns: 0, ammo: 0 };
    st.taken.cop += got; st.taken.ammo += got;
    const toMag = Math.min(got, Math.max(0, w.mag - this.mag[i]));
    this.mag[i] = Math.min(255, this.mag[i] + toMag);
    this.reserve[i] = Math.min(255, this.reserve[i] + (got - toMag));
    this.ammo[i] = this.mag[i];
    this.rlUntil[i] = this.time + w.reload;
    return true;
  }
  // ---------- 政府 / 机构：自动决策（玩家没有操作权，只能看）----------

  /** 记一条政府/机构的自动决策（面板会显示） */
  govSay(inst, text) {
    this.govLog.push({ t: this.time, inst, text });
    if (this.govLog.length > 80) this.govLog.shift();
    this.pushEvent(text, 'start');
  }

  /**
   * 自动调度：每 2 秒评估一次局势，由"条件"触发机构行为。
   * 触发条件全部写在这里，玩家不能点——只读面板能看到它做了什么。
   */
  updateGov(dt) {
    this.govT -= dt;
    if (this.govT > 0) return;
    this.govT = 2.0;
    const o = this.govOrders, cd = o.cd, t = this.time;
    const chaos = this.chaos || 0;
    const inf = (this.infectRate || 0) * 100;
    const P = this.poiByKind;
    const hosp = (P.hospital || [])[0];
    const school = (P.school || [])[0];

    // 一次扫描拿到"正在前往医院的病人数"和"已发病者"
    let patients = 0, sickN = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === ST.CORPSE || s === ST.SAVED) continue;
      if (this.goal[i] === GOAL.HELP) patients++;
      if (s === ST.INFECTED && this.sick[i]) sickN++;
    }

    // ---- 每 10 秒记一个点（观察期也记，面板才有曲线）----
    this.govHistT += 2;
    if (this.govHistT >= 10) {
      this.govHistT = 0;
      // 每个警局的弹药存量（军械库消耗曲线）
      const stAmt = (this.poiByKind.police || []).map((p) => {
        const st = p.store;
        let a = 0;
        if (st) for (let id = 1; id < st.a.length; id++) a += st.a[id] || 0;
        return a;
      });
      this.stationHist.push({ t, ammo: stAmt });
      if (this.stationHist.length > 40) this.stationHist.shift();

      // 顺带把武力相关的也采样：击杀 / 开枪 / 持枪 / 弹药（武力面板的趋势用）
      let aN = 0, aAmmo = 0;
      for (let k = 0; k < this.n; k++) {
        const s2 = this.state[k];
        if (!this.armed[k] || s2 === ST.CORPSE || s2 === ST.ZOMBIE || s2 === ST.SAVED) continue;
        aN++;
        aAmmo += (this.mag[k] || 0) + (this.reserve[k] || 0);
      }
      this.govHist.push({
        t, chaos, inf, patients,
        sick: sickN, zombies: this.stats.zombie || 0, dead: this.stats.dead || 0,
        kills: this.kills || 0, shots: this.stats.shots || 0,
        armed: aN, ammo: aAmmo,
      });
      if (this.govHist.length > 90) this.govHist.shift();
    }
    if (t < 90) return;                 // 开局 90 秒的"观察期"：还没人反应过来

    // ---- 学校：混乱 ≥ 25 或 感染 ≥ 5% → 停课；回落 → 复课 ----
    if (!o.schoolClosed && (chaos >= 25 || inf >= 5)) {
      o.schoolClosed = true; o.schoolSince = t;
      this.govSay('school', `混乱 ${chaos.toFixed(0)}、感染 ${inf.toFixed(1)}% → 全城学校停课`);
    } else if (o.schoolClosed && chaos < 12 && inf < 1.5 && t - o.schoolSince > 240) {
      o.schoolClosed = false; o.schoolSince = 0;
      this.govSay('school', '局势回落 → 学校复课');
    }

    // ---- 医院：病人挤爆 → 停止收治；压力缓解 → 恢复 ----
    if (!o.hospitalClosed && (patients >= 800 || inf >= 8)) {
      o.hospitalClosed = true; o.hospSince = t;
      this.govSay('hosp', `病人 ${patients} 人、感染 ${inf.toFixed(1)}% → 医院停止收治`);
    } else if (o.hospitalClosed && patients < 200 && inf < 2 && t - o.hospSince > 300) {
      o.hospitalClosed = false; o.hospSince = 0;
      this.govSay('hosp', '压力缓解 → 医院恢复收治');
    }
    if (inf >= 12 && t - o.hospEvacAt > 300) {
      o.hospEvacAt = t;
      const n = this.clearPatients();
      if (n > 0) this.govSay('hosp', `感染 ${inf.toFixed(1)}% → 疏散 ${n} 名病患`);
    }

    // ---- 警察：混乱 ≥ 50 → 全员回局（警员自身也会做，这里补一条统一命令）----
    if (chaos >= 50 && t - cd.policeALL > 120) {
      cd.policeALL = t;
      const r = this.orderPoliceHome();
      if (r.n > 0) this.govSay('police', `混乱 ${chaos.toFixed(0)}% → ${r.n} 名警员回局待命`);
    }

    // ---- 军队：疫情失控 → 进驻医院；混乱爆表 → 清剿医院 ----
    if (hosp && inf >= 10 && t - cd.guard > 240) {
      cd.guard = t;
      const r = this.dispatchTo('soldier', hosp.x, hosp.z, 6, { dest: '医院', why: '疫情失控' });
      if (r.ok) this.govSay('gov', `感染 ${inf.toFixed(1)}% → 派 ${r.n} 名士兵进驻医院`);
    }
    if (hosp && (chaos >= 85 || inf >= 20) && t - cd.purge > 600) {
      cd.purge = t;
      const r = this.orderPurge(hosp.x, hosp.z, 10, false);
      if (r.ok) this.govSay('gov', `混乱 ${chaos.toFixed(0)}、感染 ${inf.toFixed(1)}% → 清剿医院（${r.n} 名士兵）`);
    }
    // ---- 宵禁：混乱 ≥ 35 打开；回落到 15 以下解除 ----
    if (!o.curfew && chaos >= 35) {
      o.curfew = true; o.curfewSince = t; o.curfewOnAt = t;
      let n = 0;
      for (let i = 0; i < this.n; i++) {
        const s = this.state[i];
        if (s !== ST.CIV && s !== ST.FLEE && s !== ST.FIGHT) continue;
        if (this.goal[i] === GOAL.NONE || this.goal[i] === GOAL.FOLLOW) {
          this.setGoal(i, GOAL.HOME, this.homeX[i], this.homeZ[i]);
          n++;
        }
      }
      this.govSay('gov', `混乱 ${chaos.toFixed(0)}% → 全城宵禁（${n} 人被赶回家）`);
    } else if (o.curfew && chaos < 15 && t - o.curfewSince > 180) {
      o.curfew = false; o.curfewSince = 0;
      this.govSay('gov', '秩序恢复 → 解除宵禁');
    }

    // ---- 全城撤离令：混乱 ≥ 85 或 感染 ≥ 25%（只下一次，之后不再打扰） ----
    if (!o.evacuate && (chaos >= 85 || inf >= 25) && t - cd.evac > 600) {
      o.evacuate = true; o.evacSince = t; cd.evac = t;
      let n = 0;
      for (let i = 0; i < this.n; i++) {
        const s = this.state[i];
        if (s !== ST.CIV && s !== ST.INFECTED) continue;
        this.fleeMode[i] = 2; this.fleeGoal[i] = 2;   // 有目标逃跑：直接出城
        this.applyFleeGoal(i);
        n++;
      }
      this.govSay('gov', `混乱 ${chaos.toFixed(0)}、感染 ${inf.toFixed(1)}% → 下达全城撤离令（${n} 人开始出城）`);
    }

    if (school && chaos >= 50 && t - cd.schoolGuard > 300) {
      cd.schoolGuard = t;
      const r = this.dispatchTo('police', school.x, school.z, 4, { dest: '学校', why: '维持秩序' });
      if (r.ok) this.govSay('police', `混乱 ${chaos.toFixed(0)}% → ${r.n} 名警员前往学校维持秩序`);
    }


    // ---- 派遣名单维护：到达 / 阵亡 / 换目标就摘掉 ----
    for (const [i, d] of this.duties) {
      if (i >= this.n) { this.duties.delete(i); continue; }
      const s = this.state[i];
      if (s !== ST.POLICE && s !== ST.SOLDIER) { this.duties.delete(i); continue; }
      if (this.goal[i] !== GOAL.MOVE_TO) { this.duties.delete(i); continue; }
      if (Math.hypot(this.px[i] - d.x, this.pz[i] - d.z) < 12) this.duties.delete(i);
    }
  }
  /**
   * 统一派遣。
   * @param {'police'|'soldier'} kind 派谁
   * @param {number} x,z 目标点
   * @param {number} n   人数
   * @param {object} [opt] { purge: 秒 } —— 清剿任务：期间对"人"也开火
   */
  dispatchTo(kind, x, z, n, opt) {
    const want = Math.max(1, n | 0 || 1);
    if (kind === 'police') {
      const r = this.dispatchPolice(x, z, want, opt);
      if (opt && opt.purge && r.ids) {
        for (const i of r.ids) this.purgeT[i] = this.time + (opt.purge | 0 || 180);
      }
      return { ok: r.ok, n: r.n, from: r.station ? (r.station.n || '警察局') : '—', ids: r.ids, reason: r.reason };
    }
    // ---- 士兵：从政府大楼门口刷（没有政府就用最近的警局）----
    const base = (this.poiByKind.gov || [])[0] || this.nearestPoi('police', x, z);
    if (!base) return { ok: false, n: 0, reason: 'no-base' };
    const made = [];
    for (let k = 0; k < want; k++) {
      const a = this.rng() * 6.2832, r = 5 + this.rng() * 9;
      let sx = base.x + Math.cos(a) * r, sz = base.z + Math.sin(a) * r;
      if (!this.walkable(sx, sz)) { sx = base.x; sz = base.z; }
      const i = this.addUnit(sx, sz, 'soldier');
      if (i < 0) break;
      this.orderMove(i, x + (this.rng() - 0.5) * 12, z + (this.rng() - 0.5) * 12);
      this.boostT[i] = this.time + 60;
      if (opt && opt.purge) this.purgeT[i] = this.time + (opt.purge | 0 || 180);
      if (this.duties) {
        this.duties.set(i, {
          x, z, what: (opt && opt.purge) ? '清剿' : '增援',
          dest: (opt && opt.dest) || '目标', why: (opt && opt.why) || '', t: this.time,
        });
      }
      made.push(i);
    }
    return { ok: made.length > 0, n: made.length, from: base.n || '政府', ids: made };
  }

  /** 警力收拢：所有人回最近的警局待命（巡逻也停） */
  orderPoliceHome() {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== ST.POLICE) continue;
      if (this.escortOf[i]) continue;
      const si = this.stationOf[i] - 1;
      const st = si >= 0 ? (this.poiByKind.police || [])[si] : null;
      if (!st) continue;
      this.patrol[i] = 0;
      this.setGoal(i, GOAL.HOLD, st.x, st.z);
      n++;
    }
    this.pushEvent(`政府命令：${n} 名警员回局待命`, 'start');
    return { ok: n > 0, n };
  }

  /** 清剿：派人去某点，"见人就打"持续一段时间（默认 4 分钟） */
  orderPurge(x, z, n, usePolice) {
    const r = this.dispatchTo(usePolice ? 'police' : 'soldier', x, z, n || 10, { purge: 240 });
    this.pushEvent(
      r.ok ? `清剿令：${r.n} 名${usePolice ? '警察' : '士兵'}前往目标，人格杀勿论（4 分钟）`
        : '清剿令：没有可用兵力',
      r.ok ? 'start' : '');
    return r;
  }

  /** 疏散：所有正在前往医院的人改为回家 */
  clearPatients() {
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.goal[i] !== GOAL.HELP) continue;
      if (this.state[i] === ST.CORPSE || this.state[i] === ST.SAVED) continue;
      this.setGoal(i, GOAL.HOME, this.homeX[i], this.homeZ[i]);
      n++;
    }
    this.pushEvent(`疏散：${n} 名病患改回家`, 'start');
    return n;
  }
  /** 停课 / 复课（学校） */
  setSchoolClosed(on) {
    this.govOrders.schoolClosed = !!on;
    this.pushEvent(on ? '政府命令：全城学校停课，学生回家' : '政府命令：学校复课', 'start');
    return this.govOrders.schoolClosed;
  }

  /** 医院停止收治 / 恢复收治 */
  setHospitalClosed(on) {
    this.govOrders.hospitalClosed = !!on;
    this.pushEvent(on ? '政府命令：医院停止收治，病患不再前往' : '政府命令：医院恢复收治', 'start');
    return this.govOrders.hospitalClosed;
  }

  /** 机构总览（给政府行动面板用） */
  govDetail() {
    const P = this.poiByKind;
    const mk = (name, pois) => ({
      name, pois: pois.length,
      total: 0, alive: 0, dead: 0, infected: 0, saved: 0, atPost: 0, street: 0,
    });
    const out = {
      gov: mk('政府', P.gov || []),
      police: mk('警察', P.police || []),
      hosp: mk('医院', P.hospital || []),
      school: mk('学校', P.school || []),
      patients: 0,        // 正在前往医院的人（全国）
      purge: 0,           // 当前处于清剿状态的兵力
      orders: this.govOrders,
    };
    const slot = [null, out.gov, out.hosp, out.school];   // jobKind → 机构（INST: 1 政府 / 2 医院 / 3 学校）
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (this.goal[i] === GOAL.HELP && s !== ST.CORPSE && s !== ST.SAVED) out.patients++;
      const rec = slot[this.jobKind[i]];
      if (!rec) continue;
      rec.total++;
      if (s === ST.CORPSE) rec.dead++;
      else if (s === ST.SAVED) rec.saved++;
      else {
        rec.alive++;
        if (s === ST.INFECTED) rec.infected++;
        else if (s === ST.ZOMBIE) rec.infected++;
        if (this.goal[i] === GOAL.WORK) rec.atPost++;
        else if (this.goal[i] === GOAL.NONE || this.goal[i] === GOAL.FOLLOW) rec.street++;
      }
    }
    // 警力单独统计（警察不是 jobKind，而是真实单位）
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      const isP = s === ST.POLICE || s === ST.SOLDIER;
      if (s === ST.CORPSE && this.stationOf[i]) { out.police.dead++; out.police.total++; continue; }
      if (!isP) continue;
      out.police.total++; out.police.alive++;
      if (this.escortOf[i]) out.police.street++;
      else if (this.patrol[i]) out.police.street++;
      else if (this.goal[i] === GOAL.MOVE_TO) out.police.street++;
      else out.police.atPost++;
      if (this.purgeT[i] > this.time) out.purge++;
    }
    // 院内病人：已经走到医院 40m 内的病患（"正在前往"之外的那个数）
    const hs = P.hospital || [];
    let inside = 0;
    if (hs.length) {
      for (let i = 0; i < this.n; i++) {
        const s = this.state[i];
        if (s === ST.CORPSE || s === ST.SAVED) continue;
        if (this.goal[i] !== GOAL.HELP) continue;
        for (let k = 0; k < hs.length; k++) {
          const p = hs[k];
          const dx = this.px[i] - p.x, dz = this.pz[i] - p.z;
          if (dx * dx + dz * dz < 1600) { inside++; break; }
        }
      }
    }
    out.patientsInside = inside;
    out.police.stations = (P.police || []).length;
    out.gov.pois = (P.gov || []).length;

    // 自动决策日志（最新的在前）+ 在外执勤名单
    out.log = this.govLog.slice(-12).reverse();
    out.duties = [];
    if (this.duties) {
      for (const [i, d] of this.duties) {
        if (i >= this.n) continue;
        const s = this.state[i];
        if (s !== ST.POLICE && s !== ST.SOLDIER) continue;
        out.duties.push({
          i, soldier: s === ST.SOLDIER, what: d.what, dest: d.dest, why: d.why, t: d.t,
          dist: Math.hypot(this.px[i] - d.x, this.pz[i] - d.z),
        });
      }
      out.duties.sort((a, b) => a.dist - b.dist);
    }
    out.since = {
      school: this.govOrders.schoolSince || 0,
      hosp: this.govOrders.hospSince || 0,
      curfew: this.govOrders.curfewSince || 0,
      evac: this.govOrders.evacSince || 0,
    };
    out.now = this.time;
    out.curfew = !!this.govOrders.curfew;
    out.evacuate = !!this.govOrders.evacuate;
    out.history = this.govHist.slice(-40);
    out.now2 = 0;
    // ---- 趋势：和 60 秒前比 ----
    const h = this.govHist;
    if (h.length >= 2) {
      const a = h[Math.max(0, h.length - 7)], b = h[h.length - 1];
      out.trend = {
        dt: b.t - a.t,
        chaos: b.chaos - a.chaos,
        inf: b.inf - a.inf,
        patients: b.patients - a.patients,
        zombies: b.zombies - a.zombies,
        dead: b.dead - a.dead,
      };
    } else out.trend = null;

    // ---- 逐个机构明细（医院 / 学校 / 警察局 / 政府）----
    const byPoi = (kindCode, idx) => {
      const r = { staff: 0, alive: 0, dead: 0, infected: 0, saved: 0, atPost: 0 };
      for (let i = 0; i < this.n; i++) {
        if (this.jobKind[i] !== kindCode || this.workPoi[i] !== idx + 1) continue;
        r.staff++;
        const s = this.state[i];
        if (s === ST.CORPSE) r.dead++;
        else if (s === ST.SAVED) r.saved++;
        else {
          r.alive++;
          if (s === ST.INFECTED || s === ST.ZOMBIE) r.infected++;
          if (this.goal[i] === GOAL.WORK) r.atPost++;
        }
      }
      return r;
    };
    out.hospitals = (P.hospital || []).map((p, k) => {
      const base = byPoi(INST.HOSP, k);
      let patients = 0, guards = 0;
      for (let i = 0; i < this.n; i++) {
        const s = this.state[i];
        if (s === ST.CORPSE || s === ST.SAVED) continue;
        const dx = this.px[i] - p.x, dz = this.pz[i] - p.z;
        if (dx * dx + dz * dz > 1600) continue;
        if (this.goal[i] === GOAL.HELP) patients++;
        if (s === ST.SOLDIER) guards++;
      }
      return Object.assign({ name: p.n || '医院' }, base, { patients, guards });
    });
    out.schools = (P.school || []).map((p, k) => {
      const base = byPoi(INST.SCHOOL, k);
      let police = 0;
      for (let i = 0; i < this.n; i++) {
        const s = this.state[i];
        if (s !== ST.POLICE && s !== ST.SOLDIER) continue;
        const dx = this.px[i] - p.x, dz = this.pz[i] - p.z;
        if (dx * dx + dz * dz < 2500) police++;
      }
      return Object.assign({ name: p.n || '学校' }, base, { police });
    });
    out.govs = (P.gov || []).map((p, k) => Object.assign({ name: p.n || '政府' }, byPoi(INST.GOV, k)));
    out.stations2 = (P.police || []).map((p, k) => {
      let idle = 0, patrol = 0, onduty = 0, dead = 0;
      const idleIds = [];
      for (let i = 0; i < this.n; i++) {
        if (this.stationOf[i] !== k + 1) continue;
        const s = this.state[i];
        if (s === ST.CORPSE) { dead++; continue; }
        if (s !== ST.POLICE && s !== ST.SOLDIER) continue;
        if (this.escortOf[i] || this.patrol[i] || this.goal[i] === GOAL.MOVE_TO) onduty++;
        else { idle++; if (idleIds.length < 3) idleIds.push(i); }
      }
      return {
        name: p.n || '警察局', idle, patrol, onduty, dead, idleIds,
        stock: p.store ? stockText(p.store) : '—',
      };
    });
    return out;
  }
  /** 命令士兵移动到某点（只有士兵接受命令，警察不行） */
  orderMove(i, x, z) {
    if (this.state[i] !== ST.SOLDIER) return false;
    this.setGoal(i, GOAL.MOVE_TO, x, z);
    this.wpT[i] = 0;
    this.pathN[i] = 0;
    return true;
  }

  /** 僵尸每感染一个人，自己变得更硬：+50 血（封顶 2000） */
  growFromKill(by) {
    if (by < 0) return;
    const sp = SPECIES[this.kind[by]];
    if (!sp || sp.team !== TEAM.ZOMBIE) return;
    const add = 50;
    this.hp[by] = Math.min(2000, this.hp[by] + add);
  }

  /**
   * 潜伏时长（模拟秒；1 秒 = 1 游戏分钟）：
   *   咬伤（route 1）：1–2 游戏小时   = 60–120 秒
   *   接触（route 2）：6–24 游戏小时  = 360–1440 秒（均值 12 小时）
   * 两条路线用**同一个评分函数**：0.6 × 体质 + 0.4 × 个人哈希。
   */
  /** 真正带个体年龄的版本（上面的占位由它替换） */
  incubationFor(i, route) {
    const r = route || 1;
    const [lo, hi] = r === 2 ? INCFG.contact : INCFG.bite;
    const age = ageOf(i);
    const consti = age > 65 ? 0.25 : (age < 18 ? 0.6 : (age < 25 ? 0.75 : 0.5));
    const score = 0.6 * consti + 0.4 * h(i, 77);
    return lo + (hi - lo) * score;
  }

  /** 附近所有人（用空间哈希，半径 r 米） */
  forEachNear(x, z, r, fn) {
    const hc = this.hcols, hr = this.hrows, cell = this.hcell, nav = this.nav;
    const cx = ((x + nav.halfW) / cell) | 0;
    const cz = ((z + nav.halfH) / cell) | 0;
    const rad = Math.max(1, Math.ceil(r / cell));
    const r2 = r * r;
    for (let rr = cz - rad; rr <= cz + rad; rr++) {
      if (rr < 0 || rr >= hr) continue;
      for (let cc = cx - rad; cc <= cx + rad; cc++) {
        if (cc < 0 || cc >= hc) continue;
        const k = rr * hc + cc;
        const e = this.hStart[k + 1];
        for (let p = this.hStart[k]; p < e; p++) {
          const j = this.hOrder[p];
          const dx = this.px[j] - x, dz = this.pz[j] - z;
          if (dx * dx + dz * dz <= r2) fn(j);
        }
      }
    }
  }

  /**
   * 接触传染：传染类感染者 10m 内贴住某人**连续 10 秒** → 那人被感染（同样是接触路线）。
   * 走开就重新计时（1.5 秒内没被刷新 = 断开了）。
   */
  spreadContact() {
    const t = this.time, R = 10;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== ST.INFECTED || this.infRoute[i] !== 2) continue;
      this.forEachNear(this.px[i], this.pz[i], R, (j) => {
        if (j === i) return;
        const st = this.state[j];
        if (st !== ST.CIV && st !== ST.FLEE && st !== ST.FIGHT) return;
        const sp = SPECIES[this.kind[j]];
        if (!sp || sp.team !== TEAM.HUMAN || !sp.infectable) return;
        const last = this.exposedAt[j];
        if (last === 0 || t - last > 1.5) {
          // 刚接触 / 中间断过：重新开始计时
          this.exposedAt[j] = t;
          this.expStart[j] = t;
          return;
        }
        this.exposedAt[j] = t;
        if (t - this.expStart[j] >= 10) {
          this.exposedAt[j] = 0;
          this.expStart[j] = 0;
          this.setInfected(j, this.incubationFor(j, 2), 2);
          this.panic[j] = 0.8;
        }
      });
    }
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
  }

  /** 开火：查弹匣 / 装填 / 射程 / 精度（受熟练度影响）/ 噪音 */
  /**
   * 命中率只有这一张表，写死（不再有武器精度 / 熟练度 / 滑杆等第二种来源）：
   *   警察 30%（含 SWAT、警车）    军队 80%（士兵 / 重装 / 装甲车）    平民 10%
   */
  /** 是不是动物（狗/猫）。动物和人是同一套逻辑，只是属性不同。 */
  isAnimal(i) {
    return this.kind[i] >= SP.DOG;
  }

  shotAccuracy(i) {
    const k = this.kind[i];
    if (k === SP.POLICE) return 0.30;
    if (k === SP.SOLDIER || k === SP.ELITE || k === SP.APC) return 0.80;
    return 0.10;
  }

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
    const acc = this.shotAccuracy(i);
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
    this.stats.hits++;

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
  setInfected(i, seconds, route) {
    this.state[i] = ST.INFECTED;
    this.infRoute[i] = route || 1;
    this.incTot[i] = seconds;
    this.timer[i] = seconds;
    this.riseAt[i] = this.time + seconds;
    this.sick[i] = 1;          // 一感染就发烧 → 立刻决定去医院（不再等最后 25%）
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
      this.spd[i] = SPECIES[SP.ZOMBIE].speed * (0.85 + this.rng() * 0.3);
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
        this.setInfected(j, this.incubationFor(j, 1), 1);
        this.hp[j] = Math.max(1, this.hp[j] - 4);
        this.growFromKill(i);
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
    s.fleeImm = 0; s.fleeHome = 0; s.fleePolice = 0; s.fleeEscape = 0; s.fleeTotal = 0;
    s.vipAlive = 0; s.vipSaved = 0; s.vipLost = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      switch (this.state[i]) {
        case ST.CIV: case ST.FLEE: case ST.FIGHT: s.civ++; break;
        // 逃跑统计（不分状态：逃跑状态下也保有 fleeMode 2 的目标）
        case ST.INFECTED: s.infected++; s.civ++; if (this.sick[i]) s.sick++; break;
        case ST.ZOMBIE: s.zombie++; break;
        case ST.CORPSE: s.dead++; break;
        case ST.POLICE: s.police++; break;
        case ST.SOLDIER: s.police++; break;
        case ST.SAVED: s.saved = (s.saved || 0) + 1; break;
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.state[i] === ST.FLEE && this.fleeMode[i] === 1) s.fleeImm++;
      if (this.fleeMode[i] === 2) {
        s.fleeTotal++;
        if (this.fleeGoal[i] === 0) s.fleeHome++;
        else if (this.fleeGoal[i] === 1) s.fleePolice++;
        else s.fleeEscape++;
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

  /** 武力状态明细（给面板用） */
  forceDetail() {
    // ---- 一次扫描把武力相关的东西全算出来（口径统一，别在 UI 里再算一遍）----
    let armedN = 0, ammoN = 0, zeroAmmo = 0;
    let armedCiv = 0, armedPolice = 0, armedSoldier = 0;
    let potential = 0;              // 家里有枪、还没去取的人
    const armed = new Map();
    const hs = this.homeStocks;
    for (let i = 0; i < this.n; i++) {
      const st = this.state[i];
      if (st === ST.CORPSE || st === ST.ZOMBIE || st === ST.SAVED) continue;
      if (this.armed[i]) {
        armedN++;
        const mag = (this.mag[i] || 0) + (this.reserve[i] || 0);
        ammoN += mag;
        if (mag <= 0) zeroAmmo++;
        if (st === ST.POLICE) armedPolice++;
        else if (st === ST.SOLDIER) armedSoldier++;
        else armedCiv++;
        const id = this.wpn[i];
        const a = armed.get(id) || { n: 0, ammo: 0 };
        a.n++; a.ammo += mag;
        armed.set(id, a);
      } else if (hs && this.hh && hs.get(this.hh[i]) && hasWeapon(hs.get(this.hh[i]))) {
        potential++;
      }
    }
    const weaponRows = [...armed.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([id, a]) => ({ name: weaponOf(id).name, n: a.n, ammo: a.ammo }));

    let police = 0, soldiers = 0, idle = 0, patrol = 0, onDuty = 0, escort = 0, policeDead = 0;
    for (let i = 0; i < this.n; i++) {
      const st = this.state[i];
      if (st === ST.SOLDIER) { soldiers++; if (st !== ST.CORPSE) police++; continue; }
      if (st === ST.CORPSE && this.stationOf[i]) { policeDead++; continue; }
      if (st !== ST.POLICE) continue;
      police++;
      if (this.escortOf[i]) escort++;
      else if (this.patrol[i]) patrol++;
      else if (this.goal[i] === GOAL.MOVE_TO) onDuty++;
      else idle++;
    }

    // ---- 分数拆解：和 force 的公式一一对应，面板要能看出短板 ----
    const popAlive = Math.max(1, this.stats.civ + this.stats.police);
    const needArmed = Math.max(1, popAlive * 0.15);
    const needPolice = Math.max(1, (this.params && this.params.police) || 60);
    const needAmmo = Math.max(1, popAlive * 8);
    const pArmed = Math.min(1, armedN / needArmed);
    const pPolice = Math.min(1, police / needPolice);
    const pAmmo = Math.min(1, ammoN / needAmmo);
    const force = Math.min(100, Math.round(pArmed * 40 + pPolice * 40 + pAmmo * 20));
    const parts = [
      { key: 'armed', name: '武装率', score: pArmed * 40, max: 40,
        detail: `${armedN} 人 / 需 ${Math.round(needArmed).toLocaleString()} 人`, hint: '家里有枪的人回家取枪能补上来' },
      { key: 'police', name: '警力', score: pPolice * 40, max: 40,
        detail: `${police} 人 / 编制 ${Math.round(needPolice).toLocaleString()} 人`, hint: '警察阵亡越多这项越低' },
      { key: 'ammo', name: '弹药', score: pAmmo * 20, max: 20,
        detail: `${ammoN.toLocaleString()} 发 / 需 ${Math.round(needAmmo).toLocaleString()} 发`, hint: '打光就没火力了' },
    ];

    // ---- 趋势：用 govHist 最近 60 秒的采样 ----
    const h = this.govHist || [];
    let trend = null;
    if (h.length >= 2) {
      const last = h[h.length - 1];
      let base = h[0];
      for (let k = h.length - 1; k >= 0; k--) { if (last.t - h[k].t >= 60) { base = h[k]; break; } }
      const dt = Math.max(1, last.t - base.t);
      const perMin = (v) => v * (60 / dt);
      trend = {
        dt,
        kills: (last.kills || 0) - (base.kills || 0),
        killsPerMin: perMin((last.kills || 0) - (base.kills || 0)),
        newZombies: (last.zombies || 0) - (base.zombies || 0),
        newZombiesPerMin: perMin((last.zombies || 0) - (base.zombies || 0)),
        shots: (last.shots || 0) - (base.shots || 0),
        shotsPerMin: perMin((last.shots || 0) - (base.shots || 0)),
        armed: (last.armed || 0) - (base.armed || 0),
        ammo: (last.ammo || 0) - (base.ammo || 0),
      };
      trend.net = trend.kills - trend.newZombies;
    }
    const shots = this.stats.shots || 0;
    const hits = this.stats.hits || 0;
    const burnPerMin = trend ? trend.shotsPerMin : 0;
    const ammoMinutes = burnPerMin > 0.5 ? ammoN / burnPerMin : Infinity;

    // ---- 每个警局：人员分布 + 军械库明细 ----
    const stations = [];
    const P0 = this.poiByKind.police || [];
    for (let k = 0; k < P0.length; k++) {
      const p = P0[k];
      let idle = 0, patrol = 0, onDuty = 0, escort = 0, dead = 0;
      const idleIds = [];
      for (let i = 0; i < this.n; i++) {
        if (this.stationOf[i] !== k + 1) continue;
        const s = this.state[i];
        if (s === ST.CORPSE) { dead++; continue; }
        if (s !== ST.POLICE && s !== ST.SOLDIER) continue;
        if (this.escortOf[i]) escort++;
        else if (this.patrol[i]) patrol++;
        else if (this.goal[i] === GOAL.MOVE_TO) onDuty++;
        else { idle++; if (idleIds.length < 3) idleIds.push(i); }
      }
      // 军械库：按枪种拆开，再给个"还剩多少"的总量
      const st = p.store;
      const rows = [];
      let guns = 0, ammo = 0;
      if (st) {
        for (let id = 1; id < st.w.length; id++) {
          if (!st.w[id] && !st.a[id]) continue;
          rows.push({ name: weaponOf(id).name, n: st.w[id] || 0, ammo: st.a[id] || 0 });
          guns += st.w[id] || 0;
          ammo += st.a[id] || 0;
        }
        rows.sort((a, b) => (b.n * 1000 + b.ammo) - (a.n * 1000 + a.ammo));
      }
      const initAmmo = p.initAmmo || Math.max(1, ammo);
      const initGuns = p.initGuns || Math.max(1, guns);
      const crew = idle + patrol + onDuty + escort;
      const taken = p.taken || { civ: 0, cop: 0, guns: 0, ammo: 0 };
      stations.push({
        name: p.n || '警察局',
        x: p.x, z: p.z,
        stock: st ? stockText(st) : '—',
        taken,
        hist: (this.stationHist || []).map((h) => (h.ammo && h.ammo[k]) || 0),
        idle, patrol, onDuty, escort, dead, idleIds,
        idleAt: this.idleAt ? this.idleAt(k) : 0,
        rows, guns, ammo,
        initGuns, initAmmo,
        ammoLeft: initAmmo > 0 ? ammo / initAmmo : 0,
        gunsLeft: initGuns > 0 ? guns / initGuns : 0,
        perOfficer: crew > 0 ? ammo / crew : 0,
      });
    }

    const level = force >= 75 ? '强大' : force >= 55 ? '充足' : force >= 35 ? '尚可' : force >= 15 ? '勉强' : '虚弱';
    return {
      force, level, parts,
      armedN, armedCiv, armedPolice, armedSoldier, potential, zeroAmmo,
      ammoN,
      armedRate: armedN / popAlive,
      ammoPer: ammoN / Math.max(1, armedN),
      weaponRows, police, soldiers, idle, patrol, onDuty, escort, policeDead,
      stations,
      kills: this.kills || 0,
      civKilled: this.civDeaths || 0,
      shots, hits,
      accuracy: shots > 0 ? hits / shots : null,   // 真实命中率（没开过枪就是 null）
      trend, burnPerMin, ammoMinutes,
      hist: h.slice(-40),
    };
  }
  /** 卫生状态明细（给面板用） */
  sanitDetail() {
    const dead = this.stats.dead || 0;
    const zombies = this.stats.zombie || 0;
    const infected = this.stats.infected || 0;
    let sick = 0;
    for (let i = 0; i < this.n; i++) if (this.state[i] === ST.INFECTED && this.sick[i]) sick++;
    const penaltyDead = Math.min(45, Math.round(dead / Math.max(1, this.pop0) * 300));
    const penaltyInfect = Math.min(45, Math.round((this.infectRate || 0) * 100 * 4));
    const hospitals = [];
    for (const p of (this.poiByKind.hospital || [])) {
      let near = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.state[i] !== ST.CIV && this.state[i] !== ST.INFECTED) continue;
        if (this.goal[i] !== GOAL.HELP) continue;
        if (Math.hypot(this.px[i] - p.x, this.pz[i] - p.z) < 400) near++;
      }
      hospitals.push({ name: p.n || '医院', near });
    }
    const sanit = this.sanit || 0;
    const level = sanit >= 85 ? '良好' : sanit >= 65 ? '尚可' : sanit >= 45 ? '恶化' : sanit >= 20 ? '糟糕' : '灾难';
    const mainPressure = penaltyDead > penaltyInfect ? '尸体堆积' : penaltyInfect > 0 ? '感染扩散' : '暂无';
    return {
      sanit, level, dead, zombies, infected, sick,
      infectRate: this.infectRate || 0,
      penaltyDead, penaltyInfect, hospitals, mainPressure,
    };
  }

  /** 结算数据（撤离评分卡用） */
  scoreData() {
    const st = this.stats || {};
    const saved = this.saved || st.saved || 0;
    const dead = st.dead || 0;
    const infected = st.infected || 0;
    const total = this.pop0 || 1;
    const rate = saved / total;
    let grade = 'D';
    if (rate >= 0.5) grade = 'S';
    else if (rate >= 0.35) grade = 'A';
    else if (rate >= 0.2) grade = 'B';
    else if (rate >= 0.08) grade = 'C';
    return {
      saved, dead, infected, total, budget: this.budget, budgetBack: this.budgetBack || 0,
      saveRate: rate,
      zombies: st.zombie || 0,
      police: st.police || 0,
      day: this.dayIndex,
      time: this.clockMin,
      grade,
    };
  }

  outcome() {
    const s = this.stats;
    if (s.zombie === 0 && s.infected === 0) return s.civ > 0 ? 'CLEARED' : 'EMPTY';
    if (s.civ === 0) return 'FALLEN';
    if (this.time > 60 && s.zombie > 0 && s.civ > 0) return null;
    return null;
  }
}
























