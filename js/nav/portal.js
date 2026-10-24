// ============================================================
//  ZOS-R · NavCore / 门与室内（旧的"门场"替代品）
//
//  旧做法：启动时从所有门洞做一次全图多源 BFS，存 doorDist + doorOf。
//  代价：柏林 7.0 M 格 → 2 × Int32 = **56 MB**，>2000 万格直接禁用。
//  而且它只回答"最近的门在哪"，回答不了"这扇门通向哪"。
//
//  新做法：门 = **显式 portal**（off-mesh link）。
//    - 每个门格预先算好它的"室外出口格"（相邻、可走、clearance 最好的那一格）
//    - 室内寻路 = 从人所在格子做一次 BFS，撞到门格就停：既是"最近的门"，
//      也顺手拿到了沿 BFS 父指针回溯出来的室内折线（不用再跑 A*）
//    - 内存：门 18 k 个 → 一张 Map，**全图零常驻数组**（BFS 用 Map/Set，随用随丢）
//
//  这就是 NavMesh 里 off-mesh link 的栅格版：门是一等公民，有"两侧"。
// ============================================================

const DOOR_VALUE = 0x0f;          // 门：0x0f（可走 + 视线 + 有顶，非室内）
const isDoor = (v) => v === DOOR_VALUE;
const isIndoor = (v) => (v & 0x18) === 0x18;
const isWalkable = (v) => (v & 1) !== 0;

const DC = [1, 1, 0, -1, -1, -1, 0, 1];
const DR = [0, 1, 1, 1, 0, -1, -1, -1];

export class Portals {
  /**
   * @param {import('./grid.js').NavGrid} ng
   */
  constructor(ng, opts = {}) {
    this.ng = ng;
    this.radius = opts.radius === undefined ? 0.35 : opts.radius;
    const grid = ng.grid, cols = ng.cols, rows = ng.rows, N = grid.length;
    this.cols = cols; this.rows = rows; this.N = N;

    // 门格 → 室外出口。
    // 门常常是"两格厚"的（一格门 + 一格门），单看某个门格的邻居可能全是
    // 室内/门格 → 判成"没有出口"。所以先把门格按 8 连通聚成**门洞**，
    // 再在整个门洞的邻域里找室外格（clearance 最好的那格）。
    const doorCells = [];
    for (let i = 0; i < N; i++) if (isDoor(grid[i])) doorCells.push(i);

    const passable = (j) => {
      const v = grid[j];
      return isWalkable(v) && (isIndoor(v) || isDoor(v));
    };

    const outdoor = new Map();
    const visited = new Set();
    let doorwayN = 0;
    for (const start of doorCells) {
      if (visited.has(start)) continue;
      // 洪水填充一个门洞
      const group = [start];
      visited.add(start);
      for (let q = 0; q < group.length; q++) {
        const cur = group[q];
        const r = (cur / cols) | 0, c = cur - r * cols;
        for (let d = 0; d < 8; d++) {
          const nr = r + DR[d], nc = c + DC[d];
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nk = nr * cols + nc;
          if (visited.has(nk) || !isDoor(grid[nk])) continue;
          visited.add(nk);
          group.push(nk);
        }
      }
      // 门洞外圈找室外格
      let best = -1, bestCl = -1;
      for (const cur of group) {
        const r = (cur / cols) | 0, c = cur - r * cols;
        for (let d = 0; d < 8; d++) {
          const nr = r + DR[d], nc = c + DC[d];
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nk = nr * cols + nc;
          const v = grid[nk];
          if (!isWalkable(v) || isIndoor(v) || isDoor(v)) continue;
          const cl = ng.clearance ? ng.clearance[nk] : 1;
          if (cl > bestCl) { bestCl = cl; best = nk; }
        }
      }
      doorwayN++;
      if (best < 0) continue;
      for (const cur of group) outdoor.set(cur, best);
    }
    this.doorOutdoor = outdoor;
    this.doorCells = doorCells;
    this.stats = { doors: doorCells.length, doorways: doorwayN, withOutdoor: outdoor.size };
    void passable;
  }

  idx(x, z) { return this.ng.idx(x, z); }

