// ============================================================
//  新闻跑马灯（风味文字）
//
//  设计：
//   · 文案由**真实局势**触发（感染数、死亡、混乱度、宵禁、停课、停收、
//     军队、清剿、撤离令、警局沦陷、要员死亡……），不是随机乱播；
//   · 每条只播一次（剧情推进感），重复性的事件走"每 N 秒一条"的循环池；
//   · 完全不碰 sim 的随机数，用自己的计数轮换 → 不影响确定性。
// ============================================================

let root = null;
let view = null;
let span = null;
let queue = [];
let playing = false;
let simRef = null;
let pollT = 0;
let fired = new Set();
let idleIdx = 0;
let lastShown = 0;

const CITY = '本市';

/** 一句话文案库：条件 + 文本（可以用当前局势拼数字） */
const STORIES = [
  {
    id: 'first', when: (s) => s.stats.infected + s.stats.zombie >= 1,
    lines: () => [
      `${CITY}晨报：市立医院接诊一名「行为异常」患者，院方称正在观察`,
      '目击者称昨晚有人在中央车站附近突然倒地抽搐，警方已封锁现场',
    ],
  },
  {
    id: 'spread', when: (s) => s.awareRate > 0.12,
    lines: () => [
      '卫生部通报：多家医院报告同类病例，专家称「尚无可防可控的结论」',
      '社交平台上「咬人视频」播放量破百万，官方提醒不信谣不传谣',
    ],
  },
  {
    id: 'panic_buy', when: (s) => s.chaos >= 18,
    lines: () => [
      '超市货架被抢空：矿泉水、罐头、电池最先告罄',
      '加油站排起长队，有市民带着汽油桶前来',
      '银行门口出现挤兑，工作人员称「系统正常，请勿恐慌」',
    ],
  },
  {
    id: 'deaths', when: (s) => s.stats.dead >= 10,
    lines: (s) => [
      `死亡人数升至 ${s.stats.dead} 人，市殡仪馆表示「已经排到下周」`,
      '太平间告急：多家医院把会议室临时改成停尸间',
    ],
  },
  {
    id: 'zombies_seen', when: (s) => s.stats.zombie >= 30,
    lines: (s) => [
      `警方确认：街头已出现 ${s.stats.zombie} 名「攻击性人员」，请市民远离`,
      '市民拍到成群人影在街道上游荡，画面中有人被围住',
    ],
  },
  {
    id: 'police_fallen', when: (s) => s.stationFallen && s.stationFallen.some((v) => v),
    lines: () => [
      '警局失守：有派出所被围，增援迟迟未到，警员家属在门口等候消息',
      '一线警员：我们弹匣打空了，请求支援——录音在网上流传',
    ],
  },
  {
    id: 'school', when: (s) => s.govOrders && s.govOrders.schoolClosed,
    lines: () => [
      '教育局紧急通知：全市学校停课，复课时间另行通知',
      '停课第一天：家长群里一半在谢天谢地，一半在发愁谁看孩子',
    ],
  },
  {
    id: 'hospital', when: (s) => s.govOrders && s.govOrders.hospitalClosed,
    lines: () => [
      '医院停止收治：门口贴出「本院已满，请前往其他医疗机构」',
      '急诊科医生：走廊里全是人，我们已经没有床位，也没有药',
    ],
  },
  {
    id: 'curfew', when: (s) => s.govOrders && s.govOrders.curfew,
    lines: () => [
      '宵禁令生效：晚八点后非必要不得外出，违者将被强制带离',
      '宵禁第一夜：街道空旷，只有巡逻车的灯光划过',
    ],
  },
  {
    id: 'army', when: (s) => s.govOrders && s.govOrders.cd && s.govOrders.cd.guard > 0,
    lines: () => [
      '军方车队进入市区，装甲车停在医院门口，市民围观拍照',
      '国防部：已派出部队协助维持秩序，请市民配合检查',
    ],
  },
  {
    id: 'purge', when: (s) => s.chaosHeat && s.chaosHeat.vip >= 0 && s.chaos >= 85,
    lines: () => [
      '传政府已下达「清剿」命令：目击者称医院方向传来持续枪声',
      '匿名官员：为了阻断传播，有些决定不会写进会议记录',
    ],
  },
  {
    id: 'evac', when: (s) => s.govOrders && s.govOrders.evacuate,
    lines: () => [
      '全城撤离令发布：出城方向车辆排起数十公里长队',
      '广播循环播放：请携带证件与饮水，沿主干道有序撤离',
    ],
  },
  {
    id: 'vip', when: (s) => (s.vipDeaths || 0) > 0,
    lines: () => [
      '要员遇难：官方尚未证实，但市政厅已降半旗',
      '消息人士：车队在撤离途中遭遇袭击，随行人员无一生还',
    ],
  },
  {
    id: 'calm', when: (s) => s.chaos <= 12 && s.time > 600,
    lines: () => [
      '局势趋稳：部分商铺重新开门，街上行人明显增多',
      '专家提醒：不要放松警惕，病毒仍在人群中传播',
    ],
  },
  {
    id: 'late', when: (s) => s.stats.dead >= 500,
    lines: () => [
      '城市已不适合居住：自来水停供第三天，垃圾在街角堆成小山',
      '电台最后一次播音：如果你听到这段广播，请向城北方向走',
    ],
  },
];

