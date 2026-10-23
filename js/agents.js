// ============================================================
//  ZOS-R · 个体渲染：远景点云 + 近处实例化人形（自动 LOD）
// ============================================================
import * as THREE from 'three';
import { ST } from './sim.js';
import { SPECIES, SP, UNIT_COLOR, colorClassOf } from './species.js';
import { unitGeometry } from './units.js';

const VIP_COLOR = [1.0, 0.80, 0.15];   // 要员：金色

const COLORS = {
  [ST.CIV]: [0.30, 0.80, 0.44],
  [ST.FLEE]: [0.72, 0.88, 0.36],
  [ST.FIGHT]: [0.42, 0.86, 0.95],
  [ST.POLICE]: [0.28, 0.56, 0.98],
  [ST.ZOMBIE]: [0.94, 0.28, 0.18],
  [ST.INFECTED]: [0.97, 0.72, 0.26],
  [ST.CORPSE]: [0.24, 0.24, 0.26],
};

const pointVert = /* glsl */`
attribute float aSize;
attribute vec3  aColor;
attribute float aHide;
varying vec3  vCol;
varying float vHide;
void main(){
  vCol = aColor;
  vHide = aHide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aHide > 0.5 ? 0.0 : clamp(aSize / max(1.0, -mv.z), 2.6, 15.0);
}
`;

const pointFrag = /* glsl */`
precision highp float;
varying vec3  vCol;
varying float vHide;
void main(){
  if (vHide > 0.5) discard;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;              // 0 = 中心, 1 = 边缘
  if (r > 1.0) discard;
  float edge = smoothstep(1.0, 0.72, r);
  float core = smoothstep(0.94, 0.66, r);
  // 深色描边 + 亮核：亮底(卫星图)和暗底(矢量图)上都能看清
  vec3 col = mix(vec3(0.06, 0.06, 0.07), vCol * 1.2, core);
  gl_FragColor = vec4(col, edge);
}
`;

export class AgentRenderer {
  constructor(scene, max = 160000) {
    this.max = max;
    this.count = 0;

    // ---------- 远景点云 ----------
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.hide = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aHide', new THREE.BufferAttribute(this.hide, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const pm = new THREE.ShaderMaterial({
      vertexShader: pointVert,
      fragmentShader: pointFrag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, pm);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.geo = g;

    // ---------- 近处单位：每种物种一个 InstancedMesh ----------
    const NEAR = 4000;
    this.nearCap = NEAR;
    this.unitsVisible = true;
    this.nearFlag = new Uint8Array(160000);   // 滞回：已经显示为模型的个体不会在边界抖动
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.kindMeshes = new Map();      // kind -> { mesh, n }
    this.nearRadius = 430;

    this._meshes = (kind) => {
      let e = this.kindMeshes.get(kind);
      if (!e) {
        const mesh = new THREE.InstancedMesh(unitGeometry(kind), this.mat, NEAR);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        scene.add(mesh);
        e = { mesh, n: 0 };
        this.kindMeshes.set(kind, e);
      }
      return e;
    };

    this.dummy = new THREE.Object3D();
  }

  update(sim, camPos) {
    const n = sim.n;
    this.count = n;
    const px = sim.px, pz = sim.pz;
    const pos = this.pos, col = this.col, size = this.size, hide = this.hide;
    const camX = camPos.x, camZ = camPos.z;
    const rIn = this.nearRadius;
    const rOut = this.nearRadius * 1.3;      // 出圈要比进圈远 30%，防止抖动
    const rIn2 = rIn * rIn, rOut2 = rOut * rOut;

    if (!this.unitsVisible) { for (const e of this.kindMeshes.values()) e.n = 0; }
    else for (const e of this.kindMeshes.values()) e.n = 0;

    const dummy = this.dummy;

    for (let i = 0; i < n; i++) {
      const x = px[i], z = pz[i];
      const i3 = i * 3;
      pos[i3] = x; pos[i3 + 1] = 0.9; pos[i3 + 2] = z;

      const st = sim.state[i];
      if (st === ST.SAVED) { hide[i] = 1; continue; }

      const kind = sim.kind ? sim.kind[i] : 0;
      const sp = SPECIES[kind] || SPECIES[SP.CIV1];
      let c = UNIT_COLOR[colorClassOf(kind, st)];
      if (st === ST.CORPSE) c = UNIT_COLOR.CORPSE;
      // 要员：金色高亮 + 更大
      const isVip = sim.vip && sim.vip[i];
      if (isVip && st !== ST.CORPSE) c = VIP_COLOR;
      col[i3] = c[0]; col[i3 + 1] = c[1]; col[i3 + 2] = c[2];
      size[i] = 3300 * sp.scale * (isVip ? 1.7 : 1);

      let hid = 0;
      const dx = x - camX, dz = z - camZ;
      const d2 = dx * dx + dz * dz;

      const wasNear = this.nearFlag[i] === 1;
      const isNear = d2 < (wasNear ? rOut2 : rIn2);
      if (this.unitsVisible && isNear && st !== ST.CORPSE) {
        this.nearFlag[i] = 1;
        const e = this._meshes(kind);
        if (e.n < this.nearCap) {
          const bob = Math.sin(sim.phase[i] * 6.2832) * 0.07 * (st === ST.ZOMBIE ? 1.4 : 1);
          dummy.position.set(x, bob, z);
          dummy.rotation.set(0, -sim.heading[i] + Math.PI / 2, 0);
          const sc = sp.scale;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          dummy.matrix.toArray(e.mesh.instanceMatrix.array, e.n * 16);
          e.n++;
          hid = 1;
        }
      }
      if (!isNear) this.nearFlag[i] = 0;
      hide[i] = hid;
    }

    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aHide.needsUpdate = true;

    for (const e of this.kindMeshes.values()) {
      e.mesh.count = e.n;
      if (e.n > 0) e.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}







