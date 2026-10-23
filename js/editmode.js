// ============================================================
//  ZOS-R · 游戏内图层编辑模式
//
//  按 L（或点顶栏「✏️ 图层」）进入。做的事情：
//    · 把碰撞层叠到地图上（复用 overlay.js 的贴图，只重画改动的那一小块）
//    · 用鼠标在地面上刷/框/画线，直接改 nav.grid
//    · 每次改动记成一条补丁 op，存 localStorage（刷新不丢），可导出成
//      data/cities/<id>/collision.edit.json 与别人/别的机器共享
//
//  为什么要手改：OSM 自动烘焙会有假房子、漏房子、河宽按中心线估、桥接不严。
// ============================================================
import * as THREE from 'three';
import { applyLayerPatch, codeOf } from './layerpatch.js';

const VALUES = [
  ['wall', '墙'], ['room', '室内'], ['door', '门'], ['window', '窗'],
  ['water', '水'], ['fence', '围栏'], ['cover', '草地'], ['open', '空地'],
];
const TOOLS = [['brush', '圆刷'], ['rect', '矩形'], ['line', '直线']];
const SWATCH = {
  wall: '#e61919', room: '#ff8c1a', door: '#33ff59', window: '#33f2f2',
  water: '#1966ff', fence: '#f2cc26', cover: '#33b340', open: '#d9d9d9',
};

const STYLE = `
#le-panel{position:absolute;left:10px;top:56px;width:196px;padding:10px;border-radius:9px;
  background:rgba(16,19,23,.94);border:1px solid rgba(255,255,255,.14);
  font:12px/1.45 "Segoe UI","Microsoft YaHei",sans-serif;color:#cfd6dd;z-index:40;
  backdrop-filter:blur(6px)}
#le-panel h5{margin:0 0 7px;font-size:11px;color:#8fa2b5;font-weight:600;letter-spacing:.05em}
#le-panel .sec{margin:9px 0 6px;border-top:1px solid rgba(255,255,255,.09);padding-top:8px}
#le-panel .row{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px}
#le-panel button{flex:1 0 auto;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);
  color:#cfd6dd;border-radius:5px;padding:4px 7px;font:inherit;cursor:pointer}
#le-panel button:hover{background:rgba(255,255,255,.14)}
#le-panel button.on{background:#e2542b;border-color:#e2542b;color:#fff}
#le-panel button.val{display:flex;align-items:center;gap:5px;justify-content:flex-start;flex:0 0 92px}
#le-panel .sw{width:10px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.5);flex:0 0 auto}
#le-panel label{display:flex;align-items:center;gap:6px;color:#9fb0c0;white-space:nowrap;margin-bottom:6px}
#le-panel label input{flex:1 1 40px;min-width:30px}
#le-panel label b{min-width:38px;text-align:right;color:#cfd6dd;font-weight:400}
#le-panel .hint{color:#6f8093;font-size:11px;line-height:1.4}
#le-badge{position:absolute;left:50%;top:52px;transform:translateX(-50%);z-index:40;
  background:rgba(226,84,43,.92);color:#fff;border-radius:6px;padding:4px 12px;
  font:12px/1.4 "Segoe UI","Microsoft YaHei",sans-serif;pointer-events:none}
`;

