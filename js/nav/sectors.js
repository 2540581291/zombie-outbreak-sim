// ============================================================
//  ZOS-R · NavCore / L1+L2：分层导航图（HPA* 的抽象层）
//
//  L1  8 m 导航格（Berlin：119 k 格）
//      - 每格挑一个"代表点"：格内**最靠近格心**且放得半径 r 的细格。
//        （不挑 clearance 最大的：那样会跑到格角，相邻格连线容易擦墙）
//      - 8 邻接，边逐条校验：代表点之间跑 clearance 感知的 LOS（DDA 逐格）
//      - 室内格不当通路（进楼是 S3 的 portal 图的事），避免"规划能穿楼、
//        移动层不许进"的两套规则打架
//
//  L2  128 m sector（16×16 个 L1 格，Berlin：475 个）
//      - **节点 = 跨越 sector 边界的格子本身**（不是"整段开段"）。
//        每条跨界的合法边 (a,b) 让 a、b 互为 partner，各算一个节点。
//        这是标准 HPA* 的入口模型：进出点就是具体格子，拼接不用沿边界走，
//        因此不会出现"走 100 m 到开段中点"这种虚高路径。
//      - 每个 sector 预计算其节点两两之间的走行距离（簇内 Dijkstra），
//        跨 sector 则通过 partner 边（一格 8 m）连接 —— 这就是抽象图。
//
//  参考：Botea et al. HPA* / Jansen & Buro "HPA* Enhancements"（AAAI AIIDE'07）
// ============================================================

export const DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
export const DIR_COST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
const DDc = DIRS.map((d) => d[0]);
const DDr = DIRS.map((d) => d[1]);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {import('./grid.js').NavGrid} ng
 * @param {{cellSize?:number, sectorCells?:number, radius?:number, excludeIndoor?:boolean}} [opts]
 */
