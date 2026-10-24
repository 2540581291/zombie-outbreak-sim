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
    this.stats = { queries: 0, fails: 0, losShortcut: 0, intraAstar: 0, cacheHits: 0 };

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

  /** 吸附到最近的可走 L1 格（优先挑代表点"看得见"的格） */
  snap(x, z, maxR = 3, preferVisible = true) {
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

  plan(fromX, fromZ, toX, toZ) {
    this.stats.queries++;
    const h = this.h;
    const s = this.snap(fromX, fromZ);
    const t = this.snap(toX, toZ);
    if (s < 0 || t < 0) { this.stats.fails++; this.lastFail = 'snap'; return null; }
    if (h.compOf[s] !== h.compOf[t]) { this.stats.fails++; this.lastFail = 'unreachable'; return null; }
    const sSid = h.sectorOf[s], tSid = h.sectorOf[t];

    if (s === t) return this.finish([s], fromX, fromZ, toX, toZ, 'same-cell', 0);
    if (sSid === tSid) {
      const cells = this.intraPath(sSid, s, t);
      if (!cells) { this.stats.fails++; this.lastFail = 'intra'; return null; }
      return this.finish(cells, fromX, fromZ, toX, toZ, 'intra', cells.length);
    }

    let chain = this.abstractSearch(s, t, sSid, tSid);
    if (!chain && this.prune) {
      this.prune = false;
      chain = this.abstractSearch(s, t, sSid, tSid);
      this.prune = true;
    this.weight = 1.3;
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
    return this.finish(cells, fromX, fromZ, toX, toZ, 'hpa', chain.length);
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

  finish(cells, fromX, fromZ, toX, toZ, kind, expanded) {
    const h = this.h;
    const raw = [[fromX, fromZ]];
    for (let i = 0; i < cells.length; i++) raw.push([h.repX[cells[i]], h.repZ[cells[i]]]);
    raw.push([toX, toZ]);

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
