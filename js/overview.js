// ============================================================
//  ZOS-R · 全体人员总览（类 Excel：排序 / 筛选 / 搜索 / 虚拟滚动）
// ============================================================
import { ST } from './sim.js';
import { SPECIES, SP, TEAM } from './species.js';
import { shortName } from './people.js';

const ROW_H = 28;
const VIEW_H = 470;
const BUF = 6;

const STATE_TXT = {
  [ST.CIV]: '走动', [ST.FLEE]: '逃跑', [ST.FIGHT]: '还击',
  [ST.POLICE]: '执勤', [ST.SOLDIER]: '作战', [ST.ZOMBIE]: '丧尸',
  [ST.INFECTED]: '潜伏', [ST.CORPSE]: '死亡', [ST.SAVED]: '已撤离', [ST.WILD]: '野兽',
};

// 列定义：k=取值键，num=数值列，w=宽度(px)
const COLS = [
  { k: 'idx', t: '#', w: 64, num: true, get: (i) => i },
  { k: 'name', t: '姓名', w: 118, get: (i, ctx) => ctx.name(i) },
  { k: 'role', t: '类型', w: 74, get: (i) => roleOf(i) },
  { k: 'state', t: '状态', w: 72, get: (i) => STATE_TXT[ctxState(i)] || '—' },
  { k: 'age', t: '年龄', w: 54, num: true, get: (i) => ageOf(i) },
  { k: 'sex', t: '性别', w: 46, get: (i) => (hash(i, 4) < 0.5 ? '男' : '女') },
  { k: 'kills', t: '击杀', w: 58, num: true, get: (i) => ctxKills(i) },
  { k: 'infect', t: '传染', w: 58, num: true, get: (i) => ctxInfect(i) },
  { k: 'spd', t: '速度', w: 64, num: true, get: (i) => ctxSpd(i), fmt: (v) => v.toFixed(2) },
  { k: 'hp', t: '血量', w: 64, num: true, get: (i) => ctxHp(i), fmt: (v) => Math.round(v) },
  { k: 'ammo', t: '弹药', w: 56, num: true, get: (i) => ctxAmmo(i) },
  { k: 'vip', t: '要员', w: 48, get: (i) => (ctxVip(i) ? '★' : '') },
];

// ---- 这些在 open 时绑定到具体 sim，避免每帧传参 ----
let S = null;
function ctxState(i) { return S.state[i]; }
function ctxKills(i) { return S.killsBy ? S.killsBy[i] : 0; }
function ctxInfect(i) { return S.infectBy ? S.infectBy[i] : 0; }
function ctxSpd(i) { return S.spd[i] || 0; }
function ctxHp(i) { return S.hp[i] || 0; }
function ctxAmmo(i) { return S.ammo[i] || 0; }
function ctxVip(i) { return S.vip && S.vip[i] ? 1 : 0; }

function roleOf(i) {
  const sp = SPECIES[S.kind ? S.kind[i] : 0] || null;
  if (sp && sp.name) return sp.name;
  const st = S.state[i];
  if (st === ST.POLICE) return '警察';
  if (st === ST.SOLDIER) return '士兵';
  if (st === ST.ZOMBIE) return '丧尸';
  return '平民';
}
function hash(i, salt) {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function ageOf(i) { return 8 + Math.floor(hash(i, 3) * 72); }

// ---------------- 状态 ----------------
let sortKey = 'kills';
let sortDir = -1;      // -1 = 降序
let filter = 'all';
let query = '';
let rows = [];         // 当前过滤/排序后的个体下标
let names = [];        // 名字缓存
let el = null;
let bodyEl = null, spacerEl = null, thEl = null, countEl = null;
let timer = 0;

let namesFor = -1;
function nameOf(i) {
  // 换了一局（或重新爆发）名字缓存要重建，否则姓氏还是上一局的
  if (namesFor !== S.n) { names = []; namesFor = S.n; }
  if (!names[i]) names[i] = shortName(i, S);
  return names[i];
}

function collect() {
  rows = [];
  const n = S.n;
  const q = query.trim();
  for (let i = 0; i < n; i++) {
    const st = S.state[i];
    if (filter === 'vip' && !(S.vip && S.vip[i])) continue;
    if (filter === 'police' && st !== ST.POLICE && st !== ST.SOLDIER) continue;
    if (filter === 'zombie' && st !== ST.ZOMBIE) continue;
    if (filter === 'infected' && st !== ST.INFECTED) continue;
    if (filter === 'civ' && !(st === ST.CIV || st === ST.FLEE || st === ST.FIGHT)) continue;
    if (filter === 'dead' && st !== ST.CORPSE) continue;
    if (q && !nameOf(i).includes(q)) continue;
    rows.push(i);
  }
}

function sortRows() {
  const col = COLS.find(c => c.k === sortKey) || COLS[6];
  const ctx = { name: nameOf };
  if (col.num) {
    rows.sort((a, b) => (col.get(a, ctx) - col.get(b, ctx)) * sortDir);
  } else {
    rows.sort((a, b) => String(col.get(a, ctx)).localeCompare(String(col.get(b, ctx)), 'zh') * sortDir);
  }
}

// ---------------- 渲染 ----------------
function renderHead() {
  thEl.innerHTML = COLS.map(c => {
    const on = c.k === sortKey;
    const arrow = on ? (sortDir < 0 ? ' ▼' : ' ▲') : '';
    return `<div class="ov-cell ${c.num ? 'num' : ''} ${on ? 'on' : ''}" data-k="${c.k}"
      style="width:${c.w}px">${c.t}<i>${arrow}</i></div>`;
  }).join('');
  thEl.querySelectorAll('.ov-cell').forEach(d => {
    d.onclick = () => {
      const k = d.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = COLS.find(c => c.k === k).num ? -1 : 1; }
      sortRows();
      renderHead();
      bodyEl.scrollTop = 0;
      renderBody();
    };
  });
}

