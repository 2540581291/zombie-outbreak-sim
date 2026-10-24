// ============================================================
//  政府行动（只读）：政府 / 警察 / 医院 / 学校 四个大栏
//
//  这不是"操作面板"——玩家没有任何权限下命令。
//  机构的行为全部由 sim.updateGov() 按条件自动触发：
//    混乱度 / 感染率 / 医院压力 达到门槛 → 停课、停止收治、疏散、回局、
//    派兵进驻、清剿 ……
//  这个面板只做三件事：
//    1. 看编制与现状（在岗 / 死亡 / 感染 / 撤离）
//    2. 看**谁在外面、去哪、还有多远**（按名字列出来）
//    3. 看最近发生了什么决策、因为什么
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

/** 在外执勤名单：名字 → 目的地 · 还有多远 */
function roster(list, sim, max) {
  if (!list.length) return `<div class="gv-empty">暂时没有人被派出去</div>`;
  const rows = list.slice(0, max).map((d) => {
    const nm = shortName(d.i, sim);
    const tag = d.soldier ? '士兵' : '警员';
    return `<li><i class="gv-pip ${d.soldier ? 'sol' : 'pol'}"></i>`
      + `<b>${tag} ${nm}</b><span>→ ${d.dest}</span>`
      + `<em>${d.dist < 20 ? '已到达' : '还有 ' + Math.round(d.dist) + 'm'}</em></li>`;
  }).join('');
  const more = list.length > max ? `<li class="gv-more">…另有 ${list.length - max} 人</li>` : '';
  return `<ul class="gv-roster">${rows}${more}</ul>`;
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
  const polDuties = d.duties.filter((x) => !x.soldier);
  const solDuties = d.duties.filter((x) => x.soldier);
  const pct = (n, t) => (t ? Math.round((n / t) * 100) + '%' : '—');
  const dur = (since) => (since ? '（' + clock(now - since) + '）' : '');

  const govCard = card('政府', 'info', '自动决策 · 只看不下令',
    row('编制', d.gov.total.toLocaleString() + ' 人')
    + row('在岗', d.gov.atPost.toLocaleString() + ' 人')
    + row('街上', d.gov.street.toLocaleString() + ' 人')
    + row('死亡', d.gov.dead.toLocaleString() + ' 人', d.gov.dead ? 'bad' : '')
    + row('感染/转化', d.gov.infected.toLocaleString() + ' 人', d.gov.infected ? 'warn' : '')
    + row('已撤离', d.gov.saved.toLocaleString() + ' 人')
    + row('混乱度', (sim.chaos || 0).toFixed(0) + '/100')
    + row('军队在外', solDuties.length.toLocaleString() + ' 人', solDuties.length ? 'warn' : ''),
    `<div class="gv-subtitle">军队部署（${solDuties.length}）</div>` + roster(solDuties, sim, 6));

  const polCard = card('警察', 'civ', '自动出警 · 到点即撤',
    row('总警力', d.police.total.toLocaleString() + ' 人')
    + row('在位', d.police.alive.toLocaleString() + ' 人')
    + row('驻局待命', d.police.atPost.toLocaleString() + ' 人')
    + row('街上', d.police.street.toLocaleString() + ' 人')
    + row('阵亡', d.police.dead.toLocaleString() + ' 人', d.police.dead ? 'bad' : '')
    + row('警察局', d.police.stations + ' 处')
    + row('清剿中', d.purge.toLocaleString() + ' 人', d.purge ? 'warn' : '')
    + row('击毙丧尸', (st.kills || 0).toLocaleString() + ' 只'),
    `<div class="gv-subtitle">在外执勤（${polDuties.length}）</div>` + roster(polDuties, sim, 8));

  const hospCard = card('医院', 'inf', '救人，也聚集传染',
    row('医护编制', d.hosp.total.toLocaleString() + ' 人')
    + row('在岗', d.hosp.atPost.toLocaleString() + ' 人')
    + row('死亡', d.hosp.dead.toLocaleString() + ' 人', d.hosp.dead ? 'bad' : '')
    + row('感染/转化', d.hosp.infected.toLocaleString() + ' 人', d.hosp.infected ? 'warn' : '')
    + row('已撤离', d.hosp.saved.toLocaleString() + ' 人')
    + row('正在前往的病人', d.patients.toLocaleString() + ' 人', d.patients ? 'warn' : '')
    + row('院内病人（40m）', (d.patientsInside || 0).toLocaleString() + ' 人')
    + row('收治状态', o.hospitalClosed ? '已停止收治' + dur(o.hospSince) : '正常收治',
      o.hospitalClosed ? 'warn' : 'ok'));

  const schCard = card('学校', 'zomb', '人群聚集 = 传播加速',
    row('教职工与学生', d.school.total.toLocaleString() + ' 人')
    + row('在校', d.school.atPost.toLocaleString() + ' 人')
    + row('死亡', d.school.dead.toLocaleString() + ' 人', d.school.dead ? 'bad' : '')
    + row('感染/转化', d.school.infected.toLocaleString() + ' 人', d.school.infected ? 'warn' : '')
    + row('已撤离', d.school.saved.toLocaleString() + ' 人')
    + row('学校', d.school.pois + ' 处')
    + row('在校占比', pct(d.school.atPost, d.school.alive))
    + row('上课状态', o.schoolClosed ? '已停课' + dur(o.schoolSince) : '正常上课',
      o.schoolClosed ? 'warn' : 'ok'));

  el.querySelector('#gv-grid').innerHTML = govCard + polCard + hospCard + schCard;

  el.querySelector('#gv-sub').textContent =
    `第 ${Math.floor(now / 1440) + 1} 天 ${clock(now % 1440)} · 混乱 ${(sim.chaos || 0).toFixed(0)}`
    + ` · 平民 ${(st.civ || 0).toLocaleString()} · 丧尸 ${(st.zombie || 0).toLocaleString()}`;

  const logs = (d.log || []).slice(0, 3);
  el.querySelector('#gv-foot').innerHTML = logs.length
    ? '最近决策：' + logs.map((l) => `<b>${clock(l.t)}</b> ${l.text}`).join(' ｜ ')
    : '还没有触发任何政府决策（混乱度与感染率都没到门槛）。';
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
