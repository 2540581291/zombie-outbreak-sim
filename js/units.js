// ============================================================
//  ZOS-R · 程序化单位几何
//  每种物种用几个基本体拼一个低模，颜色烘进顶点色，
//  这样一个 InstancedMesh 就能画完同种单位。
// ============================================================
import * as THREE from 'three';
import { SP } from './species.js';

// 把多个 {geo, color, pos, rot, scale} 合并成一个带顶点色的 BufferGeometry
function mergeParts(parts) {
  let total = 0;
  const geos = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    geos.push({ g, p });
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);

  let o = 0;
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const { g, p } of geos) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0])));
    m.compose(
      new THREE.Vector3(...(p.pos || [0, 0, 0])),
      q,
      new THREE.Vector3(...(p.scale || [1, 1, 1]))
    );
    nm.getNormalMatrix(m);
    const a = g.attributes.position;
    const na = g.attributes.normal;
    const c = p.color;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m);
      pos[(o + i) * 3] = v.x; pos[(o + i) * 3 + 1] = v.y; pos[(o + i) * 3 + 2] = v.z;
      if (na) {
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        nor[(o + i) * 3] = v.x; nor[(o + i) * 3 + 1] = v.y; nor[(o + i) * 3 + 2] = v.z;
      }
      col[(o + i) * 3] = c[0]; col[(o + i) * 3 + 1] = c[1]; col[(o + i) * 3 + 2] = c[2];
    }
    o += a.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
const SPH = new THREE.SphereGeometry(0.5, 8, 6);
const CONE = new THREE.ConeGeometry(0.5, 1, 7);

const C = {
  skin: [0.82, 0.66, 0.50],
  darkSkin: [0.62, 0.46, 0.34],
  shirt: [0.42, 0.44, 0.38],
  pants: [0.22, 0.24, 0.28],
  navy: [0.18, 0.24, 0.55],
  navyHi: [0.26, 0.36, 0.78],
  army: [0.28, 0.34, 0.22],
  armyHi: [0.38, 0.44, 0.30],
  black: [0.10, 0.10, 0.11],
  steel: [0.34, 0.37, 0.36],
  steelHi: [0.46, 0.50, 0.48],
  rotten: [0.45, 0.42, 0.32],
  blood: [0.35, 0.06, 0.05],
  tank: [0.42, 0.16, 0.12],
  tankHi: [0.55, 0.24, 0.16],
  charger: [0.75, 0.34, 0.10],
  boomer: [0.62, 0.60, 0.22],
  spitter: [0.32, 0.60, 0.20],
  acid: [0.55, 1.00, 0.35],
};

/** 普通直立体型：腿 / 躯干 / 头 / 手臂 */
function humanoid(opt) {
  const { skin = C.skin, torso = C.shirt, legs = C.pants, head = null,
    w = 0.42, torsoH = 0.70, legH = 0.72, armR = 0.075, shoulder = 0.26 } = opt;
  const parts = [];
  // 腿
  for (const sx of [-1, 1]) {
    parts.push({ geo: BOX, color: legs, pos: [sx * 0.11, legH / 2, 0], scale: [0.15, legH, 0.16] });
  }
  // 躯干
  parts.push({ geo: BOX, color: torso, pos: [0, legH + torsoH / 2, 0], scale: [w, torsoH, 0.24] });
  // 肩
  parts.push({ geo: BOX, color: torso, pos: [0, legH + torsoH - 0.04, 0], scale: [w * 1.16, 0.16, 0.26] });
  // 手臂
  for (const sx of [-1, 1]) {
    parts.push({
      geo: CYL, color: skin,
      pos: [sx * shoulder, legH + torsoH * 0.55, 0.02],
      scale: [armR * 2, torsoH * 0.85, armR * 2],
    });
  }
  // 头
  parts.push({
    geo: SPH, color: head || skin,
    pos: [0, legH + torsoH + 0.16, 0], scale: [0.28, 0.30, 0.28],
  });
  return parts;
}

