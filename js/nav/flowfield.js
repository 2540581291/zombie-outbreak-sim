// ============================================================
//  ZOS-R · NavCore / L2 群体层：流场（Dijkstra map）
//
//  为什么要有这一层：
//    HPA* 是"一个个体问一条路"，成本 ~0.5 ms/次。20 k 人同时换目标 = 10 s。
//    流场反过来：**一次 Dijkstra 算好到某个目标的全场距离**，之后每人只是
//    一次 O(1) 查表 + 取梯度。目标少而热（撤离口 / 警局 / 医院 / 玩家集结点）
//    时，这是唯一能撑住 2 万人的做法（Supreme Commander 2、TD 类都用它）。
//
//  结构：
//    - 在 L1 8 m 图上做 8 邻接 Dijkstra（同 sectors.js 的邻接表，几何一致）
//    - 存 dist（Float32）+ dir（Uint8，指向"下坡"的邻居方向）
//    - 查询：gradientAt 走双线性插值，方向更平滑（S5 的跟随要用）
//    - 缓存：按目标格做 LRU，最多 maxFields 张；每张 ≈ 119 k × 5 B ≈ 0.6 MB
//
//  参考：Elijah Emerson, "Crowd Pathfinding and Steering Using Flow Field Tiles"
//        Red Blob Games, "Flow Field Pathfinding for Tower Defense"
// ============================================================

import { DIRS, DIR_COST } from './sectors.js';

const DDc = DIRS.map((d) => d[0]);
const DDr = DIRS.map((d) => d[1]);

export class FlowField {
  /**
   * @param {ReturnType<import('./sectors.js').buildHierarchy>} hier
   * @param {number} goalCell 目标 L1 格
   */
  constructor(hier, goalCell) {
    this.h = hier;
    this.goal = goalCell;
    this.N = hier.N;
    this.dist = new Float32Array(hier.N).fill(Infinity);
    this.dir = new Uint8Array(hier.N).fill(255);   // 255 = 无方向（目标/不可达）
    this.cs = hier.cs;
    this.buildMs = 0;
    this.walkN = 0;
  }

  /** 邻接表 + Dijkstra（8 邻接，代价 = 格宽 × 1/√2） */
  build() {
    const t0 = now();
    const h = this.h, cols = h.cols, adj = h.adj, walk = h.walk, cs = h.cs;
    const dist = this.dist, dir = this.dir;
    const goal = this.goal;
    const heap = new Int32Array(h.N + 1);
    let hn = 0;
    const push = (k) => {
      heap[hn] = k;
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (dist[heap[p]] <= dist[heap[i]]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hn];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < hn && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < hn && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t;
        i = m;
      }
      return top;
    };