export class LayerEditor {
  /**
   * @param {object} ctx { scene, renderer, getCamera, nav, overlay, cityId, fileOps, onChange }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.nav = ctx.nav;
    this.overlay = ctx.overlay;
    this.enabled = false;
    this.tool = 'brush';
    this.value = codeOf('room');
    this.radius = 6;
    this.ops = [];
    this.fileOps = ctx.fileOps || [];
    this.stroke = null;
    this.dirtyBox = null;
    this.lastFlush = 0;
    this.storageKey = 'zos.layerops.' + ctx.cityId;

    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();

    // 笔刷预览圈
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    ring.visible = false;
    ring.renderOrder = 3;
    ctx.scene.add(ring);
    this.ring = ring;

    this._loadLocal();
    this._bind();
  }

  // ---------- 持久化 ----------
  _loadLocal() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const ops = JSON.parse(raw);
        if (Array.isArray(ops) && ops.length) {
          this.ops = ops;
          const st = applyLayerPatch(this.nav, { ops });
          this.overlay.repaintRect(0, 0, this.nav.cols - 1, this.nav.rows - 1);
          console.log(`[ZOS-R] 本地图层修改 ${st.ops} 条 / ${st.changed} 格（未导出到文件）`);
        }
      }
    } catch (e) { console.warn('[ZOS-R] 本地图层修改读取失败：', e); }
  }
  _saveLocal() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.ops)); } catch {}
  }

  // ---------- 开关 ----------
  toggle() { this.enabled ? this.disable() : this.enable(); }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.overlayWasOn = this.overlay.visible;
    this.overlay.visible = true;
    this._buildUI();
    this._badge.style.display = '';
    this.ctx.renderer.domElement.style.cursor = 'crosshair';
    this._refreshStatus();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.ring.visible = false;
    if (this.panel) this.panel.style.display = 'none';
    this._badge.style.display = 'none';
    this.ctx.renderer.domElement.style.cursor = '';
    if (!this.overlayWasOn) this.overlay.visible = false;
    this._flush(true);
    this._saveLocal();
  }

  // ---------- 坐标 ----------
  _pick(ev) {
    const el = this.ctx.renderer.domElement;
    const r = el.getBoundingClientRect();
    this._ndc.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1
    );
    this._ray.setFromCamera(this._ndc, this.ctx.getCamera());
    return this._ray.ray.intersectPlane(this._plane, this._hit) ? this._hit : null;
  }

  // ---------- 涂改 ----------
  _apply(op) {
    this.ops.push(op);
    applyLayerPatch(this.nav, { ops: [op] });
    this._markDirty(op);
    this._refreshStatus();
  }

  /** 把 op 影响到的大致范围记进脏矩形 */
  _markDirty(op) {
    const nav = this.nav;
    const pad = (op.rad || 2) + 2;
    let x0, z0, x1, z1;
    if (op.t === 'rect') {
      x0 = Math.min(op.x, op.x + op.w); x1 = Math.max(op.x, op.x + op.w);
      z0 = Math.min(op.z, op.z + op.h); z1 = Math.max(op.z, op.z + op.h);
    } else if (op.t === 'line') {
      x0 = Math.min(op.a[0], op.b[0]) - pad; x1 = Math.max(op.a[0], op.b[0]) + pad;
      z0 = Math.min(op.a[1], op.b[1]) - pad; z1 = Math.max(op.a[1], op.b[1]) + pad;
    } else {
      x0 = op.x - pad; x1 = op.x + pad; z0 = op.z - pad; z1 = op.z + pad;
    }
    const [c0, r0] = this.overlay.cellAt(x0, z1);
    const [c1, r1] = this.overlay.cellAt(x1, z0);
    const b = this.dirtyBox;
    if (!b) this.dirtyBox = { c0, r0, c1, r1 };
    else {
      b.c0 = Math.min(b.c0, c0); b.r0 = Math.min(b.r0, r0);
      b.c1 = Math.max(b.c1, c1); b.r1 = Math.max(b.r1, r1);
    }
    this._flush();
  }

  /** 贴图重传很贵（每帧 30MB），所以合并脏矩形、限频 */
  _flush(force = false) {
    if (!this.dirtyBox) return;
    const now = performance.now();
    if (!force && now - this.lastFlush < 90) return;
    const b = this.dirtyBox;
    this.dirtyBox = null;
    this.lastFlush = now;
    this.overlay.repaintRect(b.c0, b.r0, b.c1, b.r1);
  }