/** 丧尸：前倾、手臂前伸 */
function zombieBody(col) {
  const parts = humanoid({ skin: C.rotten, torso: col, legs: C.rotten, head: C.rotten });
  // 前倾
  for (const p of parts) {
    const y = p.pos[1];
    p.pos[1] = y;
    p.pos[2] = (p.pos[2] || 0) + y * 0.16;
    p.rot = [(p.rot ? p.rot[0] : 0) - 0.16, 0, 0];
  }
  // 前伸的双臂
  for (const sx of [-1, 1]) {
    parts.push({
      geo: CYL, color: C.rotten,
      pos: [sx * 0.24, 1.18, 0.34],
      rot: [Math.PI / 2, 0, 0],
      scale: [0.14, 0.62, 0.14],
    });
  }
  return parts;
}

/** 特感：坦克 */
function tankBody() {
  const parts = humanoid({
    skin: C.tank, torso: C.tank, legs: C.tank, head: C.tank,
    w: 0.78, torsoH: 0.95, legH: 0.60, armR: 0.16, shoulder: 0.44,
  });
  // 巨大的肩背
  parts.push({ geo: SPH, color: C.tankHi, pos: [0, 1.62, -0.06], scale: [0.95, 0.55, 0.55] });
  for (const sx of [-1, 1]) {
    parts.push({ geo: SPH, color: C.tankHi, pos: [sx * 0.44, 1.52, 0], scale: [0.5, 0.5, 0.5] });
  }
  // 小头
  parts.push({ geo: SPH, color: C.blood, pos: [0, 1.95, 0.06], scale: [0.3, 0.28, 0.3] });
  return parts;
}

/** 特感：冲锋者 */
function chargerBody() {
  const parts = humanoid({
    skin: C.charger, torso: C.charger, legs: C.charger, head: C.charger,
    w: 0.44, torsoH: 0.62, legH: 0.86, armR: 0.10, shoulder: 0.30,
  });
  // 瘦长的前肢
  for (const sx of [-1, 1]) {
    parts.push({
      geo: CYL, color: C.charger,
      pos: [sx * 0.26, 1.35, 0.30], rot: [Math.PI / 2.4, 0, 0],
      scale: [0.13, 0.72, 0.13],
    });
  }
  // 尖锐的背刺
  parts.push({ geo: CONE, color: C.blood, pos: [0, 1.62, -0.06], rot: [-0.5, 0, 0], scale: [0.20, 0.34, 0.20] });
  return parts;
}

/** 特感：自爆者 */
function boomerBody() {
  const parts = [];
  // 滚圆的身体
  parts.push({ geo: SPH, color: C.boomer, pos: [0, 0.62, 0], scale: [1.05, 0.95, 0.95] });
  parts.push({ geo: SPH, color: [0.75, 0.72, 0.30], pos: [0, 0.55, 0.16], scale: [0.72, 0.60, 0.62] });
  // 短腿
  for (const sx of [-1, 1]) {
    parts.push({ geo: CYL, color: C.rotten, pos: [sx * 0.24, 0.14, 0], scale: [0.16, 0.28, 0.16] });
  }
  // 小头
  parts.push({ geo: SPH, color: C.rotten, pos: [0, 1.10, 0.04], scale: [0.30, 0.28, 0.30] });
  // 脓包
  for (const [x, y, z] of [[0.34, 0.78, 0.22], [-0.30, 0.70, 0.26], [0.10, 0.44, -0.30]]) {
    parts.push({ geo: SPH, color: [0.55, 0.72, 0.20], pos: [x, y, z], scale: [0.26, 0.26, 0.26] });
  }
  return parts;
}

/** 特感：喷吐者 */
function spitterBody() {
  const parts = humanoid({
    skin: C.spitter, torso: C.spitter, legs: C.spitter, head: C.spitter,
    w: 0.36, torsoH: 0.80, legH: 0.80, armR: 0.09, shoulder: 0.26,
  });
  // 鼓起的喉咙
  parts.push({ geo: SPH, color: C.acid, pos: [0, 1.46, 0.10], scale: [0.30, 0.34, 0.30] });
  // 长舌
  parts.push({ geo: CYL, color: C.acid, pos: [0, 1.20, 0.42], rot: [Math.PI / 2.2, 0, 0], scale: [0.07, 0.55, 0.07] });
  return parts;
}