  /**
   * 从室内一点出发，沿室内格 BFS，收集最近的若干个"能出去的门"。
   * 返回每个出口的：室内折线（起点 → 门口）+ 门外那一格。
   *
   * @returns {Array<{points:Array<[number,number]>, outdoor:[number,number], door:number, cost:number}>}
   */
  exitsFrom(x, z, maxDoors = 3, maxCells = 12000) {
    const ng = this.ng, grid = ng.grid, cols = this.cols, rows = this.rows;
    const start = ng.idx(x, z);
    if (start < 0) return [];
    if (isDoor(grid[start])) {
      const o = this.doorOutdoor.get(start);
      return o === undefined ? [] : [{ points: [], outdoor: ng.center(o), door: start, cost: 0 }];
    }
    if (!isIndoor(grid[start])) return [];

    const visited = new Set([start]);
    const parent = new Map([[start, -1]]);
    const queue = [start];
    let head = 0;
    const out = [];
    const seenOut = new Set();

    while (head < queue.length && out.length < maxDoors && head < maxCells) {
      const cur = queue[head++];
      const r = (cur / cols) | 0, c = cur - r * cols;
      for (let d = 0; d < 8; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nk = nr * cols + nc;
        if (visited.has(nk)) continue;
        const v = grid[nk];
        if (!isIndoor(v) && !isDoor(v)) continue;
        // 斜向必须两侧都通（不许贴墙角切过去，否则折线会擦墙）
        if (DC[d] !== 0 && DR[d] !== 0) {
          const a1 = r * cols + nc, a2 = nr * cols + c;
          if (!isIndoor(grid[a1]) && !isDoor(grid[a1])) continue;
          if (!isIndoor(grid[a2]) && !isDoor(grid[a2])) continue;
        }
        visited.add(nk);
        parent.set(nk, cur);
        queue.push(nk);
        if (isDoor(v)) {
          const o = this.doorOutdoor.get(nk);
          if (o === undefined || seenOut.has(o)) continue;
          seenOut.add(o);
          const cells = [];
          let k = nk, guard = 0;
          while (k >= 0 && guard++ < 100000) { cells.push(k); k = parent.get(k); }
          cells.reverse();
          out.push({
            points: cells.map((q) => ng.center(q)),
            outdoor: ng.center(o),
            door: nk,
            cost: cells.length * ng.cell,
          });
        }
      }
    }
    return out;
  }

  /** 同一个房间内两点之间（室内 BFS，找不到返回 null） */
  roomRoute(x, z, tx, tz, maxCells = 12000) {
    const ng = this.ng, grid = ng.grid, cols = this.cols, rows = this.rows;
    const s = ng.idx(x, z), t = ng.idx(tx, tz);
    if (s < 0 || t < 0) return null;
    if (s === t) return [[x, z], [tx, tz]];
    if (!isIndoor(grid[s]) || !isIndoor(grid[t])) return null;

    const visited = new Set([s]);
    const parent = new Map([[s, -1]]);
    const queue = [s];
    let head = 0;
    let hit = false;
    while (head < queue.length && head < maxCells) {
      const cur = queue[head++];
      if (cur === t) { hit = true; break; }
      const r = (cur / cols) | 0, c = cur - r * cols;
      for (let d = 0; d < 8; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nk = nr * cols + nc;
        if (visited.has(nk)) continue;
        const v = grid[nk];
        if (!isIndoor(v) && !isDoor(v)) continue;
        // 斜向必须两侧都通（不许贴墙角切过去，否则折线会擦墙）
        if (DC[d] !== 0 && DR[d] !== 0) {
          const a1 = r * cols + nc, a2 = nr * cols + c;
          if (!isIndoor(grid[a1]) && !isDoor(grid[a1])) continue;
          if (!isIndoor(grid[a2]) && !isDoor(grid[a2])) continue;
        }
        visited.add(nk);
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
    if (!hit) return null;
    const cells = [];
    let k = t, guard = 0;
    while (k >= 0 && guard++ < 100000) { cells.push(k); k = parent.get(k); }
    cells.reverse();
    return cells.map((q) => ng.center(q));
  }

  /** 常驻内存（字节，估算） */
  memBytes() {
    return this.doorOutdoor.size * 32 + this.doorCells.length * 4;
  }

  /**
   * 在 1 m 网格上走一小段：从 (x,z) 做 BFS，直到某格满足 accept(cellIndex)。
   * 用途：门口那一格常常落在楼缝的"口袋"里，8 m 层看它和街面不是一张图，
   * 但 1 m 层其实是通的 —— 用这条细网格连接段把两端接起来。
   *
   * @param {(i:number)=>boolean} accept
   * @returns {Array<[number,number]>|null} 世界折线（起点 → 满足条件的格）
   */
  fineWalk(x, z, accept, maxCells = 12000) {
    const ng = this.ng, grid = ng.grid, cols = this.cols, rows = this.rows;
    const start = ng.idx(x, z);
    if (start < 0 || !isWalkable(grid[start])) return null;
    if (accept(start)) return [[x, z]];
    const visited = new Set([start]);
    const parent = new Map([[start, -1]]);
    const queue = [start];
    let head = 0;
    let hit = -1;
    while (head < queue.length && head < maxCells) {
      const cur = queue[head++];
      const r = (cur / cols) | 0, c = cur - r * cols;
      for (let d = 0; d < 8; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nk = nr * cols + nc;
        if (visited.has(nk) || !isWalkable(grid[nk])) continue;
        if (DC[d] !== 0 && DR[d] !== 0) {
          const a1 = r * cols + nc, a2 = nr * cols + c;
          if (!isWalkable(grid[a1]) || !isWalkable(grid[a2])) continue;
        }
        visited.add(nk);
        parent.set(nk, cur);
        queue.push(nk);
        if (accept(nk)) { hit = nk; break; }
      }
      if (hit >= 0) break;
    }
    if (hit < 0) return null;
    const cells = [];
    let k = hit, guard = 0;
    while (k >= 0 && guard++ < 100000) { cells.push(k); k = parent.get(k); }
    cells.reverse();
    const pts = cells.map((q) => ng.center(q));
    pts[0] = [x, z];
    return pts;
  }
}

export function buildPortals(ng, opts) {
  return new Portals(ng, opts);
}
