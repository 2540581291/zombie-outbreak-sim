// ============================================================
//  ZOS-R · NavCore / 局部跟随（S5）
//
//  这一层只干一件事：**把一个期望方向变成一步真的走得动的位移**。
//  它替代了旧的 `sim.move()`（Bug 算法：固定一侧、逐步加大探测角）。
//
//  做法（业界叫 context steering / feelers）：
//    1. 延续上一帧的方向（≤60° 且前方两步都通）→ 消除锯齿
//    2. 期望方向直走（大多数情况两步就判断完，这是快路径）
//    3. 扇形扫描：±15°…±120°，先小后大，取第一个"两步都通"的
//    4. 都不通 → 记 stuck，交给上层做重规划
//
//  "通" = 半径 r 的个体站得下（clearance 判定），并且**前瞻两步**都成立 ——
//  只查一步的话，贴着墙走的个体每帧都会撞上"下一步能走、再下一步是墙"的死角。
//
//  性能要点（2 万人都要跑，不能有三角函数热路径）：
//    - 期望方向先归一化成向量，扇形扫描用**预旋转矩阵**，全程不碰 atan2
//    - 只有真的迈步时才算一次 atan2（给渲染用的朝向）
//    - 零分配：直接读写 sim 的 SoA 数组
// ============================================================