/** 士兵 */
function soldierBody(elite) {
  const t = elite ? C.armyHi : C.army;
  const parts = humanoid({
    skin: C.skin, torso: t, legs: elite ? C.black : C.army, head: C.skin,
    w: elite ? 0.56 : 0.46, torsoH: elite ? 0.82 : 0.72, legH: 0.74,
  });
  // 头盔
  parts.push({ geo: SPH, color: elite ? C.black : C.armyHi, pos: [0, 1.76, 0], scale: [0.34, 0.30, 0.34] });
  // 护甲板
  parts.push({ geo: BOX, color: elite ? C.black : C.armyHi, pos: [0, 1.28, 0.13], scale: [0.44, 0.44, 0.10] });
  // 步枪
  parts.push({ geo: BOX, color: C.black, pos: [0.26, 1.18, 0.34], rot: [0, 0, 0.12], scale: [0.07, 0.07, 0.86] });
  parts.push({ geo: BOX, color: C.black, pos: [0.26, 1.06, 0.10], scale: [0.06, 0.20, 0.12] });
  if (elite) {
    // 重装兵：背后的弹链箱 + 肩甲
    parts.push({ geo: BOX, color: C.steel, pos: [0, 1.20, -0.24], scale: [0.36, 0.34, 0.20] });
    for (const sx of [-1, 1]) {
      parts.push({ geo: SPH, color: C.steelHi, pos: [sx * 0.32, 1.44, 0], scale: [0.30, 0.26, 0.30] });
    }
  }
  return parts;
}

/** 装甲车 */
function apcBody() {
  const parts = [];
  // 车体
  parts.push({ geo: BOX, color: C.steel, pos: [0, 0.78, 0], scale: [1.55, 0.78, 3.0] });
  // 车头斜面
  parts.push({ geo: BOX, color: C.steel, pos: [0, 0.52, 1.62], rot: [0.30, 0, 0], scale: [1.5, 0.6, 0.8] });
  // 顶盖
  parts.push({ geo: BOX, color: C.steelHi, pos: [0, 1.20, -0.1], scale: [1.3, 0.14, 2.2] });
  // 炮塔
  parts.push({ geo: CYL, color: C.steelHi, pos: [0, 1.38, 0.35], scale: [0.62, 0.26, 0.62] });
  parts.push({ geo: BOX, color: C.black, pos: [0, 1.40, 1.05], scale: [0.10, 0.10, 1.30] });
  // 轮子
  for (const sx of [-1, 1]) {
    for (const z of [-1.05, -0.25, 0.55, 1.35]) {
      parts.push({
        geo: CYL, color: C.black, pos: [sx * 0.80, 0.34, z],
        rot: [0, 0, Math.PI / 2], scale: [0.62, 0.22, 0.62],
      });
    }
  }
  // 车灯
  for (const sx of [-1, 1]) {
    parts.push({ geo: SPH, color: [1.0, 0.95, 0.75], pos: [sx * 0.55, 0.72, 1.92], scale: [0.16, 0.16, 0.10] });
  }
  return parts;
}