    dist[goal] = 0;
    dir[goal] = 255;
    push(goal);
    let n = 0;
    // 反向 Dijkstra：边是无向的，所以等价于"每格到目标的距离"
    while (hn > 0) {
      const cur = pop();
      n++;
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      for (let d = 0; d < 8; d++) {
        // 邻接位是"从 cur 出发"的，反向走要用对面的方向 d+4
        const back = (d + 4) & 7;
        if ((adj[cur] & (1 << d)) === 0) continue;
        const nk = (cr + DDr[d]) * cols + (cc + DDc[d]);
        if (!walk[nk]) continue;
        const nd = dist[cur] + DIR_COST[d] * cs;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          // 从 nk 出发要往 cur 走的方向是 back
          dir[nk] = back;
          push(nk);
        }
      }
    }
    this.walkN = n;
    this.buildMs = now() - t0;
    return this.buildMs;
  }

  /** 该格到目标的距离（米）；不可达 = Infinity */
  distAtCell(cell) {
    return cell >= 0 && cell < this.N ? this.dist[cell] : Infinity;
  }

  /** 该格的下坡方向（单位向量）；已到目标/不可达返回 null */
  dirAtCell(cell) {
    if (cell < 0 || cell >= this.N) return null;
    const d = this.dir[cell];
    if (d === 255) return null;
    return [DDc[d], DDr[d]];
  }

  /**
   * 世界坐标处的方向：用 4 邻居的距离做双线性梯度（比单格方向平滑，
   * S5 的局部跟随会直接用它）。
   */
  gradientAt(x, z) {
    const h = this.h, cs = h.cs;
    const fx = (x + h.ng.halfW) / cs;         // 连续格坐标
    const fz = (h.ng.halfH - z) / cs;
    const c0 = Math.floor(fx), r0 = Math.floor(fz);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= h.cols || r0 + 1 >= h.rows) return null;
    const k00 = r0 * h.cols + c0;
    const d00 = this.dist[k00], d10 = this.dist[k00 + 1];
    const d01 = this.dist[k00 + h.cols], d11 = this.dist[k00 + h.cols + 1];
    if (!(d00 < Infinity) && !(d10 < Infinity) && !(d01 < Infinity) && !(d11 < Infinity)) return null;
    // 把 Infinity 换成邻居里的最大值，避免梯度爆掉
    const big = Math.max(
      d00 < Infinity ? d00 : 0, d10 < Infinity ? d10 : 0,
      d01 < Infinity ? d01 : 0, d11 < Infinity ? d11 : 0) + cs * 8;
    const a = d00 < Infinity ? d00 : big, b = d10 < Infinity ? d10 : big;
    const c = d01 < Infinity ? d01 : big, e = d11 < Infinity ? d11 : big;
    const tx = fx - c0, tz = fz - r0;
    const gx = ((b - a) * (1 - tz) + (e - c) * tz);     // d/dx
    const gz = ((c - a) * (1 - tx) + (e - b) * tx);     // d/dy(行方向)
    const len = Math.hypot(gx, gz);
    if (len < 1e-9) return null;
    // 行方向是 +z？ 行 r 增大 = z 减小 → 世界 z 的梯度取反
    return [-gx / len, gz / len];
  }

  memBytes() {
    return this.dist.byteLength + this.dir.byteLength + 64;
  }
}

export class FlowFieldCache {
  /**
   * @param {ReturnType<import('./sectors.js').buildHierarchy>} hier
   */
  constructor(hier, opts = {}) {
    this.h = hier;
    this.maxFields = opts.maxFields || 64;
    this.map = new Map();          // goalCell → FlowField（Map 保持插入序，即 LRU 序）
    this.stats = { builds: 0, hits: 0, misses: 0, evictions: 0, buildMs: 0 };
  }

  /** 目标点 → L1 格（不可走返回 -1） */
  cellOf(x, z) {
    const h = this.h;
    const cc = Math.floor((x + h.ng.halfW) / h.cs);
    const rr = Math.floor((h.ng.halfH - z) / h.cs);
    if (cc < 0 || rr < 0 || cc >= h.cols || rr >= h.rows) return -1;
    const k = rr * h.cols + cc;
    return h.walk[k] ? k : -1;
  }

  /** 取一张场（没有就建，LRU 淘汰） */
  get(goalX, goalZ) {
    const cell = this.cellOf(goalX, goalZ);
    if (cell < 0) return null;
    const hit = this.map.get(cell);
    if (hit) {
      // 触摸：删了再塞回，保持 Map 的插入序 = LRU 序
      this.map.delete(cell);
      this.map.set(cell, hit);
      this.stats.hits++;
      return hit;
    }
    this.stats.misses++;
    const f = new FlowField(this.h, cell);
    f.build();
    this.stats.builds++;
    this.stats.buildMs += f.buildMs;
    this.map.set(cell, f);
    while (this.map.size > this.maxFields) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.stats.evictions++;
    }
    return f;
  }

  /** 世界被改过（手绘墙/路障）→ 全部作废（S6 会细化到区域） */
  invalidateAll() {
    this.map.clear();
  }

  size() { return this.map.size; }

  memBytes() {
    let n = 0;
    for (const f of this.map.values()) n += f.memBytes();
    return n;
  }
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}
