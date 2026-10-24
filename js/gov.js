// ============================================================
//  政府行动面板：政府 / 警察 / 医院 / 学校 四个大栏
//
//  每一栏 = 「编制与现状」+「可下达的行动」。
//  所有"派人"的动作都走 sim.dispatchTo()：
//    警察从最近的警局抽调（不凭空生成）
//    士兵从政府大楼门口刷出来，再走过去
//  所以"派军队去医院"和"派警察去医院"只有出发点不同，链路完全一致。
// ============================================================
let root = null;
let timer = null;
let curSim = null;

const $ = (id) => (root ? root.querySelector('#' + id) : null);

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'govpanel';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="gv-card">
      <div class="gv-head">
        <b>政府行动</b>
        <span class="gv-sub" id="gv-sub">—</span>
        <button id="gv-close" title="关闭（Esc）">✕</button>
      </div>
      <div class="gv-grid" id="gv-grid"></div>
      <div class="gv-foot" id="gv-foot">提示：所有派遣都是"先到出发点集合，再走过去"，不会瞬移。</div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#gv-close').onclick = closeGov;
  root.addEventListener('click', (e) => { if (e.target === root) closeGov(); });
  return root;
}

const row = (k, v, cls) => `<div class="gv-row ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
const act = (id, label, cls) =>
  `<button class="gv-act ${cls || ''}" data-act="${id}">${label}</button>`;

// ---------- 四个大栏 ----------
function card(key, title, dot, stats, actions, note) {
  return `<div class="gv-sec" data-key="${key}">
    <div class="gv-title"><i class="dot ${dot}"></i><span>${title}</span><em>${note || ''}</em></div>
    <div class="gv-stats">${stats}</div>
    <div class="gv-acts">${actions}</div>
  </div>`;
}

function build(sim) {
  const d = sim.govDetail();
  const P = sim.poiByKind;
  const hosp = (P.hospital || [])[0];
  const school = (P.school || [])[0];
  const gov = (P.gov || [])[0];
  curSim = sim;

  const pct = (n, t) => (t ? ((n / t) * 100).toFixed(0) + '%' : '—');
  const s = sim.stats || {};

  const govCard = card('gov', '政府', 'info',
    row('编制', d.gov.total.toLocaleString() + ' 人')
    + row('在岗', d.gov.atPost.toLocaleString() + ' 人')
    + row('街上', d.gov.street.toLocaleString() + ' 人')
    + row('死亡', d.gov.dead.toLocaleString() + ' 人', d.gov.dead ? 'bad' : '')
    + row('感染/转化', d.gov.infected.toLocaleString() + ' 人', d.gov.infected ? 'warn' : '')
    + row('已撤离', d.gov.saved.toLocaleString() + ' 人')
    + row('政府大楼', d.gov.pois + ' 处')
    + row('混乱度', (sim.chaos || 0).toFixed(0) + '/100'),
    act('gov-soldier-hosp', '派兵去医院（8 人）', 'go')
    + act('gov-purge-hosp', '清剿医院（军 10 人）', 'danger')
    + act('gov-soldier-school', '派兵去学校（6 人）')
    + act('gov-soldier-police', '派兵去警局（6 人）'),
    '极端手段都在这里');

  const polCard = card('police', '警察', 'civ',
    row('总警力', d.police.total.toLocaleString() + ' 人')
    + row('在位', d.police.alive.toLocaleString() + ' 人')
    + row('驻局待命', d.police.atPost.toLocaleString() + ' 人')
    + row('街上（巡逻/出勤/护送）', d.police.street.toLocaleString() + ' 人')
    + row('阵亡', d.police.dead.toLocaleString() + ' 人', d.police.dead ? 'bad' : '')
    + row('警察局', d.police.stations + ' 处')
    + row('清剿中', d.purge.toLocaleString() + ' 人', d.purge ? 'warn' : '')
    + row('击毙丧尸', (s.kills || 0).toLocaleString() + ' 只'),
    act('pol-home', '全员回局待命', 'go')
    + act('pol-hosp', '派人去医院执勤（8 人）')
    + act('pol-school', '派人去学校（6 人）')
    + act('pol-gov', '派人去政府（4 人）'),
    '命令谁去什么地方');

  const hospCard = card('hosp', '医院', 'inf',
    row('医护编制', d.hosp.total.toLocaleString() + ' 人')
    + row('在岗', d.hosp.atPost.toLocaleString() + ' 人')
    + row('死亡', d.hosp.dead.toLocaleString() + ' 人', d.hosp.dead ? 'bad' : '')
    + row('感染/转化', d.hosp.infected.toLocaleString() + ' 人', d.hosp.infected ? 'warn' : '')
    + row('已撤离', d.hosp.saved.toLocaleString() + ' 人')
    + row('正在前往的病人', d.patients.toLocaleString() + ' 人', d.patients ? 'warn' : '')
    + row('院内病人（40m 内）', (d.patientsInside || 0).toLocaleString() + ' 人')
    + row('医院', d.hosp.pois + ' 处')
    + row('收治状态', sim.govOrders.hospitalClosed ? '已停止收治' : '正常收治',
      sim.govOrders.hospitalClosed ? 'warn' : 'ok'),
    act('hosp-toggle', sim.govOrders.hospitalClosed ? '恢复收治' : '停止收治', 'go')
    + act('hosp-evac', '疏散全部病患')
    + act('hosp-guard', '派军队守卫（6 人）'),
    '救人，也聚集传染');

  const schCard = card('school', '学校', 'zomb',
    row('教职工与学生', d.school.total.toLocaleString() + ' 人')
    + row('在校', d.school.atPost.toLocaleString() + ' 人')
    + row('死亡', d.school.dead.toLocaleString() + ' 人', d.school.dead ? 'bad' : '')
    + row('感染/转化', d.school.infected.toLocaleString() + ' 人', d.school.infected ? 'warn' : '')
    + row('已撤离', d.school.saved.toLocaleString() + ' 人')
    + row('学校', d.school.pois + ' 处')
    + row('在校占比', pct(d.school.atPost, d.school.alive))
    + row('上课状态', sim.govOrders.schoolClosed ? '已停课' : '正常上课',
      sim.govOrders.schoolClosed ? 'warn' : 'ok'),
    act('sch-toggle', sim.govOrders.schoolClosed ? '复课' : '停课放假', 'go')
    + act('sch-police', '派警察维持秩序（4 人）')
    + act('sch-soldier', '派兵封锁校园（6 人）'),
    '人群聚集 = 传播加速');

  return {
    html: govCard + polCard + hospCard + schCard,
    d, hosp, school, gov,
  };
}

function doAction(id) {
  const sim = curSim;
  if (!sim) return;
  const P = sim.poiByKind;
  const hosp = (P.hospital || [])[0];
  const school = (P.school || [])[0];
  const gov = (P.gov || [])[0];
  const pol = (P.police || [])[0];
  const goto = (poi) => (poi ? [poi.x, poi.z] : null);

  switch (id) {
    case 'gov-soldier-hosp': {
      const t = goto(hosp) || goto(pol);
      if (t) { sim.dispatchTo('soldier', t[0], t[1], 8); sim.pushEvent('政府：派 8 名士兵前往医院', 'start'); }
      break;
    }
    case 'gov-purge-hosp': {
      const t = goto(hosp);
      if (t) sim.orderPurge(t[0], t[1], 10, false);
      break;
    }
    case 'gov-soldier-school': {
      const t = goto(school) || goto(pol);
      if (t) { sim.dispatchTo('soldier', t[0], t[1], 6); sim.pushEvent('政府：派 6 名士兵前往学校', 'start'); }
      break;
    }
    case 'gov-soldier-police': {
      const t = goto(pol) || goto(gov);
      if (t) { sim.dispatchTo('soldier', t[0], t[1], 6); sim.pushEvent('政府：派 6 名士兵前往警局', 'start'); }
      break;
    }
    case 'pol-home': sim.orderPoliceHome(); break;
    case 'pol-hosp': { const t = goto(hosp); if (t) sim.dispatchTo('police', t[0], t[1], 8); break; }
    case 'pol-school': { const t = goto(school); if (t) sim.dispatchTo('police', t[0], t[1], 6); break; }
    case 'pol-gov': { const t = goto(gov); if (t) sim.dispatchTo('police', t[0], t[1], 4); break; }
    case 'hosp-toggle': sim.setHospitalClosed(!sim.govOrders.hospitalClosed); break;
    case 'hosp-evac': sim.clearPatients(); break;
    case 'hosp-guard': { const t = goto(hosp); if (t) sim.dispatchTo('soldier', t[0], t[1], 6); break; }
    case 'sch-toggle': sim.setSchoolClosed(!sim.govOrders.schoolClosed); break;
    case 'sch-police': { const t = goto(school); if (t) sim.dispatchTo('police', t[0], t[1], 4); break; }
    case 'sch-soldier': { const t = goto(school); if (t) sim.dispatchTo('soldier', t[0], t[1], 6); break; }
    default: return;
  }
  tick();
}

function tick() {
  if (!curSim) return;
  const el = ensure();
  const built = build(curSim);
  const grid = el.querySelector('#gv-grid');
  grid.innerHTML = built.html;
  grid.querySelectorAll('.gv-act').forEach((b) => {
    b.onclick = () => doAction(b.dataset.act);
  });
  el.querySelector('#gv-sub').textContent =
    `第 ${Math.floor(curSim.time / 1440) + 1} 天 · 混乱 ${(curSim.chaos || 0).toFixed(0)} · 平民 ${(curSim.stats.civ || 0).toLocaleString()} · 丧尸 ${(curSim.stats.zombie || 0).toLocaleString()}`;
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

export function isGovOpen() { return !!root && !root.classList.contains('hidden'); }
