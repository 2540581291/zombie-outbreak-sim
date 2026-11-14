// ============================================================
//  ZOS-R · 个体固有属性（纯函数，零依赖）
//
//  姓名 / 年龄 / 性别 / 职业 / 家庭 —— 全部由「个体下标 + 盐」哈希决定，
//  所以同一个人在模拟里、在档案里、在总览表里永远是同一份资料。
//
//  这个模块**不能 import 任何东西**：sim.js 和 people.js 都要用它，
//  引入依赖会成环。
// ============================================================

// ---------------- 姓名池：按城市所在国家切换 ----------------
// 显示一律用中文（日本人名也用汉字，如 佐藤 健太）。
// 这个模块不能 import 任何东西（sim.js 和 people.js 都用它，会成环），
// 所以国家由启动时 setCountry() 注入一次。
// 中国：姓取百家姓常用 200 个，名用「单字 / 双字组合 / 常用全名」三路拼，
// 组合数 200 × (约 3000) ≈ 60 万，几十万人口也不会撞名。
const CN_LAST = [...(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤' +
  '常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬师和仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩明佘池查麻苑迟邝'
)];

// 双字名的首字/次字池（男女通用）
const CN_A = '子浩思俊明嘉雨欣雅诗若语天梓文志欣心晨梦怡嘉静永建振晓海春'.split('')
const CN_B = '涵然轩宇豪远清婷曦凡阳昭恒雅彤轩睿悦宁航博琪辉杰琳蕾薇琪菲楠鑫淼磊坤敏丽芳颖洁彩虹云霞'.split('')
// 单字名（男女分开）
const CN_M1 = '伟强磊军勇杰涛超刚明辉鹏华斌峰亮健旭鑫坤鑫淼浩宁博宇轩睿恒阳晨海波立新建国志强晓东振宇家豪俊杰文博'.split('')
const CN_F1 = '芳娜敏静丽艳娟霞平燕英华玉兰珍梅玲莉萍红梅秀英海燕晓燕丽萍桂英春梅凤霞玉梅素芳秀兰'.split('')
// 常用双字全名（男女分开）
const CN_M2 = ('浩然 子轩 宇轩 俊杰 嘉豪 思远 振宇 晓东 文博 家豪 志强 建国 立新 明远 天佑 晨曦 亦凡 沐阳 昭明 之恒 ' +
  '书豪 睿泽 梓豪 子墨 修远 承泽 景行 尚德 铭轩 星宇 泓博 澈明 弘文 承宇 致远 峻熙 昊然 天成 泽宇 启航').trim().split(/\s+/)
const CN_F2 = ('雨欣 欣怡 婉清 雅婷 心怡 若曦 舒雅 语彤 思彤 佳怡 梦琪 诗涵 紫涵 语汐 一诺 安然 静姝 可欣 亦菲 婉婷 ' +
  '清悦 沐晴 星月 若彤 芷晴 心语 婉茹 雨桐 佳怡 晨露 雪晴 静雯 书瑶 美琳 慧敏 秀珍 玉兰 春梅 丽娟 晓燕').trim().split(/\s+/)

const POOL_CN = {
  surnameFirst: true,
  last: CN_LAST,
  // 名池：全名 + 单字 + 首字×次字 组合
  first: [
    ...CN_M2, ...CN_F2, ...CN_M1, ...CN_F1,
    ...CN_A.flatMap(a => CN_B.map(b => a + b)),
  ],
  // 按性别取（maleOf 决定）
  firstM: [...CN_M2, ...CN_M1],
  firstF: [...CN_F2, ...CN_F1],
};

const POOL_JP = {
  surnameFirst: true,
  last: ['佐藤', '铃木', '高桥', '田中', '伊藤', '渡边', '山本', '中村', '小林', '加藤',
         '吉田', '山田', '佐佐木', '山口', '松本', '井上', '木村', '清水', '山崎', '森田',
         '池田', '桥本', '石川', '前田', '藤田'],
  first: ['健太', '阳子', '翔太', '美咲', '拓也', '由美', '大辅', '真由', '直树', '智子',
          '凉介', '春香', '悠斗', '结衣', '海斗', '葵', '龙之介', '咲良', '和也', '千夏',
          '隆史', '绘里', '俊介', '美穗', '亮太', '彩花'],
};

const POOL_EN = {
  last: ['史密斯', '约翰逊', '威廉姆斯', '布朗', '琼斯', '米勒', '戴维斯', '威尔逊',
         '泰勒', '克拉克', '哈里斯', '刘易斯', '沃克', '怀特', '汤普森', '安德森'],
  first: ['杰克', '艾米莉', '威廉', '奥利维亚', '詹姆斯', '索菲亚', '亨利', '艾拉',
          '诺亚', '格蕾丝', '奥利弗', '莉莉', '乔治', '爱丽丝', '哈里', '露西',
          '汤姆', '莎拉', '本', '凯特'],
};

const POOL_DE = {
  last: ['米勒', '施密特', '施耐德', '费舍尔', '韦伯', '迈尔', '瓦格纳', '贝克尔',
         '舒尔茨', '霍夫曼', '科赫', '里希特', '克莱因', '沃尔夫', '诺伊曼', '施瓦茨'],
  first: ['卢卡斯', '莱娜', '马克西米利安', '安娜', '约纳斯', '玛丽', '菲利克斯', '索菲',
          '保罗', '艾玛', '本', '克拉拉', '托比亚斯', '尤利娅', '尼克拉斯', '汉娜',
          '塞巴斯蒂安', '卡特琳', '莫里茨', '伊尔莎'],
};

// 其他地区（巴西/南非/荷兰/波兰/菲律宾/阿联酋/越南…）：通用国际人名
const POOL_INTL = {
  last: ['席尔瓦', '桑托斯', '奥利维拉', '佩雷拉', '科斯塔', '德弗里斯', '扬森',
         '科瓦尔斯基', '诺瓦克', '雷耶斯', '门多萨', '卡瓦略', '阿尔梅达', '巴克'],
  first: ['若昂', '玛丽亚', '卡洛斯', '安娜', '路易斯', '费尔南达', '彼得', '伊娃',
          '马克思', '妮娜', '阿里', '莱拉', '阮', '陈', '马克', '茱莉亚'],
};

const POOLS = {
  中国: POOL_CN, 日本: POOL_JP, 德国: POOL_DE,
  英国: POOL_EN, 美国: POOL_EN, 澳大利亚: POOL_EN, 加拿大: POOL_EN,
};
let POOL = POOL_INTL;

/** 启动时按城市国家切换姓名池（main.js 在 boot 里调一次） */
export function setCountry(country) {
  POOL = POOLS[country] || POOL_INTL;
  return POOL;
}
export function namePool() { return POOL; }
/** 中日习惯「姓在前」；其它地区「名在前」 */
export function surnameFirst() { return !!POOL.surnameFirst; }

/** 兼容旧用法：FIRST / LAST 现在指向"当前国家"的池 */
export const firstNamePool = () => POOL.first;
export const lastNamePool = () => POOL.last;

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
