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

// ---------------- 武力（5 个分栏）----------------
function forceTabs(sim) {
  const d = sim.forceDetail();
  const st = sim.stats || {};
  return [
    { name: '总览', render: () => big(Math.round(d.force), '/100') + bar(d.force, 100, '#7ed07e')
        + sec('一句话判断')
        + row('状态', d.level)
        + row('判断', d.force >= 55 ? '还压得住' : d.force >= 30 ? '只能自保' : '基本无力抵抗')
        + row('人均弹药', d.ammoPer.toFixed(1) + ' 发')
        + row('对尸比', st.zombie ? (d.armedN ? (st.zombie / d.armedN).toFixed(1) + ' 只 / 人' : '—') : '暂无丧尸')
        + sec('三项关键')
        + row('武装人数', d.armedN + ' 人（占存活 ' + (d.armedRate * 100).toFixed(1) + '%）')
        + row('警察在位', d.police + ' 人')
        + row('总弹药', d.ammoN + ' 发')
        + sec('混乱度门槛')
        + row('20% · 巡逻警回局', (st.chaos || sim.chaos || 0) >= 20 ? '已触发' : '未触发')
        + row('50% · 全城避难 + 警局开库', (sim.chaos || 0) >= 50 ? '已触发' : '未触发')
        + row('80% · 要员八人队出城', (sim.chaos || 0) >= 80 ? '已触发' : '未触发')
        + sec('损失')
        + row('警察阵亡', d.policeDead + ' 人')
        + row('平民误伤', (st.civDeaths || 0).toLocaleString() + ' 人') },
    { name: '火力', render: () => sec('武器构成')
        + (d.weaponRows.length
            ? d.weaponRows.map((w) => row(w.name, w.n + ' 支 · ' + w.ammo + ' 发')).join('')
            : row('—', '没有武装人员'))
        + sec('弹药')
        + row('总弹药', d.ammoN + ' 发')
        + row('人均', d.ammoPer.toFixed(1) + ' 发')
        + row('能打多久', d.ammoPer > 40 ? '够打一阵' : d.ammoPer > 15 ? '偏紧' : '很快见底')
        + sec('射击表现')
        + row('已开火', (st.shots || 0).toLocaleString() + ' 次')
        + row('命中率（警察）', (d.accuracy * 100).toFixed(0) + '%') },
    { name: '警力', render: () => sec('在位分布')
        + row('总在位', d.police + ' 人')
        + row('驻局', d.idle + ' 人')
        + row('巡逻', d.patrol + ' 人')
        + row('出勤（被调度）', d.onDuty + ' 人')
        + row('护送要员', d.escort + ' 人')
        + sec('损失')
        + row('阵亡', d.policeDead + ' 人')
        + sec('各局驻员')
        + d.stations.map((s) => row(s.name, '驻 ' + (s.idle || 0) + ' 人')).join('') },
    { name: '军械库', render: () => sec('警察局库存（抢一把少一把）')
        + d.stations.map((s) => row(s.name, s.stock)).join('')
        + sec('家庭')
        + row('家庭持枪率', (((sim.params && sim.params.homeGunRate) || 0) * 100).toFixed(0) + '%')
        + row('说明', '家里有枪的人可以回家取，取完就没了') },
    { name: '战果', render: () => sec('本局')
        + row('击毙丧尸', (sim.kills || 0).toLocaleString() + ' 只')
        + row('平民误伤', (sim.civDeaths || 0).toLocaleString() + ' 人')
        + row('当前丧尸', (st.zombie || 0).toLocaleString() + ' 只')
        + sec('比值')
        + row('人均对尸', d.armedN ? (st.zombie / d.armedN).toFixed(1) + ' 只 / 人' : '—')
        + row('评价', d.armedN && st.zombie / d.armedN > 20 ? '尸潮已压倒火力' : '尚可周旋') },
  ];
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
  const tabs = curKind === 'force' ? forceTabs(curSim) : sanitTabs(curSim);
  curTab = Math.max(0, Math.min(curTab, tabs.length - 1));
  el.querySelector('#sp-title').textContent =
    (curKind === 'force' ? '武力状态' : '卫生状态') + ' · ' + tabs[curTab].name;
  const barEl = el.querySelector('#sp-tabs');
  barEl.innerHTML = tabs.map((t, i) =>
    `<button class="sp-tab ${i === curTab ? 'on' : ''}" data-i="${i}">${t.name}</button>`).join('');
  barEl.querySelectorAll('.sp-tab').forEach((b) => {
    b.onclick = () => { curTab = +b.dataset.i; render(); };
  });
  el.querySelector('#sp-body').innerHTML = tabs[curTab].render();
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
