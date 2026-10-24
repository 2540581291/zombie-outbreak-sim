// ============================================================
//  ZOS-R · NavCore / L0：clearance 栅格
//
//  这一层只回答两个问题：
//    1. 这里能不能站人？（位域 bit0）
//    2. 离最近的障碍有多远？（clearance，精确欧氏距离变换）
//
//  第 2 个问题是整个新导航栈的地基：
//    - HPA* 的导航格要求「半径 r 的个体真的过得去」，靠 clearance 判定；
//    - 局部跟随要"贴墙保持身位"，靠 freeSpace 判定；
//    - 门能不能过、走廊够不够宽，都不再靠猜，靠这一张表。
//
//  clearance 单位是"格"（cell），保存为 Uint8（上限 255）。
//  换算成米：freeSpace = (clearance - 0.5) * cell
//    → clearance=1 表示最近障碍在正交相邻格，格子中心到墙面的自由距离 0.5 m
//    → 半径 r 的个体可站 ⇔ clearance - 0.5 >= r / cell
//
//  算法：Felzenszwalb & Huttenlocher 的精确欧氏距离变换（两遍 1D 抛物线下包络），
//  O(n)，与暴力法逐格一致（见 tools/test_navgrid.mjs）。
// ============================================================

/** 1D 平方距离变换：f 是输入（0 = 源点），d 是输出，v/z 是工作数组 */
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// 共享边上的连接点偏移（相对两点间距离的比例）。0 = 中点，其余是沿法向的偏移。
export const CONNECT_OFFSETS = [0, -0.25, 0.25, -0.375, 0.375];

export class NavGrid {
  /**
   * @param {{grid:Uint8Array|ArrayLike<number>, cols:number, rows:number, cell:number, halfW:number, halfH:number}} nav
   */
  constructor(nav) {
    this.grid = nav.grid;
    this.cols = nav.cols | 0;
    this.rows = nav.rows | 0;
    this.cell = nav.cell || 1;
    this.halfW = nav.halfW;
    this.halfH = nav.halfH;
    this.clearance = null;      // Uint8Array，null = 还没算
    this.version = 0;           // 每次世界改动 +1（S6 用）
    this.lastBuildMs = 0;
  }

  /** 世界坐标 → 线性下标（越界 -1）。注意：第 0 行是南边（z 南为正） */
  idx(x, z) {
    const c = ((x + this.halfW) / this.cell) | 0;
    const r = ((this.halfH - z) / this.cell) | 0;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** 世界坐标 → 列/行（越界返回 null） */
  cr(x, z) {
    const c = ((x + this.halfW) / this.cell) | 0;
    const r = ((this.halfH - z) / this.cell) | 0;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return [c, r];
  }

  /** 格子中心的世界坐标 */
  center(k) {
    const c = k % this.cols, r = (k / this.cols) | 0;
    return [c * this.cell - this.halfW + this.cell * 0.5,
            this.halfH - r * this.cell - this.cell * 0.5];
  }

  valueAt(x, z) {
    const i = this.idx(x, z);
    return i < 0 ? 0 : this.grid[i];
  }

  /** 位域 bit0：可走（门 0x0f / 室内 0x1f 都算可走，与原版一致） */
  walkable(x, z) {
    const i = this.idx(x, z);
    return i >= 0 && (this.grid[i] & 1) !== 0;
  }

  walkableIdx(i) {
    return i >= 0 && (this.grid[i] & 1) !== 0;
  }

  indoor(x, z) {
    const i = this.idx(x, z);
    return i >= 0 && (this.grid[i] & 0x18) === 0x18;
  }

  /**
   * 两点之间的"连接点"：在两点连线的法向上找几个位置，取第一个"能站人、
   * 且两侧都走得到"的点。
   *
   * 这是 L1 边校验与路径还原**共用的同一套几何规则** —— 建图时用哪一点判通，
   * 还原时就必须走那一点，否则会出现"图上是通的、折线却穿墙"。
   *
   * @returns {[number, number] | null}
   */
  connectPoint(ax, az, bx, bz, r = 0) {
    const ex = bx - ax, ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) return [ax, az];
    const nx = -ez / len, nz = ex / len;
    const mx0 = (ax + bx) * 0.5, mz0 = (az + bz) * 0.5;
    for (let t = 0; t < CONNECT_OFFSETS.length; t++) {
      const off = CONNECT_OFFSETS[t] * len;
      const mx = mx0 + nx * off, mz = mz0 + nz * off;
      if (!this.walkableR(mx, mz, r)) continue;
      if (!this.losClear(ax, az, mx, mz, r)) continue;
      if (!this.losClear(mx, mz, bx, bz, r)) continue;
      return [mx, mz];
    }
    return null;
  }

