// ============================================================
//  新闻跑马灯（风味文字）
//
//   · 文案由**真实局势**触发（感染数、死亡、混乱度、宵禁、停课、停收、
//     军队、清剿、撤离令、警局沦陷、要员死亡……），不是随机乱播；
//   · 每条剧情只播一次（剧情推进感），空档期播"氛围句"循环；
//   · 点一下快讯条 → 展开最近 20 条历史；
//   · 完全不碰 sim 的随机数，用自己的计数轮换 → 不影响确定性。
// ============================================================

let root = null;
let view = null;
let span = null;
let logBox = null;
let queue = [];
let playing = false;
let simRef = null;
let timer = null;
let fired = new Set();
let idleIdx = 0;
let lastShown = 0;
let CITY = { full: '本市', short: '本市', paper: '本市晨报' };
let currentIcon = '📰';

const history = [];          // 最近的快讯 [{icon, text, t}]
const HISTORY_MAX = 20;

/* ---------------- 图标 ---------------- */
const ICON = {
  news: '📰', infect: '☣️', death: '⚰️', hospital: '🏥', police: '🚓',
  army: '🪖', school: '🏫', panic: '🛒', curfew: '🌙', evacuate: '🚗',
  zombie: '🧟', vip: '🎖️', calm: '🌤️', city: '🏙️', radio: '📻',
};

