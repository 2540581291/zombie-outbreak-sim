// ============================================================
//  ZOS-R · 物资储备（M8）
//
//  枪和子弹都是"东西"，存在某个地方：
//    · 每个警察局有一个军械库
//    · 每个家庭也可能有枪（有些人家里放着枪，子弹多少各不相同）
//
//  存储按**武器分类**分开记：w[id] = 有几把，a[id] = 这类枪的子弹有多少发。
//  拿走一把枪时会连带走一部分子弹（现实里枪和弹通常放在一起）。
// ============================================================

import { WEAPONS } from './weapons.js';

/** 新建一个空的储备（按武器 id 索引，0 号是"徒手"，不用） */
export function makeStock() {
  const N = WEAPONS.length;                 // 跟着武器表走（会随新枪增长）
  return { w: new Uint8Array(N), a: new Uint16Array(N) };
}

export function addWeapon(s, id, n = 1) {
  if (id > 0) s.w[id] = Math.min(255, s.w[id] + n);
}

export function addAmmo(s, id, n) {
  if (id > 0) s.a[id] = Math.min(65535, s.a[id] + n);
}

/** 有没有枪 */
export function hasWeapon(s) {
  if (!s) return false;
  for (let id = 1; id < s.w.length; id++) if (s.w[id] > 0) return true;
  return false;
}

/** 总共几把枪（遍历整张武器表；原来写死 id<10，会漏掉双管霰弹枪、十字弩这些 id≥10 的） */
export function weaponCount(s) {
  if (!s) return 0;
  let n = 0;
  for (let id = 1; id < s.w.length; id++) n += s.w[id];
  return n;
}

/** 总共几发子弹（同上） */
export function ammoCount(s) {
  if (!s) return 0;
  let n = 0;
  for (let id = 1; id < s.a.length; id++) n += s.a[id];
  return n;
}

/**
 * 取一把枪（同时取一部分子弹）。
 * 返回 { id, rounds } 或 null（没枪了）。
 */
export function takeWeapon(s, rng) {
  if (!s) return null;
  const ids = [];
  for (let id = 1; id < 10; id++) if (s.w[id] > 0) ids.push(id);
  if (!ids.length) return null;
  const id = ids[Math.min(ids.length - 1, (rng() * ids.length) | 0)];
  s.w[id]--;
  const w = WEAPONS[id];
  // 拿走 30%~100% 的备弹（不超过这把枪的上限）
  const want = Math.max(1, Math.round(w.reserve * (0.3 + rng() * 0.7)));
  const rounds = Math.min(s.a[id], want);
  s.a[id] -= rounds;
  return { id, rounds };
}

/** 警察局军械库：按面积给，大所多、小所少（确定性，不吃游戏随机数） */
export function makeStationStock(area) {
  const s = makeStock();
  const a = Math.min(3000, area || 200);                  // 面积封顶，免得大所变军火库
  const big = a > 1200 ? 2 : (a > 600 ? 1 : 0);           // 0–2：规模档
  addWeapon(s, 1, 4 + Math.min(6, Math.round(a / 500)));  // 手枪 9mm 4–10 把
  addAmmo(s, 1, Math.min(420, 90 + Math.round(a / 6)));   // 90–420 发
  addWeapon(s, 4, 2 + big);                               // 霰弹枪 2–4 把
  addAmmo(s, 4, 18 + big * 18);                           // 18–54 发
  // 步枪弹：每个所都有一些（军队/特警路过时能补），大所更多
  addAmmo(s, 6, 40 + big * 80);                           // 40–200 发
  if (big > 0) {
    addWeapon(s, 6, big * 2);                             // 大所才有步枪 2–4 把
  }
  // 扩充武库：小所也有弩（无声、适合巡逻），大所才有突击步枪 / 轻机枪 / 双管
  addWeapon(s, 13, 1 + big);                              // 十字弩 1–3 把
  addAmmo(s, 13, 6 + big * 6);
  addWeapon(s, 10, 1 + big);                              // 双管霰弹 1–3 把
  addAmmo(s, 10, 8 + big * 10);
  if (big > 0) {
    addWeapon(s, 11, big * 2);                            // 突击步枪 2–4 把
    addAmmo(s, 11, big * 60);
  }
  if (a > 1200) {                                         // 超大型所才有轻机枪
    addWeapon(s, 12, 1);
    addAmmo(s, 12, 100);
  }
  return s;
}

/** 家庭军械库：按"家庭持枪率"决定有没有枪，弹量各不相同 */
export function makeHomeStock(hash, rng, rate) {
  const s = makeStock();
  const pGun = rate == null ? 0.12 : rate;
  if (hash >= pGun) return s;                             // 大多数家庭没枪
  // 民用枪：手枪为主，少量左轮/霰弹枪/大口径
  const roll = rng();
  // 民用枪：手枪为主；左轮/大口径少量；猎枪（双管）和弩（打猎）偶见
  const id = roll < 0.50 ? 1 : roll < 0.68 ? 3 : roll < 0.82 ? 4
           : roll < 0.88 ? 2 : roll < 0.95 ? 10 : 13;
  addWeapon(s, id, 1 + (rng() < 0.15 ? 1 : 0));
  addAmmo(s, id, 4 + Math.round(rng() * 26));             // 4–30 发，各家不同
  return s;
}

/** 一句话概括（给 UI / 日志用） */
export function stockText(s) {
  if (!hasWeapon(s)) return '无';
  const parts = [];
  for (let id = 1; id < s.w.length; id++) {
    if (s.w[id] > 0) parts.push(`${WEAPONS[id].name}×${s.w[id]}（${s.a[id]} 发）`);
  }
  return parts.join(' / ');
}