/** 四足动物：躯干 + 4 条腿 + 头 + 耳朵 + 尾巴，朝 +X */
function quadruped(opt) {
  const { bodyL = 0.9, bodyW = 0.34, bodyH = 0.34, legH = 0.42, headR = 0.22,
    body = C.rotten, dark = C.blood, head = null, ears = true, tail = true, stripe = null } = opt;
  const y = legH + bodyH / 2;
  const parts = [];
  // 躯干
  parts.push({ geo: BOX, color: body, pos: [0, y, 0], scale: [bodyL, bodyH, bodyW] });
  // 背部色块（老虎条纹 / 熊的毛色）
  if (stripe) {
    for (let i = -2; i <= 2; i++) {
      parts.push({ geo: BOX, color: stripe, pos: [i * bodyL * 0.16, y + bodyH * 0.45, 0],
        scale: [bodyL * 0.06, bodyH * 0.16, bodyW * 1.02] });
    }
  }
  // 四条腿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geo: BOX, color: dark,
        pos: [sx * bodyL * 0.32, legH / 2, sz * bodyW * 0.38],
        scale: [0.09, legH, 0.09],
      });
    }
  }
  // 头
  parts.push({ geo: BOX, color: head || body, pos: [bodyL * 0.56, y + bodyH * 0.1, 0],
    scale: [headR * 2.2, headR * 2.0, headR * 1.8] });
  // 口鼻
  parts.push({ geo: BOX, color: dark, pos: [bodyL * 0.56 + headR * 1.3, y + bodyH * 0.02, 0],
    scale: [headR * 0.9, headR * 0.8, headR * 1.0] });
  // 耳朵
  if (ears) {
    for (const sz of [-1, 1]) {
      parts.push({ geo: CONE, color: dark, pos: [bodyL * 0.5, y + bodyH * 0.5 + headR * 0.6, sz * headR * 0.6],
        scale: [headR * 0.7, headR * 0.9, headR * 0.7] });
    }
  }
  // 尾巴
  if (tail) {
    parts.push({ geo: CYL, color: dark, pos: [-bodyL * 0.58, y + bodyH * 0.25, 0],
      rot: [0, 0, Math.PI / 2.6], scale: [0.07, bodyL * 0.45, 0.07] });
  }
  return parts;
}

const CACHE = new Map();

export function unitGeometry(kind) {
  if (CACHE.has(kind)) return CACHE.get(kind);
  let parts;
  switch (kind) {
    case SP.CIV1: parts = humanoid({ torso: [0.55, 0.56, 0.52], legs: [0.26, 0.28, 0.34] }); break;
    case SP.CIV2: parts = humanoid({ torso: [0.62, 0.40, 0.34], legs: [0.30, 0.30, 0.32], skin: C.darkSkin }); break;
    case SP.CIV3: parts = humanoid({ torso: [0.68, 0.68, 0.66], legs: [0.34, 0.34, 0.36], w: 0.56, torsoH: 0.74 }); break;
    case SP.POLICE:
      parts = humanoid({ torso: C.navyHi, legs: C.navy, head: C.skin });
      parts.push({ geo: BOX, color: C.black, pos: [0.26, 1.20, 0.32], scale: [0.06, 0.06, 0.5] });
      break;
    case SP.SOLDIER: parts = soldierBody(false); break;
    case SP.ELITE: parts = soldierBody(true); break;
    case SP.ZOMBIE: parts = zombieBody(C.rotten); break;
    case SP.TANK: parts = tankBody(); break;
    case SP.CHARGER: parts = chargerBody(); break;
    case SP.BOOMER: parts = boomerBody(); break;
    case SP.SPITTER: parts = spitterBody(); break;
    case SP.APC: parts = apcBody(); break;
    case SP.DOG: parts = quadruped({ bodyL: 0.80, bodyW: 0.30, bodyH: 0.30, legH: 0.44,
      headR: 0.19, body: [0.46, 0.32, 0.18], dark: [0.24, 0.16, 0.09], head: [0.50, 0.35, 0.20] }); break;
    case SP.CAT: parts = quadruped({ bodyL: 0.52, bodyW: 0.20, bodyH: 0.20, legH: 0.30,
      headR: 0.14, body: [0.46, 0.46, 0.50], dark: [0.24, 0.24, 0.28], head: [0.50, 0.50, 0.55] }); break;
    default: parts = humanoid({}); break;
  }
  const geo = mergeParts(parts);
  geo.computeBoundingSphere();
  CACHE.set(kind, geo);
  return geo;
}

/** 每种单位的近似高度，用来做点云大小 / 阴影贴片 */
export function unitHeight(kind) {
  switch (kind) {
    case SP.TANK: return 3.4;
    case SP.BOOMER: return 1.6;
    case SP.APC: return 1.8;
    case SP.CHARGER: return 1.9;
    case SP.SPITTER: return 2.0;
    case SP.ELITE: return 2.0;
    case SP.DOG: return 1.0;
    case SP.CAT: return 0.7;
    default: return 1.8;
  }
}