/** 没有新事件时的氛围句（循环播放） */
const IDLE = [
  '天气：多云转阴，气温 14℃，能见度一般',
  '交通：主干道多处封闭，公交线路临时调整',
  '有市民在阳台挂出「我们还在这里」的床单',
  '谣言：有人说喝高度酒能防感染，专家再次辟谣',
  '宠物收容所爆满，志愿者呼吁领养代替购买',
  '外卖平台骑手大量缺勤，部分区域已暂停配送',
  '停电通知：城西片区今晚 20:00–23:00 检修',
];

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'news';
  root.innerHTML = `<span class="news-tag">快讯</span>`
    + `<div class="news-view"><span id="news-text"></span></div>`;
  document.body.appendChild(root);
  view = root.querySelector('.news-view');
  span = root.querySelector('#news-text');
  return root;
}

/** 往队列里塞一条 */
export function pushNews(text) {
  if (!text) return;
  queue.push(text);
  if (queue.length > 12) queue.shift();
  if (!playing) next();
}

function next() {
  if (!queue.length) { playing = false; return; }
  playing = true;
  const text = queue.shift();
  span.textContent = text;
  const w = view.clientWidth || 600;
  const len = span.scrollWidth || text.length * 13;
  const dur = Math.max(8, (w + len) / 115);     // 115px/秒
  span.style.transition = 'none';
  span.style.transform = `translateX(${w}px)`;
  // 强制重排后再启动过渡
  void span.offsetWidth;
  span.style.transition = `transform ${dur}s linear`;
  span.style.transform = `translateX(${-len - 8}px)`;
  span.dataset.dur = String(dur);
  clearTimeout(span._t);
  span._t = setTimeout(() => {
    if (queue.length) next();
    else playing = false;
  }, dur * 1000 + 60);
}

/** 判断剧情是否触发（每条只播一次） */
function poll(sim) {
  const s = sim;
  for (const st of STORIES) {
    if (fired.has(st.id)) continue;
    let ok = false;
    try { ok = !!st.when(s); } catch { ok = false; }
    if (!ok) continue;
    fired.add(st.id);
    const lines = st.lines(s) || [];
    // 一条一条播，间隔由队列自然隔开
    for (const line of lines) pushNews(line);
  }
  // 长时间没有新剧情 → 播氛围句
  if (queue.length === 0 && s.time - lastShown > 45) {
    lastShown = s.time;
    pushNews(IDLE[idleIdx % IDLE.length]);
    idleIdx++;
  }
}

let timer = null;

export function initNews(sim) {
  simRef = sim;
  ensure();
  fired = new Set();
  queue = [];
  playing = false;
  idleIdx = 0;
  lastShown = sim.time;
  pollT = 0;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!simRef) return;
    poll(simRef);
  }, 1500);
  // 开局先来一条
  pushNews('本地时间 ' + (sim.startMin != null ? '07:30' : '') + '：又是平常的一天。');
}

export function resetNews(sim) {
  simRef = sim;
  fired = new Set();
  queue = [];
  playing = false;
  idleIdx = 0;
  lastShown = sim.time;
}
