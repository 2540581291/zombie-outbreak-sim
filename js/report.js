// ============================================================
//  ZOS-R · 行动后报告
// ============================================================

import { fmtMoney } from './tools.js';

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const TOOL_NAMES = {
  police: '警察小队', swat: '特警小队', soldier: '伞兵班',
  heli: '直升机撤离', rally: '疏散广播', vaccine: '疫苗空投',
  drone: '无人机打击', strike: '空袭 Mk82', napalm: '燃烧弹',
  barricade: '路障封锁', siren: '警报诱饵', ammo: '弹药补给',
};

export function grade(score) {
  if (score >= 85) return { g: 'S', c: '#ffd76a', t: '教科书级处置' };
  if (score >= 70) return { g: 'A', c: '#6ce09a', t: '控制住了局面' };
  if (score >= 55) return { g: 'B', c: '#62d7ff', t: '代价不小，但撑住了' };
  if (score >= 40) return { g: 'C', c: '#f2c14e', t: '勉强及格' };
  return { g: 'D', c: '#ff6b52', t: '全面失守' };
}

function computeScore(sim) {
  const pop = Math.max(1, sim.params.population);
  const alive = sim.stats.civ + sim.saved;
  const survival = Math.min(1, alive / pop);
  const vipPts = Math.min(12, (sim.savedVip || 0) * 6);
  const survivalPts = survival * 70 - vipPts * 0;
  const killPts = Math.min(20, sim.kills / 8);
  const timePts = Math.min(10, sim.time / 60);
  return {
    score: Math.round(survivalPts + killPts + timePts + vipPts),
    survival, alive, pop,
  };
}

function drawChart(canvas, hist, pop) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 760, H = 210;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const padL = 42, padR = 10, padT = 12, padB = 22;
  const gw = W - padL - padR, gh = H - padT - padB;
  const n = hist.t.length;

  // 网格
  c.strokeStyle = 'rgba(255,255,255,.07)';
  c.fillStyle = '#5a646f';
  c.font = '10px ui-monospace,monospace';
  c.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + gh * (i / 4);
    c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke();
    const v = Math.round(pop * (1 - i / 4));
    c.fillText(v.toLocaleString(), padL - 6, y + 3);
  }
  if (n < 2) {
    c.fillStyle = '#5a646f';
    c.textAlign = 'center';
    c.fillText('数据不足', W / 2, H / 2);
    return;
  }

  const tMax = Math.max(1, hist.t[n - 1]);
  const X = (i) => padL + (hist.t[i] / tMax) * gw;
  const Y = (v) => padT + gh * (1 - Math.min(1, v / pop));

  const series = [
    { k: 'civ', col: 'rgba(70,196,110,.95)', w: 2 },
    { k: 'zom', col: 'rgba(232,80,58,.95)', w: 2 },
    { k: 'inf', col: 'rgba(242,193,78,.9)', w: 1.5 },
    { k: 'saved', col: 'rgba(73,224,192,.9)', w: 1.5 },
  ];
  for (const s of series) {
    const arr = hist[s.k];
    if (!arr || !arr.length) continue;
    c.beginPath();
    c.strokeStyle = s.col;
    c.lineWidth = s.w;
    for (let i = 0; i < n; i++) {
      const x = X(i), y = Y(arr[i]);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }

  // 时间轴
  c.fillStyle = '#5a646f';
  c.textAlign = 'center';
  c.fillText('00:00', padL, H - 6);
  c.fillText(fmtTime(tMax), W - padR - 16, H - 6);

  // 图例
  const legend = [['#46c46e', '平民'], ['#e8503a', '丧尸'], ['#f2c14e', '潜伏'], ['#49e0c0', '已救出']];
  c.textAlign = 'left';
  let lx = padL + 58;
  const ly = H - 8;
  for (const [col, name] of legend) {
    c.fillStyle = col;
    c.fillRect(lx, ly - 3, 8, 2);
    c.fillStyle = '#8a949f';
    c.fillText(name, lx + 12, ly);
    lx += 52;
  }
}

