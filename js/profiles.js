// ============================================================
//  ZOS-R · 个体固有属性（纯函数，零依赖）
//
//  姓名 / 年龄 / 性别 / 职业 / 家庭 —— 全部由「个体下标 + 盐」哈希决定，
//  所以同一个人在模拟里、在档案里、在总览表里永远是同一份资料。
//
//  这个模块**不能 import 任何东西**：sim.js 和 people.js 都要用它，
//  引入依赖会成环。
// ============================================================

export const FIRST = [
  ['卢卡斯', 'Lukas'], ['莱娜', 'Lena'], ['马克西米利安', 'Maximilian'], ['安娜', 'Anna'],
  ['约纳斯', 'Jonas'], ['玛丽', 'Marie'], ['菲利克斯', 'Felix'], ['索菲', 'Sophie'],
  ['保罗', 'Paul'], ['艾玛', 'Emma'], ['本', 'Ben'], ['克拉拉', 'Clara'],
  ['托比亚斯', 'Tobias'], ['尤利娅', 'Julia'], ['尼克拉斯', 'Niklas'], ['汉娜', 'Hannah'],
  ['塞巴斯蒂安', 'Sebastian'], ['卡特琳', 'Katrin'], ['莫里茨', 'Moritz'], ['伊尔莎', 'Ilse'],
];

export const LAST = [
  ['米勒', 'Müller'], ['施密特', 'Schmidt'], ['施耐德', 'Schneider'], ['费舍尔', 'Fischer'],
  ['韦伯', 'Weber'], ['迈尔', 'Meyer'], ['瓦格纳', 'Wagner'], ['贝克尔', 'Becker'],
  ['舒尔茨', 'Schulz'], ['霍夫曼', 'Hoffmann'], ['科赫', 'Koch'], ['里希特', 'Richter'],
  ['克莱因', 'Klein'], ['沃尔夫', 'Wolf'], ['诺伊曼', 'Neumann'], ['施瓦茨', 'Schwarz'],
];

export const JOBS = [
  '会计', '中学教师', '厨师', '软件工程师', '护士', '出租车司机', '建筑工人',
  '大学生', '退休', '咖啡馆店员', '记者', '药剂师', '地铁司机', '书店老板', '快递员',
  '面包师', '牙医助理', '景观设计师', '舞台灯光师', '图书管理员',
];

export const STREETS = [
  '亚历山大大街', '卡尔·马克思大道', '罗莎·卢森堡广场', '奥拉宁街', '明斯特街',
  '海因里希·海涅街', '托尔街', '市政厅街', '施潘道街', '腓特烈大街', '罗森街', '林登街',
  '雅各布街', '罗克街', '阿尔特·舍恩豪泽街',
];

export const COMPANIES = [
  '一家会计师事务所', '市立第三中学', '一家泰式餐厅', '一家软件公司', '夏里特医院',
  '一家出租车行', '一个地铁工地', '洪堡大学', '一家独立咖啡馆', '一家地方报社',
  '一家街角药店', '柏林交通公司调度中心', '一家面包房', '一家建筑设计事务所',
];

/** 稳定哈希：同一下标 + 盐永远得到同一个 [0,1) 值 */
export function h(i, salt) {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const pick = (arr, i, salt) => arr[Math.floor(h(i, salt) * arr.length) % arr.length];

export function ageOf(i) { return 8 + Math.floor(h(i, 3) * 72); }
export function maleOf(i) { return h(i, 4) < 0.5; }

/** 职业：按年龄先分档，再按哈希抽 */
export function jobFor(i, age) {
  if (age < 20) return '学生';
  if (age > 65) return '退休';
  return pick(JOBS, i, 5);
}

export function jobOf(i) { return jobFor(i, ageOf(i)); }

/** 这一行职业对应哪类地点（用来分配「工作地」） */
export const JOB_POI = {
  护士: 'hospital', 药剂师: 'pharmacy',
  中学教师: 'school', 大学生: 'school', 学生: 'school',
  咖啡馆店员: 'market', 面包师: 'market', 书店老板: 'market',
  地铁司机: 'transit', 出租车司机: 'transit', 快递员: 'transit',
  会计: 'gov', 记者: 'gov',
};

/** 家有没有枪（M5 用，先定下来免得以后改公式） */
export function hasGunAtHome(i) { return h(i, 21) < 0.12; }

/** 性格：0 = 胆小，1 = 莽 */
export function braveOf(i) { return h(i, 22); }

// ---------------- 四个性格属性（0–100） ----------------
// 政府信任 / 家庭责任 / 意志 / 勇猛
// 不是纯随机：职业、年龄会先定一个基准，再加个人噪声，
// 保证"人设"和"身份"对得上（警察不会普遍不信任政府）。
export const ATTR_ROLE = {
  civilian: { trust: 50, family: 60, will: 50, courage: 45 },
  police:   { trust: 65, family: 60, will: 70, courage: 60 },
  soldier:  { trust: 68, family: 55, will: 75, courage: 70 },
  vip:      { trust: 80, family: 45, will: 60, courage: 35 },
};

export function attrFor(i, role = 'civilian') {
  const base = ATTR_ROLE[role] || ATTR_ROLE.civilian;
  const age = ageOf(i);
  const noise = (salt) => (h(i, salt) - 0.5) * 24;   // ±12
  let trust = base.trust + noise(61);
  let family = base.family + noise(62);
  let will = base.will + noise(63);
  let courage = base.courage + noise(64);
  if (age > 65) { trust += 12; courage -= 12; }
  else if (age < 25) { trust -= 8; courage += 8; will += 4; }
  if (age >= 30 && age <= 50) family += 8;            // 有孩子的年纪
  return {
    trust: Math.max(5, Math.min(95, Math.round(trust))),
    family: Math.max(5, Math.min(95, Math.round(family))),
    will: Math.max(5, Math.min(95, Math.round(will))),
    courage: Math.max(5, Math.min(95, Math.round(courage))),
  };
}