// 扇形扫描角（弧度）：±15°, ±30°, ±45°, ±60°, ±75°, ±90°, ±105°, ±120°
const FAN = [0.2618, 0.5236, 0.7854, 1.0472, 1.3090, 1.5708, 1.8326, 2.0944];
// 预计算每个角的 cos/sin（旋转矩阵），热路径里只剩乘加
const FAN_C = FAN.map((a) => Math.cos(a));
const FAN_S = FAN.map((a) => Math.sin(a));
const TAU = Math.PI * 2;

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export class Steering {
  /**
   * @param {import('./grid.js').NavGrid} ng
   * @param {{px:Float32Array, pz:Float32Array, heading:Float32Array,
   *          phase:Float32Array, stuck:Float32Array,
   *          lastDir:Float32Array, lastDirT:Float32Array,
   *          lastVX:Float32Array, lastVZ:Float32Array,
   *          radius?:number}} arrays
   */
  constructor(ng, arrays) {
    this.ng = ng;
    this.a = arrays;
    this.radius = arrays.radius === undefined ? 0.35 : arrays.radius;
    this.cell = ng.cell;
    this.halfW = ng.halfW;
    this.halfH = ng.halfH;
    this.cols = ng.cols;
    this.rows = ng.rows;
    this.grid = ng.grid;
    this.cl = ng.clearance;
    this.needCl = this.radius + 0.5 * this.cell - 1e-9;
    this.time = 0;
    this.stats = { steps: 0, fast: 0, fan: 0, blocked: 0 };
  }

  /** 半径 r 能不能站在 (x,z)：内联 idx + clearance 比较，避免函数调用 */
  free(x, z) {
    const c = ((x + this.halfW) / this.cell) | 0;
    const r = ((this.halfH - z) / this.cell) | 0;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const i = r * this.cols + c;
    if ((this.grid[i] & 1) === 0) return false;
    const cl = this.cl;
    return !cl || cl[i] >= this.needCl;
  }

  /** 沿单位向量 (ux,uz) 走两步都通？ */
  canGoV(x, z, ux, uz, stepLen) {
    const c = ux * stepLen, s = uz * stepLen;
    if (!this.free(x + c, z + s)) return false;
    return this.free(x + c * 2, z + s * 2);
  }

  /** 只查一步：绕行/延续方向用（贴墙时不会被"第二步是墙"判死） */
  canGo1(x, z, ux, uz, len) {
    return this.free(x + ux * len, z + uz * len);
  }

  /**
   * 走一步。会把结果写回 px/pz/heading/phase/lastDir/lastVX/lastVZ/stuck。
   * @returns {boolean} 是否真的移动了
   */
  step(i, dx, dz, speed, dt) {
    const A = this.a;
    const ox = A.px[i], oz = A.pz[i];
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return false;
    const inv = 1 / Math.sqrt(len2);
    const bx = dx * inv, bz = dz * inv;          // 期望方向的单位向量
    const stepLen = Math.min(speed * dt, this.cell * 0.8);
    if (stepLen <= 0) return false;
    this.stats.steps++;

    // 1) 延续上一帧方向（与期望夹角 <75°，且一步通）
    if (A.lastDirT[i] > this.time - 0.6) {
      const lx = A.lastVX[i], lz = A.lastVZ[i];
      if (lx * bx + lz * bz > 0.26 && this.canGoV(ox, oz, lx, lz, stepLen)) {
        this.stats.fast++;
        this.commitV(i, lx, lz, this.pickLen(ox, oz, lx, lz, bx, bz, stepLen), speed, dt);
        return true;
      }
    }
    // 2) 期望方向（两步都通才直走；窄缝交给扇形扫描 + 步长补偿）
    if (this.canGoV(ox, oz, bx, bz, stepLen)) {
      this.stats.fast++;
      this.commitV(i, bx, bz, stepLen, speed, dt);
      return true;
    }
    // 3) 扇形扫描（先小后大）：每个个体固定一侧先试（side 一致，避免左右横跳绕圈）
    const side = A.side ? (A.side[i] || 1) : 1;
    for (let k = 0; k < FAN.length; k++) {
      const c = FAN_C[k], s = FAN_S[k];
      const s1 = side;
      // 先试 side 那一侧，再试另一侧
      let ux = bx * c - bz * s * s1, uz = bx * s * s1 + bz * c;
      if (this.canGoV(ox, oz, ux, uz, stepLen)) {
        this.stats.fan++;
        this.commitV(i, ux, uz, this.pickLen(ox, oz, ux, uz, bx, bz, stepLen), speed, dt);
        return true;
      }
      ux = bx * c + bz * s * s1; uz = -bx * s * s1 + bz * c;
      if (this.canGoV(ox, oz, ux, uz, stepLen)) {
        this.stats.fan++;
        this.commitV(i, ux, uz, this.pickLen(ox, oz, ux, uz, bx, bz, stepLen), speed, dt);
        return true;
      }
    }
    // 4) 兜底：宁可慢慢挪也别钉死 —— 退到"只查一步"再扫一遍
    for (let k = 0; k < FAN.length; k++) {
      const c = FAN_C[k], s = FAN_S[k];
      const ux = bx * c - bz * s * side, uz = bx * s * side + bz * c;
      if (this.canGo1(ox, oz, ux, uz, stepLen)) {
        this.stats.fan++;
        this.commitV(i, ux, uz, stepLen, speed, dt);
        return true;
      }
    }
    // 5) 彻底走不动
    this.stats.blocked++;
    A.stuck[i] += dt;
    A.lastDirT[i] = 0;
    return false;
  }

  /**
   * 沿墙/绕行时方向被偏转，沿"期望方向"的有效速度只剩 cos(偏差) 倍。
   * 这里把步长按 1/cos 放大（上限 2 倍、且不超一格 0.9），让有效速度维持住 ——
   * 否则一绕墙平均速度就掉 15% 以上（实测 1.88 → 1.58 m/s）。
   */
  boost(ux, uz, bx, bz, stepLen) {
    const dot = ux * bx + uz * bz;
    const l = stepLen / Math.max(0.45, dot);
    return Math.min(l, this.cell * 0.9);
  }

  /**
   * 选实际步长：先试补偿后的长度，**落点必须仍然站得下人**；
   * 否则退回原始步长。少了这一步，补偿会把个体推进墙里 → 下一帧全方向堵死
   * （实测 stuck 从 0.5% 飙到 6.4%）。
   */
  pickLen(ox, oz, ux, uz, bx, bz, stepLen) {
    const b = this.boost(ux, uz, bx, bz, stepLen);
    if (b > stepLen && !this.free(ox + ux * b, oz + uz * b)) return stepLen;
    return b;
  }

  commitV(i, ux, uz, stepLen, speed, dt) {
    const A = this.a;
    A.px[i] += ux * stepLen;
    A.pz[i] += uz * stepLen;
    A.heading[i] = Math.atan2(uz, ux);
    A.lastVX[i] = ux;
    A.lastVZ[i] = uz;
    A.lastDir[i] = A.heading[i];
    A.lastDirT[i] = this.time;
    A.stuck[i] = 0;
    A.phase[i] = (A.phase[i] + (speed / 1.45)) % 1;
  }
}