export function openReport(sim) {
  const old = document.getElementById('report');
  if (old) old.remove();

  const { score, survival, alive, pop } = computeScore(sim);
  const gr = grade(score);
  const st = sim.stats;
  const outcome =
    st.zombie === 0 && st.infected === 0 ? { t: '感染已清除', c: '#46c46e' }
      : st.civ === 0 ? { t: '城市沦陷', c: '#e8503a' }
        : { t: '人尸对峙', c: '#f2c14e' };

  const tools = Object.entries(sim.toolUse || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="rp-tool">${TOOL_NAMES[k] || k} ×${v}</span>`)
    .join('') || '<span class="rp-dim">一个工具都没用</span>';

  const evs = (sim.events || []).slice(-40).map(e =>
    `<li class="${e.kind}"><b>${fmtTime(e.t)}</b><span>${e.text}</span></li>`
  ).join('');

  const rows = [
    ['存活平民', st.civ.toLocaleString(), 'civ'],
    ['已救出', sim.saved.toLocaleString(), 'saved'],
    ['潜伏期', st.infected.toLocaleString(), 'inf'],
    ['丧尸', st.zombie.toLocaleString(), 'zom'],
    ['死亡', st.dead.toLocaleString(), 'dead'],
    ['击毙丧尸', sim.kills.toLocaleString(), ''],
    ['平民误伤', sim.civDeaths.toLocaleString(), ''],
    ['治愈', (sim.cured || 0).toLocaleString(), ''],
    ['要员撤离', (sim.stats.vipSaved || 0) + ' / ' + (sim.vipTotal || 0), (sim.stats.vipSaved ? 'saved' : '')],
    ['经费支出', fmtMoney(sim.spentTotal || 0), ''],
    ['开火次数', st.shots.toLocaleString(), ''],
    ['坚持时长', fmtTime(sim.time), ''],
    ['撤离人数', ((sim.saved || 0)).toLocaleString() + (sim.scoreData ? '　评分 ' + sim.scoreData().grade : ''), 'saved'],
    ['撤离回款', fmtMoney(sim.budgetBack || 0), ''],
  ].map(([k, v, cls]) =>
    `<div class="rp-row ${cls}"><span>${k}</span><b>${v}</b></div>`
  ).join('');

  const el = document.createElement('div');
  el.id = 'report';
  el.innerHTML = `
  <div class="rp-card">
    <div class="rp-head">
      <div class="rp-left">
        <div class="rp-title" style="color:${outcome.c}">${outcome.t}</div>
        <div class="rp-sub">${new Date().toLocaleString('zh-CN')}</div>
      </div>
      <div class="rp-grade" style="color:${gr.c};border-color:${gr.c}">
        <b>${gr.g}</b><i>${score} 分</i><em>${gr.t}</em>
      </div>
    </div>

    <div class="rp-body">
      <div class="rp-col">
        <div class="rp-h">人口曲线</div>
        <canvas id="rp-chart"></canvas>
        <div class="rp-survive">
          存活率 <b style="color:${survival > .5 ? '#6ce09a' : survival > .2 ? '#f2c14e' : '#ff6b52'}">
          ${(survival * 100).toFixed(1)}%</b>
          <span class="rp-dim">（${alive.toLocaleString()} / ${pop.toLocaleString()}）</span>
        </div>
        <div class="rp-h">动用装备</div>
        <div class="rp-tools">${tools}</div>
      </div>

      <div class="rp-col rp-narrow">
        <div class="rp-h">战果</div>
        <div class="rp-rows">${rows}</div>
      </div>

      <div class="rp-col rp-narrow">
        <div class="rp-h">时间线</div>
        <ul class="rp-timeline">${evs || '<li class="rp-dim">无记录</li>'}</ul>
      </div>
    </div>

    <div class="rp-foot">
      <button id="rp-again" class="primary">再来一局</button>
      <button id="rp-close">继续观察</button>
    </div>
  </div>`;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));
  drawChart(el.querySelector('#rp-chart'), sim.hist, pop);

  el.querySelector('#rp-close').onclick = () => closeReport();
  el.querySelector('#rp-again').onclick = () => {
    closeReport();
    if (window.__zosRestart) window.__zosRestart();
  };
  return el;
}

export function closeReport() {
  const el = document.getElementById('report');
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 260);
}

export function isReportOpen() {
  return !!document.getElementById('report');
}



