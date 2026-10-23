// ============================================================
//  ZOS-R · 2009 复古模式（2D 俯视角）
//  直接用反编译出来的原版精灵，一张图集一个 draw call。
//  采样用 NEAREST —— 放大后就是当年的像素颗粒感。
// ============================================================
import * as THREE from 'three';
import { ST } from './sim.js';
import { SP, SPECIES, TEAM, UNIT_COLOR, colorClassOf } from './species.js';

// 主角 15×14 像素对应约 1.65m，所以 1 像素 ≈ 0.11m
const M_PER_PX = 0.11;
const FPS = 12;                 // 原版动画大约 12 帧/秒
const CAP = 20000;              // 同时画得出来的个体上限（远看时全城 2 万人要一次画完）
const ZOMBIE_BODIES = ['guy01', 'girl01', 'guy02', 'fat01'];
// 远看时的最小屏幕尺寸：低于这个像素数就把精灵放大成"颜色块"，
// 这样整城拉远也能一眼看出势力和分布。
const MIN_SCREEN_PX = 6.0;      // 精灵至少占这么多像素（远看才不至于消失）
const DOT_BELOW_PX = 2.2;       // 自然尺寸低于这个就改画纯色圆点
const DOT_PX = 5.0;             // 圆点直径（屏幕像素）

// 平民可用的体型（原版 6 套人物精灵，去掉警察那套）
const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];

const TYPE_TO_SPRITE = {
  [SP.CIV1]: 'guy01',
  [SP.CIV2]: 'guy02',
  [SP.CIV3]: 'fat01',
  [SP.POLICE]: 'police01',
  [SP.SOLDIER]: 'police01',
  [SP.ELITE]: 'police01',
  [SP.ZOMBIE]: 'guy02',
  [SP.TANK]: 'fat01',
  [SP.CHARGER]: 'guy01',
  [SP.BOOMER]: 'fat01',
  [SP.SPITTER]: 'girl01',
  [SP.APC]: 'police01',
  [SP.DOG]: 'animals_dog',
  [SP.CAT]: 'animals_cat',
  [SP.BEAR]: 'animals_bear',
  [SP.TIGER]: 'animals_tiger',
};

const vert = /* glsl */`
attribute vec4 aRect;      // xy = 图集位置, zw = 尺寸
attribute vec3 aTint;
attribute float aHue;      // 每件"衣服"的色相偏移（弧度）
varying vec2 vUv;
varying vec3 vTint;
varying float vHue;
uniform vec2 uAtlas;
void main() {
  // 图集坐标以左上角为原点；平面绕 X 转 -90° 摊到 XZ 后，uv.y=1 在屏幕上方。
  // texture.flipY 已关掉（v=0 对应图片第 0 行），所以 uv.y=1 必须取 rect 顶部 y。
  float vy = aRect.y + (1.0 - uv.y) * aRect.w;
  vUv = vec2(aRect.x + uv.x * aRect.z, vy) / uAtlas;
  vTint = aTint;
  vHue = aHue;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */`
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
varying vec3 vTint;
varying float vHue;

