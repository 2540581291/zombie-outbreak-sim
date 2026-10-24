// ============================================================
//  ZOS-R · NavCore / HPA* 规划器
//
//  一次查询：
//    1. 起终点吸附到最近的 8 m 可走格（优先挑"看得见"的）
//    2. 同格 → 直连；同 sector → 簇内 A*
//    3. 跨 sector → 抽象 A*：节点 = **边界格**，簇内边 = 预先算好的
//       节点距离矩阵，跨区 = partner 边（一格 8 m）
//    4. 入口链还原成 8 m 格链（每段簇内 A*，带 LOS 直连捷径 + 缓存）
//    5. clearance 感知的 string pulling（DDA 逐格，不会擦角穿墙）
//
//  和旧实现的关键差别：
//    - 8 邻接 + octile 启发式（旧的是 4 邻接，路径天生偏长）
//    - 分层：跨城查询不会展开几万个格（旧的 30000 上限就是撞死在这里）
//    - 节点是具体格子：进出点精确，不会为了"走到开段中点"而绕路
// ============================================================

import { DIRS } from './sectors.js';
import { Portals } from './portal.js';

const DDc = DIRS.map((d) => d[0]);
const DDr = DIRS.map((d) => d[1]);

export class Planner {
  /**
   * @param {import('./grid.js').NavGrid} ng
   * @param {ReturnType<import('./sectors.js').buildHierarchy>} hier
   */
  constructor(ng, hier, opts = {}) {
    this.ng = ng;
    this.h = hier;
    this.radius = hier.radius;
    this.cs = hier.cs;
    this.lastFail = '';
    this.prune = true;
    this.weight = 1.3;
    this.debug = false;
    this.stats = { queries: 0, fails: 0, losShortcut: 0, intraAstar: 0, cacheHits: 0, indoor: 0 };

    const N = hier.N;
    // 簇内 A*
    this.gA = new Float32Array(N);
    this.fA = new Float32Array(N);
    this.cameA = new Int32Array(N);
    this.seenA = new Int32Array(N);
    this.closedA = new Int32Array(N);
    this.stampA = 0;
    this.heapA = new Int32Array(N + 1);

    // sector 内 Dijkstra
    this.dist = new Float32Array(N);
    this.closedD = new Uint8Array(N);
    this.heapD = new Int32Array(N);
    this.hD = new Int32Array(N + 1);

    // 抽象 A*（节点就是格子）
    this.gN = new Float32Array(N);
    this.fN = new Float32Array(N);
    this.hN = new Float32Array(N);
    this.hStampN = new Int32Array(N);
    this.cameN = new Int32Array(N);
    this.seenN = new Int32Array(N);
    this.closedN = new Int32Array(N);
    this.gCostN = new Float32Array(N);
    this.gCostStampN = new Int32Array(N);
    this.stampN = 0;
    this.heapN = new Int32Array(N * 2 + 8);

    // sector 级启发式（475 个点的小图 Dijkstra）
    const SN = hier.sectorN;
    this.sectorH = new Float32Array(SN);
    this.sectorSeen = new Int32Array(SN);
    this.sectorClosed = new Uint8Array(SN);
    this.sectorHeap = new Int32Array(SN * 4 + 8);
    this.sectorStamp = 0;

    // 门/室内（S3）：门 = 显式 portal，替掉旧的 56 MB 门场
    this.portals = opts.portals || new Portals(ng, { radius: this.radius });

    this.cache = new Map();
    this.cacheCap = opts.cacheCap || 40000;
  }

