// ============================================================
//  政府行动（只读）
//
//  玩家没有任何操作权限：机构的行为全部由 sim.updateGov() 按条件自动触发
//  （混乱度 / 感染率 / 医院压力 / 时间窗口）。
//  这个面板只负责"看"：
//    1. 局势概览 + 60 秒趋势
//    2. 四个大栏：编制 / 在岗 / 死亡 / 感染 / 撤离
//    3. 逐个设施明细（每家医院、每所学校、每个警局）
//    4. 在外执勤名单（谁、去哪、还有多远）
//    5. 最近决策日志（什么时候、因为什么）
// ============================================================
import { shortName } from './people.js';

let root = null;
let timer = null;
let curSim = null;

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'govpanel';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="gv-card">
      <div class="gv-head">
        <b>政府行动</b>
        <span class="gv-tag">只读 · 系统自动决策</span>
        <span class="gv-sub" id="gv-sub">—</span>
        <button id="gv-close" title="关闭（Esc）">✕</button>
      </div>
      <div class="gv-banner" id="gv-banner"></div>
      <div class="gv-grid" id="gv-grid"></div>
      <div class="gv-foot" id="gv-foot"></div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#gv-close').onclick = closeGov;
  root.addEventListener('click', (e) => { if (e.target === root) closeGov(); });
  return root;
}

const row = (k, v, cls) => `<div class="gv-row ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
const clock = (t) => {
  const m = Math.max(0, Math.floor(t / 60));
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
};
const num = (n) => (n || 0).toLocaleString();
const delta = (v, unit) => {
  if (v === undefined || v === null) return '';
  const s = (v >= 0 ? '+' : '') + v.toFixed(unit === '%' ? 1 : 0) + (unit || '');
  return `<i class="gv-d ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${s}</i>`;
};

/** 设施明细行：名称 + 若干小字段 */
function fac(name, cells) {
  return `<li><b>${name}</b>${cells.map((c) => `<span>${c}</span>`).join('')}</li>`;
}

/** 在外执勤名单 */
function roster(list, sim, max) {
  if (!list.length) return `<div class="gv-empty">暂时没有人被派出去</div>`;
  const rows = list.slice(0, max).map((d) => {
    const nm = shortName(d.i, sim);
    return `<li><i class="gv-pip ${d.soldier ? 'sol' : 'pol'}"></i>`
      + `<b>${d.soldier ? '士兵' : '警员'} ${nm}</b><span>→ ${d.dest}</span>`
      + `<em>${d.dist < 20 ? '已到达' : '还有 ' + Math.round(d.dist) + 'm'}</em></li>`;
  }).join('');
  const more = list.length > max ? `<li class="gv-more">…另有 ${list.length - max} 人</li>` : '';
  return `<ul class="gv-roster">${rows}${more}</ul>`;
}

/** 迷你曲线：拿历史采样的序列画柱状 */
function spark(series, color) {
  if (!series || series.length < 2) return '<div class="gv-spark gv-spark-empty"></div>';
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = Math.max(1, hi - lo);
  return '<div class="gv-spark">' + series.map((v) => {
    const k = (v - lo) / span;                       // 0..1，按区间拉伸，波动才看得出来
    return `<i style="height:${Math.max(6, Math.round(k * 100))}%;background:${color}"></i>`;
  }).join('') + '</div>';
}

/** 政策行：名称 + 状态 */
function pol(name, on, since, now, why) {
  const state = on ? `执行中（${Math.floor(Math.max(0, now - since) / 60)}:${String(Math.floor(Math.max(0, now - since) % 60)).padStart(2, '0')}）` : '未启动';
  return `<li class="${on ? 'on' : ''}"><b>${name}</b><span>${state}</span>${why ? `<em>${why}</em>` : ''}</li>`;
}

function card(title, dot, note, stats, extra) {
  return `<div class="gv-sec">
    <div class="gv-title"><i class="dot ${dot}"></i><span>${title}</span><em>${note || ''}</em></div>
    <div class="gv-stats">${stats}</div>
    ${extra || ''}
  </div>`;
}