// 保亮度的色相旋转（YIQ 绕灰轴）
vec3 hueShift(vec3 col, float h) {
  const vec3 k = vec3(0.57735);
  float c = cos(h), s = sin(h);
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.45) discard;
  vec3 col = t.rgb;
  // 只处理"有颜色、不太暗"的像素：描边和阴影不参与换色，否则会发黑
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mx = max(max(col.r, col.g), col.b);
  float mn = min(min(col.r, col.g), col.b);
  float sat = mx > 0.02 ? (mx - mn) / mx : 0.0;
  float cloth = step(0.16, lum) * smoothstep(0.10, 0.28, sat);
  // 皮肤保护
  float skin = 1.0 - smoothstep(0.09, 0.20, distance(col, vec3(0.95, 0.80, 0.62)));
  // 衣服换色：用逐通道乘子（偏暖/偏冷/偏绿），不会产生负值
  vec3 warm = vec3(1.0 + vHue * 0.45, 1.0 + vHue * 0.10, 1.0 - vHue * 0.35);
  vec3 cool = vec3(1.0 - vHue * 0.35, 1.0 + vHue * 0.15, 1.0 + vHue * 0.45);
  vec3 mulv = mix(warm, cool, step(0.0, vHue));
  mulv = clamp(mulv, 0.55, 1.55);
  col = mix(col, clamp(col * mulv, 0.0, 1.0), cloth * (1.0 - skin));
  gl_FragColor = vec4(col * vTint, 1.0);
}
`;

export class RetroView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.meta = null;
    this.ready = false;
    this.count = 0;
    // 遮挡滞回计时（每个个体一个），以及上一帧的时间戳
    this.occlT = new Float32Array(CAP);
    this.lastT = 0;
  }

  async load() {
    const meta = await (await fetch('assets/retro/atlas.json')).json();
    const tex = await new THREE.TextureLoader().loadAsync('assets/retro/atlas.png');
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    // atlas.json 的 rect 是「图片左上角为原点」的像素坐标；three 默认 flipY=true
    // 会把图上下翻过来（v=0 对应图片底行），若不关掉，v=(y+uv*h)/H 会采到
    // 整张图镜像位置的另一帧 —— 屏幕上就是一堆彩色碎块。
    tex.flipY = false;
    this.meta = meta;
    this.tex = tex;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);          // 摊平到 XZ 平面
    const rects = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    const hues = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    rects.setUsage(THREE.DynamicDrawUsage);
    tints.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRect', rects);
    geo.setAttribute('aTint', tints);
    geo.setAttribute('aHue', hues);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uAtlas: { value: new THREE.Vector2(meta.w, meta.h) },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });

    // ---- 远距离用的纯色圆点 ----
    const dgeo = new THREE.PlaneGeometry(1, 1);
    dgeo.rotateX(-Math.PI / 2);
    const dcol = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    dcol.setUsage(THREE.DynamicDrawUsage);
    dgeo.setAttribute('aColor', dcol);
    const dmat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 aColor;
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          vUv = uv; vCol = aColor;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          float d = length(vUv - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.40, d);
          gl_FragColor = vec4(vCol * (0.85 + a * 0.35), 1.0);
        }`,
      depthWrite: true, depthTest: true,
    });
    this.dotMesh = new THREE.InstancedMesh(dgeo, dmat, CAP);
    this.dotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dotMesh.frustumCulled = false;
    this.dotMesh.count = 0;
    this.group.add(this.dotMesh);
    this.dotCol = dcol;

    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
    this.rects = rects;
    this.tints = tints;
    this.hues = hues;
    this.dummy = new THREE.Object3D();
    // 每体的稳定随机种子：同一帧内不变，但个体之间不同
    this.seed = new Float32Array(CAP);
    this.seed2 = new Float32Array(CAP);
    for (let i = 0; i < CAP; i++) {
      const h = (i * 2654435761) >>> 0;
      this.seed[i] = ((h ^ (h >>> 13)) & 0xffff) / 65535;
      this.seed2[i] = ((h * 1597334677) >>> 0 & 0xffff) / 65535;
    }
    this.ready = true;
    console.log(`[ZOS-R] 复古图集 ${meta.w}×${meta.h}  ${meta.count} 帧`);
  }

  // 每种体型有的动画不一样（police01 没有丧尸动画），所以按"想要的 → 次选 → 兜底"取帧。
  // wantOutline 时优先取**同一个动画**的 outline 帧：帧数与 solid 一一对应、位置对齐，
  // 所以切换时不会换动作、不会跳位（这是 F3「未被遮挡却跳变成被遮挡」的根）。
  _frames(type, anim, wantOutline) {
    const F = this.meta.frames;
    // 只在同一体型内兜底 —— 跨体型会让人物"变形成胖子"
    const chain = [
      `${type}/${anim}_solid`,
      `${type}/walk_solid`,
      `${type}/idle01_solid`,
      `${type}/zattack01_solid`,   // 丧尸缺 zwalk 时用它，至少肢体是红的
    ];
    for (const k of chain) {
      if (!F[k]) continue;
      if (wantOutline) {
        const ok = k.replace(/_solid$/, '_outline');
        if (F[ok]) return F[ok];
      }
      return F[k];
    }
    return null;
  }

  /**
   * 状态 → 动画名（不含 _solid 后缀）
   * 分类依据 sim 的状态机，不是物种：同一物种在不同状态下动作完全不同。
   */
  _pickAnim(sim, i, isZombieBody) {
    const st = sim.state[i];
    if (st === ST.CORPSE) return isZombieBody ? 'zdie01' : 'die01';
    if (st === ST.ZOMBIE) {
      // 正在啃人 → 攻击帧；否则走路
      const tg = sim.tgt ? sim.tgt[i] : -1;
      if (tg >= 0) {
        const dx = sim.px[tg] - sim.px[i], dz = sim.pz[tg] - sim.pz[i];
        if (dx * dx + dz * dz < 3.2 * 3.2) return 'zattack01';
      }
      return 'zwalk01';
    }
    if (st === ST.INFECTED) return 'walk';          // 潜伏期还是活人
    if (st === ST.WILD) return (sim.tgt && sim.tgt[i] >= 0) ? 'run01' : 'walk';   // 熊/虎：追人时奔跑
    if (st === ST.FLEE) return 'run01';
    if (st === ST.FIGHT) return 'shoot01';
    if (st === ST.POLICE || st === ST.SOLDIER) {
      if (sim.tgt && sim.tgt[i] >= 0) return 'shoot01';
      return sim.idle && sim.idle[i] ? 'idle01' : 'walk';
    }
    if (sim.idle && sim.idle[i]) return ((i & 1) ? 'idle02' : 'idle01');
    return 'walk';
  }

  update(sim, cam) {
    if (!this.ready) return;
    const n = sim.n;
    const dummy = this.dummy;
    const rects = this.rects.array;
    const tints = this.tints.array;
    const hues = this.hues.array;
    const t = sim.time;
    const halfW = cam.halfW, halfH = cam.halfH;
    // 每米多少屏幕像素；用来保证远看时单位至少 MIN_SCREEN_PX 大
    const pxPerM = cam.pxPerM || (720 / (2 * halfH));
    const minWorld = MIN_SCREEN_PX / Math.max(pxPerM, 1e-4);
    const cx = cam.cx, cz = cam.cz;

    // ---- 遮挡判定（在屋里 = 被屋顶盖住）----
    // 必须带滞回：人在门口来回走时 indoor 会逐帧翻转，不加滞回就会「没被挡住却
    // 突然跳成被挡住的样子」，来回闪。
    // 用真实时间而不是 sim.time —— 16× 快进时 sim.time 会跑得飞快，滞回会失效。
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = Math.min(0.25, Math.max(0, now - this.lastT));
    this.lastT = now;
    const nav = sim.nav;
    const occlT = this.occlT;
    const HYST = 0.25;                    // 进出屋各要持续 0.25s 才切换
    const occl = (i, x, z) => {
      const indoor = !!(nav && nav.indoor && nav.indoor(x, z));
      let v = occlT[i] + (indoor ? dt : -dt);
      v = v < 0 ? 0 : (v > HYST ? HYST : v);
      occlT[i] = v;
      return v >= HYST;
    };

    let k = 0, dk = 0;
    const dots = this.dotCol.array;
    const dotWorld = DOT_PX / Math.max(pxPerM, 1e-4);
    // 全城远看时圆点数量会超过容量，按步长抽样（平民是按网格行序生成的，
    // 等步长抽样在空间上也是均匀的 —— 否则「只画前 CAP 个」会画满南城、空着北城）。
    // 只在圆点档生效：近景是精灵，不该被抽样。
    const dotStride = Math.max(1, Math.ceil(n / CAP));
    for (let i = 0; i < n && k < CAP; i++) {
      const st = sim.state[i];
      if (st === ST.SAVED) continue;
      const x = sim.px[i], z = sim.pz[i];
      if (x < cx - halfW - 3 || x > cx + halfW + 3) continue;
      if (z < cz - halfH - 3 || z > cz + halfH + 3) continue;

      const kind = sim.kind ? sim.kind[i] : 0;
      const sp = SPECIES[kind] || SPECIES[SP.CIV1];
      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';
      // 平民：按个体稳定哈希挑体型，让街头看起来是"各种人"而不是一个人复制
      if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
        const h = (i * 2654435761) >>> 0;
        sprType = CIV_BODIES[h % CIV_BODIES.length];
        // 注意：这里**不再**因为缺 idle 帧而换体型 —— 5 种体型的 idle 帧已补齐，
        // 换体型会让"胖子一停下就变成普通男人"。
      }
      // 丧尸：在几种体型间轮换（图集里只有 fat01 有完整的 zwalk 动画链）
      if (st === ST.ZOMBIE && kind === SP.ZOMBIE) {
        sprType = ZOMBIE_BODIES[i % ZOMBIE_BODIES.length];
      }
      // 狗/猫尸变后换一套红色变体
      const zk0 = (SPECIES[kind] || {}).zombieKind;
      const zk = zk0 ? (zk0.startsWith('animals_') ? zk0 : 'animals_' + zk0) : null;
      if (zk && st === ST.ZOMBIE) sprType = zk;
      const anim = this._pickAnim(sim, i, sp.team === TEAM.ZOMBIE && st === ST.CORPSE);
      // 精灵/圆点的分界只看物种体型，先算出来：圆点档不必做遮挡判定
      const nominal = 15 * M_PER_PX * (sp.scale || 1);
      const naturalPx = nominal * pxPerM;
      // 在屋里 = 被屋顶挡住 → 画 X 光绿轮廓（带滞回，在门口来回走不会闪）
      const wantOutline = naturalPx >= DOT_BELOW_PX && occl(i, x, z);
      const fv = this._frames(sprType, anim, wantOutline);
      if (!fv) continue;

      // 帧序：跟着个体自己的步态相位走（站着就不动，走得快就迈得快）
      // 衣服变体：每个个体挑一套（animal 只有 1 套）
      let frames = fv;
      if (Array.isArray(fv[0])) {
        const vi = Math.min(fv.length - 1, Math.floor(this.seed2[i % CAP] * fv.length));
        frames = fv[Math.max(0, vi)];
      }
      if (!frames || !frames.length) continue;
      let fi = Math.floor(sim.phase[i] * frames.length) % frames.length;
      if (st === ST.ZOMBIE || st === ST.WILD) fi = Math.floor((sim.phase[i] * 1.3 + t * 0.2) * frames.length) % frames.length;
      if (st === ST.CORPSE) fi = frames.length - 1;   // 尸体停在最后一帧
      const r = frames[fi];

      const px = r[2], py = r[3];
      let scaleX = px * M_PER_PX * (sp.scale || 1);
      let scaleZ = py * M_PER_PX * (sp.scale || 1);

      // 极远：画纯色圆点（放大精灵在这个尺度只会糊成毛边）
      if (naturalPx < DOT_BELOW_PX) {
        if (dk >= CAP) continue;
        if (dotStride > 1 && (i % dotStride)) continue;
        dummy.position.set(x, 0.7, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(dotWorld, 1, dotWorld);
        dummy.updateMatrix();
        dummy.matrix.toArray(this.dotMesh.instanceMatrix.array, dk * 16);
        // 颜色与精灵一致
        const b0 = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
        const v = 0.82 + this.seed2[i % CAP] * 0.38;
        const b2 = [b0[0] * v, b0[1] * v, b0[2] * v];
        dots[dk * 3] = b2[0]; dots[dk * 3 + 1] = b2[1]; dots[dk * 3 + 2] = b2[2];
        dk++;
        continue;
      }

      // 远看但还没到圆点档：等比放大到最小屏幕尺寸
      const big = Math.max(scaleX, scaleZ);
      if (big < minWorld) {
        const kk = minWorld / big;
        scaleX *= kk; scaleZ *= kk;
      }

      dummy.position.set(x, 0.6, z);
      dummy.rotation.set(0, -sim.heading[i], 0);
      dummy.scale.set(scaleX, 1, scaleZ);
      dummy.updateMatrix();
      dummy.matrix.toArray(this.mesh.instanceMatrix.array, k * 16);

      rects[k * 4] = r[0]; rects[k * 4 + 1] = r[1];
      rects[k * 4 + 2] = px; rects[k * 4 + 3] = py;

      // 配色：尸体系整片压红，特感按物种上色
      // 统一阵营色：精灵保留原画，只做 35% 的偏色，保证一眼分得清敌我
      // 阵营色固定（按属性）：平民绿 / 警察蓝 / 军绿 / 丧尸红 / 特感紫
      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const K = 0.35;
      let c = [
        1 * (1 - K) + base[0] * K * 1.9,
        1 * (1 - K) + base[1] * K * 1.9,
        1 * (1 - K) + base[2] * K * 1.9,
      ];
      // 衣服随机：每个个体一个色相偏移（±23°），皮肤和描边由 shader 保护
      hues[k] = (this.seed2[i % CAP] - 0.5) * 0.8;
      tints[k * 3] = c[0]; tints[k * 3 + 1] = c[1]; tints[k * 3 + 2] = c[2];
      k++;
    }

    this.mesh.count = k;
    this.dotMesh.count = dk;
    this.dotMesh.instanceMatrix.needsUpdate = true;
    this.dotCol.needsUpdate = true;
    this.count = k + dk;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rects.needsUpdate = true;
    this.tints.needsUpdate = true;
    this.hues.needsUpdate = true;
  }
}
