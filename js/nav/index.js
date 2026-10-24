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
    this.portalMs = performance.now() - t2;
    this.buildMs = performance.now() - t0;
    this.opts = opts;
  }

  get radius() { return this.hier.radius; }

  /** 给 sim 做局部跟随用（数组由 sim 提供，避免多一份状态） */
  makeSteering(arrays) {
    return new Steering(this.ng, { radius: this.radius, ...arrays });
  }

  /** 世界被改过（手绘墙/路障）→ 场与规划缓存全部作废，clearance 需重算 */
  invalidate(reason = 'world') {
    this.flows.invalidateAll();
    this.planner.cache.clear();
    this.reason = reason;
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
 * 每个 nav 对象只建一次（挂到 nav 上）。
 * @param {any} nav  loadCollision() 返回的碰撞层
 * @param {object} [opts]
 */
export function getNavWorld(nav, opts) {
  if (!nav.__navWorld) nav.__navWorld = new NavWorld(nav, opts || {});
  return nav.__navWorld;
}