  /**
   * 从 targetSid 出发在 sector 图上做一次 Dijkstra，得到"每个 sector 到目标
   * sector 至少还要走多远"。作为抽象 A* 的**下界启发式**（比欧氏距离强得多）。
   */
  sectorHeuristic(targetSid) {
    const h = this.h;
    const stamp = ++this.sectorStamp;
    const d = this.sectorH, seen = this.sectorSeen, closed = this.sectorClosed;
    const heap = this.sectorHeap;
    let hn = 0;
    const push = (sid) => {
      heap[hn] = sid;
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (d[heap[p]] <= d[heap[i]]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hn];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < hn && d[heap[l]] < d[heap[m]]) m = l;
        if (r < hn && d[heap[r]] < d[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
      }
      return top;
    };
    for (let i = 0; i < h.sectorN; i++) { seen[i] = stamp; d[i] = Infinity; closed[i] = 0; }
    d[targetSid] = 0;
    push(targetSid);
    while (hn > 0) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const adj = h.sectorAdj[cur];
      for (let i = 0; i < adj.length; i += 2) {
        const nb = adj[i], w = adj[i + 1];
        if (closed[nb]) continue;
        const nd = d[cur] + w;
        if (nd < d[nb]) { d[nb] = nd; push(nb); }
      }
    }
    return d;
  }

  // ---------------- 基础换算 ----------------

  cellAt(x, z) {
    const h = this.h;
    const cc = Math.floor((x + this.ng.halfW) / h.cs);
    const rr = Math.floor((this.ng.halfH - z) / h.cs);
    if (cc < 0 || rr < 0 || cc >= h.cols || rr >= h.rows) return -1;
    return rr * h.cols + cc;
  }

  /** 吸附到最近的可走 L1 格（优先挑代表点"看得见"的格）。
   *  wantComp >= 0 时只接受该连通分量里的格子 —— 门口那一格常常落在
   *  楼与楼之间的"口袋"里，和街面根本不是一张图，需要往外多找几格。 */
  snap(x, z, maxR = 3, preferVisible = true, wantComp = -1) {
    const h = this.h;
    const cc0 = Math.floor((x + this.ng.halfW) / h.cs);
    const rr0 = Math.floor((this.ng.halfH - z) / h.cs);
    let best = -1, bd = Infinity;
    let bestAny = -1, bdAny = Infinity;
    const canSee = this.ng.walkableR(x, z, this.radius);
    for (let dr = -maxR; dr <= maxR; dr++) {
      const rr = rr0 + dr;
      if (rr < 0 || rr >= h.rows) continue;
      for (let dc = -maxR; dc <= maxR; dc++) {
        const cc = cc0 + dc;
        if (cc < 0 || cc >= h.cols) continue;
        const k = rr * h.cols + cc;
        if (!h.walk[k]) continue;
        if (wantComp >= 0 && h.compOf[k] !== wantComp) continue;
        const dx = h.repX[k] - x, dz = h.repZ[k] - z;
        const d = dx * dx + dz * dz;
        if (d < bdAny) { bdAny = d; bestAny = k; }
        if (!preferVisible || !canSee || d >= bd) continue;
        if (!this.losOk(x, z, h.repX[k], h.repZ[k])) continue;
        bd = d; best = k;
      }
    }
    return best >= 0 ? best : bestAny;
  }

  losOk(ax, az, bx, bz) {
    return this.ng.losClear(ax, az, bx, bz, this.radius);
  }

  // ---------------- 簇内 A* ----------------

  intraPath(sid, a, b) {
    if (a === b) return [a];
    if (a < 0 || b < 0) return null;
    const key = (sid * this.h.N + a) * this.h.N + b;   // sid 必须进 key：同一对格子在不同 sector 边界上不该串用
    const cached = this.cache.get(key);
    if (cached) { this.stats.cacheHits++; return cached; }

    let out;
    if (this.losOk(this.h.repX[a], this.h.repZ[a], this.h.repX[b], this.h.repZ[b])) {
      out = [a, b];
      this.stats.losShortcut++;
    } else {
      out = this.astarCells(sid, a, b);
      this.stats.intraAstar++;
    }
    if (out) {
      if (this.cache.size > this.cacheCap) this.cache.clear();
      this.cache.set(key, out);
    }
    return out;
  }

  astarCells(sid, a, b) {
    const h = this.h;
    const cols = h.cols, adj = h.adj, walk = h.walk, cs = h.cs;
    const baseR = ((sid / h.scols) | 0) * h.sectorCells;
    const baseC = (sid % h.scols) * h.sectorCells;
    const inR = Math.min(h.sectorCells, h.rows - baseR);
    const inC = Math.min(h.sectorCells, h.cols - baseC);
    const minR = baseR, maxR = baseR + inR - 1, minC = baseC, maxC = baseC + inC - 1;
    const stamp = ++this.stampA;
    const g = this.gA, f = this.fA, came = this.cameA, seen = this.seenA;
    const closed = this.closedA, heap = this.heapA;
    const bc = b % cols, br = (b / cols) | 0;
    let hn = 0;
    const push = (k) => {
      heap[hn] = k;
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
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
        if (l < hn && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hn && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t;
        i = m;
      }
      return top;
    };

    const octile = (c1, r1) => {
      const dc = Math.abs(c1 - bc), dr = Math.abs(r1 - br);
      return cs * (Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr));
    };
    g[a] = 0; came[a] = -1; seen[a] = stamp;
    f[a] = octile(a % cols, (a / cols) | 0);
    push(a);
    let found = false, expanded = 0;
    while (hn > 0 && expanded < 1024) {
      const cur = pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      expanded++;
      if (cur === b) { found = true; break; }
      const cr = (cur / cols) | 0, cc2 = cur - cr * cols;
      for (let d = 0; d < 8; d++) {
        if ((adj[cur] & (1 << d)) === 0) continue;
        const nr = cr + DDr[d], nc = cc2 + DDc[d];
        if (nr < minR || nr > maxR || nc < minC || nc > maxC) continue;
        const nk = nr * cols + nc;
        if (!walk[nk] || closed[nk] === stamp) continue;
        const ng2 = g[cur] + ((d & 1) ? cs * Math.SQRT2 : cs);
        if (seen[nk] === stamp && ng2 >= g[nk]) continue;
        seen[nk] = stamp;
        g[nk] = ng2;
        f[nk] = ng2 + octile(nc, nr);
        came[nk] = cur;
        push(nk);
      }
    }
    if (!found) return null;
    const out = [];
    let k = b;
    while (k >= 0 && out.length < 2048) { out.push(k); k = came[k]; }
    out.reverse();
    return out;
  }

  // ---------------- sector 内 Dijkstra ----------------

  sectorDijkstra(sid, sources) {
    const h = this.h;
    const cols = h.cols, adj = h.adj, cs = h.cs;
    const baseR = ((sid / h.scols) | 0) * h.sectorCells;
    const baseC = (sid % h.scols) * h.sectorCells;
    const inR = Math.min(h.sectorCells, h.rows - baseR);
    const inC = Math.min(h.sectorCells, h.cols - baseC);
    const dist = this.dist, closed = this.closedD, heap = this.heapD;
    for (let r = 0; r < inR; r++) {
      const b = (baseR + r) * cols + baseC;
      for (let c = 0; c < inC; c++) { dist[b + c] = Infinity; closed[b + c] = 0; }
    }
    let hn = 0;
    const push = (k) => {
      heap[hn] = k;
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (dist[heap[p]] <= dist[heap[i]]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
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
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
      }
      return top;
    };
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s < 0 || !h.walk[s]) continue;
      dist[s] = 0; push(s);
    }
    while (hn > 0) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cr = (cur / cols) | 0, cc2 = cur - cr * cols;
      for (let d = 0; d < 8; d++) {
        if ((adj[cur] & (1 << d)) === 0) continue;
        const nk = (cr + DDr[d]) * cols + (cc2 + DDc[d]);
        if (closed[nk]) continue;
        const nd = dist[cur] + ((d & 1) ? cs * Math.SQRT2 : cs);
        if (nd < dist[nk]) { dist[nk] = nd; push(nk); }
      }
    }
    return dist;
  }

  // ---------------- 主查询 ----------------

  /**
   * 对外唯一入口：自动处理"起点/终点在室内"的情况。
   * 室内段走门 portal（BFS 出折线），室外段走 HPA*。
   */
  plan(fromX, fromZ, toX, toZ) {
    this.stats.queries++;
    const ng = this.ng;
    const P = this.portals;
    const sIn = ng.indoor(fromX, fromZ);
    const tIn = ng.indoor(toX, toZ);

    // 全室外：直通
    if (!sIn && !tIn) return this.planOutdoor(fromX, fromZ, toX, toZ);
    if (!P) { this.stats.fails++; this.lastFail = 'no-portals'; return null; }

    // 都在室内：同一间房就直接室内直达
    if (sIn && tIn) {
      const same = P.roomRoute(fromX, fromZ, toX, toZ);
      if (same) { this.stats.indoor++; return this.finishRaw(same, 'indoor', 0); }
    }

    // 起点出口候选（室外端点则只有一个"零长度出口"）
    const sEx = sIn ? P.exitsFrom(fromX, fromZ, 3) : [{ points: [], outdoor: [fromX, fromZ] }];
    const tEx = tIn ? P.exitsFrom(toX, toZ, 3) : [{ points: [], outdoor: [toX, toZ] }];
    if (!sEx.length) { this.stats.fails++; this.lastFail = 'start-sealed'; return null; }
    if (!tEx.length) { this.stats.fails++; this.lastFail = 'goal-sealed'; return null; }

    // 逐个组合试：门可能通向另一个院子之类的不连通区域
    let best = null, bestCost = Infinity;
    for (const a of sEx) {
      for (const b of tEx) {
        const core = this.planOutdoor(a.outdoor[0], a.outdoor[1], b.outdoor[0], b.outdoor[1]);
        if (!core) continue;
        const cost = (a.cost || 0) + core.cost + (b.cost || 0);
        if (cost < bestCost) { bestCost = cost; best = { a, b, core }; }
      }
    }
    if (!best) { this.stats.fails++; this.lastFail = 'indoor-exit'; return null; }
    this.stats.indoor++;

    // 拼接：起点 → 门 → （室外段）→ 门 → 终点
    const raw = [[fromX, fromZ]];
    for (const p of best.a.points) raw.push(p);
    for (const p of best.core.pts) raw.push(p);
    for (let i = best.b.points.length - 1; i >= 0; i--) raw.push(best.b.points[i]);
    raw.push([toX, toZ]);
    return this.finishRaw(raw, 'indoor+hpa', best.core.expanded);
  }

  /** 纯室外查询（原来的 plan 主体） */
  planOutdoor(fromX, fromZ, toX, toZ) {
    const h = this.h;
    const ng = this.ng;
    let s = this.snap(fromX, fromZ);
    let t = this.snap(toX, toZ);
    if (s < 0 || t < 0) { this.stats.fails++; this.lastFail = 'snap'; return null; }

    let prePts = null, postPts = null;
    let planFromX = fromX, planFromZ = fromZ;
    let planToX = toX, planToZ = toZ;

    if (h.compOf[s] !== h.compOf[t]) {
      // 两侧不在一张 8 m 连通图里：多半是门口/楼缝那一格落在"口袋"里。
      // 在 1 m 网格上走一小段，接到对方所在的分量上（这才是真的走得过去的路）。
      // accept 还要检查"这一格能看见它所在 8 m 格的代表点"，
      // 这样连接段的最后一步和粗网格路径的第一段就是同一段可走的路。
      let hit8 = -1;
      const acceptFor = (wantComp) => (cell) => {
        const r = (cell / ng.cols) | 0, c = cell - r * ng.cols;
        const k = ((r / h.cellSize) | 0) * h.cols + ((c / h.cellSize) | 0);
        if (h.walk[k] !== 1 || h.compOf[k] !== wantComp) return false;
        // 收尾条件：走到代表点 2.2 m 以内（这样最后一跳一定在同一个 8 m 格里）
        const ctr = ng.center(cell);
        const dd = Math.hypot(ctr[0] - h.repX[k], ctr[1] - h.repZ[k]);
        if (dd > 1.2 && !this.losOk(ctr[0], ctr[1], h.repX[k], h.repZ[k])) return false;
        hit8 = k;
        return true;
      };
      const w1 = this.portals.fineWalk(fromX, fromZ, acceptFor(h.compOf[t]), 12000);
      if (w1 && w1.length > 1 && hit8 >= 0) {
        prePts = w1;
        s = hit8;
        this.stats.fineWalk = (this.stats.fineWalk || 0) + 1;
      } else {
        hit8 = -1;
        const w2 = this.portals.fineWalk(toX, toZ, acceptFor(h.compOf[s]), 12000);
        if (w2 && w2.length > 1 && hit8 >= 0) {
          const rev = [...w2].reverse();
          postPts = rev;
          t = hit8;
          this.stats.fineWalk = (this.stats.fineWalk || 0) + 1;
        }
      }
      if (s < 0 || t < 0 || h.compOf[s] !== h.compOf[t]) {
        this.stats.fails++; this.lastFail = 'unreachable'; return null;
      }
    }
    const sSid = h.sectorOf[s], tSid = h.sectorOf[t];

    if (s === t) return this.finish([s], fromX, fromZ, toX, toZ, 'same-cell', 0, prePts, postPts);
    if (sSid === tSid) {
      const cells = this.intraPath(sSid, s, t);
      if (!cells) { this.stats.fails++; this.lastFail = 'intra'; return null; }
      return this.finish(cells, fromX, fromZ, toX, toZ, 'intra', cells.length, prePts, postPts);
    }

    let chain = this.abstractSearch(s, t, sSid, tSid);
    if (!chain && this.prune) {
      this.prune = false;
      chain = this.abstractSearch(s, t, sSid, tSid);
      this.prune = true;
    }
    if (!chain) { this.stats.fails++; return null; }

    const cells = [];
    const pushAll = (arr) => {
      if (!arr) return false;
      for (let i = 0; i < arr.length; i++) {
        if (cells.length && cells[cells.length - 1] === arr[i]) continue;
        cells.push(arr[i]);
      }
      return true;
    };

    if (!pushAll(this.intraPath(sSid, s, chain[0]))) {
      this.stats.fails++; this.lastFail = 'leg-start'; return null;
    }
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      if (h.partner[a] === b || h.partnerB[a] === b || h.partnerC[a] === b) { cells.push(b); continue; }   // 跨 sector：一格
      if (!pushAll(this.intraPath(h.sectorOf[a], a, b))) {
        this.stats.fails++; this.lastFail = 'leg-mid'; return null;
      }
    }
    if (!pushAll(this.intraPath(tSid, chain[chain.length - 1], t))) {
      this.stats.fails++; this.lastFail = 'leg-goal'; return null;
    }
    return this.finish(cells, fromX, fromZ, toX, toZ, 'hpa', chain.length, prePts, postPts);
  }

  abstractSearch(s, t, sSid, tSid) {
    const h = this.h;
    const sCluster = h.clusterOf[s], tCluster = h.clusterOf[t];
    if (sCluster < 0) { this.lastFail = 'start-no-cluster'; return null; }
    if (tCluster < 0) { this.lastFail = 'goal-no-cluster'; return null; }

    const stamp = ++this.stampN;
    const g = this.gN, f = this.fN, hh = this.hN, hs = this.hStampN;
    const came = this.cameN, seen = this.seenN, closed = this.closedN, heap = this.heapN;
    const gCost = this.gCostN;
    const gCostStamp = this.gCostStampN;
    const tX = h.repX[t], tZ = h.repZ[t];
    // 走廊剪枝：只考虑"起终点连线附近"的节点。城市里绕行不会离直线太远，
    // 这一步能把抽象搜索的展开量砍掉一个数量级（HPA* 的常规优化）。
    const sX = h.repX[s], sZ = h.repZ[s];
    const ldx = tX - sX, ldz = tZ - sZ;
    const lLen = Math.max(1e-6, Math.sqrt(ldx * ldx + ldz * ldz));
    const ux = ldx / lLen, uz = ldz / lLen;
    const perpMax = this.prune ? (200 + 0.25 * lLen) : Infinity;
    const inCorridor = (c) => {
      if (perpMax === Infinity) return true;
      const perp = Math.abs(ux * (h.repZ[c] - sZ) - uz * (h.repX[c] - sX));
      return perp <= perpMax;
    };

    // 启发式：欧氏距离 × 权重 W（加权 A*）。W=1 时严格最优但展开量大；
    // 这里用 1.6，路径长度实测仍在 1.0× 附近（string pulling 会把多余拐弯剪掉）。
    const W = this.weight || 1.6;
    const heur = (c) => {
      if (hs[c] === stamp) return hh[c];
      const dx = h.repX[c] - tX, dz = h.repZ[c] - tZ;
      const v = Math.sqrt(dx * dx + dz * dz) * W;
      hs[c] = stamp; hh[c] = v;
      return v;
    };
    let hn = 0;
    const push = (c) => {
      heap[hn] = c;
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hn];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < hn && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hn && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
      }
      return top;
    };

    // 起点/终点 → 各自 sector 的节点
    const dS = this.sectorDijkstra(sSid, [s]);
    for (const c of h.clusterNodes[sCluster]) {
      const d = dS[c];
      if (!(d < Infinity)) continue;
      seen[c] = stamp; g[c] = d; f[c] = d + heur(c); came[c] = -1;
      push(c);
    }
    const dT = this.sectorDijkstra(tSid, [t]);
    for (const c of h.clusterNodes[tCluster]) { gCost[c] = dT[c]; gCostStamp[c] = stamp; }

    let expanded = 0;
    let best = -1, bestC = Infinity;
    while (hn > 0 && expanded < 12000) {
      const cur = pop();
      if (closed[cur] === stamp) continue;
      // 提前退出：剩下节点的 g 已经不小于已知最优总代价，再搜也不可能更短
      if (g[cur] >= bestC) break;
      closed[cur] = stamp;
      expanded++;

      // 当前节点本身就可能是终点侧的节点
      const gc0 = gCostStamp[cur] === stamp ? gCost[cur] : Infinity;
      if (gc0 < Infinity) {
        const tot0 = g[cur] + gc0;
        if (tot0 < bestC) { bestC = tot0; best = cur; }
      }

      // ① 跨 sector：partner 边（一格；一个角格最多有 3 个 partner 槽位）
      if (!inCorridor(cur)) continue;
      for (let slot = 0; slot < 3; slot++) {
        const p = slot === 0 ? h.partner[cur] : slot === 1 ? h.partnerB[cur] : h.partnerC[cur];
        if (p < 0 || closed[p] === stamp) continue;
        const w = slot === 0 ? h.partnerCost[cur] : slot === 1 ? h.partnerCostB[cur] : h.partnerCostC[cur];
        const ng2 = g[cur] + w;
        if (seen[p] === stamp && ng2 >= g[p]) continue;
        seen[p] = stamp; g[p] = ng2; f[p] = ng2 + heur(p); came[p] = cur;
        push(p);
      }

      // ② 簇内：同一 sector 的其它节点
      const box = h.intra[h.clusterOf[cur]];
      if (box) {
        const nodes = box.nodes, k = box.k;
        const row = h.nodeIdx[cur] * k;
        for (let j = 0; j < k; j++) {
          const w = box.mat[row + j];
          if (!(w < Infinity)) continue;
          const nid = nodes[j];
          if (nid === cur || closed[nid] === stamp) continue;
          const ng2 = g[cur] + w;
          if (seen[nid] === stamp && ng2 >= g[nid]) continue;
          seen[nid] = stamp; g[nid] = ng2; f[nid] = ng2 + heur(nid); came[nid] = cur;
          push(nid);
        }
      }
    }

    this.lastExpanded = expanded;
    if (best < 0) { this.lastFail = 'no-goal-node'; return null; }
    const chain = [];
    let cur = best, guard = 0;
    while (cur >= 0 && guard++ < 100000) { chain.push(cur); cur = came[cur]; }
    chain.reverse();
    if (chain[0] !== best && chain.length < 2) { this.lastFail = 'chain'; return null; }
    return chain;
  }

  // ---------------- 收尾：格链 → 世界折线（string pulling） ----------------

  finish(cells, fromX, fromZ, toX, toZ, kind, expanded, prePts, postPts) {
    const h = this.h;
    const raw = [[fromX, fromZ]];
    if (prePts) for (const p of prePts) raw.push(p);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      // 相邻两格之间插"共享边连接点"：建图时用哪一点判通，还原就必须走那一点
      if (i > 0) {
        const a = cells[i - 1];
        const cp = this.ng.connectPoint(h.repX[a], h.repZ[a], h.repX[c], h.repZ[c], this.radius);
        if (cp) raw.push(cp);
      }
      raw.push([h.repX[c], h.repZ[c]]);
    }
    if (postPts) for (const p of postPts) raw.push(p);
    raw.push([toX, toZ]);
    return this.finishRaw(raw, kind, expanded);
  }

  /** 已经是世界折线（含室内段）时的收尾：string pulling + 代价 */
  finishRaw(raw, kind, expanded) {
    if (this.debug) {
      for (let k = 1; k < raw.length; k++) {
        if (!this.losOk(raw[k - 1][0], raw[k - 1][1], raw[k][0], raw[k][1])) {
          console.log(`[DEBUG] 不可见相邻对 #${k}  ` +
            `(${raw[k - 1][0].toFixed(1)},${raw[k - 1][1].toFixed(1)}) -> (${raw[k][0].toFixed(1)},${raw[k][1].toFixed(1)})`);
        }
      }
    }
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = i + 1;
      while (j + 1 < raw.length && this.losOk(raw[i][0], raw[i][1], raw[j + 1][0], raw[j + 1][1])) j++;
      out.push(raw[j]);
      i = j;
    }
    let cost = 0;
    for (let k = 1; k < out.length; k++) {
      cost += Math.hypot(out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]);
    }
    return { pts: out, cost, expanded, kind };
  }
}