export function buildHierarchy(ng, opts = {}) {
  const t0 = now();
  const cellSize = opts.cellSize || 8;
  const sectorCells = opts.sectorCells || 16;
  const radius = opts.radius === undefined ? 0.35 : opts.radius;
  const excludeIndoor = opts.excludeIndoor !== false;
  const cell = ng.cell;
  const cs = cellSize * cell;
  const cols = Math.ceil(ng.cols / cellSize);
  const rows = Math.ceil(ng.rows / cellSize);
  const N = cols * rows;

  const walk = new Uint8Array(N);
  const repX = new Float32Array(N);
  const repZ = new Float32Array(N);

  // ---------- L1：代表点 + 可走判定 ----------
  const needCl = radius + 0.5 * cell;
  let walkN = 0;
  for (let rr = 0; rr < rows; rr++) {
    const r0 = rr * cellSize;
    const r1 = Math.min(r0 + cellSize, ng.rows);
    const cz = ng.halfH - (r0 + (r1 - r0) / 2) * cell;
    for (let cc = 0; cc < cols; cc++) {
      const c0 = cc * cellSize;
      const c1 = Math.min(c0 + cellSize, ng.cols);
      const cx = (c0 + (c1 - c0) / 2) * cell - ng.halfW;
      let best = -1, bestD = Infinity;
      for (let r = r0; r < r1; r++) {
        const base = r * ng.cols;
        const wz = ng.halfH - (r + 0.5) * cell;
        for (let c = c0; c < c1; c++) {
          const v = ng.grid[base + c];
          if ((v & 1) === 0) continue;
          if (excludeIndoor && (v & 0x18) === 0x18) continue;
          const cl = ng.clearance ? ng.clearance[base + c] : 1;
          if (cl < needCl) continue;
          const wx = (c + 0.5) * cell - ng.halfW;
          const d = (wx - cx) * (wx - cx) + (wz - cz) * (wz - cz);
          if (d < bestD) { best = base + c; bestD = d; }
        }
      }
      if (best >= 0) {
        const k = rr * cols + cc;
        walk[k] = 1;
        walkN++;
        const c = best % ng.cols, r = (best / ng.cols) | 0;
        repX[k] = (c + 0.5) * cell - ng.halfW;
        repZ[k] = ng.halfH - (r + 0.5) * cell;
      }
    }
  }

  // ---------- L1：8 邻接边校验 ----------
  //  关键：判"两格能不能通"不能只看格心连线 —— 城市里相邻两格中间常常
  //  正好是一个楼角，格心连线擦角就判死，整张图会碎成两千多个孤岛。
  //  标准做法是看**共享边**：只要共享边上有一点（这里取边中点）站得下人，
  //  并且两侧格心都能走到这个点，这条边就通（路径允许在边中点折一下）。
  const adj = new Uint8Array(N);
  let edgeN = 0;
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < cols; cc++) {
      const k = rr * cols + cc;
      if (!walk[k]) continue;
      for (let d = 0; d < 8; d++) {
        const nc = cc + DDc[d], nr = rr + DDr[d];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nk = nr * cols + nc;
        if (!walk[nk]) continue;
        if (DDc[d] !== 0 && DDr[d] !== 0) {
          if (!walk[rr * cols + nc] || !walk[nr * cols + cc]) continue;   // 不许切墙角
        }
        const mx = (repX[k] + repX[nk]) * 0.5;
        const mz = (repZ[k] + repZ[nk]) * 0.5;
        if (!ng.walkableR(mx, mz, radius)) continue;
        if (!ng.losClear(repX[k], repZ[k], mx, mz, radius)) continue;
        if (!ng.losClear(mx, mz, repX[nk], repZ[nk], radius)) continue;
        adj[k] |= 1 << d;
        edgeN++;
      }
    }
  }

  // ---------- L2：sector 划分 ----------
  const scols = Math.ceil(cols / sectorCells);
  const srows = Math.ceil(rows / sectorCells);
  const sectorN = scols * srows;
  const sectorOf = new Int32Array(N);
  for (let rr = 0; rr < rows; rr++) {
    const sr = (rr / sectorCells) | 0;
    for (let cc = 0; cc < cols; cc++) {
      sectorOf[rr * cols + cc] = sr * scols + ((cc / sectorCells) | 0);
    }
  }

  // ---------- L2：边界节点（partner 对） ----------
  // partner[c] = 与 c 跨 sector 相邻的那一格；-1 = 不是边界格。
  // 一个格子在 sector 角上可能同时有"竖向 + 横向 + 斜向"三条跨界边，
  // 只留一条会把那条通路从抽象图里抹掉（实测：某些簇一个边界节点都没有，
  // 于是抽象搜索永远到不了 → 规划失败）。这里留 3 个槽位。
  const partner = new Int32Array(N).fill(-1);
  const partnerB = new Int32Array(N).fill(-1);
  const partnerC = new Int32Array(N).fill(-1);
  let nodeN = 0;
  const link = (a, b) => {
    if (partner[a] < 0 && partner[b] < 0) { partner[a] = b; partner[b] = a; nodeN += 2; return; }
    if (partnerB[a] < 0 && partnerB[b] < 0) { partnerB[a] = b; partnerB[b] = a; return; }
    if (partnerC[a] < 0 && partnerC[b] < 0) { partnerC[a] = b; partnerC[b] = a; return; }
  };
  // 竖直边界：列 cc 与 cc+1 之间（含斜向跨越，否则斜着穿边界的通路会丢）
  for (let cc = 0; cc + 1 < cols; cc++) {
    if ((cc + 1) % sectorCells !== 0) continue;
    for (let rr = 0; rr < rows; rr++) {
      const a = rr * cols + cc;
      if (!walk[a]) continue;
      if ((adj[a] & 1) !== 0) link(a, a + 1);                       // E
      if (rr + 1 < rows && (adj[a] & (1 << 1)) !== 0) link(a, a + 1 + cols);   // SE
      if (rr > 0 && (adj[a] & (1 << 7)) !== 0) link(a, a + 1 - cols);          // NE
    }
  }
  // 水平边界：行 rr 与 rr+1 之间
  for (let rr = 0; rr + 1 < rows; rr++) {
    if ((rr + 1) % sectorCells !== 0) continue;
    for (let cc = 0; cc < cols; cc++) {
      const a = rr * cols + cc;
      if (!walk[a]) continue;
      if ((adj[a] & (1 << 2)) !== 0) link(a, a + cols);             // S
      if (cc + 1 < cols && (adj[a] & (1 << 1)) !== 0) link(a, a + cols + 1);   // SE
      if (cc > 0 && (adj[a] & (1 << 3)) !== 0) link(a, a + cols - 1);          // SW
    }
  }

  // 跨 sector 边的代价（两格代表点之间的距离），预先算好，查询时 O(1)
  const partnerCost = new Float32Array(N);
  const partnerCostB = new Float32Array(N);
  const partnerCostC = new Float32Array(N);
  const fillCost = (arr, costArr) => {
    for (let c = 0; c < N; c++) {
      const pc = arr[c];
      if (pc < 0) continue;
      costArr[c] = Math.hypot(repX[pc] - repX[c], repZ[pc] - repZ[c]);
    }
  };
  fillCost(partner, partnerCost);
  fillCost(partnerB, partnerCostB);
  fillCost(partnerC, partnerCostC);

  // ---------- L2：sector 级邻接（给规划器做"分层启发式"用） ----------
  // 每条跨 sector 边（partner 对）折算到 sector 图上，代价取该对的最小值。
  // 有了这张小图（475 个点），规划器就能算出"到目标 sector 还有多远"的
  // 下界，作为 A* 的启发式 —— 比纯欧氏距离强得多，展开量能砍掉大半。
  const sectorAdj = Array.from({ length: sectorN }, () => []);
  {
    const seenPair = new Map();
    const addSlot = (arr) => {
      for (let c = 0; c < N; c++) {
        const p = arr[c];
        if (p < 0) continue;
        const a = sectorOf[c], b = sectorOf[p];
        if (a === b) continue;
        const key = a < b ? a * sectorN + b : b * sectorN + a;
        const w = Math.hypot(repX[p] - repX[c], repZ[p] - repZ[c]);
        const prev = seenPair.get(key);
        if (prev === undefined || w < prev) seenPair.set(key, w);
      }
    };
    addSlot(partner); addSlot(partnerB); addSlot(partnerC);
    for (const [key, w] of seenPair) {
      const a = (key / sectorN) | 0, b = key - a * sectorN;
      sectorAdj[a].push(b, w);
      sectorAdj[b].push(a, w);
    }
  }

  // ---------- 全局连通分量：查询前先判"根本到不了"，省掉最贵的那种空搜 ----------
  const compOf = new Int32Array(N).fill(-1);
  let compN = 0;
  {
    const st = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (!walk[i] || compOf[i] >= 0) continue;
      let sp = 0; st[sp++] = i; compOf[i] = compN;
      while (sp > 0) {
        const cur = st[--sp];
        const cr = (cur / cols) | 0, ccl = cur - cr * cols;
        for (let d = 0; d < 8; d++) {
          if ((adj[cur] & (1 << d)) === 0) continue;
          const nk = (cr + DDr[d]) * cols + (ccl + DDc[d]);
          if (compOf[nk] >= 0) continue;
          compOf[nk] = compN; st[sp++] = nk;
        }
      }
      compN++;
    }
  }

  // ---------- L2：sector 内的连通块（簇） ----------
  // 一个 128 m 的 sector 很容易被一栋楼切成两块。抽象图若把两块当成一个簇，
  // 就会出现"同一簇内两个入口其实走不通" → 抽象搜索永远到不了终点（实测 22% 失败）。
  // 所以簇 = (sector × sector 内连通块)，簇内一定连通。
  const clusterOf = new Int32Array(N).fill(-1);
  const clusterSector = [];
  const clusterNodes = [];
  const stack = new Int32Array(Math.max(1, sectorCells * sectorCells * 4));
  for (let sid = 0; sid < sectorN; sid++) {
    const baseR = ((sid / scols) | 0) * sectorCells;
    const baseC = (sid % scols) * sectorCells;
    const inR = Math.min(sectorCells, rows - baseR);
    const inC = Math.min(sectorCells, cols - baseC);
    for (let r = 0; r < inR; r++) {
      const rowBase = (baseR + r) * cols + baseC;
      for (let c = 0; c < inC; c++) {
        const k0 = rowBase + c;
        if (!walk[k0] || clusterOf[k0] >= 0) continue;
        const cid = clusterNodes.length;
        clusterSector.push(sid);
        clusterNodes.push([]);
        let sp = 0;
        stack[sp++] = k0;
        clusterOf[k0] = cid;
        while (sp > 0) {
          const cur = stack[--sp];
          const cr = (cur / cols) | 0, cc2 = cur - cr * cols;
          for (let d = 0; d < 8; d++) {
            if ((adj[cur] & (1 << d)) === 0) continue;
            const nr = cr + DDr[d], nc = cc2 + DDc[d];
            if (nr < baseR || nr >= baseR + inR || nc < baseC || nc >= baseC + inC) continue;
            const nk = nr * cols + nc;
            if (clusterOf[nk] >= 0) continue;
            clusterOf[nk] = cid;
            stack[sp++] = nk;
          }
        }
      }
    }
  }
  const clusterN = clusterNodes.length;

  // 边界格（节点）按簇归档
  const nodeIdx = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    if (partner[c] < 0 && partnerB[c] < 0 && partnerC[c] < 0) continue;
    const cid = clusterOf[c];
    nodeIdx[c] = clusterNodes[cid].length;
    clusterNodes[cid].push(c);
  }

  // ---------- L2：簇内节点距离矩阵 ----------
  const dist = new Float32Array(N);
  const closed = new Uint8Array(N);
  const heap = new Int32Array(4096);
  const intra = new Array(clusterN).fill(null);
  let dijkstras = 0;

  const heapPush = (hn, k) => {
    heap[hn] = k;
    let i = hn;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[i]]) break;
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
      i = p;
    }
    return hn + 1;
  };
  const heapPop = (hn) => {
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
    return [top, hn];
  };

  for (let sid = 0; sid < clusterN; sid++) {
    const nodes = clusterN ? clusterNodes[sid] : [];
    if (!nodes.length) continue;
    const k = nodes.length;
    const mat = new Float32Array(k * k);
    const sectorOfCluster = clusterSector[sid];
    const baseR = ((sectorOfCluster / scols) | 0) * sectorCells;
    const baseC = (sectorOfCluster % scols) * sectorCells;
    const inR = Math.min(sectorCells, rows - baseR);
    const inC = Math.min(sectorCells, cols - baseC);

    for (let i = 0; i < k; i++) {
      const src = nodes[i];
      for (let r = 0; r < inR; r++) {
        const b = (baseR + r) * cols + baseC;
        for (let c = 0; c < inC; c++) { dist[b + c] = Infinity; closed[b + c] = 0; }
      }
      dist[src] = 0;
      let hn = heapPush(0, src);
      while (hn > 0) {
        let cur; [cur, hn] = heapPop(hn);
        if (closed[cur]) continue;
        closed[cur] = 1;
        const cr = (cur / cols) | 0, cc2 = cur - cr * cols;
        for (let d = 0; d < 8; d++) {
          if ((adj[cur] & (1 << d)) === 0) continue;
          const nk = (cr + DDr[d]) * cols + (cc2 + DDc[d]);
          if (closed[nk]) continue;
          const nd = dist[cur] + DIR_COST[d] * cs;
          if (nd < dist[nk]) { dist[nk] = nd; hn = heapPush(hn, nk); }
        }
      }
      dijkstras++;
      for (let j = 0; j < k; j++) mat[i * k + j] = dist[nodes[j]];
    }
    intra[sid] = { k, mat, nodes };
  }

  return {
    ng, cellSize, cell, cs, sectorCells, radius, excludeIndoor,
    cols, rows, N, walk, repX, repZ, adj,
    scols, srows, sectorN, sectorOf,
    partner, partnerB, partnerC, partnerCost, partnerCostB, partnerCostC, nodeIdx,
    clusterOf, nodeIdx, clusterNodes, clusterSector,
    sectorAdj, compOf, compN,
    intra,
    stats: {
      cells: N, walkable: walkN, edges: edgeN,
      sectors: sectorN, clusters: clusterN, nodes: nodeN, dijkstras, components: compN,
      buildMs: now() - t0,
    },
  };
}
