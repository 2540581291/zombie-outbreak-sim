// ============================================================
//  ZOS-R · NavCore 门面
//
//  把 L0~L2 打包成一个对象，并且**每个 nav 只建一次**（懒加载）。
//  sim 重置多次也不会重复建图（建图 ~750 ms，不能拖进每局）。
//
//  用法：
//      import { getNavWorld } from './js/nav/index.js';
//      const world = getNavWorld(nav);     // 第一次调用会建图
//      world.planner.plan(...) / world.flows.get(...) / world.portals.exitsFrom(...)
// ============================================================

import { NavGrid } from './grid.js';
import { buildHierarchy } from './sectors.js';
import { Portals } from './portal.js';
import { Planner } from './planner.js';
import { FlowFieldCache } from './flowfield.js';
import { Steering } from './steering.js';
import { blockCells } from './dynamic.js';

export { NavGrid, buildHierarchy, Portals, Planner, FlowFieldCache, Steering };

export class NavWorld {
  constructor(nav, opts = {}) {
    const t0 = performance.now();
    this.ng = new NavGrid(nav);
    this.edtMs = this.ng.buildClearance();
    const t1 = performance.now();
    this.hier = buildHierarchy(this.ng, {
      cellSize: opts.cellSize || 8,
      sectorCells: opts.sectorCells || 16,
      radius: opts.radius === undefined ? 0.35 : opts.radius,
    });
    this.hierMs = performance.now() - t1;
    const t2 = performance.now();
    this.portals = new Portals(this.ng, { radius: this.radius });
    this.planner = new Planner(this.ng, this.hier, { portals: this.portals });
    this.flows = new FlowFieldCache(this.hier, { maxFields: opts.maxFields || 48 });
    this.doorFieldMs = 0;
    this.buildDoorAnchorField();
    this.portalMs = performance.now() - t2;
    this.buildMs = performance.now() - t0;
    this.opts = opts;
  }

  get radius() { return this.hier.radius; }

  /**
   * 门锚点场：8 m 格 → "最近那扇门的室外出口格"。
   *
   * 这是旧 `doorDist/doorOf`（1 m 格、56 MB）的替代品：
   * 只回答"这栋楼的室外落脚点在哪儿"，在 8 m 格上做一次多源 BFS，
   * **476 KB / 5 ms**，而且是几何近邻（穿不穿墙都无所谓，要的就是最近的门）。
   */
  buildDoorAnchorField() {
    const t0 = performance.now();
    const h = this.hier, ng = this.ng;
    const N = h.N, cols = h.cols, cs = h.cellSize;
    const anchor = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    for (const [cell, outdoor] of this.portals.doorOutdoor) {
      const c = cell % ng.cols, r = (cell / ng.cols) | 0;
      const k = ((r / cs) | 0) * cols + ((c / cs) | 0);
      if (anchor[k] === -1) { anchor[k] = outdoor; q[tail++] = k; }
    }
    while (head < tail) {
      const cur = q[head++];
      const src = anchor[cur];
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      for (let d = 0; d < 8; d++) {
        const nr = cr + (d === 1 || d === 2 || d === 3 ? 1 : d === 5 || d === 6 || d === 7 ? -1 : 0);
        const nc = cc + (d === 0 || d === 1 || d === 7 ? 1 : d === 3 || d === 4 || d === 5 ? -1 : 0);
        if (nr < 0 || nc < 0 || nr >= h.rows || nc >= cols) continue;
        const nk = nr * cols + nc;
        if (anchor[nk] !== -1) continue;
        anchor[nk] = src;
        q[tail++] = nk;
      }
    }
    this.doorAnchorField = anchor;
    this.doorFieldMs = performance.now() - t0;
  }

  /**
   * 室内点 → 这栋楼最近那扇门的室外落脚点（世界坐标）；找不到返回 null。
   * 旧实现是 1 m 全图门场；这里是 8 m 格上的锚点场，O(1)。
   */
  doorAnchor(x, z) {
    const h = this.hier, ng = this.ng;
    const cc = Math.floor((x + ng.halfW) / h.cs);
    const rr = Math.floor((ng.halfH - z) / h.cs);
    if (cc < 0 || rr < 0 || cc >= h.cols || rr >= h.rows) return null;
    const a = this.doorAnchorField[rr * h.cols + cc];
    return a >= 0 ? ng.center(a) : null;
  }

  /** 给 sim 做局部跟随用（数组由 sim 提供，避免多一份状态） */
  makeSteering(arrays) {
    return new Steering(this.ng, { radius: this.radius, ...arrays });
  }

  /** 世界被改过（手绘墙/路障）→ 场与规划缓存全部作废 */
  invalidate(reason = 'world') {
    this.flows.invalidateAll();
    this.planner.cache.clear();
    this.reason = reason;
  }

  /**
   * 局内局部改动（路障）：只修受影响的 8 m 格与簇，不重建全图。
   * @param {Iterable<number>} cells1m 已经被写成 0 的 1 m 格下标
   */
  blockCells(cells1m, opts) {
    const r = blockCells(this, cells1m, opts);
    this.lastBlock = r;
    return r;
  }

  /** 大改动（手绘墙/编辑器）：全部重建（EDT 270 ms + 分层 340 ms，一次性） */
  rebuildAll() {
    const t0 = performance.now();
    this.edtMs = this.ng.buildClearance();
    this.hier = buildHierarchy(this.ng, {
      cellSize: this.opts.cellSize || 8,
      sectorCells: this.opts.sectorCells || 16,
      radius: this.radius,
    });
    this.portals = new Portals(this.ng, { radius: this.radius });
    this.planner = new Planner(this.ng, this.hier, { portals: this.portals });
    this.flows = new FlowFieldCache(this.hier, { maxFields: this.opts.maxFields || 48 });
    this.rebuildMs = performance.now() - t0;
    return this.rebuildMs;
  }

  stats() {
    return {
      buildMs: Math.round(this.buildMs),
      edtMs: Math.round(this.edtMs),
      hierMs: Math.round(this.hierMs),
      portalMs: Math.round(this.portalMs),
      cells: this.hier.stats.cells,
      nodes: this.hier.stats.nodes,
      clusters: this.hier.stats.clusters,
      flowBytes: this.flows.memBytes(),
    };
  }
}

/**
 * 每个 nav 对象只建一次（挂在 nav 上）。
 * @param {any} nav loadCollision() 返回的碰撞层
 * @param {object} [opts]
 */
export function getNavWorld(nav, opts) {
  if (!nav.__navWorld) nav.__navWorld = new NavWorld(nav, opts || {});
  return nav.__navWorld;
}
