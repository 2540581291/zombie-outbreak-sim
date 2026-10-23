// ============================================================
//  src/sprite/index.js  ——  SpriteView（2D 精灵渲染器）
//
//  对外暴露和旧 js/retro.js 完全一样的 5 个成员，所以 main.js 只需要换一行构造：
//      ready / group / load() / update(sim, cam) / count
//
//  v2 相比旧版的差别（都是这一轮重写要解决的）：
//    1. 数据来自 assets/atlas/（帧数与原版一致），不再有 @五套变体；
//    2. 每帧的帧长来自 clip.ms（旧版是全局 FPS=12 假常数）；
//    3. 尸体走独立 decal 层，压在人下面；
//    4. 有阴影层（原版 20×15、偏移 (-8,-2) px、不随朝向转）；
//    5. 剪影用白图 + 阵营 tint（绿/蓝/红），且"屋内"判定带滞回；
//    6. 新增"方案 B"阶段叠加：只靠状态变化就能播 turn01 / die01（P3 之后可关掉）。
// ============================================================
import * as THREE from 'three';
import { ST } from '../../js/sim.js';
import { SPECIES, SP, TEAM, UNIT_COLOR, colorClassOf } from '../../js/species.js';
import { Atlas } from './atlas.js';
import { frameAt } from './anim.js';
import { bodyFor, animFor, silColorFor, SIL } from './bodies.js';
import { makeSpriteMesh, makeShadowMesh, makeDotMesh } from './layers.js';

const M_PER_PX = 0.11;      // 主角 15×14 px ≈ 1.65 m
const CAP = 20000;          // 同屏上限（远看时全城 2 万人）
const MIN_SCREEN_PX = 6.0;  // 精灵至少占这么多屏幕像素
const DOT_BELOW_PX = 2.2;   // 自然尺寸低于这个 → 画圆点
const DOT_PX = 5.0;
const SHADOW_ALPHA = 0.6;   // 原版 alpha 上限 153/255

const Y_ACTOR = 0.60;
const Y_DECAL = 0.45;
const Y_SHADOW = 0.55;

// 阶段（正交于 state，见 方案_精灵系统重写.md §7）
const STAGE = { NONE: 0, TURN: 1, DIE: 2, RISE: 3 };

