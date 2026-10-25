// 坐标一致性自检
//
//   这个世界只有一套坐标：x 东为正、z 南为正、碰撞网格第 0 行是南。
//   历史教训：烘焙曾经吐「y 北为正」，每跨一次边界都要翻符号，
//   于是 POI 整批上下镜像（医院跑到河对岸），桥的补丁也整批判反。
//   这个脚本就是防止再犯：直接验证「几何」和「碰撞层」对得上。
//
//   node tools/test_coords.mjs
import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';

const city = loadCity();
const nav = await loadCollision(city);
const { halfW, halfH, cell, cols, rows, grid } = nav;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

// 世界坐标 → 网格下标（全项目唯一公式）
const idx = (x, z) => {
  const c = Math.floor((x + halfW) / cell);
  const r = Math.floor((halfH - z) / cell);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
  return r * cols + c;
};
const val = (x, z) => { const k = idx(x, z); return k < 0 ? null : grid[k]; };
const isWall = (v) => v === 0x00;
const isInside = (v) => v === 0x1f;
const isWater = (v) => v === 0x82;

// 多边形内部点（扫描线取最宽一段的中点）—— 凹形建筑的质心会落在院子里，不能用来测
const interiorPoint = (p) => {
  let zc = 0;
  for (const q of p) zc += q[1];
  zc /= p.length;
  const xs = [];
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
    if ((z1 > zc) !== (z2 > zc)) xs.push(x1 + (zc - z1) * (x2 - x1) / (z2 - z1));
  }
  xs.sort((a, b) => a - b);
  let best = 0, bx = xs[0] ?? 0;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1] - xs[k];
    if (w > best) { best = w; bx = (xs[k] + xs[k + 1]) / 2; }
  }
  return [bx, zc];
};
const sample = (arr, n) => {
  const out = [];
  const step = Math.max(1, Math.floor(arr.length / n));
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
};

// ---------- 1. 建筑几何 vs 碰撞层 ----------
console.log('1) 建筑：多边形质心处的格子应该是墙或室内');
{
  const bs = sample(city.buildings, 600);
  let hit = 0, hitMirror = 0;
  for (const b of bs) {
    const [x, z] = interiorPoint(b.p);
    const v = val(x, z);
    if (v !== null && (isWall(v) || isInside(v))) hit++;
    // 反过来（把 z 取反）应该明显更差 —— 证明这个指标能抓到镜像
    const vm = val(x, -z);
    if (vm !== null && (isWall(vm) || isInside(vm))) hitMirror++;
  }
  const r1 = hit / bs.length, r2 = hitMirror / bs.length;
  ok(r1 > 0.9, `正坐标 ${(r1 * 100).toFixed(0)}% 落在墙/室内（应 > 90%）`);
  ok(r2 < r1 - 0.25, `镜像坐标只有 ${(r2 * 100).toFixed(0)}%（比正坐标低 25 个点以上，说明这个指标能抓到镜像）`);
}

// ---------- 2. 道路几何 vs 碰撞层 ----------
console.log('2) 道路：多边形上的点应该是可走的');
{
  const rs = sample(city.roads, 600);
  let walk = 0, mirror = 0, n = 0;
  for (const r of rs) {
    const [x, z] = r.p[0];
    const v = val(x, z);
    if (v === null) continue;
    n++;
    if (v & 1) walk++;
    const vm = val(x, -z);
    if (vm !== null && (vm & 1)) mirror++;
  }
  // 道路本来就是"到处都能走"，所以镜像后也可走 —— 这条只查正坐标
  ok(walk / Math.max(1, n) > 0.9, `正坐标 ${(walk / Math.max(1, n) * 100).toFixed(0)}% 可走（应 > 90%）`);
}

// ---------- 3. POI vs 建筑轮廓 ----------
console.log('3) POI：必须落在某栋建筑里');
{
  const inPoly = (x, y, pts) => {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
    }
    return ins;
  };
  const pois = city.pois || [];
  let inb = 0, inWater = 0;
  for (const p of pois) {
    if (city.buildings.some((b) => inPoly(p.x, p.z, b.p))) inb++;
    if (city.water.some((w) => inPoly(p.x, p.z, w.p))) inWater++;
  }
  ok(inb / Math.max(1, pois.length) > 0.99, `POI 室内率 ${(inb / Math.max(1, pois.length) * 100).toFixed(0)}%（应 > 99%）`);
  ok(inWater === 0, `POI 落水 ${inWater} 个（应为 0）`);
}

// ---------- 4. 桥：中线上的点必须可走 ----------
console.log('4) 桥：中线全程可走');
{
  let bad = 0, tot = 0;
  for (const br of city.bridges || []) {
    for (let i = 0; i < br.p.length - 1; i++) {
      const [ax, az] = br.p[i], [bx, bz] = br.p[i + 1];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(d / 3));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const v = val(ax + (bx - ax) * t, az + (bz - az) * t);
        if (v === null) continue;
        tot++;
        if (!(v & 1)) bad++;
      }
    }
  }
  if (tot === 0) {
    console.log('  · 这个城市没有桥，跳过');
  } else {
    ok(bad === 0, `桥中线 ${tot} 个采样点，不可走 ${bad} 个（应为 0）`);
  }
}

// ---------- 5. 边界：网格与世界范围对得上 ----------
console.log('5) 边界');
{
  const v0 = val(-halfW + cell * 0.5, halfH - cell * 0.5);
  const v1 = val(halfW - cell * 0.5, -halfH + cell * 0.5);
  ok(v0 !== null && v1 !== null, '西南角 / 东北角都能取到格子（没有越界偏移）');
}

console.log(fail ? `\n${fail} 项失败 ✗` : '\n全部通过 ✓');
if (fail) process.exit(1);