/* ---------------- 剧情 ---------------- */
const STORIES = [
  {
    id: 'first', icon: ICON.infect, when: (s) => s.stats.infected + s.stats.zombie >= 1,
    lines: () => [
      `${CITY.paper}：市立医院接诊一名「行为异常」患者，院方称正在观察`,
      '目击者称昨晚有人在中央车站附近突然倒地抽搐，警方已封锁现场',
      '急诊科值班医生：病人瞳孔对光反应异常，我们从来没见过这种情况',
    ],
  },
  {
    id: 'spread', icon: ICON.infect, when: (s) => s.awareRate > 0.12,
    lines: () => [
      '卫生部通报：多家医院报告同类病例，专家称「尚无可防可控的结论」',
      '社交平台上「咬人视频」播放量破百万，官方提醒不信谣不传谣',
      '药店的口罩和消毒液卖断货，有店员说「早上就没了」',
    ],
  },
  {
    id: 'panic_buy', icon: ICON.panic, when: (s) => s.chaos >= 18,
    lines: () => [
      '超市货架被抢空：矿泉水、罐头、电池最先告罄',
      '加油站排起长队，有市民带着汽油桶前来',
      '银行门口出现挤兑，工作人员称「系统正常，请勿恐慌」',
      '五金店的撬棍和棒球棍脱销，老板说「这周卖了三年的量」',
    ],
  },
  {
    id: 'deaths', icon: ICON.death, when: (s) => s.stats.dead >= 10,
    lines: (s) => [
      `死亡人数升至 ${s.stats.dead} 人，市殡仪馆表示「已经排到下周」`,
      '太平间告急：多家医院把会议室临时改成停尸间',
    ],
  },
  {
    id: 'zombies_seen', icon: ICON.zombie, when: (s) => s.stats.zombie >= 30,
    lines: (s) => [
      `警方确认：街头已出现 ${s.stats.zombie} 名「攻击性人员」，请市民远离`,
      '市民拍到成群人影在街道上游荡，画面中有人被围住',
      '被困者拨进电台热线：它们不跑，但也不停，我们快没地方退了',
    ],
  },
  {
    id: 'police_fallen', icon: ICON.police, when: (s) => s.stationFallen && s.stationFallen.some((v) => v),
    lines: () => [
      '警局失守：有派出所被围，增援迟迟未到，警员家属在门口等候消息',
      '一线警员：我们弹匣打空了，请求支援——录音在网上流传',
      '警察工会声明：请市民不要再前往警局避难，那里已经不安全',
    ],
  },
  {
    id: 'school', icon: ICON.school, when: (s) => s.govOrders && s.govOrders.schoolClosed,
    lines: () => [
      '教育局紧急通知：全市学校停课，复课时间另行通知',
      '停课第一天：家长群里一半在谢天谢地，一半在发愁谁看孩子',
      '中学门口贴出告示：请勿在校内聚集，校园已暂停开放',
    ],
  },
  {
    id: 'hospital', icon: ICON.hospital, when: (s) => s.govOrders && s.govOrders.hospitalClosed,
    lines: () => [
      '医院停止收治：门口贴出「本院已满，请前往其他医疗机构」',
      '急诊科医生：走廊里全是人，我们已经没有床位，也没有药',
      '护士站的排班表被划掉了大半——有人请假，也有人再没回来',
    ],
  },
  {
    id: 'curfew', icon: ICON.curfew, when: (s) => s.govOrders && s.govOrders.curfew,
    lines: () => [
      '宵禁令生效：晚八点后非必要不得外出，违者将被强制带离',
      '宵禁第一夜：街道空旷，只有巡逻车的灯光划过',
      '便利店改成「窗口营业」，老板说「别进来，递钱就行」',
    ],
  },
  {
    id: 'army', icon: ICON.army, when: (s) => s.govOrders && s.govOrders.cd && s.govOrders.cd.guard > 0,
    lines: () => [
      '军方车队进入市区，装甲车停在医院门口，市民围观拍照',
      '国防部：已派出部队协助维持秩序，请市民配合检查',
      '有士兵在路边分发瓶装水，孩子隔着铁马向他们挥手',
    ],
  },
  {
    id: 'purge', icon: ICON.army, when: (s) => s.chaos >= 85,
    lines: () => [
      '传政府已下达「清剿」命令：目击者称医院方向传来持续枪声',
      '匿名官员：为了阻断传播，有些决定不会写进会议记录',
      '附近居民：枪声响了十几分钟，然后就没动静了，也没人出来解释',
    ],
  },
  {
    id: 'evac', icon: ICON.evacuate, when: (s) => s.govOrders && s.govOrders.evacuate,
    lines: () => [
      '全城撤离令发布：出城方向车辆排起数十公里长队',
      '广播循环播放：请携带证件与饮水，沿主干道有序撤离',
      '加油站已经限额，每人只能加十升，队伍还在往后延',
    ],
  },
  {
    id: 'vip', icon: ICON.vip, when: (s) => (s.vipDeaths || 0) > 0,
    lines: () => [
      '要员遇难：官方尚未证实，但市政厅已降半旗',
      '消息人士：车队在撤离途中遭遇袭击，随行人员无一生还',
    ],
  },
  {
    id: 'calm', icon: ICON.calm, when: (s) => s.chaos <= 12 && s.time > 600,
    lines: () => [
      '局势趋稳：部分商铺重新开门，街上行人明显增多',
      '专家提醒：不要放松警惕，病毒仍在人群中传播',
      '公交恢复部分线路，司机说「路面终于不像昨天那样了」',
    ],
  },
  {
    id: 'late', icon: ICON.radio, when: (s) => s.stats.dead >= 500,
    lines: () => [
      '城市已不适合居住：自来水停供第三天，垃圾在街角堆成小山',
      '电台最后一次播音：如果你听到这段广播，请向城北方向走',
    ],
  },
];