function tick() {
  if (!curSim) return;
  const sim = curSim;
  const el = ensure();
  const d = sim.govDetail();
  const st = sim.stats || {};
  const o = sim.govOrders || {};
  const now = sim.time;
  const tr = d.trend;
  const polDuties = d.duties.filter((x) => !x.soldier);
  const solDuties = d.duties.filter((x) => x.soldier);
  const pct = (n, t) => (t ? Math.round((n / t) * 100) + '%' : '—');
  const dur = (since) => (since ? '（' + clock(now - since) + '）' : '');

  // ---------- 顶部：局势 + 趋势 ----------
  const chips = [];
  if (d.curfew) chips.push(`<i class="gv-chip warn">宵禁中${dur(d.since.curfew)}</i>`);
  if (o.schoolClosed) chips.push(`<i class="gv-chip warn">学校停课${dur(d.since.school)}</i>`);
  if (o.hospitalClosed) chips.push(`<i class="gv-chip warn">医院停收${dur(d.since.hosp)}</i>`);
  if (d.evacuate) chips.push(`<i class="gv-chip danger">全城撤离令${dur(d.since.evac)}</i>`);
  if (d.purge > 0) chips.push(`<i class="gv-chip danger">清剿进行中 · ${d.purge} 人</i>`);
  if (!chips.length) chips.push('<i class="gv-chip ok">一切照常</i>');

  el.querySelector('#gv-banner').innerHTML =
    `<span class="gv-kv">混乱 <b>${(sim.chaos || 0).toFixed(0)}</b>${tr ? delta(tr.chaos) : ''}</span>`
    + `<span class="gv-kv">感染 <b>${((sim.infectRate || 0) * 100).toFixed(1)}%</b>${tr ? delta(tr.inf, '%') : ''}</span>`
    + `<span class="gv-kv">病人 <b>${num(d.patients)}</b>${tr ? delta(tr.patients) : ''}</span>`
    + `<span class="gv-kv">丧尸 <b>${num(st.zombie)}</b>${tr ? delta(tr.zombies) : ''}</span>`
    + `<span class="gv-kv">死亡 <b>${num(st.dead)}</b>${tr ? delta(tr.dead) : ''}</span>`
    + `<span class="gv-kv">撤离 <b>${num(st.saved)}</b></span>`
    + `<span class="gv-chips">${chips.join('')}</span>`;

  // ---------- 政府 ----------
  const govCard = card('政府', 'info', '自动决策 · 只看不下令',
    row('编制', num(d.gov.total) + ' 人')
    + row('在岗', num(d.gov.atPost) + ' 人')
    + row('街上', num(d.gov.street) + ' 人')
    + row('死亡', num(d.gov.dead) + ' 人', d.gov.dead ? 'bad' : '')
    + row('感染/转化', num(d.gov.infected) + ' 人', d.gov.infected ? 'warn' : '')
    + row('已撤离', num(d.gov.saved) + ' 人')
    + row('混乱度', (sim.chaos || 0).toFixed(0) + '/100')
    + row('军队在外', num(solDuties.length) + ' 人', solDuties.length ? 'warn' : ''),
    `<div class="gv-subtitle">当前政策</div>`
    + `<ul class="gv-pol">`
    + pol('宵禁', d.curfew, d.since.curfew, now, '混乱 ≥ 35 自动启动')
    + pol('学校停课', !!o.schoolClosed, d.since.school, now, '混乱 ≥ 25 或 感染 ≥ 5%')
    + pol('医院停收', !!o.hospitalClosed, d.since.hosp, now, '病人 ≥ 800 或 感染 ≥ 8%')
    + pol('全城撤离', !!d.evacuate, d.since.evac, now, '混乱 ≥ 85 或 感染 ≥ 25%')
    + `</ul>`
    + `<div class="gv-subtitle">局势曲线（左：病人 / 右：感染%）</div>`
    + `<div class="gv-sparks">${spark(d.history.map((h) => h.patients), '#e0b23c')}`
    + `${spark(d.history.map((h) => h.inf), '#c8452f')}</div>`
    + `<div class="gv-subtitle">政府大楼</div>`
    + `<ul class="gv-fac">${d.govs.map((g) => fac(g.name,
      ['在岗 ' + num(g.atPost), '死亡 ' + num(g.dead), '感染 ' + num(g.infected)])).join('')}</ul>`
    + `<div class="gv-subtitle">军队部署（${solDuties.length}）</div>` + roster(solDuties, sim, 6));

  // ---------- 警察 ----------
  const polCard = card('警察', 'civ', '自动出警 · 到点即撤',
    row('总警力', num(d.police.total) + ' 人')
    + row('在位', num(d.police.alive) + ' 人')
    + row('驻局待命', num(d.police.atPost) + ' 人')
    + row('街上', num(d.police.street) + ' 人')
    + row('阵亡', num(d.police.dead) + ' 人', d.police.dead ? 'bad' : '')
    + row('警察局', d.police.stations + ' 处')
    + row('清剿中', num(d.purge) + ' 人', d.purge ? 'warn' : '')
    + row('击毙丧尸', num(st.kills) + ' 只'),
    `<div class="gv-subtitle">各警局</div>`
    + `<ul class="gv-fac">${d.stations2.map((s) => fac(s.name,
      ['待命 ' + num(s.idle), '出勤 ' + num(s.onduty), '阵亡 ' + num(s.dead)]
      .concat(s.idleIds && s.idleIds.length
        ? ['在局：' + s.idleIds.map((i) => shortName(i, sim)).join('、')] : []))).join('')}</ul>`
    + `<div class="gv-subtitle">在外执勤（${polDuties.length}）</div>` + roster(polDuties, sim, 8));

  // ---------- 医院 ----------
  const hospCard = card('医院', 'inf', '救人，也聚集传染',
    row('医护编制', num(d.hosp.total) + ' 人')
    + row('在岗', num(d.hosp.atPost) + ' 人')
    + row('死亡', num(d.hosp.dead) + ' 人', d.hosp.dead ? 'bad' : '')
    + row('感染/转化', num(d.hosp.infected) + ' 人', d.hosp.infected ? 'warn' : '')
    + row('已撤离', num(d.hosp.saved) + ' 人')
    + row('正在前往的病人', num(d.patients) + ' 人', d.patients ? 'warn' : '')
    + row('院内病人（40m）', num(d.patientsInside) + ' 人')
    + row('收治状态', o.hospitalClosed ? '已停止收治' + dur(o.hospSince) : '正常收治',
      o.hospitalClosed ? 'warn' : 'ok'),
    `<div class="gv-subtitle">各医院（在岗 / 院内病人 / 死亡 / 守卫）</div>`
    + `<ul class="gv-fac">${d.hospitals.map((h) => fac(h.name,
      ['在岗 ' + num(h.atPost), '病人 ' + num(h.patients), '死亡 ' + num(h.dead),
        h.guards ? '守卫 ' + h.guards : '无守卫'])).join('')}</ul>`);

  // ---------- 学校 ----------
  const schCard = card('学校', 'zomb', '人群聚集 = 传播加速',
    row('教职工与学生', num(d.school.total) + ' 人')
    + row('在校', num(d.school.atPost) + ' 人')
    + row('死亡', num(d.school.dead) + ' 人', d.school.dead ? 'bad' : '')
    + row('感染/转化', num(d.school.infected) + ' 人', d.school.infected ? 'warn' : '')
    + row('已撤离', num(d.school.saved) + ' 人')
    + row('学校', d.school.pois + ' 处')
    + row('在校占比', pct(d.school.atPost, d.school.alive))
    + row('上课状态', o.schoolClosed ? '已停课' + dur(o.schoolSince) : '正常上课',
      o.schoolClosed ? 'warn' : 'ok'),
    `<div class="gv-subtitle">各学校（在校 / 死亡 / 感染 / 警力）</div>`
    + `<ul class="gv-fac">${d.schools.map((s) => fac(s.name,
      ['在校 ' + num(s.atPost), '死亡 ' + num(s.dead), '感染 ' + num(s.infected),
        s.police ? '警力 ' + s.police : '无警力'])).join('')}</ul>`);

  // 700ms 一次全量重绘会把滚动位置顶回去：重绘前后保存/恢复所有可滚动容器
  const scrollers = [];
  for (const n of el.querySelectorAll('*')) {
    if (n.scrollHeight > n.clientHeight + 2) scrollers.push([n, n.scrollTop]);
  }
  el.querySelector('#gv-grid').innerHTML = govCard + polCard + hospCard + schCard;

  el.querySelector('#gv-sub').textContent =
    `第 ${Math.floor(now / 1440) + 1} 天 ${clock(now % 1440)} · 平民 ${num(st.civ)}`;

  const logs = (d.log || []).slice(0, 4);
  el.querySelector('#gv-foot').innerHTML = logs.length
    ? '<span class="gv-ft">最近决策</span>' + logs.map((l) =>
      `<span class="gv-log"><b>${clock(l.t)}</b> ${l.text}</span>`).join('')
    : '<span class="gv-ft">系统消息</span><span class="gv-log">还没有触发任何政府决策（混乱度与感染率都没到门槛）</span>';
  for (const [n, top] of scrollers) n.scrollTop = top;
}

export function openGov(sim) {
  curSim = sim;
  ensure().classList.remove('hidden');
  tick();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 700);
}

export function closeGov() {
  if (root) root.classList.add('hidden');
  if (timer) { clearInterval(timer); timer = null; }
}

export function isGovOpen() { return !!root && !!root.classList.contains('hidden') === false; }