  /**
   * 半径 r 的"走廊"是否通。
   *
   * 用 Amanatides-Woo 网格遍历（DDA）逐格判定，**不是**按步长采样：
   * 采样会漏掉"只擦过一角"的墙格（弦长可能只有几厘米），
   * 于是平面上看着通、实际穿墙 —— 这是之前 82 条非法路径的根因。
   *
   * 判定规则 = Minkowski 膨胀后的可走性：格子的 clearance 不够放下半径 r
   * 的个体，就算"这一格对 r 来说不可走"。
   */
  losClear(x0, z0, x1, z1, r = 0) {
    const cell = this.cell, halfW = this.halfW, halfH = this.halfH;
    const cols = this.cols, rows = this.rows, grid = this.grid, cl = this.clearance;
    const need = r > 0 ? r + 0.5 * cell - 1e-9 : 0;
    const check = (ic, ir) => {
      if (ic < 0 || ir < 0 || ic >= cols || ir >= rows) return false;
      const k = ir * cols + ic;
      if ((grid[k] & 1) === 0) return false;
      return !(cl && cl[k] < need);
    };

    const c0 = (x0 + halfW) / cell, r0 = (halfH - z0) / cell;
    const c1 = (x1 + halfW) / cell, r1 = (halfH - z1) / cell;
    let ic = Math.floor(c0), ir = Math.floor(r0);
    const ic1 = Math.floor(c1), ir1 = Math.floor(r1);
    if (!check(ic, ir)) return false;
    if (ic === ic1 && ir === ir1) return true;

    const dc = c1 - c0, dr = r1 - r0;
    const stepC = dc > 0 ? 1 : -1, stepR = dr > 0 ? 1 : -1;
    const tDeltaC = dc === 0 ? Infinity : Math.abs(1 / dc);
    const tDeltaR = dr === 0 ? Infinity : Math.abs(1 / dr);
    let tMaxC = dc === 0 ? Infinity
      : (dc > 0 ? (ic + 1 - c0) : (c0 - ic)) / Math.abs(dc);
    let tMaxR = dr === 0 ? Infinity
      : (dr > 0 ? (ir + 1 - r0) : (r0 - ir)) / Math.abs(dr);

    let guard = 0;
    while ((ic !== ic1 || ir !== ir1) && guard++ < 200000) {
      if (tMaxC < tMaxR) { ic += stepC; tMaxC += tDeltaC; }
      else { ir += stepR; tMaxR += tDeltaR; }
      if (!check(ic, ir)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------
  //  clearance
  // ------------------------------------------------------------

  /**
   * 精确欧氏距离变换。外边界一圈按"障碍"处理（人不该贴地图边缘走）。
   * @param {{maxRadius?:number}} [opts] maxRadius 只是上限提示，实际会截断到 255
   * @returns {number} 耗时 ms
   */
  buildClearance(opts = {}) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const cols = this.cols, rows = this.rows, grid = this.grid;
    const P = 1;                       // 外圈 padding：把边界当障碍
    const pw = cols + 2 * P, ph = rows + 2 * P, pn = pw * ph;
    const INF = 1e9;

    // buf：填 0（障碍），可走格填 INF；padding 保持 0
    const buf = new Float32Array(pn);
    for (let r = 0; r < rows; r++) {
      const src = r * cols, dst = (r + P) * pw + P;
      for (let c = 0; c < cols; c++) {
        if ((grid[src + c] & 1) !== 0) buf[dst + c] = INF;
      }
    }

    const maxLen = Math.max(pw, ph);
    const f = new Float32Array(maxLen);
    const d = new Float32Array(maxLen);
    const v = new Int32Array(maxLen);
    const z = new Float64Array(maxLen + 1);

    // 横变换：每一行
    for (let r = 0; r < ph; r++) {
      const off = r * pw;
      for (let c = 0; c < pw; c++) f[c] = buf[off + c];
      dt1d(f, pw, d, v, z);
      for (let c = 0; c < pw; c++) buf[off + c] = d[c];
    }
    // 纵变换：每一列
    for (let c = 0; c < pw; c++) {
      for (let r = 0; r < ph; r++) f[r] = buf[r * pw + c];
      dt1d(f, ph, d, v, z);
      for (let r = 0; r < ph; r++) buf[r * pw + c] = d[r];
    }

    // 取平方根 → Uint8 截断
    const cl = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const src = (r + P) * pw + P, dst = r * cols;
      for (let c = 0; c < cols; c++) {
        const s = Math.sqrt(buf[src + c]);         // 单位：格
        cl[dst + c] = s > 255 ? 255 : s;
      }
    }

    this.clearance = cl;
    this.version++;
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastBuildMs = t1 - t0;
    return this.lastBuildMs;
  }

  hasClearance() {
    return this.clearance !== null;
  }

  /** 到最近障碍的自由距离（米）。无障碍数据时退化成半格 */
  freeSpaceIdx(i) {
    const cl = this.clearance;
    if (!cl) return this.cell * 0.5;
    if (i < 0) return 0;
    return Math.max(0, (cl[i] - 0.5) * this.cell);
  }

  freeSpace(x, z) {
    return this.freeSpaceIdx(this.idx(x, z));
  }

  /** 半径 r 的个体能否站在这里（格子中心判定；r 用米） */
  walkableR(x, z, r = 0) {
    const i = this.idx(x, z);
    if (i < 0 || (this.grid[i] & 1) === 0) return false;
    if (r <= 0) return true;
    const cl = this.clearance;
    if (!cl) return true;
    return (cl[i] - 0.5) * this.cell >= r;
  }

  walkableRIdx(i, r = 0) {
    if (i < 0 || (this.grid[i] & 1) === 0) return false;
    if (r <= 0) return true;
    const cl = this.clearance;
    if (!cl) return true;
    return (cl[i] - 0.5) * this.cell >= r;
  }

  /** 统计：按 freeSpace 分档的格数（启动自检/调参用） */
  clearanceStats(bins = [0.5, 1.5, 2.5, 4]) {
    const cl = this.clearance;
    if (!cl) return null;
    const out = new Array(bins.length + 1).fill(0);
    const total = cl.length;
    for (let i = 0; i < total; i++) {
      if ((this.grid[i] & 1) === 0) continue;       // 只统计可走格
      const fs = Math.max(0, (cl[i] - 0.5) * this.cell);
      let k = 0;
      while (k < bins.length && fs >= bins[k]) k++;
      out[k]++;
    }
    const walk = out.reduce((a, b) => a + b, 0);
    return { bins, buckets: out, walkable: walk, total };
  }
}

/** 从现有 nav 对象建 NavGrid（并在需要时立刻算 clearance） */
export function makeNavGrid(nav, { clearance = true } = {}) {
  const g = new NavGrid(nav);
  if (clearance) g.buildClearance();
  return g;
}