/* ---------------- 氛围句（循环） ---------------- */
const IDLE = [
  ['🌤️', '天气：多云转阴，气温 14℃，能见度一般'],
  ['🚦', '交通：主干道多处封闭，公交线路临时调整'],
  ['🏠', '有市民在阳台挂出「我们还在这里」的床单'],
  ['🍷', '谣言：有人说喝高度酒能防感染，专家再次辟谣'],
  ['🐕', '宠物收容所爆满，志愿者呼吁领养代替购买'],
  ['🍜', '外卖平台骑手大量缺勤，部分区域已暂停配送'],
  ['💡', '停电通知：城西片区今晚 20:00–23:00 检修'],
  ['📻', '电台热线被打爆：主持人反复提醒「不要挤在同一个地方」'],
  ['🏥', '药店门口贴出手写告示：退烧药、酒精、绷带，全部售罄'],
  ['🧻', '日用品抢购潮：卫生纸、瓶装水、打火机成了硬通货'],
  ['🚌', '末班公交提前两小时收车，司机说「不敢在外面待到天黑」'],
  ['📱', '手机信号时断时续，运营商称基站供电不稳'],
  ['🏫', '学校体育馆被征用为临时安置点，门口排起了队'],
  ['🔦', '五金店的手电筒和蜡烛卖光，老板在补货'],
  ['🚧', '部分路口被私家车堵死，居民自发设卡盘问来往车辆'],
  ['🩺', '社区诊所排起长队，护士说「大部分只是感冒，但他们都很怕」'],
  ['🐈', '有人把猫装进背包撤离，安检口吵了一架'],
  ['📰', '晨报头版只有一句话：请保持冷静'],
  ['🎙️', '记者在街头随机采访，十个人里有七个说「不信官方通报」'],
  ['🥫', '社区自发组织分发罐头，登记表上写满了门牌号'],
  ['🚗', '出城方向堵成停车场，有人干脆下车走路'],
  ['⛽', '加油站只收现金，队伍从路口排到下一个街口'],
  ['🏚️', '老城区的几栋楼被贴了封条，居民在楼下不肯走'],
  ['📞', '电话线路拥堵，通讯公司建议改用短信'],
  ['🧯', '消防队忙着处理无人照看的火情，队长说「人比火还难救」'],
  ['🌧️', '夜里下了小雨，街上的血迹被冲淡了一些'],
  ['🎒', '有人背着登山包往城外走，说「先走一步，总比留下强」'],
  ['👮', '巡逻警车用喇叭喊话：请回家，锁门，不要开窗'],
  ['📉', '股市连续第三日停牌，交易大厅空无一人'],
  ['🚑', '救护车在路口被围住，司机按了十分钟喇叭才挤出去'],
  ['🕯️', '有人在广场点起蜡烛，说是给还没回来的人'],
  ['🎺', '教堂的钟敲了三次，没人知道是谁安排的'],
  ['🧊', '冷柜里的东西没人敢碰，超市干脆整排拉下了卷帘门'],
  ['📦', '快递停在分拣中心，仓库管理员说「没人来上班了」'],
  ['🚲', '共享单车被骑到城外，堆在出城的路肩上'],
  ['🪧', '有人把寻人启事贴在电线杆上，照片被雨打湿了'],
  ['🧴', '消毒液的价格翻了四倍，还是有人买'],
  ['🔋', '充电宝成了硬通货，能换两瓶水'],
  ['🍞', '面包店只开到上午十点，老板说「卖完就关，我也要回家」'],
  ['🚿', '自来水有异味，居民开始排队接消防栓的水'],
  ['🎧', '有人整夜戴着耳机，说「不想听见外面的声音」'],
  ['🧸', '失物招领处堆满儿童玩具，没人来认领'],
  ['🕰️', '钟楼停了，没人上去修'],
  ['🌫️', '清晨起雾，能见度不到五十米'],
  ['🪟', '沿街的窗户一扇扇关上，然后是拉窗帘的声音'],
  ['🔔', '门铃响了三下，开门却没人——邻居说是风'],
  ['🧟', '有人坚持说「那些不是人」，帖子几分钟后就被删了'],
  ['🩸', '街角的自助洗衣店地上有大片暗色痕迹'],
  ['🚨', '警报器在半夜自己响了，响了整整一小时才停'],
  ['📵', '部分区域彻底断网，运营商无法给出恢复时间'],
  ['🛏️', '旅馆房间被抢空，前台说「走廊里都有人打地铺」'],
  ['🍺', '酒吧照常营业，老板说「反正也没别的地方可去」'],
  ['🚪', '有人用家具把楼道堵死，邻居在群里吵了一整天'],
  ['🧯', '消防通道被杂物堵住，物业说「先顾眼前吧」'],
  ['📷', '有人架起相机拍街景，说「总得留点记录」'],
  ['🎬', '电影院照常放片，全场只有三个观众'],
  ['🧾', '超市开始只收现金，扫码支付「系统维护中」'],
  ['🛡️', '有社区自发组织巡逻队，袖标是红布缝的'],
  ['🚛', '一辆运货卡车被拦在路口，司机说「我也不知道该往哪开」'],
];

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'news';
  root.innerHTML = `<span class="news-tag">快讯</span>`
    + `<span class="news-ic" id="news-ic">📰</span>`
    + `<div class="news-view"><span id="news-text"></span></div>`
    + `<span class="news-hint">历史</span>`
    + `<div class="news-log hidden" id="news-log"></div>`;
  document.body.appendChild(root);
  view = root.querySelector('.news-view');
  span = root.querySelector('#news-text');
  logBox = root.querySelector('#news-log');
  root.addEventListener('click', () => toggleLog());
  return root;
}