  // ---------- 事件 ----------
  _bind() {
    const el = this.ctx.renderer.domElement;

    el.addEventListener('pointerdown', (ev) => {
      if (!this.enabled || ev.button !== 0) return;
      const p = this._pick(ev);
      if (!p) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      this.stroke = { start: [p.x, p.z], last: [p.x, p.z], moved: false };
      if (this.tool === 'brush') this._paintAt(p.x, p.z);
    }, true);

    el.addEventListener('pointermove', (ev) => {
      if (!this.enabled) return;
      const p = this._pick(ev);
      if (!p) { this.ring.visible = false; return; }
      // 预览圈
      this.ring.visible = true;
      this.ring.position.set(p.x, 1.2, p.z);
      const r = this.tool === 'line' ? Math.max(1, this.radius / 3) : this.radius;
      this.ring.scale.set(r, r, r);

      if (!this.stroke) return;
      this.stroke.moved = true;
      if (this.tool === 'brush') this._paintAt(p.x, p.z, this.stroke.last);
      this.stroke.last = [p.x, p.z];
    }, true);

    el.addEventListener('pointerup', (ev) => {
      if (!this.enabled || !this.stroke) return;
      const p = this._pick(ev) || { x: this.stroke.last[0], z: this.stroke.last[1] };
      const s = this.stroke;
      this.stroke = null;
      if (this.tool === 'rect' && s.moved) {
        this._apply({ t: 'rect', x: +Math.min(s.start[0], p.x).toFixed(1), z: +Math.min(s.start[1], p.z).toFixed(1),
          w: +Math.abs(p.x - s.start[0]).toFixed(1), h: +Math.abs(p.z - s.start[1]).toFixed(1), v: this.value });
      } else if (this.tool === 'line' && s.moved) {
        this._apply({ t: 'line', a: [+s.start[0].toFixed(1), +s.start[1].toFixed(1)],
          b: [+p.x.toFixed(1), +p.z.toFixed(1)], rad: Math.max(1, this.radius / 3), v: this.value });
      }
      this._flush(true);
      this._saveLocal();
    }, true);

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const n = '12345678'.indexOf(e.key);
      if (n >= 0) { this.value = codeOf(VALUES[n][0]); this._syncUI(); }
      if (e.key === 'b') { this.tool = 'brush'; this._syncUI(); }
      if (e.key === 'r') { this.tool = 'rect'; this._syncUI(); }
      if (e.key === 'l' && !e.ctrlKey) { this.tool = 'line'; this._syncUI(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); }
      if (e.key === 'Escape') this.disable();
    });
  }

  _paintAt(x, z, from) {
    if (from) {
      // 沿上一段插值，快速拖拽也不会断线
      const d = Math.hypot(x - from[0], z - from[1]);
      const steps = Math.max(1, Math.ceil(d / (this.radius * 0.6)));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        this._apply({ t: 'brush', x: +(from[0] + (x - from[0]) * k).toFixed(1),
          z: +(from[1] + (z - from[1]) * k).toFixed(1), rad: this.radius, v: this.value });
      }
    } else {
      this._apply({ t: 'brush', x: +x.toFixed(1), z: +z.toFixed(1), rad: this.radius, v: this.value });
    }
  }

  // ---------- 撤销 / 导出 ----------
  undo() {
    if (!this.ops.length) return;
    this.ops.pop();
    this._rebuild();
  }

  clearAll() {
    if (!this.ops.length) return;
    this.ops = [];
    this._rebuild();
  }

  _rebuild() {
    // 回到"只有文件补丁"的状态，再按 ops 重放
    const base = this.ctx.baseGrid;
    if (base) this.nav.grid.set(base);
    applyLayerPatch(this.nav, { ops: this.ops });
    this.overlay.repaintRect(0, 0, this.nav.cols - 1, this.nav.rows - 1);
    this._saveLocal();
    this._refreshStatus();
  }

  exportPatch() {
    const ops = this.fileOps.concat(this.ops);
    const patch = { version: 1, city: this.ctx.cityId, ops };
    const blob = new Blob([JSON.stringify(patch, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'collision.edit.json';
    a.click();
    this._say(`已导出 ${ops.length} 条 → 放进 data/cities/${this.ctx.cityId}/collision.edit.json`);
  }

  importPatch(text) {
    try {
      const p = JSON.parse(text);
      const ops = Array.isArray(p.ops) ? p.ops : [];
      this.ops = this.fileOps.concat(ops);
      this._rebuild();
      this._say(`已载入 ${ops.length} 条`);
    } catch (e) { this._say('解析失败：' + e.message); }
  }

  // ---------- UI ----------
  _buildUI() {
    if (this.panel) { this.panel.style.display = ''; this._syncUI(); return; }
    const st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);

    const p = document.createElement('div');
    p.id = 'le-panel';
    p.innerHTML = `
      <h5>图层编辑（L 退出）</h5>
      <div class="row" data-tools></div>
      <label>半径 <input type="range" id="le-rad" min="1" max="40" step="1" value="${this.radius}"><b id="le-radv">${this.radius}m</b></label>
      <div class="sec"><h5>刷成什么（1–8）</h5><div class="row" data-vals></div></div>
      <div class="sec"><h5>补丁</h5>
        <div class="row"><button id="le-undo">撤销</button><button id="le-clear">清空</button></div>
        <div class="row"><button id="le-export">导出 JSON</button></div>
        <div class="row"><button id="le-import">载入文件…</button></div>
        <input type="file" id="le-file" accept=".json" style="display:none">
        <div class="hint" id="le-status"></div>
        <div class="hint" style="margin-top:5px">涂墙/门后按「重新爆发」让门场重算</div>
        <div class="hint" id="le-msg" style="color:#ffb86b"></div>
      </div>`;
    document.body.appendChild(p);
    this.panel = p;

    const tools = p.querySelector('[data-tools]');
    tools.innerHTML = TOOLS.map(([id, label]) =>
      `<button data-tool="${id}" class="${id === this.tool ? 'on' : ''}">${label}</button>`).join('');
    tools.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.tool = b.dataset.tool; this._syncUI();
    };

    const vals = p.querySelector('[data-vals]');
    vals.innerHTML = VALUES.map(([k, label], i) => {
      const v = codeOf(k);
      return `<button class="val ${v === this.value ? 'on' : ''}" data-v="${k}">
        <i class="sw" style="background:${SWATCH[k]}"></i>${i + 1} ${label}</button>`;
    }).join('');
    vals.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.value = codeOf(b.dataset.v); this._syncUI();
    };

    p.querySelector('#le-rad').oninput = (e) => {
      this.radius = +e.target.value;
      p.querySelector('#le-radv').textContent = this.radius + 'm';
    };
    p.querySelector('#le-undo').onclick = () => this.undo();
    p.querySelector('#le-clear').onclick = () => this.clearAll();
    p.querySelector('#le-export').onclick = () => this.exportPatch();
    p.querySelector('#le-import').onclick = () => p.querySelector('#le-file').click();
    p.querySelector('#le-file').onchange = async (e) => {
      const f = e.target.files[0];
      if (f) this.importPatch(await f.text());
    };

    this._badge = document.createElement('div');
    this._badge.id = 'le-badge';
    this._badge.textContent = '图层编辑中 · 左键涂改 · L 退出';
    document.body.appendChild(this._badge);

    this._syncUI();
  }

  _syncUI() {
    if (!this.panel) return;
    this.panel.querySelectorAll('[data-tool]').forEach((b) =>
      b.classList.toggle('on', b.dataset.tool === this.tool));
    this.panel.querySelectorAll('[data-v]').forEach((b) =>
      b.classList.toggle('on', codeOf(b.dataset.v) === this.value));
  }

  _refreshStatus() {
    if (!this.panel) return;
    const st = this.overlay.refreshStats();
    const el = this.panel.querySelector('#le-status');
    if (el) {
      el.innerHTML = `改动 <b>${this.ops.length}</b> 条 · 室内 <b>${st.roomPct.toFixed(1)}%</b>` +
        ` · 不可通行 <b>${st.pct.toFixed(1)}%</b>`;
    }
  }

  _say(msg) {
    const el = this.panel && this.panel.querySelector('#le-msg');
    if (el) { el.textContent = msg; clearTimeout(this._msgT); this._msgT = setTimeout(() => { el.textContent = ''; }, 4000); }
  }
}
