// ============================================================
//  ZOS-R · 碰撞层（位域网格，照抄原版）
//
//  每格一个字节，2m 一格：
//    0x00 墙          0x03 路/空地    0x07 树/林地
//    0x0f 门          0x16 窗          0x1f 室内（可走！）
//    0x42 围栏        0x43 围栏门      0x82 水
//  位：0x01 可走   0x02 视线可穿   0x04 有顶   0x08|0x10 室内
// ============================================================

export const CL = {
  // 兼容说明：原版 2009 的碰撞表值域与我们几乎逐位相同
//   原版 3/7/15/22/31  = 我们 0x03/0x07/0x0f/0x16/0x1f（逐位一致）
//   原版 66（bit1+bit6）= 围栏，我们记作 0x42；旧值 0x22 保留
// 运行时只看 bit0（可走）和 0x18（室内），所以原版的原始表可以直接喂进来
WALL: 0x00, OPEN: 0x03, GRASS: 0x07, DOOR: 0x0f,
  WINDOW: 0x16, INSIDE: 0x1f, FENCE: 0x42, FENCE_GAP: 0x43, WATER: 0x82,
  WALK: 0x01, SIGHT: 0x02, INDOOR: 0x18,
};

async function inflate(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('浏览器不支持 DecompressionStream，无法解压碰撞层');
  }
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * 从 city.collision 生成碰撞层。没有该字段时返回 null（调用方回退到旧的布尔栅格）。
 */
export async function loadCollision(city) {
  const c = city.collision;
  if (!c) return null;

  const grid = await inflate(c.b64);
  const { cols, rows, cell } = c;
  if (grid.length !== cols * rows) {
    throw new Error(`碰撞层尺寸不符：期望 ${cols * rows}，实际 ${grid.length}`);
  }
  const [W, H] = city.size;

  const nav = {
    grid, cols, rows, cell,
    W, H, halfW: W / 2, halfH: H / 2,
    isCollision: true,

    idx(x, z) {
      // 注意：Python 生成时 y 是"北为正"，所以第 0 行是南边。
      // 世界 z 是"南为正"，这里必须反过来算，否则整张图上下颠倒。
      const cc = ((x + this.halfW) / this.cell) | 0;
      const rr = ((this.halfH - z) / this.cell) | 0;
      if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) return -1;
      return rr * this.cols + cc;
    },

    valueAt(x, z) {
      const i = this.idx(x, z);
      return i < 0 ? CL.WALL : this.grid[i];
    },

    walkable(x, z) {
      const i = this.idx(x, z);
      return i >= 0 && (this.grid[i] & CL.WALK) !== 0;
    },

    indoor(x, z) {
      const i = this.idx(x, z);
      return i >= 0 && (this.grid[i] & CL.INDOOR) === CL.INDOOR;
    },

    /** 视线：沿线逐格查 0x02（原版 isVisibleFrom 的同一套做法） */
    los(x0, z0, x1, z1) {
      const dx = x1 - x0, dz = z1 - z0;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4) return true;
      const steps = Math.min(64, Math.ceil(dist / (this.cell * 0.7)));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const cc = ((x0 + dx * t + this.halfW) / this.cell) | 0;
        const rr = ((this.halfH - (z0 + dz * t)) / this.cell) | 0;
        if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) return false;
        if ((this.grid[rr * this.cols + cc] & CL.SIGHT) === 0) return false;
      }
      return true;
    },

    // 门场（doorDist/doorOf/doorPoint/doorGradient）已在 S7 删除：
    //   全图 1 m 多源 BFS = 56 MB，只回答"最近的门在哪"。
    //   现在由 js/nav/index.js 的 8 m 门锚点场（476 KB / 5 ms）和
    //   js/nav/portal.js 的门洞图接管。
  };
  return nav;
}

/** 统计各取值占比，启动时打印一次，便于确认数据对不对 */
export function collisionStats(nav) {
  if (!nav || !nav.isCollision) return null;
  const names = {
    0x00: '墙', 0x03: '空地/路', 0x07: '林地', 0x0f: '门',
    0x16: '窗', 0x1f: '室内', 0x42: '围栏', 0x43: '围栏门', 0x22: '围栏（旧值）', 0x82: '水',
  };
  const h = new Map();
  for (let i = 0; i < nav.grid.length; i++) {
    const v = nav.grid[i];
    h.set(v, (h.get(v) || 0) + 1);
  }
  const total = nav.grid.length;
  const rows = [];
  for (const [v, n] of [...h.entries()].sort((a, b) => b[1] - a[1])) {
    rows.push(`${names[v] || '0x' + v.toString(16)}:${(n / total * 100).toFixed(1)}%`);
  }
  return { total, text: rows.join(' ') };
}
