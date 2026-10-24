// 武力 / 卫生 两个独立信息面板（分标签页）
import { shortName } from './people.js';

let root = null;
let curKind = 'force';
let curTab = 0;
let curSim = null;

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'statuspanel';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="sp-card">
      <div class="sp-head"><b id="sp-title">—</b><button id="sp-close">✕</button></div>
      <div class="sp-tabs" id="sp-tabs"></div>
      <div class="sp-body" id="sp-body"></div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#sp-close').onclick = () => root.classList.add('hidden');
  root.addEventListener('click', (e) => { if (e.target === root) root.classList.add('hidden'); });
  return root;
}

const sec = (t) => `<div class="sp-sec">${t}</div>`;
const row = (k, v, cls) =>
  `<div class="sp-row ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
const bar = (v, max, color) =>
  `<div class="sp-bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(0)}%;background:${color}"></i></div>`;
const big = (v, unit) => `<div class="sp-big"><b>${v}</b><small>${unit || ''}</small></div>`;

// ---------------- 武力（不分标签，两栏一次铺开）----------------
const fmt = (n) => (n || 0).toLocaleString();

/** 迷你柱状：给"击杀/分钟"这种序列用 */
function spark(series, color) {
  if (!series || series.length < 2) return '<div class="fw-spark fw-spark-empty">采样中…</div>';
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = Math.max(1, hi - lo);
  return '<div class="fw-spark">' + series.map((v) => {
    const k = (v - lo) / span;
    return `<i style="height:${Math.max(6, Math.round(k * 100))}%;background:${color}"></i>`;
  }).join('') + '</div>';
}

/** 一个警局：人员分布 + 军械库（弹药条 + 按枪种明细） */
function stationCard(s) {
  const col = s.ammoLeft >= 0.6 ? '#7ed07e' : s.ammoLeft >= 0.25 ? '#e0b23c' : '#e8503a';
  const rows = s.rows.length
    ? s.rows.map((r) => {
      const pctA = r.initAmmo ? Math.round((r.ammo / r.initAmmo) * 100) : 100;
      const colA = pctA >= 60 ? '#7ed07e' : pctA >= 25 ? '#e0b23c' : '#e8503a';
      return `<div class="st-row"><span>${r.name}</span>`
        + `<b>${r.n} 支</b><em>${fmt(r.ammo)}${r.initAmmo && r.initAmmo !== r.ammo ? ' / ' + fmt(r.initAmmo) : ''} 发</em>`
        + `<div class="st-typebar"><i style="width:${pctA}%;background:${colA}"></i></div></div>`;
    }).join('')
    : '<div class="st-row"><span>仓库已空</span></div>';
  const takenRow = s.taken && s.taken.ammo > 0
    ? `<div class="st-meta"><span class="st-taken">被取走 ${fmt(s.taken.ammo)} 发（警员 ${fmt(s.taken.cop)} · 平民 ${fmt(s.taken.civ)}）</span><span>枪 ${s.taken.guns} 支</span></div>`
    : '';
  const curve = (s.hist && s.hist.length >= 2)
    ? `<div class="st-curve">${spark(s.hist, col)}</div>` : '';
  return `<div class="st-card" data-x="${Math.round(s.x)}" data-z="${Math.round(s.z)}" title="点击把镜头移到这个警局">
    <div class="st-head"><b>${s.name}</b>
      <span class="st-people">驻 ${s.idle} · 巡 ${s.patrol} · 勤 ${s.onDuty} · 护 ${s.escort}${s.dead ? ' · 亡 ' + s.dead : ''}</span>
    </div>
    <div class="st-ammo">
      <span>弹药 ${fmt(s.ammo)} / ${fmt(s.initAmmo)}${s.dry ? ' <em class="st-dry">· 已耗尽</em>' : ''}</span>
      <b>${Math.round(s.ammoLeft * 100)}%</b>
    </div>
    <div class="fw-part-bar"><i style="width:${Math.round(s.ammoLeft * 100)}%;background:${col}"></i></div>
    <div class="st-meta"><span>枪 ${s.guns} / ${s.initGuns} 支</span><span>≈ ${Math.round(s.ammo / 15)} 个弹匣（按 15 发算）</span></div>
    <div class="st-rows">${rows}</div>
    ${takenRow}${curve}
  </div>`;
}

function forceView(sim) {
  const d = sim.forceDetail();
  const st = sim.stats || {};
  const tr = d.trend;
  const chaos = sim.chaos || 0;

  // 分数拆解：三项各自占多少
  const parts = d.parts.map((p) => {
    const w = (p.score / p.max) * 100;
    const col = w >= 70 ? '#7ed07e' : w >= 35 ? '#e0b23c' : '#e8503a';
    return `<div class="fw-part">
      <div class="fw-part-top"><span>${p.name}</span>
        <b>${p.score.toFixed(1)}<i>/${p.max}</i></b></div>
      <div class="fw-part-bar"><i style="width:${w.toFixed(0)}%;background:${col}"></i></div>
      <div class="fw-part-detail">${p.detail}${p.score < p.max * 0.35 ? ' · <em>' + p.hint + '</em>' : ''}</div>
    </div>`;
  }).join('');

  // 战果趋势
  const t = tr;
  const netCls = t ? (t.net > 0 ? 'down' : t.net < 0 ? 'up' : '') : '';
  const killsSeries = (d.hist || []).map((h, k, arr) => (k === 0 ? 0 : (h.kills || 0) - (arr[k - 1].kills || 0)));

  const left = `
    <div class="fw-card">
      <div class="fw-title">武力 <em>${d.level}</em></div>
      <div class="fw-score"><b>${Math.round(d.force)}</b><small>/100</small></div>
      <div class="fw-bar"><i style="width:${d.force}%;background:${d.force >= 55 ? '#7ed07e' : d.force >= 30 ? '#e0b23c' : '#e8503a'}"></i></div>
      <div class="fw-parts">${parts}</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">判断</div>
      <div class="fw-kv"><span>状态</span><b>${d.level}</b></div>
      <div class="fw-kv"><span>判断</span><b>${d.force >= 55 ? '还压得住' : d.force >= 30 ? '只能自保' : '基本无力抵抗'}</b></div>
      <div class="fw-kv"><span>对尸比</span><b>${st.zombie ? (d.armedN ? (st.zombie / d.armedN).toFixed(1) + ' 只 / 人' : '—') : '暂无丧尸'}</b></div>
      <div class="fw-kv"><span>混乱度门槛</span><b>${chaos >= 80 ? '80% 已触发（要员出城）' : chaos >= 50 ? '50% 已触发（全城避难）' : chaos >= 20 ? '20% 已触发（巡逻警回局）' : '未触发'}</b></div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">战果 · 最近 60 秒</div>
      <div class="fw-metrics">
        <div><span>击杀</span><b>${t ? fmt(t.kills) : '—'}</b></div>
        <div><span>新增丧尸</span><b class="down">${t ? '+' + fmt(t.newZombies) : '—'}</b></div>
        <div><span>净增</span><b class="${t ? (t.net > 0 ? 'up' : 'down') : ''}">${t ? (t.net > 0 ? '+' : '') + fmt(t.net) : '—'}</b></div>
        <div><span>击杀/分钟</span><b>${t ? t.killsPerMin.toFixed(1) : '—'}</b></div>
      </div>
      ${spark(killsSeries, '#e8503a')}
      <div class="fw-note">${t
        ? (t.net > 0 ? '在压制：击杀速度高于新增' : t.net < 0 ? '在失守：新增丧尸快于击杀' : '僵持')
        : '还在采样（每 10 秒一个点）'}</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">损失</div>
      <div class="fw-kv"><span>警察阵亡</span><b>${fmt(d.policeDead)} 人</b></div>
      <div class="fw-kv"><span>平民误伤</span><b>${fmt(d.civKilled)} 人</b></div>
      <div class="fw-kv"><span>未能开火</span><b class="${d.zeroAmmo ? 'down' : ''}">${fmt(d.zeroAmmo)} 人（持枪但没子弹）</b></div>
    </div>`;

  const right = `
    <div class="fw-card">
      <div class="fw-sub">武装构成</div>
      <div class="fw-kv"><span>已持枪</span><b>${fmt(d.armedN)} 人（民 ${fmt(d.armedCiv)} · 警 ${fmt(d.armedPolice)} · 军 ${fmt(d.armedSoldier)}）</b></div>
      <div class="fw-kv"><span>家里有枪（潜在）</span><b class="up">${fmt(d.potential)} 人</b></div>
      <div class="fw-kv"><span>武装率</span><b>${(d.armedRate * 100).toFixed(1)}%（占存活）</b></div>
      <div class="fw-note">潜在的人要回家取枪才会武装；爆发初期基本都还在家里锁着。</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">弹药（按枪种分开记，不通用）</div>
      <div class="fw-kv"><span>合计</span><b>${fmt(d.ammoN)} 发</b></div>
      ${d.weaponRows.length
        ? d.weaponRows.map((w) => `<div class="fw-type">
            <span>${w.name}</span>
            <b>${w.n} 支</b>
            <em>${fmt(w.ammo)} 发</em>
            <i>人均 ${w.per.toFixed(0)} / ${w.cap}</i>
          </div>`).join('')
        : '<div class="fw-note">没有武装人员</div>'}
      <div class="fw-kv"><span>每分钟消耗</span><b>${t ? d.burnPerMin.toFixed(1) + ' 发' : '—'}</b></div>
      <div class="fw-kv"><span>还能撑</span><b>${Number.isFinite(d.ammoMinutes) ? d.ammoMinutes > 999 ? '很久' : d.ammoMinutes.toFixed(0) + ' 分钟' : '—'}</b></div>
      <div class="fw-kv"><span>命中率</span><b>${d.accuracy === null ? '还没开过枪' : (d.accuracy * 100).toFixed(0) + '%（实算 ' + fmt(d.hits) + '/' + fmt(d.shots) + '）'}</b></div>
      <div class="fw-kv"><span>无弹警员</span><b class="${d.dryNoStock ? 'down' : ''}">${fmt(d.dryOfficers)} 人${d.dryNoStock ? '（其中 ' + d.dryNoStock + ' 人回所也补不到：库房已空）' : ''}</b></div>
      <div class="fw-note">手枪弹补不了步枪、弩箭补不了火箭弹——每种枪只吃自己的弹。</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">警力</div>
      <div class="fw-kv"><span>在位</span><b>${fmt(d.police)} 人（警 ${fmt(d.police - d.soldiers)} · 军 ${fmt(d.soldiers)}）</b></div>
      <div class="fw-kv"><span>驻局 / 巡逻</span><b>${fmt(d.idle)} / ${fmt(d.patrol)} 人</b></div>
      <div class="fw-kv"><span>出勤 / 护送</span><b>${fmt(d.onDuty)} / ${fmt(d.escort)} 人</b></div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">各警局军械库</div>
      ${d.stations.map(stationCard).join('')}
    </div>`;

  return `<div class="fw-grid"><div class="fw-col">${left}</div><div class="fw-col">${right}</div></div>`;
}
// ---------------- 卫生（5 个分栏）----------------
function sanitTabs(sim) {
  const d = sim.sanitDetail();
  const st = sim.stats || {};
  return [
    { name: '总览', render: () => big(Math.round(d.sanit), '/100') + bar(d.sanit, 100, '#c8a6ff')
        + sec('一句话判断')
        + row('状态', d.level)
        + row('主要压力', d.mainPressure)
        + row('判断', d.sanit >= 65 ? '还能运转' : d.sanit >= 35 ? '正在恶化' : '已经失控')
        + sec('总量')
        + row('死亡', d.dead.toLocaleString() + ' 人')
        + row('已尸变', d.zombies.toLocaleString() + ' 只')
        + row('潜伏/发病', (d.infected || 0).toLocaleString() + ' / ' + d.sick + ' 人')
        + row('感染率', (d.infectRate * 100).toFixed(2) + '%')
        + sec('扣分来源')
        + row('尸体堆积', '−' + d.penaltyDead)
        + row('感染扩散', '−' + d.penaltyInfect)
        + sec('医疗压力')
        + row('前往医院', (d.hospitals.reduce((a, h) => a + h.near, 0)).toLocaleString() + ' 人')
        + row('医院数量', d.hospitals.length + ' 处') },
    { name: '尸体', render: () => sec('数量')
        + row('死亡总数', d.dead.toLocaleString() + ' 人')
        + row('已尸变', d.zombies.toLocaleString() + ' 只')
        + row('占人口', (d.dead / Math.max(1, sim.pop0) * 100).toFixed(1) + '%')
        + sec('影响')
        + row('卫生扣分', '−' + d.penaltyDead + '（上限 45）')
        + row('说明', '尸体越多卫生越差，卫生差会加快感染扩散') },
    { name: '感染', render: () => sec('当前')
        + row('潜伏中', (st.infected || 0) + ' 人')
        + row('已发病', d.sick + ' 人')
        + row('感染率', (d.infectRate * 100).toFixed(2) + '%')
        + row('卫生扣分', '−' + d.penaltyInfect)
        + sec('两条路线')
        + row('咬伤（1–2 小时）', '丧尸咬的，不会再传人')
        + row('接触（6–24 小时）', '10m 内待满 10 秒就传人') },
    { name: '医疗', render: () => sec('医院')
        + (d.hospitals.length
            ? d.hospitals.map((h) => row(h.name, h.near + ' 人正在前往')).join('')
            : row('—', '本地没有医院 POI'))
        + sec('需求')
        + row('发病者', d.sick + ' 人')
        + row('普通病', '约 3% 的居民（爆发前就有人在跑医院）')
        + row('说明', '医院是双刃剑：救人，也聚集传染') },
    { name: '判定', render: () => sec('等级门槛')
        + row('85+ 良好', d.sanit >= 85 ? '← 当前' : '')
        + row('65–84 尚可', d.sanit >= 65 && d.sanit < 85 ? '← 当前' : '')
        + row('45–64 恶化', d.sanit >= 45 && d.sanit < 65 ? '← 当前' : '')
        + row('20–44 糟糕', d.sanit >= 20 && d.sanit < 45 ? '← 当前' : '')
        + row('0–19 灾难', d.sanit < 20 ? '← 当前' : '')
        + sec('趋势')
        + row('当前值', Math.round(d.sanit) + ' / 100') },
  ];
}

/** 卫生面板：和武力一样的「分数拆解 + 两栏 + 趋势」结构 */
function sanitView(sim) {
  const d = sim.sanitDetail();
  const st = sim.stats || {};
  const hist = (sim.govHist || []).slice(-40);
  const tr = hist.length >= 2 ? (() => {
    const last = hist[hist.length - 1];
    let base = hist[0];
    for (let k = hist.length - 1; k >= 0; k--) if (last.t - hist[k].t >= 60) { base = hist[k]; break; }
    return {
      dt: Math.max(1, last.t - base.t),
      dead: (last.dead || 0) - (base.dead || 0),
      zombies: (last.zombies || 0) - (base.zombies || 0),
      patients: (last.patients || 0) - (base.patients || 0),
      inf: (last.inf || 0) - (base.inf || 0),
    };
  })() : null;

  // 分数拆解：sanit = 100 − 尸体扣分 − 感染扣分（两项各封顶 45）
  const parts = [
    { name: '尸体扣分', score: d.penaltyDead, max: 45, col: '#c8452f',
      detail: `${fmt(d.dead)} 具尸体 / 总人口 ${fmt(sim.pop0 || 0)}` },
    { name: '感染扣分', score: d.penaltyInfect, max: 45, col: '#e0b23c',
      detail: `感染率 ${(d.infectRate * 100).toFixed(2)}%` },
  ].map((p) => `<div class="fw-part">
      <div class="fw-part-top"><span>${p.name}</span><b>−${p.score}<i>/${p.max}</i></b></div>
      <div class="fw-part-bar"><i style="width:${(p.score / p.max * 100).toFixed(0)}%;background:${p.col}"></i></div>
      <div class="fw-part-detail">${p.detail}</div>
    </div>`).join('');

  const deadSeries = hist.map((h) => h.zombies || 0);
  const left = `
    <div class="fw-card">
      <div class="fw-title">卫生 <em>${d.level}</em></div>
      <div class="fw-score"><b>${Math.round(d.sanit)}</b><small>/100</small></div>
      <div class="fw-bar"><i style="width:${d.sanit}%;background:${d.sanit >= 65 ? '#c8a6ff' : d.sanit >= 35 ? '#e0b23c' : '#e8503a'}"></i></div>
      <div class="fw-parts">${parts}</div>
      <div class="fw-note">卫生分 = 100 − 尸体扣分 − 感染扣分；两项各封顶 45。</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">判断</div>
      <div class="fw-kv"><span>状态</span><b>${d.level}</b></div>
      <div class="fw-kv"><span>主要压力</span><b>${d.mainPressure}</b></div>
      <div class="fw-kv"><span>判断</span><b>${d.sanit >= 65 ? '还能运转' : d.sanit >= 35 ? '正在恶化' : '已经失控'}</b></div>
      <div class="fw-kv"><span>等级门槛</span><b>85 良好 / 65 尚可 / 45 恶化 / 20 糟糕 / 0 灾难</b></div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">最近 60 秒</div>
      <div class="fw-metrics">
        <div><span>新增死亡</span><b class="down">${tr ? '+' + fmt(tr.dead) : '—'}</b></div>
        <div><span>新增丧尸</span><b class="down">${tr ? '+' + fmt(tr.zombies) : '—'}</b></div>
        <div><span>病人变化</span><b>${tr ? (tr.patients >= 0 ? '+' : '') + fmt(tr.patients) : '—'}</b></div>
        <div><span>感染率变化</span><b>${tr ? (tr.inf >= 0 ? '+' : '') + tr.inf.toFixed(2) + '%' : '—'}</b></div>
      </div>
      ${spark(deadSeries, '#c8452f')}
      <div class="fw-note">${tr ? (tr.zombies > 0 ? '尸变还在增加' : '尸变已经停滞') : '还在采样（每 10 秒一个点）'}</div>
    </div>`;

  const hosp = (d.hospitals || []);
  const right = `
    <div class="fw-card">
      <div class="fw-sub">总量</div>
      <div class="fw-kv"><span>死亡</span><b>${fmt(d.dead)} 人（占人口 ${(d.dead / Math.max(1, sim.pop0) * 100).toFixed(1)}%）</b></div>
      <div class="fw-kv"><span>已尸变</span><b>${fmt(d.zombies)} 只</b></div>
      <div class="fw-kv"><span>潜伏 / 发病</span><b>${fmt(d.infected)} / ${fmt(d.sick)} 人</b></div>
      <div class="fw-kv"><span>感染率</span><b>${(d.infectRate * 100).toFixed(2)}%</b></div>
      <div class="fw-kv"><span>当前丧尸</span><b>${fmt(st.zombie)} 只</b></div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">医疗压力</div>
      ${hosp.length
        ? hosp.map((h) => `<div class="fw-kv"><span>${h.name}</span><b>${fmt(h.near)} 人前往</b></div>`).join('')
        : '<div class="fw-note">本地没有医院 POI</div>'}
      <div class="fw-note">医院是双刃剑：救人，也把感染者集中到一起。</div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">两条传染路线</div>
      <div class="fw-kv"><span>咬伤</span><b>被丧尸咬，1–2 游戏小时发作，不会再传人</b></div>
      <div class="fw-kv"><span>接触</span><b>10m 内待满 10 秒被传，6–24 小时发作</b></div>
      <div class="fw-kv"><span>接触路线占比</span><b>${(sim.infRoute ? (() => { let a = 0, b = 0; for (let i = 0; i < sim.n; i++) { if (sim.state[i] !== 7) continue; if (sim.infRoute[i] === 1) a++; else if (sim.infRoute[i] === 2) b++; } return (a + b) ? Math.round(b / (a + b) * 100) + '%（' + b + '/' + (a + b) + '）' : '—'; })() : '—')}</b></div>
    </div>`;

  return `<div class="fw-grid"><div class="fw-col">${left}</div><div class="fw-col">${right}</div></div>`;
}

/** 点警局卡片 → 关闭面板 + 镜头飞过去（main.js 监听 zos:focus） */
function bindStationClicks(body) {
  body.querySelectorAll('.st-card').forEach((c) => {
    c.onclick = () => {
      const x = +c.dataset.x, z = +c.dataset.z;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      root.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('zos:focus', { detail: { x, z, dist: 260 } }));
    };
  });
}

function render() {
  if (!curSim) return;
  const el = ensure();
  const tabBar = el.querySelector('#sp-tabs');
  const body = el.querySelector('#sp-body');

  // ---- 武力：两栏铺开，没有标签页 ----
  if (curKind === 'force') {
    tabBar.innerHTML = '';
    tabBar.style.display = 'none';
    el.querySelector('#sp-title').textContent = '武力状态';
    body.className = 'sp-body sp-body-force';
    body.innerHTML = forceView(curSim);
    bindStationClicks(body);
    return;
  }

  // ---- 卫生：同样两栏铺开 ----
  tabBar.innerHTML = '';
  tabBar.style.display = 'none';
  el.querySelector('#sp-title').textContent = '卫生状态';
  body.className = 'sp-body sp-body-force';
  body.innerHTML = sanitView(curSim);
}
export function openForce(sim) { curSim = sim; curKind = 'force'; curTab = 0; render(); ensure().classList.remove('hidden'); }
export function openSanit(sim) { curSim = sim; curKind = 'sanit'; curTab = 0; render(); ensure().classList.remove('hidden'); }

// ---------------- 顶栏三个指标的明细 ----------------
const d4 = (v) => (Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toFixed(4));
const hhmmss = (t) => {
  const m = Math.max(0, Math.floor(t / 60));
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
};

/** 把某类事件渲染成"逐条"的列表（时间 + 具体对象 + 这次加/减多少） */
function eventLines(list, sim, max) {
  if (!list.length) return '<div class="sp-ev none">还没有发生过</div>';
  return list.slice(0, max).map((e) => {
    let label;
    if (e.type === 'station') label = `${e.text} 沦陷（50m 内已无警力）`;
    else if (e.type === 'vip') label = `要员 ${shortName(e.i, sim)} 死亡`;
    else if (e.type === 'death') label = `平民 ${shortName(e.i, sim)} 死亡`;
    else if (e.type === 'infect') label = `${shortName(e.i, sim)} 被感染`;
    else label = e.text || e.type;
    return `<div class="sp-ev"><b>${hhmmss(e.t)}</b><span>${label}</span>`
      + `<i class="${e.delta >= 0 ? 'up' : 'down'}">${e.delta >= 0 ? '+' : ''}${d4(e.delta)}</i></div>`;
  }).join('');
}

export function openChaosInfo(sim) {
  const el = ensure();
  const d = sim.chaosDetail();
  el.querySelector('#sp-tabs').innerHTML = '';
  el.querySelector('#sp-tabs').style.display = 'none';
  el.querySelector('#sp-title').textContent = '混乱度 · 明细';
  const body = el.querySelector('#sp-body');
  body.className = 'sp-body sp-body-one';

  const pct = (v) => (v * 100).toFixed(1) + '%';
  const plus = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  const sub = (t) => `<div class="sp-sub">${t}</div>`;
  const evs = (type) => d.events.filter((e) => e.type === type);

  let h = big((sim.chaos || 0).toFixed(0), '/100') + bar(sim.chaos || 0, 100, '#ff8a3d');

  // ---------------- 增长 ----------------
  h += sec('增长');
  h += row('知情项', `${pct(d.awareRate)} × 0.5 = ${plus(d.awarePart)}（上限 ${d.max.aware}）`);
  h += sub(`${d.counts.aware.toLocaleString()} / ${d.counts.total.toLocaleString()} 人知情`);

  h += row('感染项', `${(d.infectRate * 100).toFixed(2)}% × 2 = ${plus(d.infectPart)}（上限 ${d.max.infect}）`);
  h += sub(`累计 ${d.counts.infected.toLocaleString()} 人曾被感染`);

  h += row('枪声', plus(d.heat.gun));
  h += sub(`累计 ${d.counts.shots.toLocaleString()} 枪 · 每枪 +${d.perEvent.gun.toFixed(3)} · 本项封顶 ${d.gunCap}`);

  h += row('平民死亡', plus(d.heat.death));
  h += sub(`共 ${d.counts.civKilled.toLocaleString()} 人 · 当前单价 +${d.perEvent.death.toFixed(4)}/人（${d.maxBy.death} ÷ 存活 ${d.pools.civ.toLocaleString()}）`);
  h += eventLines(evs('death'), sim, 3);

  h += row('新增感染', plus(d.heat.infect));
  h += sub(`当前单价 +${d.perEvent.infect.toFixed(4)}/人（${d.maxBy.infect} ÷ 未感染 ${d.pools.susceptible.toLocaleString()}）`);
  h += eventLines(evs('infect'), sim, 3);

  h += row('要员死亡', plus(d.heat.vip));
  h += sub(`每死一个 +${d.perEvent.vip.toFixed(2)}（${d.maxBy.vip} ÷ 要员 ${d.pools.vips} 人）`);
  h += eventLines(evs('vip'), sim, 3);

  h += row('警局沦陷', plus(d.heat.station));
  h += sub(`每处 +${d.perEvent.station.toFixed(2)}（${d.maxBy.station} ÷ 警局 ${d.pools.stations} 处）`);
  h += eventLines(evs('station'), sim, 4);

  h += `<div class="sp-sum up">增长合计 ${plus(d.growth)} / 上限 ${d.max.growth}</div>`;
  h += '<div class="sp-divider"></div>';

  // ---------------- 减少 ----------------
  h += sec('减少');
  h += row('自然平静', '−' + d.calm.toFixed(1) + `（上限 ${d.max.calm}）`);
  h += sub(`每游戏小时 −1 点（一天 −24），已累积 ${d.calm.toFixed(1)}`);

  h += row('击杀丧尸', '−' + d.killCut.toFixed(1) + `（上限 ${d.max.kill}）`);
  h += sub(`场上 ${d.pools.zombies.toLocaleString()} 只 → 每杀一只 −${d.perEvent.kill.toFixed(3)}（150 ÷ 当前丧尸数）`);

  h += `<div class="sp-sum down">减少合计 −${d.shrink.toFixed(1)} / 上限 ${d.max.shrink}</div>`;
  h += '<div class="sp-divider"></div>';
  h += row('最终混乱度', (d.chaos || 0).toFixed(1) + '（钳 0–100）');

  // ---------------- 门槛 ----------------
  h += sec('门槛');
  h += row('20% · 巡逻警回局', (sim.chaos || 0) >= 20 ? '已触发' : '未触发');
  h += row('35% · 宵禁', (sim.chaos || 0) >= 35 ? '已触发' : '未触发');
  h += row('50% · 秩序崩溃', (sim.chaos || 0) >= 50 ? '已触发' : '未触发');
  h += row('80% · 要员八人队出城', (sim.chaos || 0) >= 80 ? '已触发' : '未触发');

  body.innerHTML = h;
  el.classList.remove('hidden');
}
export function openInfectInfo(sim) {
  const el = ensure();
  el.querySelector('#sp-tabs').innerHTML = '';
  el.querySelector('#sp-title').textContent = '感染 · 明细';
  let bite = 0, contact = 0, sick = 0;
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] !== 6 && sim.state[i] !== 7) continue;
    if (sim.infRoute[i] === 1) bite++;
    else if (sim.infRoute[i] === 2) contact++;
    if (sim.sick[i]) sick++;
  }
  const r = (sim.infectRate || 0) * 100;
  let h = big(r.toFixed(2), '%') + bar(r, 10, '#e0b23c');
  h += sec('构成');
  h += row('潜伏中', (sim.stats.infected || 0) + ' 人');
  h += row('　咬伤路线（1–2 小时）', bite + ' 人');
  h += row('　接触路线（6–24 小时）', contact + ' 人');
  h += row('已发病', sick + ' 人（会往医院跑）');
  h += row('已尸变', (sim.stats.zombie || 0) + ' 只');
  h += sec('影响');
  h += row('对混乱度贡献', '×2 → +' + (r * 2).toFixed(1));
  h += row('会再传人吗', '只有接触路线（10m 内 10 秒）');
  el.querySelector('#sp-body').innerHTML = h;
  el.classList.remove('hidden');
}

export function openAwareInfo(sim) {
  const el = ensure();
  el.querySelector('#sp-tabs').innerHTML = '';
  el.querySelector('#sp-title').textContent = '知情 · 明细';
  let a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < sim.n; i++) {
    const a = sim.aware[i];
    if (a === 1) a1++; else if (a === 2) a2++; else if (a >= 3) a3++;
  }
  const r = (sim.awareRate || 0) * 100;
  let h = big(r.toFixed(1), '%') + bar(r, 100, '#4aa8ff');
  h += sec('分层');
  h += row('听说了（电话/网络）', a1 + ' 人');
  h += row('亲眼看见', a2 + ' 人');
  h += row('亲身经历', a3 + ' 人');
  h += sec('影响');
  h += row('对混乱度贡献', '×0.5 → +' + (r * 0.5).toFixed(1));
  h += row('网络热度', (sim.heat || 0).toFixed(2));
  el.querySelector('#sp-body').innerHTML = h;
  el.classList.remove('hidden');
}

export function closeStatus() { if (root) root.classList.add('hidden'); }
export function isStatusOpen() { return !!root && !root.classList.contains('hidden'); }