function renderBody() {
  const st = bodyEl.scrollTop;
  const total = rows.length;
  spacerEl.style.height = total * ROW_H + 'px';
  const start = Math.max(0, Math.floor(st / ROW_H) - BUF);
  const end = Math.min(total, Math.ceil((st + VIEW_H) / ROW_H) + BUF);

  const ctx = { name: nameOf };
  const parts = [];
  for (let r = start; r < end; r++) {
    const i = rows[r];
    const state = ctxState(i);
    const cls = [
      S.vip && S.vip[i] ? 'vip' : '',
      state === ST.ZOMBIE || state === ST.CORPSE ? 'zom' : '',
      state === ST.POLICE || state === ST.SOLDIER ? 'pol' : '',
      state === ST.SAVED ? 'saved' : '',
    ].join(' ');
    const cells = COLS.map(c => {
      let v = c.get(i, ctx);
      if (c.fmt) v = c.fmt(v);
      if (v === 0 && c.num && c.k !== 'hp') v = '';
      return `<div class="ov-cell ${c.num ? 'num' : ''}" style="width:${c.w}px">${v}</div>`;
    }).join('');
    parts.push(`<div class="ov-row ${cls}" data-i="${i}" style="top:${r * ROW_H}px;height:${ROW_H}px">${cells}</div>`);
  }
  // 保留 spacer，替换行
  bodyEl.innerHTML = '';
  bodyEl.appendChild(spacerEl);
  const frag = document.createElement('div');
  frag.innerHTML = parts.join('');
  while (frag.firstChild) bodyEl.appendChild(frag.firstChild);

  bodyEl.querySelectorAll('.ov-row').forEach(row => {
    row.onclick = () => {
      const i = +row.dataset.i;
      if (window.__zosSelect) window.__zosSelect(i);
      close();
    };
  });

  if (countEl) countEl.textContent = `${total.toLocaleString()} 条`;
}

function refresh() {
  if (!el || !S) return;
  collect();
  sortRows();
  renderBody();
}

// ---------------- 打开 / 关闭 ----------------
export function openOverview(sim) {
  close();
  S = sim;
  if (!names.length) {
    names = new Array(Math.min(sim.n + 400, 62000));
  }
  el = document.createElement('div');
  el.id = 'overview';

  const cols = COLS.map(c => c.w + 'px').join(' ');
  el.innerHTML = `
  <div class="ov-card">
    <div class="ov-head">
      <div class="ov-title">全体人员总览 <em id="ov-count"></em></div>
      <input id="ov-search" type="text" placeholder="搜索姓名…" autocomplete="off">
      <select id="ov-filter">
        <option value="all">全部</option>
        <option value="vip">★ 要员</option>
        <option value="civ">平民</option>
        <option value="police">警察 / 士兵</option>
        <option value="zombie">丧尸</option>
        <option value="infected">潜伏者</option>
        <option value="dead">已死亡</option>
      </select>
      <button id="ov-close">✕</button>
    </div>
    <div class="ov-table" style="--ov-cols:${cols}">
      <div class="ov-th" id="ov-th"></div>
      <div class="ov-body" id="ov-body"><div class="ov-spacer" id="ov-spacer"></div></div>
    </div>
    <div class="ov-foot">表头可点排序 · 点行选中并跟随 · 数据每秒刷新</div>
  </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  bodyEl = el.querySelector('#ov-body');
  spacerEl = el.querySelector('#ov-spacer');
  thEl = el.querySelector('#ov-th');
  countEl = el.querySelector('#ov-count');

  el.querySelector('#ov-close').onclick = close;
  el.querySelector('#ov-search').oninput = (e) => {
    query = e.target.value;
    collect(); sortRows(); bodyEl.scrollTop = 0; renderBody();
  };
  el.querySelector('#ov-filter').onchange = (e) => {
    filter = e.target.value;
    collect(); sortRows(); bodyEl.scrollTop = 0; renderBody();
  };
  bodyEl.onscroll = () => renderBody();

  collect();
  sortRows();
  tableHeadSetup();
  renderBody();

  clearInterval(timer);
  timer = setInterval(() => { if (el) refresh(); }, 1000);
}

function tableHeadSetup() {
  renderHead();
}

export function close() {
  clearInterval(timer);
  timer = 0;
  if (el) {
    el.classList.remove('show');
    const e = el;
    setTimeout(() => e.remove(), 220);
  }
  el = null; bodyEl = null; spacerEl = null; thEl = null; countEl = null;
  S = null;
}

export function isOpen() {
  return !!el;
}

export function toggle(sim) {
  if (el) close();
  else openOverview(sim);
}
