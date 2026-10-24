// ============================================================
//  ZOS-R · NavCore / S6：动态世界（路障、手绘墙）
//
//  问题：L1/L2 是启动时一次性建好的。路障一铺，8 m 图就过期了 ——
//  规划还会从路障中间穿过去，人走过去被挡、再规划、再穿…
//
//  两种改法，按代价分：
//    A. blockCells()  —— 局部改 8 m 图：把受影响的格子标死、断边、清 partner，
//       然后**只重算受影响的簇**（实测 0.2 ms/簇），最后清规划缓存与流场。
//       适合玩家在局内铺路障（不需要重建全图）。
//    B. rebuildAll()  —— 重算 clearance（EDT 270 ms）+ 重建分层（340 ms）。
//       适合编辑器里手绘墙（一次操作，可以接受一次卡顿）。
//
//  为什么局部改可行：路径的有效性由 8 m 图的邻接位和簇内距离矩阵决定，
//  这两样都能按"受影响的格子/簇"局部更新；细网格（1 m）是 steering 直接读的，
//  改 nav.grid 立刻生效，不需要任何重建。
// ============================================================

import { computeClusterIntra, DIRS } from './sectors.js';

const DDc = DIRS.map((d) => d[0]);
const DDr = DIRS.map((d) => d[1]);

/**
 * 把若干 1 m 格标成不可走，并局部修复 8 m 图。
 * 调用前 nav.grid 里的这些格子应该已经被写成 0（sim.barricade 就是这么干的）。
 *
 * @param {import('./index.js').NavWorld} world
 * @param {Iterable<number>} cells 1 m 格下标
 * @param {{recomputeComponents?:boolean}} [opts]
 * @returns {{cells8:number, clusters:number, ms:number}}
 */
export function blockCells(world, cells, opts = {}) {
  const t0 = now();
  const h = world.hier;
  const ng = world.ng;
  const N = h.N, cols = h.cols;
  const cs = h.cellSize;

  // 1) 1 m 格 → 受影响的 8 m 格
  const touched = [];
  const seen = new Set();
  for (const i of cells) {
    const c = i % ng.cols, r = (i / ng.cols) | 0;
    const k = ((r / cs) | 0) * cols + ((c / cs) | 0);
    if (k < 0 || k >= N || seen.has(k)) continue;
    seen.add(k);
    touched.push(k);
  }

  // 2) 标死 + 断边 + 清 partner（受影响的簇要一并收集）
  const affected = new Set();
  for (const k of touched) {
    affected.add(h.clusterOf[k]);
    h.walk[k] = 0;
    const kr = (k / cols) | 0, kc = k - kr * cols;
    for (let d = 0; d < 8; d++) {
      const nr = kr + DDr[d], nc = kc + DDc[d];
      if (nr < 0 || nc < 0 || nr >= h.rows || nc >= cols) continue;
      const nk = nr * cols + nc;
      // 邻居指向 k 的那条边要断掉
      h.adj[nk] &= ~(1 << ((d + 4) & 7));
      affected.add(h.clusterOf[nk]);
    }
    h.adj[k] = 0;
    for (const arr of [h.partner, h.partnerB, h.partnerC]) {
      const p = arr[k];
      if (p >= 0) {
        arr[k] = -1;
        if (arr[p] === k) arr[p] = -1;
        affected.add(h.clusterOf[p]);
      }
    }
    if (h.nodeIdx[k] >= 0) h.nodeIdx[k] = -1;
  }

  // 3) 只重算受影响的簇（0.2 ms 量级）
  let rebuilt = 0;
  for (const cid of affected) {
    if (cid < 0 || cid >= h.clusterNodes.length) continue;
    computeClusterIntra(h, cid);
    rebuilt++;
  }

  // 4) 连通分量：路障可能把一条街切断，分量得重算（8 m 图 12 万格，几 ms）
  if (opts.recomputeComponents !== false) recomputeComponents(h);

  // 5) 缓存全部作废（规划器的簇内路径缓存、流场）
  world.invalidate('block');

  return { cells8: touched.length, clusters: rebuilt, ms: now() - t0 };
}

/** 重算 8 m 图的连通分量（BFS，12 万格 ≈ 5 ms） */
export function recomputeComponents(h) {
  const N = h.N, cols = h.cols, adj = h.adj, walk = h.walk;
  const compOf = h.compOf;
  compOf.fill(-1);
  let nc = 0;
  const st = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!walk[i] || compOf[i] >= 0) continue;
    let sp = 0;
    st[sp++] = i;
    compOf[i] = nc;
    while (sp > 0) {
      const cur = st[--sp];
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      for (let d = 0; d < 8; d++) {
        if ((adj[cur] & (1 << d)) === 0) continue;
        const nk = (cr + DDr[d]) * cols + (cc + DDc[d]);
        if (compOf[nk] >= 0) continue;
        compOf[nk] = nc;
        st[sp++] = nk;
      }
    }
    nc++;
  }
  h.compN = nc;
  return nc;
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}
