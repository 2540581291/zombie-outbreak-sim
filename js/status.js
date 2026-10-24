// 武力 / 卫生 两个独立信息面板（分标签页）
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
      <div class="fw-sub">弹药</div>
      <div class="fw-kv"><span>总弹药</span><b>${fmt(d.ammoN)} 发</b></div>
      <div class="fw-kv"><span>人均</span><b>${d.ammoPer.toFixed(1)} 发</b></div>
      <div class="fw-kv"><span>每分钟消耗</span><b>${t ? d.burnPerMin.toFixed(1) + ' 发' : '—'}</b></div>
      <div class="fw-kv"><span>还能撑</span><b>${Number.isFinite(d.ammoMinutes) ? d.ammoMinutes > 999 ? '很久' : d.ammoMinutes.toFixed(0) + ' 分钟' : '—'}</b></div>
      <div class="fw-kv"><span>命中率</span><b>${d.accuracy === null ? '还没开过枪' : (d.accuracy * 100).toFixed(0) + '%（实算 ' + fmt(d.hits) + '/' + fmt(d.shots) + '）'}</b></div>
    </div>

    <div class="fw-card">
      <div class="fw-sub">武器构成</div>
      ${d.weaponRows.length
        ? d.weaponRows.map((w) => `<div class="fw-kv"><span>${w.name}</span><b>${w.n} 支 · ${fmt(w.ammo)} 发</b></div>`).join('')
        : '<div class="fw-note">没有武装人员</div>'}
    </div>

    <div class="fw-card">
      <div class="fw-sub">警力</div>
      <div class="fw-kv"><span>在位</span><b>${fmt(d.police)} 人（警 ${fmt(d.police - d.soldiers)} · 军 ${fmt(d.soldiers)}）</b></div>
      <div class="fw-kv"><span>驻局 / 巡逻</span><b>${fmt(d.idle)} / ${fmt(d.patrol)} 人</b></div>
      <div class="fw-kv"><span>出勤 / 护送</span><b>${fmt(d.onDuty)} / ${fmt(d.escort)} 人</b></div>
      <div class="fw-sub2">各警局</div>
      ${d.stations.map((s) => `<div class="fw-kv"><span>${s.name}</span><b>驻 ${s.idle} 人</b></div>`).join('')}
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
    return;
  }

  // ---- 卫生：仍然是标签 ----
  tabBar.style.display = '';
  body.className = 'sp-body';
  const tabs = sanitTabs(curSim);
  curTab = Math.max(0, Math.min(curTab, tabs.length - 1));
  el.querySelector('#sp-title').textContent = '卫生状态 · ' + tabs[curTab].name;
  tabBar.innerHTML = tabs.map((t, i) =>
    `<button class="sp-tab ${i === curTab ? 'on' : ''}" data-i="${i}">${t.name}</button>`).join('');
  tabBar.querySelectorAll('.sp-tab').forEach((b) => {
    b.onclick = () => { curTab = +b.dataset.i; render(); };
  });
  body.innerHTML = tabs[curTab].render();
}
export function openForce(sim) { curSim = sim; curKind = 'force'; curTab = 0; render(); ensure().classList.remove('hidden'); }
export function openSanit(sim) { curSim = sim; curKind = 'sanit'; curTab = 0; render(); ensure().classList.remove('hidden'); }

// ---------------- 顶栏三个指标的明细 ----------------
export function openChaosInfo(sim) {
  const el = ensure();
  el.querySelector('#sp-tabs').innerHTML = '';
  el.querySelector('#sp-title').textContent = '混乱度 · 明细';
  const aware = (sim.awareRate || 0) * 100;
  const infect = (sim.infectRate || 0) * 100;
  const a = aware * 0.5, b = infect * 2;
  let h = big((sim.chaos || 0).toFixed(0), '/100') + bar(sim.chaos || 0, 100, '#ff8a3d');
  h += sec('公式拆解');
  h += row('知情值 × 0.5', aware.toFixed(1) + '% → +' + a.toFixed(1));
  h += row('感染值 × 2', infect.toFixed(2) + '% → +' + b.toFixed(1));
  h += row('合计（上限 100）', (a + b).toFixed(1));
  h += sec('门槛');
  h += row('20% · 巡逻警回局', sim.chaos >= 20 ? '已触发' : '未触发');
  h += row('50% · 全城避难 + 警局开库', sim.chaos >= 50 ? '已触发' : '未触发');
  h += row('80% · 要员八人队出城', sim.chaos >= 80 ? '已触发' : '未触发');
  h += sec('含义');
  h += row('当前状态', sim.chaos >= 80 ? '全面崩溃' : sim.chaos >= 50 ? '秩序崩溃'
        : sim.chaos >= 20 ? '社会动荡' : sim.chaos >= 8 ? '人心浮动' : '表面平静');
  el.querySelector('#sp-body').innerHTML = h;
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