export class SpriteView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.atlas = null;
    this.tex = null;
    this.ready = false;
    this.count = 0;

    // 遮挡滞回（每体一个），以及上一帧的时间戳
    this.occlT = new Float32Array(CAP);
    this.lastT = 0;

    // 方案 B 的阶段叠加
    this.prevSt = new Int8Array(CAP).fill(-1);   // -1 = 还没见过
    this.bodyStr = new Array(CAP);               // 上一帧的体型（转阶段时用它，别用已经变了的 kind）
    this.stage = new Uint8Array(CAP);
    this.stageAt = new Float32Array(CAP);        // 开始时的 sim.time
    this.stageDur = new Float32Array(CAP);
    this.zDie = new Uint8Array(CAP);

    this.trace = null;   // 开发用：设成数组就把每帧画了什么记进去
    this.dummy = new THREE.Object3D();
    // 每体稳定随机：同一帧内不变，个体之间不同（衣服色相 / 圆点抖动）
    this.seed2 = new Float32Array(CAP);
    for (let i = 0; i < CAP; i++) {
      const h = (i * 2654435761) >>> 0;
      this.seed2[i] = ((h * 1597334677) >>> 0 & 0xffff) / 65535;
    }
  }

  async load(jsonUrl = 'assets/atlas/atlas.json') {
    this.atlas = await Atlas.load(jsonUrl);
    const pngUrl = jsonUrl.replace(/atlas\.json(\?.*)?$/, 'atlas.png');
    const tex = await new THREE.TextureLoader().loadAsync(pngUrl);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    // rect 以图片左上角为原点，必须关掉 flipY，否则整张图上下镜像
    tex.flipY = false;
    this.tex = tex;

    const A = this.atlas;
    this.actor = makeSpriteMesh(CAP, tex, A.w, A.h, Y_ACTOR);
    this.decal = makeSpriteMesh(CAP, tex, A.w, A.h, Y_DECAL);
    this.group.add(this.decal.mesh);       // 尸体先画（更靠下）
    this.group.add(this.actor.mesh);

    if (A.shadowRect) {
      this.shadow = makeShadowMesh(CAP, tex, A.w, A.h, A.shadowRect);
      this.group.add(this.shadow.mesh);
    }

    this.dots = makeDotMesh(CAP);
    this.group.add(this.dots.mesh);

    this.ready = true;
    console.log('[sprite] v2 图集 ' + A.w + '×' + A.h + '  ' +
      Object.keys(A.clips).length + ' clips  shadow=' + (A.shadowRect ? 'yes' : 'no'));
  }

  // ---------------- 阶段叠加（方案 B） ----------------
  _begin(i, st, sim) {
    // 用**上一帧**的体型：sim 把 state 改成 ZOMBIE 的同一帧里也把 kind 改成了丧尸，
    // 这时候再 bodyFor 会拿到丧尸体型，turn01 就变成「丧尸在转身」了。
    const body = this.bodyStr[i] || bodyFor(sim, i, sim.state[i]);
    let key, dur;
    if (st === STAGE.TURN) {
      key = body + '/turn01';
      this.zDie[i] = 0;
    } else if (st === STAGE.DIE) {
      const sp = SPECIES[sim.kind[i]] || SPECIES[SP.CIV1];
      this.zDie[i] = sp.team === TEAM.ZOMBIE ? 1 : 0;
      key = body + '/' + (this.zDie[i] ? 'zdie01' : 'die01');
    } else {
      key = body + '/zrise01';
      this.zDie[i] = 1;
    }
    dur = this.atlas.dur(key);
    if (!(dur > 0)) return;
    this.stage[i] = st;
    this.stageAt[i] = sim.time;
    this.stageDur[i] = dur;
  }

  /** 返回当前阶段（0=没有），并处理开始/结束。 */
  _stage(i, sim, st) {
    const prev = this.prevSt[i];
    if (prev !== st) {
      this.prevSt[i] = st;
      this.stage[i] = STAGE.NONE;
      if (st === ST.ZOMBIE && prev === ST.INFECTED) this._begin(i, STAGE.TURN, sim);
      else if (st === ST.CORPSE) this._begin(i, STAGE.DIE, sim);
    }
    const sg = this.stage[i];
    if (!sg) return STAGE.NONE;
    if (sim.time - this.stageAt[i] >= this.stageDur[i]) {
      this.stage[i] = STAGE.NONE;
      return STAGE.NONE;
    }
    return sg;
  }

  // ---------------- 每帧 ----------------
  update(sim, cam) {
    if (!this.ready) return;
    const n = sim.n;
    const A = this.atlas;
    const dummy = this.dummy;
    const t = sim.time;
    const halfW = cam.halfW, halfH = cam.halfH;
    const cx = cam.cx, cz = cam.cz;
    const pxPerM = cam.pxPerM || (720 / (2 * halfH));
    const minWorld = MIN_SCREEN_PX / Math.max(pxPerM, 1e-4);
    const dotWorld = DOT_PX / Math.max(pxPerM, 1e-4);

    // 遮挡滞回：用真实时间（16× 快进时 sim.time 会跑飞）
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = Math.min(0.25, Math.max(0, now - this.lastT));
    this.lastT = now;
    const nav = sim.nav;
    const HYST = 0.25;
    const occl = (i, x, z) => {
      const indoor = !!(nav && nav.indoor && nav.indoor(x, z));
      let v = this.occlT[i] + (indoor ? dt : -dt);
      v = v < 0 ? 0 : (v > HYST ? HYST : v);
      this.occlT[i] = v;
      return v >= HYST;
    };

    const actor = this.actor, decal = this.decal, dots = this.dots;
    const aR = actor.rects.array, aT = actor.tints.array, aH = actor.hues.array;
    const dR = decal.rects.array, dT = decal.tints.array, dH = decal.hues.array;
    const sMesh = this.shadow ? this.shadow.mesh : null;
    const sA = this.shadow ? this.shadow.alpha.array : null;
    const dotCol = dots.col.array;

    let k = 0, dk = 0, sk = 0, pk = 0;
    const dotStride = Math.max(1, Math.ceil(n / CAP));

    for (let i = 0; i < n; i++) {
      const st = sim.state[i];
      if (st === ST.SAVED) continue;
      const x = sim.px[i], z = sim.pz[i];
      if (x < cx - halfW - 3 || x > cx + halfW + 3) continue;
      if (z < cz - halfH - 3 || z > cz + halfH + 3) continue;

      const kind = sim.kind ? sim.kind[i] : 0;
      const sp = SPECIES[kind] || SPECIES[SP.CIV1];

      // 阶段：sim 里有 aStage 就用它（A 方案，P3 之后就是这条路）；
      // 没有（预览页的假 sim）才退回渲染层自己的状态跳变检测（方案 B）。
      let stage, stageT, zDie;
      if (sim.aStage) {
        stage = sim.aStage[i];
        stageT = sim.aT[i];
        zDie = sim.aZ[i];
      } else {
        stage = this._stage(i, sim, st);
        stageT = sim.time - this.stageAt[i];
        zDie = this.zDie[i];
      }
      const body = bodyFor(sim, i, st);
      this.bodyStr[i] = body;
      let anim = animFor(sim, i, st, stage, zDie);
      // 动物只有 walk / idle01 两支，其余一律退到 walk（原版也是这样）
      if (body.startsWith('animals_')) anim = (anim === 'idle01' || anim === 'idle02') ? 'idle01' : 'walk';

      const nominal = 15 * M_PER_PX * (sp.scale || 1);
      const naturalPx = nominal * pxPerM;
      const sil = naturalPx >= DOT_BELOW_PX && occl(i, x, z);

      const clip = A.clipFast(body, anim, sil);
      if (!clip) continue;

      // 帧号：阶段动画按"进入阶段后的秒数"，其余按步态相位
      let fi;
      if (stage) {
        fi = frameAt(clip, stageT);                         // 阶段动画：从进入阶段起算
      } else if (st === ST.CORPSE) {
        fi = clip.n - 1;                                    // 躺尸：末帧定格
      } else {
        // 步态相位（旧 retro.js 的算法，逐帧一致）：僵尸走得快 1.3× 并带一点时间漂移
        const boost = (st === ST.ZOMBIE || st === ST.WILD) ? 1.3 : 1.0;
        const fpos = sim.phase[i] * boost + (boost > 1 ? t * 0.2 : 0);
        fi = Math.floor(fpos * clip.n) % clip.n;
        if (fi < 0) fi += clip.n;
      }
      const r = clip.frames[fi];
      if (!r) continue;

      const px = r[2], py = r[3];
      let scaleX = px * M_PER_PX * (sp.scale || 1);
      let scaleZ = py * M_PER_PX * (sp.scale || 1);

      // 极远：纯色圆点（阶段动画不降级，否则"变"看不见）
      if (naturalPx < DOT_BELOW_PX && stage === STAGE.NONE) {
        if (pk >= CAP) continue;
        if (dotStride > 1 && (i % dotStride)) continue;
        dummy.position.set(x, 0.7, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(dotWorld, 1, dotWorld);
        dummy.updateMatrix();
        dummy.matrix.toArray(dots.mesh.instanceMatrix.array, pk * 16);
        const b0 = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
        const v = 0.82 + this.seed2[i % CAP] * 0.38;
        dotCol[pk * 3] = b0[0] * v; dotCol[pk * 3 + 1] = b0[1] * v; dotCol[pk * 3 + 2] = b0[2] * v;
        pk++;
        continue;
      }

      // 远看但没到圆点档：等比放大到最小屏幕尺寸
      const big = Math.max(scaleX, scaleZ);
      if (big < minWorld) {
        const kk = minWorld / big;
        scaleX *= kk; scaleZ *= kk;
      }

      const corpse = (st === ST.CORPSE && stage === STAGE.NONE);
      const buf = corpse ? { R: dR, T: dT, H: dH, idx: dk } : { R: aR, T: aT, H: aH, idx: k };
      const o = buf.idx;
      if (o >= CAP) continue;

      dummy.position.set(x, corpse ? Y_DECAL : Y_ACTOR, z);
      dummy.rotation.set(0, -sim.heading[i], 0);
      dummy.scale.set(scaleX, 1, scaleZ);
      dummy.updateMatrix();
      dummy.matrix.toArray((corpse ? decal : actor).mesh.instanceMatrix.array, o * 16);

      buf.R[o * 4] = r[0]; buf.R[o * 4 + 1] = r[1]; buf.R[o * 4 + 2] = px; buf.R[o * 4 + 3] = py;

      // 配色：剪影 → 阵营纯色；实色 → 原画 + 35% 阵营偏色
      // 转身期间（方案 B）依然按人类配色：绿/蓝，播完才翻红 —— 和原版一致
      const turning = stage === STAGE.TURN;
      let c;
      if (sil) {
        c = turning ? (body === 'police01' ? SIL.police : SIL.civ) : silColorFor(kind, st);
        buf.H[o] = 0;
      } else {
        const base = UNIT_COLOR[turning ? (body === 'police01' ? 'POLICE' : 'CIV') : colorClassOf(kind, st)] || [1, 1, 1];
        const K = 0.35;
        c = [
          1 * (1 - K) + base[0] * K * 1.9,
          1 * (1 - K) + base[1] * K * 1.9,
          1 * (1 - K) + base[2] * K * 1.9,
        ];
        buf.H[o] = (this.seed2[i % CAP] - 0.5) * 0.8;
      }
      buf.T[o * 3] = c[0]; buf.T[o * 3 + 1] = c[1]; buf.T[o * 3 + 2] = c[2];

      // ---- 阴影：尸体 / 剪影 / 太远 都不画 ----
      if (sMesh && !corpse && !sil && naturalPx >= 3) {
        let alpha = SHADOW_ALPHA;
        if (stage === STAGE.DIE || stage === STAGE.RISE) {
          const d = sim.aStage ? sim.aDur[i] : this.stageDur[i];
          const p = d > 0 ? Math.min(1, stageT / d) : 1;
          alpha *= (stage === STAGE.DIE) ? (1 - p) : p;     // 原版：倒地淡出、爬起淡入
        }
        if (alpha > 0.02) {
          const sw = 20 * M_PER_PX * (sp.scale || 1);
          const sh = 15 * M_PER_PX * (sp.scale || 1);
          dummy.position.set(x - 8 * M_PER_PX * (sp.scale || 1), Y_SHADOW, z - 2 * M_PER_PX * (sp.scale || 1));
          dummy.rotation.set(0, 0, 0);          // 阴影不随朝向旋转
          dummy.scale.set(sw, 1, sh);
          dummy.updateMatrix();
          dummy.matrix.toArray(sMesh.instanceMatrix.array, sk * 16);
          sA[sk] = alpha / SHADOW_ALPHA;
          sk++;
        }
      }

      if (this.trace) this.trace.push({ i, st, stage, anim, fi, corpse, sil, x, z, s: scaleX.toFixed(2) });
      if (corpse) dk++; else k++;
    }

    actor.mesh.count = k;
    decal.mesh.count = dk;
    if (sMesh) sMesh.count = sk;
    dots.mesh.count = pk;
    this.count = k + dk;
    actor.mesh.instanceMatrix.needsUpdate = true;
    decal.mesh.instanceMatrix.needsUpdate = true;
    dots.mesh.instanceMatrix.needsUpdate = true;
    actor.rects.needsUpdate = true; actor.tints.needsUpdate = true; actor.hues.needsUpdate = true;
    decal.rects.needsUpdate = true; decal.tints.needsUpdate = true; decal.hues.needsUpdate = true;
    if (this.shadow) {
      this.shadow.mesh.instanceMatrix.needsUpdate = true;
      this.shadow.alpha.needsUpdate = true;
    }
    dots.col.needsUpdate = true;
  }
}




