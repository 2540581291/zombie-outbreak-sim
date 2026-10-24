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