function toggleLog() {
  const open = logBox.classList.contains('hidden');
  logBox.classList.toggle('hidden', !open);
  if (open) renderLog();
}

function renderLog() {
  if (!history.length) { logBox.innerHTML = '<div class="nl-empty">还没有快讯</div>'; return; }
  logBox.innerHTML = history.map((h) =>
    `<div class="nl-row"><i>${h.icon}</i><span>${h.text}</span><b>${h.t}</b></div>`).join('');
}

/** 往队列里塞一条（icon 省略时沿用当前题材） */
export function pushNews(text, icon) {
  if (!text) return;
  const ic = icon || currentIcon || '📰';
  history.unshift({ icon: ic, text, t: clockNow() });
  if (history.length > HISTORY_MAX) history.pop();
  if (logBox && !logBox.classList.contains('hidden')) renderLog();
  queue.push({ text, icon: ic });
  if (queue.length > 12) queue.shift();
  if (!playing) next();
}

function clockNow() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function next() {
  if (!queue.length) { playing = false; return; }
  playing = true;
  const item = queue.shift();
  currentIcon = item.icon;
  const ic = root.querySelector('#news-ic');
  if (ic) ic.textContent = item.icon;
  span.textContent = item.text;
  const w = view.clientWidth || 600;
  const len = span.scrollWidth || item.text.length * 13;
  const dur = Math.max(8, (w + len) / 115);     // 115px/秒
  span.style.transition = 'none';
  span.style.transform = `translateX(${w}px)`;
  void span.offsetWidth;
  span.style.transition = `transform ${dur}s linear`;
  span.style.transform = `translateX(${-len - 8}px)`;
  clearTimeout(span._t);
  span._t = setTimeout(() => {
    if (queue.length) next();
    else playing = false;
  }, dur * 1000 + 60);
}

function poll(sim) {
  for (const st of STORIES) {
    if (fired.has(st.id)) continue;
    let ok = false;
    try { ok = !!st.when(sim); } catch { ok = false; }
    if (!ok) continue;
    fired.add(st.id);
    currentIcon = st.icon;
    for (const line of st.lines(sim)) pushNews(line, st.icon);
  }
  if (queue.length === 0 && sim.time - lastShown > 45) {
    lastShown = sim.time;
    const [ic, text] = IDLE[idleIdx % IDLE.length];
    idleIdx++;
    pushNews(text, ic);
  }
}

export function initNews(sim, cityNames) {
  simRef = sim;
  if (cityNames) CITY = cityNames;
  ensure();
  fired = new Set();
  queue = [];
  playing = false;
  idleIdx = 0;
  history.length = 0;
  lastShown = sim.time;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!simRef) return;
    poll(simRef);
  }, 1500);
  pushNews(`${CITY.full}：又是平常的一天。`, '🏙️');
}

export function resetNews(sim, cityNames) {
  simRef = sim;
  if (cityNames) CITY = cityNames;
  fired = new Set();
  queue = [];
  playing = false;
  idleIdx = 0;
  history.length = 0;
  lastShown = sim.time;
  if (logBox) { logBox.classList.add('hidden'); renderLog(); }
}
