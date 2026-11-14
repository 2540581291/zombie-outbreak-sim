// ============================================================
//  ZOS-R · 图层补丁（手工修正碰撞层）
//
//  OSM 自动烘焙出来的碰撞层一定会有错：把不是房子的算成房子、漏掉房子、
//  河宽不对、桥没接上…… 与其一遍遍重烘，不如允许**手绘修正**，
//  存成一份纯数据的补丁文件，运行时叠加上去。
//
//  文件：数据库/cities/<id>/collision.edit.json
//  {
//    "version": 1, "city": "berlin",
//    "ops": [
//      {"t":"cell",  "c":1200, "r":900, "v":"room"},          // 单格
//      {"t":"brush", "x":-120, "z":340, "rad":6, "v":"open"},  // 圆刷（米）
//      {"t":"rect",  "x":-200, "z":100, "w":30, "h":20, "v":"room"},
//      {"t":"poly",  "pts":[[0,0],[10,0],[10,10]], "v":"wall"},
//      {"t":"line",  "a":[0,0], "b":[10,10], "rad":1.5, "v":"wall"}
//    ]
//  }
//  v 可以写名字（见下面 VALUE_NAMES），也可以写十六进制数字（"0x1f"）。
//  注意：x/z 是**世界坐标（米）**，原点在城市几何中心；网格坐标 (c,r) 才是格子下标。
// ============================================================

export const VALUE_NAMES = {
  wall: 0x00, open: 0x03, grass: 0x07, door: 0x0f,
  window: 0x16, room: 0x1f, fence: 0x42, fencegate: 0x43, water: 0x82,
  // 别名（编辑器里也认这些写法）
  inside: 0x1f, indoor: 0x1f, building: 0x1f, forest: 0x07, cover: 0x07, erase: 0x03,
};

export const VALUE_LABELS = {
  0x00: '墙', 0x03: '空地/路', 0x07: '林地/草地', 0x0f: '门',
  0x16: '窗', 0x1f: '室内', 0x22: '围栏', 0x82: '水',
};

export function codeOf(v) {
  if (typeof v === 'number') return v & 0xff;
  if (typeof v === 'string') {
    if (v.startsWith('0x') || /^\d+$/.test(v)) return parseInt(v, v.startsWith('0x') ? 16 : 10) & 0xff;
    if (v in VALUE_NAMES) return VALUE_NAMES[v];
  }
  throw new Error('未知的层值：' + v);
}

// --- 世界坐标 ↔ 格子下标（与 collision.js 的 idx() 同一套约定：第 0 行在南边）---
function cellOf(nav, x, z) {
  return [
    Math.floor((x + nav.halfW) / nav.cell),
    Math.floor((nav.halfH - z) / nav.cell),
  ];
}

function setCell(nav, c, r, v, stat) {
  if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return;
  const k = r * nav.cols + c;
  if (nav.grid[k] === v) return;
  nav.grid[k] = v;
  stat.changed++;
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

function applyOpacity(nav, op, stat) {
  const v = codeOf(op.v);
  const t = op.t || 'cell';

  if (t === 'cell') {
    setCell(nav, op.c | 0, op.r | 0, v, stat);
    return;
  }

  if (t === 'brush') {
    const rad = Math.max(0.5, +op.rad || 3);
    const [c0, r0] = cellOf(nav, op.x, op.z);
    const span = Math.ceil(rad / nav.cell) + 1;
    const rr = rad / nav.cell;
    for (let dr = -span; dr <= span; dr++) {
      for (let dc = -span; dc <= span; dc++) {
        if (dc * dc + dr * dr > rr * rr) continue;
        setCell(nav, c0 + dc, r0 + dr, v, stat);
      }
    }
    return;
  }

  if (t === 'rect') {
    const x0 = op.x, z0 = op.z, w = op.w, h = op.h;
    const ax = Math.min(x0, x0 + w), bx = Math.max(x0, x0 + w);
    const az = Math.min(z0, z0 + h), bz = Math.max(z0, z0 + h);
    const [c0, r0] = cellOf(nav, ax, az);      // az 小 = 北 = 行号大
    const [c1, r1] = cellOf(nav, bx, bz);
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) setCell(nav, c, r, v, stat);
    }
    return;
  }

  if (t === 'poly') {
    const pts = op.pts || [];
    if (pts.length < 3) return;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const [c0] = cellOf(nav, Math.min(...xs), 0);
    const [c1] = cellOf(nav, Math.max(...xs), 0);
    const [, r0] = cellOf(nav, 0, Math.max(...zs));
    const [, r1] = cellOf(nav, 0, Math.min(...zs));
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      const z = nav.halfH - (r + 0.5) * nav.cell;
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        const x = (c + 0.5) * nav.cell - nav.halfW;
        if (pointInPoly(x, z, pts)) setCell(nav, c, r, v, stat);
      }
    }
    return;
  }

  if (t === 'line') {
    const a = op.a || [0, 0], b = op.b || [0, 0];
    const rad = Math.max(0.5, +op.rad || 1.5);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / (nav.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      applyOpacity(nav, { t: 'brush', x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, rad, v: op.v }, stat);
    }
    return;
  }

  console.warn('[layerpatch] 不认识的 op：', op);
}

/**
 * 把补丁叠到 nav.grid 上（就地修改）。
 * 返回 { changed, ops }，并把 nav.doorDist 置空 —— 门变了，门场必须重算。
 */
export function applyLayerPatch(nav, patch) {
  const stat = { changed: 0, ops: 0 };
  if (!nav || !patch || !Array.isArray(patch.ops)) return stat;
  for (const op of patch.ops) {
    try { applyOpacity(nav, op, stat); stat.ops++; }
    catch (e) { console.warn('[layerpatch] 跳过一条 op：', e.message, op); }
  }
  // 门的位置变了：旧门场已删除；导航图由 main.js 的 onChange 统一 rebuildAll()
  return stat;
}

/** 统计各层值占比（编辑器和启动日志都用它） */
function layerStats(nav) {
  const hist = new Map();
  for (let i = 0; i < nav.grid.length; i++) {
    const v = nav.grid[i];
    hist.set(v, (hist.get(v) || 0) + 1);
  }
  const total = nav.grid.length;
  const rows = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total,
    room: (hist.get(0x1f) || 0) / total,
    text: rows.map(([v, n]) => `${VALUE_LABELS[v] || '0x' + v.toString(16)}:${(n / total * 100).toFixed(1)}%`).join(' '),
  };
}
