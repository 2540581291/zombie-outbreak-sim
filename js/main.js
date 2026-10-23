// ============================================================
//  ZOS-R · 主程序：装配、相机、循环、UI
// ============================================================
import * as THREE from 'three';
import { buildCity, buildSatelliteGround, localizeCityNames } from './city.js';
import { TiledGround } from './ground.js';
import { buildNav, Sim, ST, GOAL } from './sim.js';
import { loadCollision, collisionStats } from './collision.js';
import { applyLayerPatch } from './layerpatch.js';
import { AgentRenderer } from './agents.js';
import { TOOLS, TOOL_BY_ID, HOTKEYS, fmtWan, fmtMoney } from './tools.js';
import { profileFor, shortName } from './people.js';
import { kinList, ageOfAgent } from './family.js';
import { SPECIES, SP } from './species.js';
import { weaponOf } from './weapons.js';
import { stockText } from './storage.js';
import { AudioEngine } from './audio.js';
import { openReport, closeReport, isReportOpen } from './report.js';
import { openForce, openSanit, openChaosInfo, openInfectInfo, openAwareInfo } from './status.js';
import { openOverview, close as closeOverview, toggle as toggleOverview, isOpen as overviewIsOpen } from './overview.js';
import { SpriteView } from '../src/sprite/index.js';
import { TerrainOverlay } from './overlay.js';
import { LayerEditor } from './editmode.js';

const $ = (id) => document.getElementById(id);
const MAX_DIST = 9000;        // 3D 上限：视高 ≈ 0.975×dist ≈ 8.8 km
// 2D 的 dist 语义完全不同（视高 = 2×0.0475×dist），9000 只相当于 855 m 视高，
// 根本缩不出城区。所以 2D 单独设上限，而且按城市大小算：正好把整座城装进画面
// （启动时由 nav.H 覆盖，见 boot；柏林约 28,000 → 视高 2.7 km）
let maxDist2d = 30000;

// ---------- 错误可见化 ----------
function fail(msg) {
  const l = $('loading');
  l.classList.remove('done');
  $('ld-txt').innerHTML = '<span style="color:#ff6b52">' + msg + '</span>';
  console.error(msg);
}
window.addEventListener('error', (e) => {
  document.title = 'ERR ' + (e.message || e);
  fail('运行错误：' + (e.message || e));
});
window.addEventListener('unhandledrejection', (e) => {
  document.title = 'ERR ' + (e.reason?.message || e.reason);
  fail('未处理错误：' + (e.reason?.message || e.reason));
});

// ---------- 浏览器能力 ----------
const app = $('app');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fail('WebGL 初始化失败：' + e.message);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x222c38);
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 900, 5200);

// ---------- 天空穹顶（渐变）----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x35506e) },
      uBot: { value: new THREE.Color(0x0e1216) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP;
      void main(){ float h = normalize(vP).y * 0.5 + 0.5;
        vec3 c = mix(uBot, uTop, pow(clamp(h,0.0,1.0), 0.85));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment> }`,
  })
);
sky.scale.setScalar(14000);
sky.frustumCulled = false;
scene.add(sky);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 20000);

// ---------- 灯光（给 Lambert 材质用）----------
const sun = new THREE.DirectionalLight(0xfff0dd, 1.5);
sun.position.set(-500, 900, 600);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0x93b3d6, 0x1a1c18, 0.85);
scene.add(hemi);
const nightTint = document.getElementById('nighttint');

// ---------- 相机机架 ----------
const rig = {
  target: new THREE.Vector3(0, 0, 0),
  dist: 820,
  yaw: -0.7,
  pitch: 0.90,
};
function applyCamera() {
  const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
  camera.position.set(
    rig.target.x + Math.sin(rig.yaw) * cp * rig.dist,
    rig.target.y + sp * rig.dist,
    rig.target.z + Math.cos(rig.yaw) * cp * rig.dist
  );
  camera.lookAt(rig.target);

  // 深度精度：near 跟着观察距离走。
  // near=1 / far=25000 会让远处的地面图层和相邻墙面在深度上撞车（闪烁）。
  camera.near = Math.min(300, Math.max(0.6, rig.dist * 0.02));
  camera.far = rig.dist * 3 + 4000;
  camera.updateProjectionMatrix();

  // 雾也跟着观察距离走，否则拉远了整座城会被雾糊成一片灰
  if (scene.fog) {
    scene.fog.near = rig.dist * 1.6;
    scene.fog.far = rig.dist * 7.5;
  }
  // 天空球始终贴着远平面，避免被裁掉
  sky.scale.setScalar(camera.far * 0.8);
}

// ---------- 指北针 ----------
//  compass：东 = +x，西 = -x，南 = +z，北 = -z。2D 模式强制正北朝上。
const CMP = $('compass');
const CMP_CTX = CMP ? CMP.getContext('2d') : null;
const DIRS = [
  ['N', [0, 0, -1]], ['E', [1, 0, 0]], ['S', [0, 0, 1]], ['W', [-1, 0, 0]],
];
function drawCompass() {
  if (!CMP_CTX) return;
  const yaw = retroMode ? 0 : rig.yaw;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // 屏幕右方向（世界 xz）
  const ux = -Math.sin(yaw), uz = -Math.cos(yaw);     // 屏幕上方向（世界 xz，水平投影）
  const W = CMP.width, H = CMP.height, cx = W / 2, cy = H / 2, R = 30;
  CMP_CTX.clearRect(0, 0, W, H);
  CMP_CTX.beginPath();
  CMP_CTX.arc(cx, cy, R + 9, 0, 6.2832);
  CMP_CTX.strokeStyle = 'rgba(255,255,255,.16)';
  CMP_CTX.lineWidth = 1;
  CMP_CTX.stroke();

  const screen = (d) => [d[0] * rx + d[2] * rz, -(d[0] * ux + d[2] * uz)];

  // 方位字母
  CMP_CTX.font = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';
  CMP_CTX.textAlign = 'center';
  CMP_CTX.textBaseline = 'middle';
  for (const [k, d] of DIRS) {
    const [sx, sy] = screen(d);
    CMP_CTX.fillStyle = k === 'N' ? '#e2542b' : 'rgba(207,214,221,.85)';
    CMP_CTX.fillText(k, cx + sx * R, cy + sy * R);
  }
  // 北向箭头
  const [nx, ny] = screen([0, 0, -1]);
  CMP_CTX.beginPath();
  CMP_CTX.moveTo(cx + nx * (R - 12), cy + ny * (R - 12));
  CMP_CTX.lineTo(cx + nx * 8 + (-ny) * 5, cy + ny * 8 + nx * 5);
  CMP_CTX.lineTo(cx + nx * 8 - (-ny) * 5, cy + ny * 8 - nx * 5);
  CMP_CTX.closePath();
  CMP_CTX.fillStyle = 'rgba(226,84,43,.85)';
  CMP_CTX.fill();
  // 中心点
  CMP_CTX.beginPath();
  CMP_CTX.arc(cx, cy, 2.2, 0, 6.2832);
  CMP_CTX.fillStyle = 'rgba(207,214,221,.7)';
  CMP_CTX.fill();
}

// ---------- 输入 ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyM') setMapMode(mapMode === 'sat' ? 'vec' : 'sat');
  if (e.code === 'KeyB') setBuildings(!showBuildings);
  if (e.code === 'Tab') { e.preventDefault(); setRetro(!retroMode); }
  if (e.code === 'KeyC') setOverlay(!overlayOn);
  if (e.code === 'KeyL' && layerEdit) { e.preventDefault(); layerEdit.toggle(); }
  if (e.code === 'KeyO' && sim) toggleOverview(sim);
  if (e.code === 'Escape' && overviewIsOpen()) closeOverview();
  if (HOTKEYS[e.code]) selectTool(HOTKEYS[e.code]);
});
addEventListener('keyup', (e) => keys.delete(e.code));

let drag = null;
const el = renderer.domElement;
el.addEventListener('contextmenu', (e) => e.preventDefault());

el.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0, btn: e.button, sx: e.clientX, sy: e.clientY };
  el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  hoverAt(e);
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);

  const yaw = retroMode ? 0 : rig.yaw;   // 2D 固定正北朝上
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  if (drag.btn === 2) {
    // 右键 = 平移（灵敏度系数 0.0016 → 0.00085）
    const k = rig.dist * 0.00085;
    rig.target.addScaledVector(fwd, dy * k).addScaledVector(right, -dx * k);
  } else if (drag.btn === 1 && !retroMode) {
    // 中键 = 旋转 / 俯仰（2D 禁止旋转，正北朝上）
    rig.yaw -= dx * 0.005;
    rig.pitch = Math.max(0.18, Math.min(1.52, rig.pitch + dy * 0.004));
  }
  clampTarget();
});
el.addEventListener('pointerup', (e) => {
  const wasClick = drag && drag.moved < 5 && drag.btn === 0;   // 只有左键算点击
  const wasRight = drag && drag.moved < 8 && drag.btn === 2;   // 右键 = 给士兵下令
  drag = null;
  // 右键：选中的是士兵 → 命令他走到这里（警察不接受命令）
  if (wasRight && sim && selected >= 0) {
    const ndc2 = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    const rc2 = new THREE.Raycaster();
    rc2.setFromCamera(ndc2, activeCamera());
    const hit2 = new THREE.Vector3();
    if (rc2.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit2)) {
      if (sim.orderMove(selected, hit2.x, hit2.z)) {
        toast('命令：移动到此处');
        ping(hit2, 0x7aa7ff, 8);
      } else {
        toast(sim.state[selected] === 3 ? '警察不接受命令（只能命令士兵）' : '这个人不能接受命令');
      }
    }
  }
  if (layerEdit && layerEdit.enabled) return;   // 编辑模式：左键是涂改
  if (wasClick && sim) {
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, activeCamera());
    const hit = new THREE.Vector3();
    if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
      const t = TOOL_BY_ID[activeTool];
      if (!t || t.kind === 'select') {
        const i = pickAgent(e.clientX, e.clientY);
        if (i >= 0) selectAgent(i);
        else deselectAgent();
      } else {
        useToolAt(hit.x, hit.z);
      }
    }
  }
});

// ---------- 个体选择 ----------
let selected = -1;
let followSelected = false;

function pickAgent(clientX, clientY) {
  if (!sim) return -1;
  const cam = activeCamera();
  const v = new THREE.Vector3();
  let best = -1, bd = 18 * 18;   // 18 像素以内算点中
  const n = sim.n;
  for (let i = 0; i < n; i++) {
    const st = sim.state[i];
    if (st === ST.CORPSE || st === ST.SAVED) continue;
    v.set(sim.px[i], 0.9, sim.pz[i]).project(cam);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -40 || sy < -40 || sx > window.innerWidth + 40 || sy > window.innerHeight + 40) continue;
    const d = (sx - clientX) * (sx - clientX) + (sy - clientY) * (sy - clientY);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

let escapeMark = null;      // 逃离线的绿色光带

// 选中角色的行走路径（虚线折线）
let pathLine = null;
let pathRing = null;
let linkLine = null;                    // 纯黑连线：选中的那个人 → 点到的另一个角色/地点
let linkTo = null;                      // { kind: 'agent'|'place', i, x, z, label }
let pathKey = '';

function ensurePathGfx() {
  if (pathLine) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 260), 3));
  const mat = new THREE.LineDashedMaterial({
    color: 0x59d0ff, dashSize: 7, gapSize: 5, transparent: true, opacity: 0.9, depthTest: false,
  });
  pathLine = new THREE.Line(geo, mat);
  pathLine.frustumCulled = false;
  pathLine.renderOrder = 6;
  pathLine.visible = false;
  scene.add(pathLine);

  pathRing = new THREE.Mesh(
    new THREE.RingGeometry(4, 7.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x59d0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
  pathRing.rotation.x = -Math.PI / 2;
  pathRing.renderOrder = 6;
  pathRing.visible = false;
  scene.add(pathRing);

  // 纯黑连线（两点，每帧更新端点）
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    linkLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x000000, transparent: false, depthTest: false, depthWrite: false,
    }));
    linkLine.frustumCulled = false;
    linkLine.renderOrder = 9;
    linkLine.visible = false;
    scene.add(linkLine);
  }
}

/** 每帧刷新：选中谁就画谁的行走路径 */
function updatePathLine() {
  ensurePathGfx();
  if (!sim || selected < 0) { pathLine.visible = false; pathRing.visible = false; return; }
  const g = sim.goal[selected];
  let tp = sim.goalPoint(selected, g);
  if (!tp && g === GOAL.FLEE) tp = sim.escapePoint(selected);
  if (!tp) { pathLine.visible = false; pathRing.visible = false; return; }

  // 画他**正在走**的路线：自己 → 门 → 剩余路点 → 目标（不做寻路计算，每帧重建）
  {
    const pts = sim.routeOf ? sim.routeOf(selected) : null;
    const arr = pathLine.geometry.attributes.position.array;
    const n = Math.min(259, pts ? pts.length : 0);
    for (let k = 0; k < n; k++) {
      arr[k * 3] = pts[k][0];
      arr[k * 3 + 1] = 2.2;
      arr[k * 3 + 2] = pts[k][1];
    }
    if (!n) { arr[0] = sim.px[selected]; arr[1] = 2.2; arr[2] = sim.pz[selected]; arr[3] = tp[0]; arr[4] = 2.2; arr[5] = tp[1]; }
    pathLine.geometry.setDrawRange(0, Math.max(2, n));
    pathLine.geometry.attributes.position.needsUpdate = true;
    pathLine.computeLineDistances();
  }
  pathLine.visible = true;
  pathRing.position.set(tp[0], 2.2, tp[1]);
  pathRing.visible = true;
}


/** 把"逃离线"画出来（2D / 3D 都看得见） */
function buildEscapeMarker() {
  if (!sim || !sim.escapeLine) return;
  if (escapeMark) {
    scene.remove(escapeMark);
    escapeMark.geometry.dispose();
    escapeMark.material.dispose();
    escapeMark = null;
  }
  const side = sim.escapeLine();
  const nav = sim.nav;
  const horizontal = sim.escapeSide === 'N' || sim.escapeSide === 'S';
  const len = horizontal ? nav.halfW * 2 : nav.halfH * 2;
  const geo = new THREE.PlaneGeometry(len, 34);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x43e08a, transparent: true, opacity: 0.45, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  if (horizontal) m.position.set(0, 1.2, side.z > 0 ? nav.halfH - 18 : -nav.halfH + 18);
  else {
    m.rotation.z = Math.PI / 2;
    m.position.set(side.x > 0 ? nav.halfW - 18 : -nav.halfW + 18, 1.2, 0);
  }
  m.renderOrder = 3;
  scene.add(m);
  escapeMark = m;
}

function selectAgent(i) {
  if (i === selected) {
    // 同一个人的情况下也要能"从地点视图回到他本人"
    placeView = null;
    renderAgentCard();
    return;
  }
  // 换人 = 全新的一次选择：上一个人身上的所有临时状态一律清掉
  clearLink();                // 黑色连线
  pathKey = '';               // 路径缓存失效
  if (pathLine) pathLine.visible = false;
  if (pathRing) pathRing.visible = false;
  selected = i;
  placeView = null;           // 回到"角色视图"
  if (followSelected) rig.target.set(sim.px[i], 0, sim.pz[i]);   // 跟随中就直接对准新人
  const el = document.getElementById('agentcard');
  if (!el) return;
  el.classList.remove('hidden');
  renderAgentCard();
}

/** 连线：把"当前选中的人"接到另一个角色 / 一个地点上（纯黑线，镜头不动） */
function setLink(kind, key, label) {
  if (!sim || selected < 0) return;
  const same = linkTo && linkTo.kind === kind &&
    (kind === 'agent' ? linkTo.i === key
      : (Math.abs(linkTo.x - key[0]) < 0.5 && Math.abs(linkTo.z - key[1]) < 0.5));
  if (same) { clearLink(); toast('已断开连线'); return; }
  linkTo = kind === 'agent'
    ? { kind, i: key, x: 0, z: 0, label }
    : { kind, i: -1, x: key[0], z: key[1], label };
  toast('连线：' + label);
}

function clearLink() {
  linkTo = null;
  if (linkLine) linkLine.visible = false;
}

/** 每帧刷新连线两端（人是活的，会走） */
function updateLink() {
  if (!linkLine) return;
  if (!sim || selected < 0 || !linkTo) { linkLine.visible = false; return; }
  let tx = linkTo.x, tz = linkTo.z;
  if (linkTo.kind === 'agent') {
    const i = linkTo.i;
    if (i < 0 || i >= sim.n) { linkLine.visible = false; return; }
    tx = sim.px[i]; tz = sim.pz[i];
  }
  const a = linkLine.geometry.attributes.position.array;
  a[0] = sim.px[selected]; a[1] = 2.4; a[2] = sim.pz[selected];
  a[3] = tx; a[4] = 2.4; a[5] = tz;
  linkLine.geometry.attributes.position.needsUpdate = true;
  linkLine.geometry.computeBoundingSphere();
  linkLine.visible = true;
}

function setFollow(on) {
  followSelected = !!on;
  const f = document.getElementById('ac-follow');
  if (f) {
    f.textContent = followSelected ? '停止跟随' : '跟随镜头';
    f.classList.toggle('on', followSelected);
  }
}

function deselectAgent() {
  selected = -1;
  clearLink();                // 点空白：连线一并消失
  followSelected = false;
  const el = document.getElementById('agentcard');
  if (el) el.classList.add('hidden');
}

const KIND_NAME = {
  police: '警察局', hospital: '医院', school: '学校', market: '超市',
  transit: '车站', pharmacy: '药店', gov: '政府', fire: '消防',
};
let placeView = null;        // 当前查看的地点（null = 看角色）

/** 坐标附近有什么设施（默认 150m 内最近的 POI） */
function placeNear(x, z, maxD = 150) {
  let best = null, bd = maxD * maxD;
  for (const k of Object.keys(sim.poiByKind || {})) {
    for (const p of sim.poiByKind[k]) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
  }
  return best;
}

/** 某个地点周围有多少人 */
function crowdAt(x, z, r = 50) {
  let n = 0;
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] === ST.CORPSE) continue;
    if ((sim.px[i] - x) ** 2 + (sim.pz[i] - z) ** 2 < r * r) n++;
  }
  return n;
}

/** 行动逻辑速查：条件 / 结果 / 进度条（满足就点亮） */
function agentRules(i, p) {
  const chaos = sim.chaos || 0;
  const rules = [];
  const isPolice = p.state === ST.POLICE || p.state === ST.SOLDIER;
  const bar = (v, max) => `<div class="ac-bar ${v >= max ? 'on' : ''}"><i style="width:${Math.min(100, (v / max) * 100).toFixed(0)}%"></i></div>`;

  if (isPolice) {
    rules.push({ t: '巡逻警回局', v: chaos, max: 20, d: `混乱度 ≥ 20%（当前 ${chaos.toFixed(0)}%）` });
    rules.push({ t: '全员回局坚守', v: chaos, max: 50, d: `混乱度 ≥ 50%（当前 ${chaos.toFixed(0)}%）—— 不再追捕` });
    const deaths = (sim.deathAlarms || []).length;
    rules.push({ t: '死亡出警', v: deaths > 0 ? 1 : 0, max: 1, d: `500m 内的死亡只派一次、只派 2 人（本局已 ${deaths} 起）` });
    rules.push({ t: '被调度出勤', v: sim.goal[i] === GOAL.MOVE_TO ? 1 : 0, max: 1, d: '接到调度 → 走去目标点，路上照常开枪' });
  } else {
    rules.push({ t: '去警局避难', v: chaos, max: 50, d: `混乱度 ≥ 50%（当前 ${chaos.toFixed(0)}%）—— 到了才拿得到枪` });
    const gun = sim.homeHasGun && sim.homeHasGun(i) ? 1 : 0;
    rules.push({ t: '回家取枪', v: gun, max: 1, d: gun ? '自家军械库里还有枪' : '家里没枪，只能靠逃或去警局' });
    const sick = sim.sick && sim.sick[i] ? 1 : 0;
    const inf = sim.state[i] === ST.INFECTED ? 1 : 0;
    rules.push({ t: '发病就医', v: sick, max: 1, d: inf ? (sick ? '已发病 → 目标强制为医院' : '潜伏中（最后 40% 才发病）') : '未被感染' });
    const alive = sim.familyAlive ? sim.familyAlive(i) : 0;
    rules.push({ t: '家人死亡 → 转身逃', v: alive === 0 ? 1 : 0, max: 1, d: alive === 0 ? '家里已经没人了' : `家里还有 ${alive} 个活人` });
    const aware = sim.aware ? sim.aware[i] : 0;
    rules.push({ t: '目击 / 知情', v: aware, max: 3, d: ['一无所知', '听说了（电话/网络）', '亲眼看见', '亲身经历'][Math.min(3, aware)] });
  }

  return rules.map((r) => `
    <div class="ac-rule ${r.v >= r.max ? 'on' : ''}">
      <div class="ar-t"><span>${r.t}</span><b>${r.v >= r.max ? '已生效' : '未触发'}</b></div>
      ${bar(r.v, r.max)}
      <div class="ar-d">${r.d}</div>
    </div>`).join('');
}

/** 当前状态：一排小标签（不再是长条） */
  function stateChips(i, p) {
    const chips = [];
    const add = (t, cls) => chips.push('<span class="ac-chip ' + (cls || '') + '">' + t + '</span>');
    const chaos = sim.chaos || 0;
    const isPolice = p.state === ST.POLICE || p.state === ST.SOLDIER;

    // 身份类
    if (p.vip) add('要员', 'vip');
    if (isPolice) add('警务', 'pol');
    if (sim.armed[i]) add('持枪', 'hot');

    // 触发类（是/否，不再画长条）
    if (sim.sick && sim.sick[i]) add('已发病', 'bad');
    if (sim.state[i] === ST.INFECTED) add('已感染', 'bad');
    const fam = sim.familyAlive ? sim.familyAlive(i) : 0;
    if (fam === 0) add('家人全无', 'bad');
    else add('家人 ' + fam + ' 人');
    if (sim.homeHasGun && sim.homeHasGun(i)) add('家里有枪', 'warm');

    // 全局门槛只做"提一句"，不再是这个人的属性
    if (chaos >= 50) add('全城避难令', 'warm');
    else if (chaos >= 20) add('警局戒备', 'warm');

    // 链
    const step = sim.chainStep ? sim.chainStep[i] : 0;
    if (step) add('第 ' + step + ' / 3 步', 'step');

    return chips.join('');
  }

  function renderPlace() {
  const p = placeView;
  const kind = KIND_NAME[p.k] || '地点';
  document.getElementById('ac-name').textContent = p.n || kind;
  document.getElementById('ac-sub').textContent = `${kind} · 坐标 ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`;
  document.getElementById('ac-vip').style.display = 'none';

  const rows = [['类型', kind], ['面积', p.a ? `${Math.round(p.a)} m²` : '—']];
  if (p.k === 'police') {
    rows.push(['军械库', stockText(p.store)]);
    const si = (sim.poiByKind.police || []).indexOf(p);
    rows.push(['驻局警员', si >= 0 ? `${sim.idleAt(si)} 人在局` : '—']);
  }
  rows.push(['附近', `${crowdAt(p.x, p.z)} 人在 50m 内`]);
  rows.push(['离镜头', `${Math.hypot(p.x - rig.target.x, p.z - rig.target.z).toFixed(0)} m`]);

  document.getElementById('ac-body').innerHTML =
    `<div class="ac-sec">地点信息</div>` +
    rows.map(([k, v]) => `<div class="ac-row"><span>${k}</span><em>${v}</em></div>`).join('');
}

  // ---------- 行动溯源 + 属性条（P0.3 / P0.4） ----------
  function bar(v, max, cls) {
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    return `<div class="ac-bar ${cls || ''}"><i style="width:${pct.toFixed(0)}%"></i></div>`;
  }

  /** 数值属性（移速 / 命中率 / 攻击 / 咬合 / 感知） */
  function statBlock(i) {
    const st = sim.state[i];
    const sp = SPECIES[sim.kind[i]] || SPECIES[SP.CIV1];
    const isZ = st === ST.ZOMBIE || st === ST.WILD;
    const rows = [];
    rows.push(['移动速度', sim.spd[i].toFixed(2) + ' m/s']);
    if (isZ) {
      rows.push(['命中率', '—（撕咬必中）']);
      rows.push(['咬击伤害', Math.round((sp.dmg || 0) * (sim.pow[i] || 1)) + ' / 口']);
      rows.push(['咬合间隔', '1.0 s']);
      rows.push(['追击半径', (sp.range || 0) + ' m']);
    } else {
      const armed = !!sim.armed[i];
      rows.push(['命中率', armed ? (sim.shotAccuracy(i) * 100).toFixed(0) + '%' : '—（徒手）']);
      const w = armed ? weaponOf(sim.wpn[i]) : null;
      rows.push(['攻击', w ? (w.dmg + ' / 发 · ' + w.range + ' m') : (sp.dmg ? sp.dmg + ' / 下' : '无')]);
      if (armed) rows.push(['武器', w.name + ' · ' + sim.mag[i] + (sim.reserve[i] ? '/' + sim.reserve[i] : '')]);
      rows.push(['感知半径', (st === ST.POLICE ? 50 : st === ST.SOLDIER ? 80 : 40) + ' m']);
    }
    if (st === ST.INFECTED) {
      rows.push(['尸变倒计时', Math.max(0, sim.timer[i]).toFixed(1) + ' s']);
      if (sim.chaos > 80) rows.push(['通缉', '<b style="color:#ff8a5c">混乱 > 80%：被当作丧尸</b>']);
    }
    if (st === ST.FLEE) rows.push(['体力', (sim.stam[i] * 100).toFixed(0) + '% · 恐慌 ' + sim.panic[i].toFixed(2)]);
    return '<div class="ac-sec">属性</div>' +
      rows.map(([k, v]) => `<div class="ac-row"><span>${k}</span><em>${v}</em></div>`).join('');
  }

  /** 逃跑（独立大类，和身份/状态/属性平级） */
  function fleeBlock(i) {
    const st = sim.state[i];
    const GOALS = ['回家', '去警局', '逃离城区'];
    const mode = sim.fleeMode ? sim.fleeMode[i] : 0;
    let t;
    if (mode === 1) t = '<b style="color:#ffd479">即时逃跑</b> <span style="color:#7d8b99">（只想离开 40m 内的丧尸）</span>';
    else if (mode === 2) {
      t = `<b style="color:#ff9b6a">有目标逃跑 → ${GOALS[sim.fleeGoal[i]] || '?'}</b>` +
        (sim.stationLost[i] ? '<span style="color:#7d8b99">（警局已沦陷，改道）</span>' : '');
    } else t = '<span style="color:#7d8b99">没有在逃跑</span>';
    const rows = [['类型', t]];
    if (mode) {
      if (st === ST.FLEE) {
        rows.push(['体力', (sim.stam[i] * 100).toFixed(0) + '%']);
        rows.push(['恐慌', sim.panic[i].toFixed(2)]);
      }
      if (mode === 2) rows.push(['路线', GOALS[sim.fleeGoal[i]] === '回家' ? '先回家接人 / 固守' :
        (sim.fleeGoal[i] === 1 ? '去最近的警察局避难' : '往撤离口方向出城')]);
    }
    return '<div class="ac-sec">逃跑</div>' +
      rows.map(([k, v]) => `<div class="ac-row"><span>${k}</span><em>${v}</em></div>`).join('');
  }

  function attrBlock(i) {
    const rows = [
      ['政府信任', sim.trust[i]],
      ['家庭责任', sim.familyDuty[i]],
      ['意志', sim.willpower[i]],
      ['勇猛', sim.courage[i]],
    ];
    return `<div class="ac-sec">性格（0–100）</div>` +
      rows.map(([k, v]) => `
        <div class="ac-row"><span>${k}</span><em>${v}</em></div>
        ${bar(v, 100)}`).join('');
  }

  function explainBlock(i) {
    if (!sim.explain) return '';
    const ex = sim.explain(i);
    const top = ex.candidates[0];
    const second = ex.candidates[1];
    if (!top) return '';
    const parts = top.parts
      .slice()
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .map((p) => `
        <div class="ac-row"><span style="flex:0 0 108px">${p.k}</span>
          <em style="color:${p.v >= 0 ? '#8fd18a' : '#e2827a'}">${p.v >= 0 ? '+' : ''}${p.v.toFixed(2)}</em></div>`)
      .join('');
    const secondTxt = second
      ? `第二名 ${second.name} ${second.score.toFixed(2)}（差 ${(top.score - second.score).toFixed(2)}）`
      : '没有竞争者';
    const excl = ex.excluded.length
      ? ex.excluded.map((e) => `${e.name}（${e.why}）`).join('、')
      : '无';
    return `
      <div class="ac-sec">行动溯源（为什么是他现在这个行动）</div>
      <div class="ac-row"><span>当前</span><em><b>${top.name}</b> · 分 ${top.score.toFixed(2)}</em></div>
      <div class="ac-row"><span>对比</span><em>${secondTxt}</em></div>
      ${parts}
      <div class="ac-row"><span>排除</span><em style="color:#7d8b99">${excl}</em></div>`;
  }

function renderAgentCard() {
  if (!sim || selected < 0) return;
  const el = document.getElementById('agentcard');
  if (!el) return;
  if (placeView) { renderPlace(); return; }

  const p = profileFor(sim, selected);
  document.getElementById('ac-name').textContent = p.name;
  document.getElementById('ac-sub').textContent = p.isAnimal
    ? `${p.nameEn} · 动物 · ${p.job}`
    : `${p.nameEn} · ${p.male ? '男' : '女'} ${p.age} 岁 · ${p.job}`;
  document.getElementById('ac-vip').style.display = p.vip ? 'inline-block' : 'none';

  const px = sim.px[selected], pz = sim.pz[selected];
  const homeP = placeNear(sim.homeX[selected], sim.homeZ[selected], 200);
  const workP = placeNear(sim.workX[selected], sim.workZ[selected], 200);
  const polP = sim.nearestPoi('police', px, pz);
  const hosP = sim.nearestPoi('hospital', px, pz);

  const link = (label, x, z) =>
    `<em class="link" data-act="place" data-x="${x.toFixed(1)}" data-z="${z.toFixed(1)}">${label}</em>`;

  const isAnimal = sim.isAnimal ? sim.isAnimal(selected) : false;
  const kindName = (SPECIES[sim.kind[selected]] || SPECIES[SP.CIV1]).name;
  // 家属：每个都做成可点的 chip（点了选中他，镜头跳过去）
  const ROLE_TXT = { spouse: '配偶', child: '子女', parent: '父母', grandparent: '祖辈', sibling: '同住' };
  const knd = sim.kind[selected];
  const forceKind = (knd === 4 || knd === 5);   // 士兵 / 重装兵住营房；警察是本地人，正常有家
  const kins = (isAnimal || forceKind) ? []
    : kinList(sim, selected, (j) => (sim.age && sim.age[j]) || ageOfAgent(sim, j, () => 0), (j) => shortName(j, sim));
  const kinChip = (k) => {
    const dead = sim.state[k.j] === ST.CORPSE;
    const zom = sim.state[k.j] === ST.ZOMBIE;
    const mark = dead ? '†' : (zom ? '☠' : '');
    const tip = `${ROLE_TXT[k.role] || '家人'} · ${k.age} 岁${dead ? ' · 已死亡' : (zom ? ' · 已尸变' : '')}`;
    return `<b class="link${dead ? ' gone' : ''}" data-act="agent" data-i="${k.j}" title="${tip}">${k.name}${mark}</b>`;
  };
  const SEP = '<span style="color:#5b6a77"> · </span>';
  // 按关系分组：配偶 / 子女 / 父母 / 祖辈 / 同住，各占一行
  const kinGroups = new Map();
  for (const k of kins) {
    if (!kinGroups.has(k.role)) kinGroups.set(k.role, []);
    kinGroups.get(k.role).push(k);
  }
  const kinRows = [...kinGroups.entries()]
    .map(([role, arr]) => `<div class="ac-row"><span>${ROLE_TXT[role] || '家人'}</span><em>${arr.map(kinChip).join(SEP)}</em></div>`)
    .join('');
  const kinHtml = kinRows || (p.family ? `<div class="ac-row"><span>家庭</span><em>${p.family}</em></div>` : '<div class="ac-row"><span>家庭</span><em>—</em></div>');

  const sec1 = `
    <div class="ac-sec">身份</div>
    ${isAnimal
      ? `<div class="ac-row"><span>种类</span><em>${kindName}（动物）</em></div>
         <div class="ac-row"><span>来历</span><em>街上的${kindName}，没有家和工作地</em></div>`
      : `<div class="ac-row"><span>职业</span><em>${p.job}</em></div>
         ${kinHtml}`}`;

  const sec2 = `
    <div class="ac-sec">状态</div>
    <div class="ac-row"><span>状态</span><em><b class="st-${p.stateColor}">${p.stateTxt}</b></em></div>
    ${p.social ? `<div class="ac-row"><span>行程</span><em>${p.social}</em></div>` : ''}
    <div class="ac-row"><span>知情</span><em>${p.awareText || '一无所知'}</em></div>
    ${p.vipEscort ? `<div class="ac-row"><span>护送</span><em>${p.vipEscort}</em></div>` : ''}
    ${linkTo ? `<div class="ac-row"><span>连线</span><em><b class="link" data-act="unlink">→ ${linkTo.label}</b>（再点一次断开）</em></div>` : ''}
    <div class="ac-row"><span>血量</span><em>${p.hp} / ${p.hpMax}</em></div>
    <div class="ac-bar ${p.hp / p.hpMax < 0.35 ? 'on' : ''}"><i style="width:${Math.min(100, (p.hp / p.hpMax) * 100).toFixed(0)}%"></i></div>
    <div class="ac-row"><span>武器</span><em>${p.weaponTxt
      ? `${p.weaponTxt} · <b>${p.mag}${p.reserve ? '/' + p.reserve : ''}</b> · 熟练 ${p.skillPct}%`
      : '徒手'}</em></div>
    ${p.infected ? `<div class="ac-row"><span>感染</span><em><b class="st-red">${Math.max(0, p.timer).toFixed(1)}s 后尸变</b></em></div>` : ''}`;

  const sec3 = `
    <div class="ac-sec">地点（点一下看详情）</div>
    <div class="ac-row"><span>住址</span>${link(p.home, sim.homeX[selected], sim.homeZ[selected])}</div>
    <div class="ac-row"><span>工作地</span>${link(p.work, sim.workX[selected], sim.workZ[selected])}</div>
    ${polP ? `<div class="ac-row"><span>最近警局</span>${link(`${Math.hypot(polP.x - px, polP.z - pz).toFixed(0)} m`, polP.x, polP.z)}</div>` : ''}
    ${hosP ? `<div class="ac-row"><span>最近医院</span>${link(`${Math.hypot(hosP.x - px, hosP.z - pz).toFixed(0)} m`, hosP.x, hosP.z)}</div>` : ''}`;

  const sec4 = `
    <div class="ac-sec">处境</div>
    <div class="ac-row"><span>离家</span><em>${Math.hypot(sim.homeX[selected] - px, sim.homeZ[selected] - pz).toFixed(0)} m</em></div>
    <div class="ac-row"><span>位置</span><em>${(sim.nav && sim.nav.indoor && sim.nav.indoor(px, pz)) ? '楼里' : '街上'} · ${px.toFixed(0)}, ${pz.toFixed(0)}</em></div>`;

  document.getElementById('ac-body').innerHTML =
    sec1 + sec2 + fleeBlock(selected) + statBlock(selected) + sec3 + sec4 +
    `<div class="ac-sec">当前状态</div>` + stateChips(selected, p) +
    attrBlock(selected) + explainBlock(selected);
}

// ---------- 地点名牌：投影到屏幕，公共建筑加发光 ----------
const PUB_KINDS = new Set(['police', 'hospital', 'fire', 'gov', 'transit', 'school']);
let poiLabelEls = [];       // [{ el, x, z, kind }]
let poiLabelSim = null;

function buildPoiLabels() {
  const box = document.getElementById('poilabels');
  if (!box || !sim) return;
  box.innerHTML = '';
  poiLabelEls = [];
  poiLabelSim = sim;
  for (const p of (sim.pois || [])) {
    const el = document.createElement('div');
    el.className = 'poilabel' + (PUB_KINDS.has(p.k) ? ' pub ' + p.k : '');
    el.textContent = p.n || KIND_NAME[p.k] || '地点';
    box.appendChild(el);
    poiLabelEls.push({ el, x: p.x, z: p.z, poi: p });
  }
}

const _pv = new THREE.Vector3();
function updatePoiLabels() {
  if (!sim) return;
  if (poiLabelSim !== sim || !poiLabelEls.length) {
    buildPoiLabels();
    if (!poiLabelEls.length) return;
  }
  const cam = activeCamera();
  const W = window.innerWidth, H = window.innerHeight;
  const show = overlayOn && !overviewIsOpen();   // 只有在地形模式下才显示地点名牌
  // 2D：视高 = 2 × rig.dist × 0.0475；3D：dist 约等于相机到目标的距离
  const viewHalfH = retroMode ? rig.dist * 0.0475 : rig.dist * 0.5;
  for (const it of poiLabelEls) {
    if (!show) { it.el.style.display = 'none'; continue; }
    _pv.set(it.x, 24, it.z).project(cam);
    const inView = _pv.z < 1 && _pv.x > -1.15 && _pv.x < 1.15 && _pv.y > -1.15 && _pv.y < 1.15;
    if (!inView) { it.el.style.display = 'none'; continue; }
    // 缩得太远只留公共建筑，避免糊成一片（按"视野半高"判断，2D 的 dist 语义不一样）
    if (viewHalfH > (PUB_KINDS.has(it.poi.k) ? 1200 : 320)) { it.el.style.display = 'none'; continue; }
    it.el.style.display = '';
    it.el.style.left = ((_pv.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
    it.el.style.top = ((-_pv.y * 0.5 + 0.5) * H).toFixed(1) + 'px';
  }
}

/** 点某个地点时，把它的名牌高亮 2 秒 */
function flashPoiAt(x, z) {
  let best = null, bd = 160 * 160;
  for (const it of poiLabelEls) {
    const d = (it.x - x) ** 2 + (it.z - z) ** 2;
    if (d < bd) { bd = d; best = it; }
  }
  if (!best) return;
  best.el.classList.add('on');
  setTimeout(() => best.el.classList.remove('on'), 2000);
}

function hoverAt(e) {
  if (!sim) return;
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, activeCamera());
  const hit = new THREE.Vector3();
  if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
    previewRing.position.set(hit.x, 0.65, hit.z);
  }
}

// 当前用于拾取的相机（2D 模式必须用正交相机，否则点击位置会整体偏移）
function activeCamera() {
  return (retroMode && orthoCam) ? orthoCam : camera;
}

// 用当前选中的工具打一下
function useToolAt(x, z) {
  const t = TOOL_BY_ID[activeTool];
  if (!sim || !t) return false;
  if (!sim.canUse(t)) {
    if (sim.cd[t.id] > 0) toast(`${t.name} 冷却中 ${sim.cd[t.id].toFixed(1)}s`);
    else toast(`指挥点数不足（需要 ${t.cost}）`);
    return false;
  }
  sim.spend(t);
  t.apply(sim, x, z, { angle: rig.yaw });
  if (sim.lastDispatch && sim.lastDispatch.ok === false) {
    toast('附近警局已无可用警力（都被派出去了）');
    sim.lastDispatch = null;
  } else if (sim.lastDispatch) {
    toast(`出动 ${sim.lastDispatch.n} 人，正在从 ${sim.lastDispatch.dist.toFixed(0)}m 外的警局赶来`);
    sim.lastDispatch = null;
  }
  if (t.kind === 'strike') flash(new THREE.Vector3(x, 0, z), t.radius);
  ping(new THREE.Vector3(x, 0, z), t.color, t.radius);
  return true;
}

el.addEventListener('wheel', (e) => {
  e.preventDefault();
  // 2D 的可缩范围比 3D 宽得多（300 ~ 40000），每格滚幅也要更大，否则滚三十几下才到头
  const f = Math.exp(e.deltaY * (retroMode ? 0.0017 : 0.0011));
  // 2D 最小视距 300（视高约 28 m）——再拉近就只剩空地面，看不到单位
  const lo = retroMode ? 300 : 26;
  const hi = retroMode ? maxDist2d : MAX_DIST;
  rig.dist = Math.max(lo, Math.min(hi, rig.dist * f));
}, { passive: false });

function clampTarget() {
  if (!CITY_HALF) return;
  const m = 400;
  rig.target.x = Math.max(-CITY_HALF[0] - m, Math.min(CITY_HALF[0] + m, rig.target.x));
  rig.target.z = Math.max(-CITY_HALF[1] - m, Math.min(CITY_HALF[1] + m, rig.target.z));
}

// ---------- 全球变量 ----------
let CITY_HALF = null;
let FIXCAM = false;
let sim = null;
let cityRef = null;
let satMesh = null, ground = null;
let agents = null;
let retro = null, retroMode = false, orthoCam = null;
let overlay = null, overlayOn = false;
let layerEdit = null;                 // 游戏内图层编辑器（L）
let layerFileOps = [];                // collision.edit.json 里的原始 op（导出时合并用）
// 2D 视高 = 2×0.0475×dist：默认 1500 → 142 m，小人约 10 px，卫星图差不多 1:1
let zoom3d = 620, zoom2d = 1500;
let seed = (Math.random() * 1e9) | 0;

// ---------- 爆炸环 ----------
const boomPool = [];
const boomGeo = new THREE.RingGeometry(0.6, 1.0, 24);
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({
    color: 0xffb060, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  scene.add(m);
  boomPool.push({ mesh: m, life: 0, max: 1, r: 40 });
}
function flash(pos, r) {
  const b = boomPool.find(x => x.life <= 0) || boomPool[0];
  b.mesh.position.set(pos.x, 1.2, pos.z);
  b.mesh.visible = true;
  b.r = r; b.life = 0.85; b.max = 0.85;
}
function updateBooms(dt) {
  for (const b of boomPool) {
    if (b.life <= 0) continue;
    b.life -= dt;
    const t = 1 - b.life / b.max;
    const s = 0.3 + t * b.r;
    b.mesh.scale.set(s, s, s);
    b.mesh.material.opacity = Math.max(0, 1 - t) * 0.9;
    if (b.life <= 0) b.mesh.visible = false;
  }
}

// ---------- 弹道 ----------
const TRACER_MAX = 220;
const tracerGeo = new THREE.BufferGeometry();
const tracerPos = new Float32Array(TRACER_MAX * 6);
tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
tracerGeo.setDrawRange(0, 0);
const tracerMesh = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
  color: 0xffe6a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
}));
tracerMesh.frustumCulled = false;
scene.add(tracerMesh);
function updateTracers() {
  if (!sim) return;
  const n = Math.min(sim.tracers.length, TRACER_MAX);
  for (let i = 0; i < n; i++) {
    const t = sim.tracers[i];
    tracerPos[i * 6] = t.x1; tracerPos[i * 6 + 1] = 1.35; tracerPos[i * 6 + 2] = t.z1;
    tracerPos[i * 6 + 3] = t.x2; tracerPos[i * 6 + 4] = 1.35; tracerPos[i * 6 + 5] = t.z2;
  }
  tracerGeo.setDrawRange(0, n * 2);
  tracerGeo.attributes.position.needsUpdate = true;
}

// ---------- 爆发模式 ----------
//  compass：东 = +x，西 = -x，南 = +z，北 = -z（正北朝上）
const MOPT = { dir: 'N', points: 3, perPoint: 40, carriers: 3, waves: 4, waveInterval: 40, waveCount: 40 };
const MODE_HINT = {
  single: '随机一处冒出来（默认）。数量用上面「初始丧尸」。',
  invade: '从选定方向的边缘成片涌入，向城内推进。',
  multi: '同时多个点位冒出来，点位数 / 每点数量可调。',
  stealth: '零号病人：开场 1–3 个感染者，潜伏 10–30 分钟；发病后会往医院跑，医院成了爆发点。',
  waves: '先爆一处，之后每隔一段时间在别处再开一个点。',
  apocalypse: '全城随机散布，数量用上面「初始丧尸」。',
};
const MODE_ROWS = {
  invade: () => `<div class="p-row p-segrow"><span>入侵方向</span>
      <div class="p-seg4" id="o-dir">
        ${[['N','北'],['E','东'],['S','南'],['W','西']].map(([k,t]) =>
          `<button data-dir="${k}" class="${MOPT.dir === k ? 'on' : ''}">${t}</button>`).join('')}
      </div></div>`,
  multi: () => `
    <label class="p-row"><span>点位数</span><input type="range" id="o-points" min="1" max="12" step="1" value="${MOPT.points}"><b id="v-points">${MOPT.points}</b></label>
    <label class="p-row"><span>每点丧尸</span><input type="range" id="o-per" min="5" max="200" step="5" value="${MOPT.perPoint}"><b id="v-per">${MOPT.perPoint}</b></label>`,
  stealth: () => `
    <label class="p-row"><span>零号病人</span><input type="range" id="o-carriers" min="1" max="3" step="1" value="${MOPT.carriers}"><b id="v-carriers">${MOPT.carriers}</b></label>`,
  waves: () => `
    <label class="p-row"><span>波数</span><input type="range" id="o-waves" min="1" max="12" step="1" value="${MOPT.waves}"><b id="v-waves">${MOPT.waves}</b></label>
    <label class="p-row"><span>间隔</span><input type="range" id="o-waveint" min="10" max="120" step="5" value="${MOPT.waveInterval}"><b id="v-waveint">${MOPT.waveInterval}s</b></label>
    <label class="p-row"><span>每波丧尸</span><input type="range" id="o-wavecount" min="5" max="200" step="5" value="${MOPT.waveCount}"><b id="v-wavecount">${MOPT.waveCount}</b></label>`,
};

function buildModeUI() {
  const sel = $('sel-mode');
  if (!sel) return;
  const box = $('mode-opts');
  const mode = sel.value;
  const row = MODE_ROWS[mode];
  box.innerHTML = (row ? row() : '') + `<div class="p-hint2">${MODE_HINT[mode] || ''}</div>`;

  const dir = $('o-dir');
  if (dir) dir.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    MOPT.dir = b.dataset.dir;
    [...dir.children].forEach((x) => x.classList.toggle('on', x === b));
  };
  const bind = (id, key, fmt) => {
    const el = $(id);
    if (!el) return;
    el.oninput = () => {
      MOPT[key] = +el.value;
      const v = $(id.replace('o-', 'v-'));
      if (v) v.textContent = fmt ? fmt(+el.value) : el.value;
    };
  };
  bind('o-points', 'points');
  bind('o-per', 'perPoint');
  bind('o-carriers', 'carriers');
  bind('o-waves', 'waves');
  bind('o-waveint', 'waveInterval', (v) => v + 's');
  bind('o-wavecount', 'waveCount');
}

// ---------- 参数 ----------
const sPop = $('s-pop'), sZ0 = $('s-z0');
const sArm = $('s-arm'), sPol = $('s-pol');

// 难度档：一次调四组参数（人口 / 初始尸 / 持枪率 / 警力）
// 城市名中文化
const CITY_CN = {
  berlin: '柏林·米特', tokyo: '东京·千代田', zhengzhou: '郑州·金水',
  nanyang: '南阳·卧龙', zhenping: '镇平',
};
function cnCity(id, fallback) {
  const k = String(id || '').toLowerCase();
  for (const key of Object.keys(CITY_CN)) if (k.includes(key)) return CITY_CN[key];
  return fallback || id || '未知城市';
}

const DIFF_PRESET = {
  easy:      { pop: 0.6, zomb: 0.6, armed: 1.6, police: 1.4 },
  normal:    { pop: 1.0, zomb: 1.0, armed: 1.0, police: 1.0 },
  nightmare: { pop: 1.4, zomb: 1.7, armed: 0.6, police: 0.65 },
};
function applyDifficulty(p) {
  const q = new URLSearchParams(location.search).get('diff') || 'normal';
  const d = DIFF_PRESET[q] || DIFF_PRESET.normal;
  p.population = Math.max(200, Math.round(p.population * d.pop));
  p.initialZombies = Math.max(1, Math.round(p.initialZombies * d.zomb));
  p.armedRate = Math.min(0.9, p.armedRate * d.armed);
  p.police = Math.max(4, Math.round(p.police * d.police));
  p.difficulty = q;
  return p;
}

function readParams() {
  const p = {
    seed,
    population: +sPop.value,
    initialZombies: +sZ0.value,
    homeGunRate: +sArm.value / 100,   // 「家庭持枪率」：决定每户有没有枪
    police: +sPol.value,
    startMin: (() => {
      const q = new URLSearchParams(location.search).get('hour');
      return q == null ? 450 : Math.round(parseFloat(q) * 60);   // 默认 07:30
    })(),
    // 信息传播
    infoRate: $('s-info') ? +$('s-info').value : 1,
    // 爆发模式
    mode: $('sel-mode') ? $('sel-mode').value : 'single',
    invadeDir: MOPT.dir,
    points: MOPT.points, perPoint: MOPT.perPoint,
    carriers: MOPT.carriers,
    waves: MOPT.waves, waveInterval: MOPT.waveInterval, waveCount: MOPT.waveCount,
  };
  return applyDifficulty(p);
}
function syncLabels() {
  $('v-pop').textContent = (+sPop.value).toLocaleString();
  $('v-z0').textContent = sZ0.value;
  $('v-arm').textContent = sArm.value + '%';
  $('v-pol').textContent = sPol.value;
}
[sPop, sZ0, sArm, sPol].forEach(s => s.addEventListener('input', syncLabels));
if ($('sel-mode')) {
  buildModeUI();
  $('sel-mode').onchange = buildModeUI;
  // 调试 / 分享：?mode=invade&dir=E
  const Q0 = new URLSearchParams(location.search);
  if (Q0.get('mode')) {
    $('sel-mode').value = Q0.get('mode');
    buildModeUI();
  }
  if (Q0.get('dir')) {
    MOPT.dir = (Q0.get('dir') || 'N').toUpperCase();
    buildModeUI();
  }
}
syncLabels();

$('btn-restart').onclick = () => {
  clearLink();
  closeReport();
  closeOverview();
  deselectAgent();
  sim.reset(readParams());
  hideBanner();
};
$('btn-report').onclick = () => {
  if (!sim) return;
  if (document.getElementById('report')) closeReport();
  else openReport(sim);
};

// ---------- 全体人员总览 ----------
$('btn-overview').onclick = () => {
  if (sim) toggleOverview(sim);
};
// 总览里点某一行 → 选中并跟随
window.__zosSelect = (i) => {
  selectAgent(i);
  followSelected = true;
  const f = document.getElementById('ac-follow');
  if (f) { f.textContent = '停止跟随'; f.classList.add('on'); }
};
// 调试：?pick=N 开局直接选中第 N 个个体（方便看信息面板）
if (new URLSearchParams(location.search).has('pick')) {
  const want = Math.max(0, parseInt(new URLSearchParams(location.search).get('pick') || '0', 10) | 0);
  setTimeout(() => {
    if (!sim) return;
    for (let i = want; i < sim.n; i++) {
      if (sim.state[i] === ST.CIV) { selectAgent(i); break; }
    }
  }, 900);
}
window.addEventListener('error', (e) => {
  window.__err = (e.message || 'err') + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno;
});
window.__zosRestart = () => { clearLink(); sim.reset(readParams()); buildEscapeMarker(); buildPoiLabels(); hideBanner(); };
$('btn-seed').onclick = () => { clearLink(); seed = (Math.random() * 1e9) | 0; sim.reset(readParams()); buildEscapeMarker(); buildPoiLabels(); hideBanner(); };
$('p-toggle').onclick = () => {
  const b = $('p-body');
  b.classList.toggle('hide');
  $('p-toggle').textContent = b.classList.contains('hide') ? '+' : '—';
};

// ---------- 变速 ----------
let speed = 1;
document.querySelectorAll('.spd').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.spd').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    speed = +btn.dataset.spd;
  };
});

// ---------- 音频 ----------
const audio = new AudioEngine();
let audioOn = true;
function kickAudio() {
  if (audio.init()) {
    audio.setMuted(!audioOn);
  }
}
addEventListener('pointerdown', kickAudio, { once: true });
addEventListener('keydown', kickAudio, { once: true });

$('btn-sound').onclick = () => {
  audioOn = !audioOn;
  kickAudio();
  audio.setMuted(!audioOn);
  $('btn-sound').textContent = audioOn ? '🔊 声音' : '🔇 静音';
  $('btn-sound').style.opacity = audioOn ? '1' : '.55';
};

// ---------- 指挥工具：UI + 特效 ----------
let activeTool = 'select';
const ringPool = [], discPool = [], heliPool = [], pingPool = [];

function makeRing() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.982, 1.0, 72),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.55;
  m.visible = false;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
function makeDisc() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uK: { value: 1 } },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `precision highp float;
      varying vec2 vUv;
      uniform float uTime, uK;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float t = uTime;
        float n = sin(p.x * 9.0 + t * 2.6) * sin(p.y * 11.0 - t * 2.1) * 0.5 + 0.5;
        n = pow(n, 1.4);
        float fall = smoothstep(1.0, 0.12, r);
        float a = fall * (0.14 + 0.45 * n) * uK;
        vec3 c = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.86, 0.30), n * n);
        gl_FragColor = vec4(c, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 44), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.45;
  m.visible = false;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
function makeHeli() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x39424c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.3), mat);
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(8.5, 0.06, 0.45),
    new THREE.MeshBasicMaterial({ color: 0x161a1f })
  );
  rotor.position.y = 0.95;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 3.4), mat);
  tail.position.z = 1.9;
  g.add(body, rotor, tail);
  g.visible = false;
  scene.add(g);
  return g;
}
for (let i = 0; i < 20; i++) ringPool.push(makeRing());
for (let i = 0; i < 10; i++) discPool.push(makeDisc());
for (let i = 0; i < 5; i++) heliPool.push(makeHeli());

// 选中的工具 → 跟随鼠标的范围圈
const previewRing = makeRing();
previewRing.material.opacity = 0.5;
previewRing.visible = false;

function buildToolbar() {
  const host = $('tools');
  if (!host) return;
  host.innerHTML = '';
  for (const t of TOOLS) {
    const hk = Object.keys(HOTKEYS).find(k => HOTKEYS[k] === t.id) || '';
    const label = hk.replace('Digit', '').replace('Minus', '-').replace('Equal', '=');
    const el = document.createElement('div');
    el.className = 'tool';
    el.dataset.id = t.id;
    el.innerHTML = `<span class="hk">${label}</span>
      <span class="ic">${t.icon}</span>
      <span class="nm">${t.name}</span>
      <span class="ct">${t.cost ? '¥' + fmtWan(t.cost) : '免费'}</span>
      <i class="cdfill"></i>`;
    el.title = `${t.desc}\n花费 ${t.cost} · 冷却 ${t.cool}s · 半径 ${t.radius}m`;
    el.onclick = (ev) => { ev.stopPropagation(); selectTool(t.id); };
    host.appendChild(el);
  }
}

function selectTool(id) {
  activeTool = id;
  const t = TOOL_BY_ID[id];
  for (const el of document.querySelectorAll('.tool')) {
    el.classList.toggle('sel', el.dataset.id === id);
  }
  if (t) {
    previewRing.material.color.setHex(t.color);
    previewRing.scale.setScalar(Math.max(1, t.radius));
    previewRing.visible = t.radius > 0;   // 查看模式不显示范围圈
  }
}

function updateToolbar() {
  if (!sim) return;
  for (const el of document.querySelectorAll('.tool')) {
    const t = TOOL_BY_ID[el.dataset.id];
    if (!t) continue;
    el.classList.toggle('off', !sim.canUse(t));
    const f = el.querySelector('.cdfill');
    if (f) {
      const cd = sim.cd[t.id] || 0;
      f.style.width = (cd > 0 && t.cool > 0 ? (cd / t.cool) * 100 : 0) + '%';
    }
  }
  const b = $('budget'), bf = $('budfill');
  if (b) b.textContent = fmtWan(sim.budget) + (sim.budget >= 10000 ? '' : '');
  if (bf) bf.style.width = Math.min(100, (sim.budget / sim.budgetMax) * 100) + '%';
  // 卡片跟随刷新
  if (selected >= 0 && !document.getElementById('agentcard').classList.contains('hidden')) {
    try { renderAgentCard(); } catch (e) { window.__cardErr = String((e && e.message) || e); }
    if (followSelected) {
      rig.target.set(sim.px[selected], 0, sim.pz[selected]);
    }
  }
}

let toastTimer = 0;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

function ping(pos, color, r) {
  let slot = pingPool.find(p => p.life <= 0);
  if (!slot && pingPool.length < 8) {
    slot = { mesh: makeRing(), life: 0 };
    pingPool.push(slot);
  }
  if (!slot) slot = pingPool[0];
  slot.mesh.visible = true;
  slot.mesh.material.color.setHex(color);
  slot.mesh.position.set(pos.x, 0.6, pos.z);
  slot.life = 0.6; slot.max = 0.6; slot.r = r;
}

function updateFx(tms) {
  if (!sim) return;
  let ri = 0, di = 0;
  for (const e of sim.effects) {
    const k = Math.max(0, e.life / e.max);
    if (e.type === 'fire') {
      const m = discPool[di]; if (!m) continue; di++;
      m.visible = true;
      m.position.set(e.x, 0.5, e.z);
      const s = e.r * (0.92 + 0.08 * Math.sin(tms * 0.008 + e.x * 0.3));
      m.scale.set(s, s, s);
      m.material.uniforms.uTime.value = tms * 0.001;
      m.material.uniforms.uK.value = Math.min(1, k * 2.5);
      continue;
    }
    const m = ringPool[ri]; if (!m) continue; ri++;
    let c = 0xffffff, sc = e.r, op = 0.8;
    if (e.type === 'siren') {
      c = 0xff9ad5; sc = e.r * (0.55 + 0.45 * (1 - k));
      op = 0.30 + 0.45 * Math.abs(Math.sin(tms * 0.007));
    } else if (e.type === 'rally') {
      c = 0x5ee07a; op = 0.30 + 0.45 * k;
    } else if (e.type === 'heli') {
      c = 0x49e0c0; op = 0.65 * k;
    } else if (e.type === 'cure') {
      c = 0x62d7ff; sc = e.r * (1.15 - k); op = k;
    } else if (e.type === 'supply') {
      c = 0xf2d24a; sc = e.r * (1.15 - k); op = k;
    } else if (e.type === 'wall') {
      c = 0xc0c6cf; op = k * 0.9;
    }
    m.visible = true;
    m.position.set(e.x, 0.55, e.z);
    m.scale.set(sc, sc, sc);
    m.material.color.setHex(c);
    m.material.opacity = op;
  }
  for (let i = ri; i < ringPool.length; i++) ringPool[i].visible = false;
  for (let i = di; i < discPool.length; i++) discPool[i].visible = false;

  // 点击反馈环
  for (const p of pingPool) {
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.life -= 1 / 60;
    const k = 1 - p.life / p.max;
    const s = p.r * (0.25 + 0.75 * k);
    p.mesh.scale.set(s, s, s);
    p.mesh.material.opacity = (1 - k) * 0.9;
    if (p.life <= 0) p.mesh.visible = false;
  }

  // 直升机
  let hi = 0;
  for (const h of sim.helis) {
    const g = heliPool[hi]; if (!g) break; hi++;
    g.visible = true;
    let alt;
    if (h.state === 0) alt = 140 - 131 * Math.min(1, h.t / 1.2);
    else if (h.state === 1) alt = 9 + Math.sin(tms * 0.006) * 0.7;
    else alt = 9 + 131 * Math.min(1, h.t / 1.4);
    g.position.set(h.x, alt, h.z);
    g.rotation.y += 0.03;
    if (g.children[1]) g.children[1].rotation.y += 0.55;
  }
  for (let i = hi; i < heliPool.length; i++) heliPool[i].visible = false;
}

buildToolbar();
selectTool('select');

// ---------- 档案卡按钮 / 地点点击 ----------
{
  const bindGauge = (id, fn) => {
    const el = document.getElementById(id);
    if (el) { el.style.cursor = 'pointer'; el.onclick = () => { if (sim) fn(sim); }; }
  };
  bindGauge("g-chaos", openChaosInfo);
  bindGauge("g-infect", openInfectInfo);
  bindGauge("g-aware", openAwareInfo);
  const bf = document.getElementById('btn-force');
  if (bf) bf.onclick = () => { if (sim) openForce(sim); };
  const bs = document.getElementById('btn-sanit');
  if (bs) bs.onclick = () => { if (sim) openSanit(sim); };
  const c = document.getElementById('ac-close');
  if (c) c.onclick = (ev) => { ev.stopPropagation(); deselectAgent(); };

  // 上一个 / 下一个角色
  const step = (d) => {
    if (!sim) return;
    let i = selected;
    for (let k = 0; k < 400; k++) {
      i = (i + d + sim.n) % sim.n;
      if (sim.state[i] !== ST.CORPSE) { selectAgent(i); return; }
    }
  };
  const pv = document.getElementById('ac-prev');
  if (pv) pv.onclick = (ev) => { ev.stopPropagation(); step(-1); };
  const nx = document.getElementById('ac-next');
  if (nx) nx.onclick = (ev) => { ev.stopPropagation(); step(1); };

  // 返回角色
  const bk = document.getElementById('ac-back');
  if (bk) bk.onclick = (ev) => {
    ev.stopPropagation();
    placeView = null;
    bk.classList.add('hidden');
    renderAgentCard();
  };

  // 点"住址 / 工作地 / 最近警局…" → 看地点
  const body = document.getElementById('ac-body');
  if (body) body.onclick = (ev) => {
    if (!sim) return;
    // 点家属：选中他，并把镜头挪过去（保持当前缩放）
    const unl = ev.target.closest('[data-act="unlink"]');
    if (unl) { ev.stopPropagation(); clearLink(); renderAgentCard(); return; }
    const kin = ev.target.closest('[data-act="agent"]');
    if (kin) {
      ev.stopPropagation();
      const j = +kin.dataset.i;
      // 连线到这位家属（镜头不动、选中不变）
      setLink('agent', j, (shortName(j, sim) || ('#' + j)));
      renderAgentCard();
      return;
    }
    const a = ev.target.closest('[data-act="place"]');
    if (!a) return;
    const x = parseFloat(a.dataset.x), z = parseFloat(a.dataset.z);
    const poi = placeNear(x, z, 220);
    const label = poi ? ((KIND_NAME[poi.k] || '地点') + (poi.n ? ' · ' + poi.n : '')) : a.textContent || '地点';
    setLink('place', [x, z], label);
    flashPoiAt(x, z);
    renderAgentCard();
  };
  const f = document.getElementById('ac-follow');
  if (f) f.onclick = (ev) => {
    ev.stopPropagation();
    setFollow(!followSelected);
    f.textContent = followSelected ? '停止跟随' : '跟随镜头';
    f.classList.toggle('on', followSelected);
  };
}

// ---------- 地图模式（矢量 / 卫星）与 3D 建筑 ----------
let mapMode = 'vec';
let showBuildings = true;

function setMapMode(m) {
  if (m === 'sat' && !satMesh) m = 'vec';
  mapMode = m;
  const VEC_KINDS = ['roads', 'parks', 'water', 'trees'];
  if (cityRef?.group) {
    for (const c of cityRef.group.children) {
      if (VEC_KINDS.includes(c.userData.kind)) c.visible = (m === 'vec');
      if (c.userData.kind === 'buildings') c.visible = showBuildings;
    }
  }
  if (satMesh) satMesh.visible = (m === 'sat');
  setBuildings(m === 'vec');
  document.querySelectorAll('#seg-map button').forEach(b => {
    b.classList.toggle('on', b.dataset.map === m);
  });
  // 雾保持常开：卫星贴图材质自己关了 fog，矢量地面才吃它
}

function setBuildings(v) {
  showBuildings = v;
  if (cityRef?.group) {
    for (const c of cityRef.group.children) {
      if (c.userData.kind === 'buildings') c.visible = v;
    }
  }
  document.querySelectorAll('#seg-bld button').forEach(b => {
    b.classList.toggle('on', (b.dataset.bld === '1') === v);
  });
}

document.querySelectorAll('#seg-map button').forEach(b => {
  b.onclick = () => setMapMode(b.dataset.map);
});
document.querySelectorAll('#seg-bld button').forEach(b => {
  b.onclick = () => setBuildings(b.dataset.bld === '1');
});

// ---------- 结局 ----------
let bannerShown = false;
// ---------- 地形图层 ----------
function setOverlay(on) {
  if (!overlay) return;
  overlayOn = !!on;
  overlay.visible = overlayOn;
  const b = document.getElementById('btn-overlay');
  if (b) b.textContent = overlayOn ? '🗺 地形' : '🗺 地形';
  if (overlayOn && !document.getElementById('overlay-legend')) {
    const d = document.createElement('div');
    d.id = 'overlay-legend';
    d.innerHTML =
      '<b>地形图层</b>' +
      '<span><i style="background:#e61919"></i>墙 / 栅栏（不可走）</span>' +
      '<span><i style="background:#1a66ff"></i>水（不可走）</span>' +
      '<span><i style="background:#f2cc26"></i>围栏（不可走，通视线）</span>' +
      '<span><i style="background:#33f2f2"></i>窗（不可走，通视线）</span>' +
      '<span><i style="background:#33ff59"></i>门（可走）</span>' +
      '<span><i style="background:#ff8c1a"></i>室内（可走）</span>' +
      '<span><i style="background:#33b340"></i>林地（可走）</span>' +
      '<span style="opacity:.5">不可通行 ' + overlay.stats.pct.toFixed(1) + '%</span>';
    document.body.appendChild(d);
  } else if (!overlayOn) {
    const d = document.getElementById('overlay-legend');
    if (d) d.remove();
  }
}

// ---------- 2D 模式（原「2009 复古模式」）----------
function setRetro(on) {
  if (!retro || !retro.ready) { console.warn('2D 精灵图集未就绪，保持 3D'); return; }
  const next = !!on;
  if (next !== retroMode) {
    // 3D 视高 ≈ 0.975×dist；2D 视高 = 2×0.0475×dist → 换算系数约 10.3
    // 两种模式各存各的缩放：2D 视距含义不同，直接换算会把小人缩成 2 像素
    if (next) { zoom3d = rig.dist; rig.dist = zoom2d; }
    else { zoom2d = rig.dist; rig.dist = zoom3d; }
  }
  retroMode = next;
  retro.group.visible = retroMode;
  if (cityRef && cityRef.group) cityRef.group.visible = !retroMode && showBuildings;
  if (sky) sky.visible = !retroMode;
  if (agents) {
    agents.points.visible = !retroMode;
    agents.unitsVisible = !retroMode;
  }
  const btn = document.getElementById('btn-retro');
  if (btn) btn.textContent = retroMode ? '🕹 2D 模式' : '🧊 3D 模式';
  document.body.classList.toggle('retro-mode', retroMode);
  if (retroMode && !document.getElementById('retro-hint')) {
    const h = document.createElement('div');
    h.id = 'retro-hint';
    h.textContent = '2D 模式 · Tab 切回 3D';
    document.body.appendChild(h);
  } else if (!retroMode) {
    const h = document.getElementById('retro-hint');
    if (h) h.remove();
  }
}

function showBanner(txt) {
  $('banner-txt').textContent = txt;
  $('banner').classList.remove('hidden');
  bannerShown = true;
}
function hideBanner() { $('banner').classList.add('hidden'); bannerShown = false; }

// ---------- 加载 ----------
async function boot() {
  const lf = $('ld-fill'), lt = $('ld-txt');
  const Q = new URLSearchParams(location.search);
  if (Q.get('pop')) { sPop.value = Q.get('pop'); syncLabels(); }
  const setL = (p, t) => { lf.style.width = p + '%'; lt.textContent = t; };

  setL(6, '读取城市数据…');
  // ---------- 多城市：?city=<id>，默认 berlin ----------
  const CID = (Q.get('city') || 'berlin').replace(/[^a-z0-9_-]/gi, '');
  const CDIR = 'data/cities/' + CID;
  let cityIndex = [];
  try {
    const ir = await fetch('data/cities/index.json');
    if (ir.ok) cityIndex = await ir.json();
  } catch (e) { /* 没有索引就只跑默认城市 */ }

  const res = await fetch(CDIR + '/city.json');
  if (!res.ok) { fail('找不到 ' + CDIR + '/city.json —— 请先运行 pipeline/bake_pbf.py'); return; }
  const city = await res.json();
  if (Q.get('maxb')) city.buildings = city.buildings.slice(0, +Q.get('maxb'));
  cityRef = city;
  setL(30, `载入 ${city.name}：${city.buildings.length.toLocaleString()} 栋建筑…`);

  await new Promise(r => setTimeout(r, 30));

  // 导航 / 碰撞层（有烘焙好的位域碰撞层就用它，否则回退到旧的布尔栅格）
  const t0 = performance.now();
  let nav = null;
  if (city.collision) {
    try {
      nav = await loadCollision(city);
      const st = collisionStats(nav);
      if (st) console.log(`[ZOS-R] 碰撞层 ${nav.cols}×${nav.rows} @${nav.cell}m  ${st.text}`);
    } catch (e) {
      console.warn('[ZOS-R] 碰撞层加载失败，回退到布尔栅格：', e);
    }
  }
  if (!nav) nav = buildNav(city, 2);

  // 手工图层补丁：修正自动烘焙的错误（把不是房子的当房子、河宽、桥没接上……）
  // 必须在 new Sim(nav) 之前应用 —— 门场 BFS 要用修补后的门位置。
  if (nav && nav.grid) {
    try {
      const pr = await fetch(CDIR + '/collision.edit.json');
      if (pr.ok) {
        const patch = await pr.json();
        const ps = applyLayerPatch(nav, patch);
        if (ps.ops) {
          console.log(`[ZOS-R] 图层补丁 ${ps.ops} 条 / 改动 ${ps.changed.toLocaleString()} 格`);
        }
      }
    } catch (e) {
      console.warn('[ZOS-R] 图层补丁加载失败（不影响游戏）：', e);
    }
  }
  const navMs = performance.now() - t0;
  CITY_HALF = [nav.halfW, nav.halfH];
  // 2D 最远视距：整座城的高度 + 240m 边距，换算成 2D 的 dist
  //   （视高 = 2×0.0475×dist = 0.095×dist → dist = 视高 / 0.095）
  maxDist2d = Math.min(60000, (nav.H + 240) / 0.095);

  setL(52, '构建几何体…');
  await new Promise(r => setTimeout(r, 30));
  localizeCityNames(city);   // 建筑名一律中文
  const { group, buildingMat } = buildCity(city);
  scene.add(group);
  cityRef.mat = buildingMat;
  cityRef.group = group;

  // ---------- 卫星影像（有 data/sat.json 就加载）----------
  setL(62, '载入卫星影像…');
  try {
    const tr = await fetch(CDIR + '/ground/tileset.json');
    if (tr.ok) {
      const tileset = await tr.json();
      tileset.dir = CDIR + '/ground';
      ground = await new TiledGround(scene, city, tileset).load();
      satMesh = ground;                       // 沿用旧的开关逻辑
      console.log('[ZOS-R] 分块地面 ' + tileset.cols + 'x' + tileset.rows +
        ' 每块 ' + tileset.tileSize + 'px');
    } else {
      // 没有分块就退回单张图
      const sr = await fetch(CDIR + '/sat.json');
      if (sr.ok) {
        const meta = await sr.json();
        const tex = await new THREE.TextureLoader().loadAsync(CDIR + '/' + meta.image);
        satMesh = buildSatelliteGround(city, meta, tex);
        scene.add(satMesh);
      }
    }
  } catch (e) {
    console.warn('卫星影像不可用，回退矢量地图：', e);
  }

  setL(72, '生成人口…');
  await new Promise(r => setTimeout(r, 30));
  sim = new Sim(nav, city);   // city 里有 POI（工作地分配用）
  sim.reset(readParams());
  buildEscapeMarker();

  agents = new AgentRenderer(scene, 62000);

// ---------- 2009 复古模式（图集 + 正交相机） ----------
  // 精灵块 v2（src/sprite/）：图集来自 assets/atlas/，见 assets/atlas/README.md
  retro = new SpriteView(scene);
  try {
    await retro.load();
  } catch (e) {
    console.warn('[ZOS-R] 复古图集加载失败：', e);
  }
  overlay = new TerrainOverlay(scene, nav, city);
  // 游戏内图层编辑器：baseGrid 是"只剩文件补丁"时的网格，撤销/清空都回到它
  layerEdit = new LayerEditor({
    scene, renderer, getCamera: activeCamera, nav, overlay,
    cityId: CID, fileOps: layerFileOps, baseGrid: nav.grid.slice(),
    // 手绘墙之后：门场要重建（否则出门路线是旧的），被墙盖住的人要挪出来
    onChange: () => {
      try {
        nav.buildDoorField();
        const n = sim ? sim.evictFromWalls() : 0;
        if (n) console.log('[ZOS-R] 手绘后挪出墙体 ' + n + ' 人');
      } catch (err) { console.warn('[ZOS-R] 手绘后处理失败：', err); }
    },
  });
  console.log('[ZOS-R] 地形图层：不可通行 ' + overlay.stats.block.toLocaleString() +
    ' / ' + overlay.stats.total.toLocaleString() + ' 格 (' + overlay.stats.pct.toFixed(1) + '%)');

  orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  orthoCam.up.set(0, 0, -1);
  if (Q.get('dist2d')) zoom2d = +Q.get('dist2d');   // 调试用：直接指定 2D 视距

  // 相机初始（先按 3D 摆好，这样切回 3D 时是正常视野）
  rig.target.set(0, 0, 0);
  rig.dist = 520;
  applyCamera();

  // ---- 默认进 2D 模式；?3d=1 直接以 3D 启动（?demo 是 3D 模型陈列，强制 3D）----
  setRetro(!(Q.get('3d') === '1' || Q.get('demo')));

  document.title = 'CAM ' + camera.position.toArray().map(v => v.toFixed(0)).join(',') +
    ' tgt=' + rig.target.toArray().map(v => v.toFixed(0)).join(',') +
    ' dist=' + rig.dist.toFixed(0) + ' pitch=' + rig.pitch.toFixed(2) +
    ' gc=' + group.children.length;
  $('n-civ').textContent = sim.stats.civ.toLocaleString();
  $('n-zomb').textContent = sim.stats.zombie.toLocaleString();

  setL(96, '完成');
  await new Promise(r => setTimeout(r, 120));

  // ---- 调试开关（URL 参数）----
  if (Q.get('demo')) {
    // 单位全家福：把 12 种单位排成两行摆好，方便看模型
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    // 找一片「室外」空地（室内也是可走的，必须排除）
    let bx = 0, bz = 0;
    for (let t = 0; t < 5000; t++) {
      const a = Math.random() * 6.2832, r = 60 + Math.random() * 380;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (nav.walkable(x, z) && !(nav.indoor && nav.indoor(x, z))) { bx = x; bz = z; break; }
    }
    ids.forEach((id, k) => {
      const gx = bx - 7 + (k % 4) * 4.6;
      const gz = bz + 4 + ((k / 4) | 0) * 5.2;
      const idx = sim.addUnit(gx, gz, id);
      if (idx >= 0) {
        sim.px[idx] = gx; sim.pz[idx] = gz;
        sim.state[idx] = id >= 6 ? 4 : 0;    // 4=ZOMBIE 0=CIV
        sim.idle[idx] = 1; sim.actT[idx] = 9999;
        sim.heading[idx] = -Math.PI / 2;
      }
    });
    rig.target.set(bx, 1.0, bz + 9);
    rig.dist = 17;
    rig.pitch = 0.30;
    rig.yaw = 0;
    applyCamera();
  }
  if (Q.get('nosky')) sky.visible = false;
  if (Q.get('mat') === 'normal' && cityRef.group) {
    cityRef.group.children[0].material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  }
  if (Q.get('mat') === 'basic' && cityRef.group) {
    cityRef.group.children[0].material = new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide });
  }
  if (Q.get('nocity') && cityRef.group) cityRef.group.visible = false;

  // 地图模式：默认卫星（有影像时），可用 ?map=vec 强制矢量
  setMapMode(satMesh && Q.get('map') !== 'vec' ? 'sat' : 'vec');
  if (Q.get('nobld')) setBuildings(false);
  // 调试：快进 N 秒模拟 / 直接打开战报
  if (Q.get('ff')) {
    const secs = Math.min(600, +Q.get('ff') || 0);
    for (let i = 0; i < secs * 20; i++) sim.step(1 / 20, camera.position.x, camera.position.z);
  }
  if (Q.get('report')) setTimeout(() => openReport(sim), 500);
  if (Q.get('ov')) setTimeout(() => { if (sim) toggleOverview(sim); }, 600);
  // 调试：?zombify=N 让第 N 个个体被咬 → 快进 → 选中跟随（复现"变丧尸后图标消失"）
  if (Q.get('zombify') != null) {
    setTimeout(() => {
      const i = Math.max(0, +Q.get('zombify') || 0);
      if (!sim || !sim.setInfected) return;
      sim.setInfected(i, 0.2);
      const secs = Math.min(120, +Q.get('zsec') || 12);
      for (let k = 0; k < secs * 20; k++) sim.step(1 / 20, sim.px[i], sim.pz[i]);
      selectAgent(i);
      followSelected = true;
    }, 800);
  }
  // 调试：?follow=N 选中并跟随第 N 个个体（截图/排查用）
  if (Q.get('follow') != null) {
    setTimeout(() => {
      const i = Math.max(0, +Q.get('follow') || 0);
      selectAgent(i);
      followSelected = true;
    }, 900);
  }
  // 调试：?spritedbg=1 显示 2D 精灵各层实例数
  if (Q.get('spritedbg')) {
    const pre = document.createElement('pre');
    pre.id = 'spritedbg';
    pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:rgba(0,0,0,.72);' +
      'color:#9fe;padding:6px 9px;font:11px/1.35 ui-monospace,monospace;border-radius:6px;white-space:pre';
    document.body.appendChild(pre);
    setInterval(() => {
      if (!retro || !retro.stats) { pre.textContent = 'sprite: 未就绪'; return; }
      const s = retro.stats;
      retro.watchSel = selected;
      const selTxt = selected >= 0
        ? ('sel #' + selected + '  state=' + sim.state[selected] +
           '  stage=' + (sim.aStage ? sim.aStage[selected] : '-') +
           '  kind=' + sim.kind[selected] +
           '  body=' + (retro.bodyStr && retro.bodyStr[selected]) +
           '  本帧画出=' + (retro.selDrawn ? 'YES' : 'NO'))
        : 'sel -';
      // 全城有多少人正处在"有顶盖"的格子上（僵尸/警察会不会进屋，看这一行）
      let ic = 0, ip = 0, iz = 0;
      if (sim && sim.nav && sim.nav.indoor) {
        for (let k = 0; k < sim.n; k++) {
          if (!sim.nav.indoor(sim.px[k], sim.pz[k])) continue;
          const st = sim.state[k];
          if (st === ST.ZOMBIE) iz++;
          else if (st === ST.POLICE || st === ST.SOLDIER) ip++;
          else if (st === ST.CIV || st === ST.INFECTED) ic++;
        }
      }
      pre.textContent =
        'sprite v2  atlas ' + s.w + 'x' + s.h + '  clips ' + s.clips + '\n' +
        'actor ' + s.actor + '  decal ' + s.decal + '  shadow ' + s.shadow + '  dots ' + s.dots + '\n' +
        'silhouette ' + s.sil + '  (civ ' + s.silCiv + ' / police ' + s.silPolice + ' / zombie ' + s.silZombie + ')\n' +
        '累计剪影 civ ' + s.silTot.civ + '  police ' + s.silTot.police + '  zombie ' + s.silTot.zombie + '\n' +
        'turn01 ' + s.turn + '  die01 ' + s.die + '  zrise01 ' + s.rise + '\n' +
        '全城室内：平民 ' + ic + '  警察/士兵 ' + ip + '  丧尸 ' + iz + '\n' + selTxt + '\n' + selTxt + (window.__err ? '\nERR ' + window.__err : '');
    }, 250);
  }
  if (Q.get('sel')) setTimeout(() => {
    const i = (sim.vips && sim.vips.length) ? sim.vips[0] : 0;
    selectAgent(i);
  }, 700);
  // 演示：一次性丢几个工具，便于截图/排查
  if (Q.get('demo')) {
    const fireDemo = () => {
      const ox = sim.origin[0], oz = sim.origin[1];
      sim.budget = 200;
      TOOL_BY_ID.heli.apply(sim, ox, oz, { angle: 0 });
      TOOL_BY_ID.napalm.apply(sim, ox + 90, oz + 20, { angle: 0 });
      TOOL_BY_ID.siren.apply(sim, ox - 70, oz + 70, { angle: 0 });
      TOOL_BY_ID.strike.apply(sim, ox + 40, oz - 80, { angle: 0 });
      TOOL_BY_ID.barricade.apply(sim, ox, oz + 110, { angle: 0 });
      TOOL_BY_ID.rally.apply(sim, ox - 90, oz - 40, { angle: 0 });
      TOOL_BY_ID.police.apply(sim, ox + 20, oz - 20, { angle: 0 });
      TOOL_BY_ID.soldier.apply(sim, ox - 30, oz + 10, { angle: 0 });
    };
    fireDemo();
    setInterval(fireDemo, 5200);
  }
  if (Q.get('bld')) setBuildings(true);

  if (Q.get('b3d') && typeof setBuildings === 'function') setBuildings(Q.get('b3d') !== '0');
  if (Q.get('nopoints')) agents.points.visible = false;
  if (Q.get('nohumans')) agents.unitsVisible = false;
  if (Q.get('cam') === 'origin') {
    rig.target.set(sim.origin[0], 0, sim.origin[1]);
    rig.dist = +(Q.get('dist') || 140);
    applyCamera();
  } else if (Q.get('cam')) {
    const a = Q.get('cam').split(',').map(Number);
    rig.target.set(a[0] || 0, 0, a[1] || 0);
    rig.dist = a[2] || 400;
    if (!isNaN(a[3])) rig.yaw = a[3];
    if (Q.get('pitch')) rig.pitch = +Q.get('pitch');
    applyCamera();
  }
  $('loading').classList.add('done');
  setTimeout(() => {
    const l = document.getElementById('loading');
    if (l) l.style.display = 'none';
  }, 650);

  $('tb-city').textContent = cnCity(CID, city.name);
  {
    const tb = $('topbar');
    const b = document.createElement('button');
    b.id = 'btn-retro';
    b.textContent = retroMode ? '🕹 2D 模式' : '🧊 3D 模式';   // 按钮显示当前模式
    b.title = '切换 2D / 3D 模式（Tab）';
    b.style.cssText = 'margin-left:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
      'color:#cfd6dd;font:inherit;font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer';
    b.onclick = () => setRetro(!retroMode);
    tb && tb.appendChild(b);

    const b2 = document.createElement('button');
    b2.id = 'btn-overlay';
    b2.textContent = '🗺 地形';
    b2.title = '叠加地形图层（C）：显示每格能不能走';
    b2.style.cssText = b.style.cssText + ';margin-left:6px';
    b2.onclick = () => setOverlay(!overlayOn);
    tb && tb.appendChild(b2);

    // 城市选择器（data/cities/index.json 里有多个城市才显示）
    if (cityIndex && cityIndex.length > 1) {
      const sel = document.createElement('select');
      sel.id = 'sel-city';
      sel.title = '切换城市';
      sel.style.cssText = 'margin-left:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
        'color:#cfd6dd;font:inherit;font-size:11px;padding:3px 6px;border-radius:5px;cursor:pointer';
      for (const c of cityIndex) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = cnCity(c.id, c.name);
        if (c.id === CID) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        const u = new URL(location.href);
        u.searchParams.set('city', sel.value);
        location.href = u.toString();
      };
      tb && tb.appendChild(sel);
    }
  }
  if (Q.get('retro')) setRetro(true);
  if (Q.get('overlay')) setOverlay(true);
  if (Q.get('edit') && layerEdit) layerEdit.enable();   // ?edit=1 直接进编辑模式
  document.title = 'CAM ' + camera.position.toArray().map(v => v.toFixed(0)).join(',') +
    ' tgt=' + rig.target.toArray().map(v => v.toFixed(0)).join(',') +
    ' dist=' + rig.dist.toFixed(0) + ' pitch=' + rig.pitch.toFixed(2) +
    ' gc=' + group.children.length + ' n=' + sim.n;
  console.log(`[ZOS-R] ${city.name} | 建筑 ${city.buildings.length} | 道路 ${city.roads?.length ?? 0} | nav ${navMs.toFixed(0)}ms | agents ${sim.n}`);
  if (Q.get('fixcam')) {
    FIXCAM = true;
    camera.position.set(400, 700, 500);
    camera.lookAt(0, 0, 0);
    camera.far = 20000; camera.updateProjectionMatrix();
  }
  if (cityRef?.mat) {
    cityRef.mat.uniforms.uCam.value.copy(camera.position);
    cityRef.mat.uniforms.uNight.value = 0.42;
  }
  if (retroMode && retro && retro.ready) {
    // ---- 2D 模式：正交俯视 + 精灵 ----
    const halfH = Math.max(7, rig.dist * 0.0475);   // 视高 = 2×halfH；原来的 0.095 让视野大一倍，小人只剩 9 px
    const halfW = halfH * camera.aspect;
    orthoCam.left = -halfW; orthoCam.right = halfW;
    orthoCam.top = halfH; orthoCam.bottom = -halfH;
    orthoCam.near = 1; orthoCam.far = 4000;
    orthoCam.updateProjectionMatrix();
    orthoCam.position.set(rig.target.x, 900, rig.target.z);
    orthoCam.up.set(0, 0, -1);                                  // 2D 强制正北朝上
    orthoCam.lookAt(rig.target.x, 0, rig.target.z);
    retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH,
      pxPerM: (renderer.domElement.clientHeight || window.innerHeight) / Math.max(1e-4, 2 * halfH) });
    if (++fc % 20 === 0) document.title = 'RETRO n=' + retro.count + ' ready=' + retro.ready +
      ' halfW=' + halfW.toFixed(0) + ' tx=' + rig.target.x.toFixed(0) + ' cz=' + rig.target.z.toFixed(0) +
      ' total=' + (sim ? sim.n : 0);
    renderer.render(scene, orthoCam);
  } else {
    renderer.render(scene, camera);
  }
  document.title = '生化危机模拟器 · ' + city.name;
  startLoop();
}

// ---------- 主循环 ----------
let last = 0, acc = 0, frames = 0, fpsT = 0, hudT = 0, fc = 0;
const DT = 1 / 20;

function startLoop() {
  requestAnimationFrame(loop);
}

function loop(t) {
  requestAnimationFrame(loop);
  if (!last) last = t;
  let dtReal = (t - last) / 1000;
  last = t;
  if (dtReal > 0.25) dtReal = 0.25;

  // 键控
  const spd = rig.dist * 1.1 * dtReal;
  const yaw = retroMode ? 0 : rig.yaw;   // 2D 固定正北朝上，WASD 就是屏幕方向
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('KeyW')) rig.target.addScaledVector(fwd, spd);
  if (keys.has('KeyS')) rig.target.addScaledVector(fwd, -spd);
  if (keys.has('KeyA')) rig.target.addScaledVector(right, -spd);
  if (keys.has('KeyD')) rig.target.addScaledVector(right, spd);
  if (!retroMode && keys.has('KeyQ')) rig.yaw += dtReal * 1.1;
  if (!retroMode && keys.has('KeyE')) rig.yaw -= dtReal * 1.1;
  if (keys.has('KeyR')) rig.pitch = Math.min(1.52, rig.pitch + dtReal * 0.7);
  if (keys.has('KeyF')) rig.pitch = Math.max(0.18, rig.pitch - dtReal * 0.7);
  clampTarget();
  updatePathLine();
  if (!FIXCAM) applyCamera();

  // 模拟
  if (speed > 0 && sim) {
    acc += dtReal * speed;
    let steps = 0;
    const maxSteps = speed > 4 ? 24 : 12;
    while (acc >= DT && steps < maxSteps) {
      sim.step(DT, camera.position.x, camera.position.z);
      acc -= DT;
      steps++;
      if (speed > 1 && sim.tracers.length > 120) sim.tracers.length = 120;
    }
    if (steps >= maxSteps) acc = 0;
  }

  // 渲染更新
  if (agents && sim) {
    // 视距越大，显示模型的半径也越大（连续，避免整片突变）
    agents.nearRadius = Math.min(1400, Math.max(110, rig.dist * 0.9));
    agents.update(sim, camera.position);
  }
  updateTracers();
  updateBooms(dtReal);
  updateFx(t);
  if (audio.ok) {
    const rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
    audio.setView(camera.position.x, camera.position.z, rx, rz);
    audio.frame(sim);
  }
  if (ground) {
    ground.update({ cx: rig.target.x, cz: rig.target.z, dist: rig.dist,
      halfW: Math.max(60, rig.dist * 0.9), halfH: Math.max(60, rig.dist * 0.9) });
  }
  // 夜间光照：太阳/环境光/城市夜灯/雾色都跟着夜色走
  if (sim) {
    const nf = sim.nightFactor;
    if (sun) sun.intensity = 1.5 * (1 - nf * 0.92);
    if (hemi) hemi.intensity = 0.85 * (1 - nf * 0.55);
    if (cityRef?.mat) cityRef.mat.uniforms.uNight.value = 0.30 + nf * 0.65;
    if (scene.fog) scene.fog.color.setRGB(0.48 - nf * 0.40, 0.56 - nf * 0.44, 0.68 - nf * 0.45);
    if (nightTint) nightTint.style.opacity = (nf * 0.34).toFixed(3);
  }

  sky.position.copy(camera.position);
  drawCompass();
  if (cityRef?.mat) {
    cityRef.mat.uniforms.uCam.value.copy(camera.position);
    cityRef.mat.uniforms.uFog.value.copy(FOG);
    cityRef.mat.uniforms.uNight.value = 0.42;
    cityRef.mat.uniforms.uFogNear.value = scene.fog ? scene.fog.near : 900;
    cityRef.mat.uniforms.uFogFar.value = scene.fog ? scene.fog.far : 5200;
  }

  // 跟随 + 选中圈：每帧更新，2D/3D 都生效
  if (sim) {
    if (followSelected && selected >= 0) rig.target.set(sim.px[selected], 0, sim.pz[selected]);
    updateLink();
  }

  if (retroMode && retro && retro.ready) {
    // ---- 2D 模式：正交俯视 + 精灵 ----
    const halfH = Math.max(7, rig.dist * 0.0475);   // 视高 = 2×halfH；原来的 0.095 让视野大一倍，小人只剩 9 px
    const halfW = halfH * camera.aspect;
    orthoCam.left = -halfW; orthoCam.right = halfW;
    orthoCam.top = halfH; orthoCam.bottom = -halfH;
    orthoCam.near = 1; orthoCam.far = 4000;
    orthoCam.updateProjectionMatrix();
    orthoCam.position.set(rig.target.x, 900, rig.target.z);
    orthoCam.up.set(0, 0, -1);                                  // 2D 强制正北朝上
    orthoCam.lookAt(rig.target.x, 0, rig.target.z);
    retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH,
      pxPerM: (renderer.domElement.clientHeight || window.innerHeight) / Math.max(1e-4, 2 * halfH) });
    if (++fc % 20 === 0) document.title = 'RETRO n=' + retro.count + ' ready=' + retro.ready +
      ' halfW=' + halfW.toFixed(0) + ' tx=' + rig.target.x.toFixed(0) + ' cz=' + rig.target.z.toFixed(0) +
      ' total=' + (sim ? sim.n : 0);
    renderer.render(scene, orthoCam);
  } else {
    renderer.render(scene, camera);
  }
  updatePoiLabels();   // 相机矩阵这一帧已更新，投影才不会 NaN
  if (++fc === 1) {
    document.title = 'R tris=' + renderer.info.render.triangles +
      ' calls=' + renderer.info.render.calls +
      ' gc=' + (cityRef?.group ? cityRef.group.children.length : -1) +
      ' camY=' + camera.position.y.toFixed(0) +
      ' matOk=' + (cityRef?.mat ? 1 : 0);
  }

  // FPS
  frames++;
  hudT += dtReal;
  if (hudT > 0.25) {
    const fps = frames / hudT;
    document.title = 'R tris=' + renderer.info.render.triangles + ' calls=' + renderer.info.render.calls + ' n=' + (sim ? sim.n : 0) + ' gc=' + (cityRef?.group ? cityRef.group.children.length : -1);
    $('fps').textContent = fps.toFixed(0) + ' fps';
    $('n-civ').textContent = sim.stats.civ.toLocaleString();
    $('n-inf').textContent = sim.stats.infected.toLocaleString();
    $('n-zomb').textContent = sim.stats.zombie.toLocaleString();
    $('n-dead').textContent = sim.stats.dead.toLocaleString();
    if ($('n-flee')) {
      const st2 = sim.stats;
      $('n-flee').textContent = ((st2.fleeTotal || 0) + (st2.fleeImm || 0)).toLocaleString();
      $('n-flee').title = `即时逃跑 ${st2.fleeImm || 0} · 有目标逃跑 ${st2.fleeTotal || 0}`
        + `（回家 ${st2.fleeHome || 0} / 警局 ${st2.fleePolice || 0} / 出城 ${st2.fleeEscape || 0}）`;
    }
    // 三条状态条（混乱 → 感染 → 知情）
    const gauge = (id, v) => { const e = $(id); if (e) e.style.width = Math.max(0, Math.min(100, v)) + "%"; };
    gauge("bar-chaos", sim.chaos || 0);
    gauge("bar-infect", (sim.infectRate || 0) * 100);
    gauge("bar-aware", (sim.awareRate || 0) * 100);
    const setPct = (id, v) => { const e = $(id); if (e) e.textContent = Math.round(v) + "%"; };
    setPct("n-infect", (sim.infectRate || 0) * 100);
    setPct("n-aware", (sim.awareRate || 0) * 100);
    if ($("n-chaos")) $("n-chaos").textContent = Math.round(sim.chaos || 0);
    if ($('n-exit') && sim.escapeSide) {
      const side = sim.escapeLine ? sim.escapeLine() : null;
      $('n-exit').textContent = side ? side.name : '—';
    }
    if ($('n-chaos')) {
      const c = Math.round(sim.chaos || 0);
      $('n-chaos').textContent = c;
      $('n-chaos').classList.toggle('hot', c >= 50);
      $('n-chaos').title = `混乱度 ${c}%（知情 ${((sim.awareRate || 0) * 100).toFixed(0)}% ×1 + 感染 ${((sim.infectRate || 0) * 100).toFixed(1)}% ×2）`;
    }
    if ($('n-aware')) {
      $('n-aware').textContent = (sim.nAware / Math.max(1, sim.n) * 100).toFixed(0) + '%';
      const heatBar = $('heat')?.firstElementChild;
      if (heatBar) heatBar.style.width = Math.round(Math.min(1, sim.heat || 0) * 100) + '%';
    }
    // 游戏时钟（1 模拟秒 = 1 游戏分钟）
    const cm = sim.clockMin | 0;
    $('tb-clock').textContent =
      `第 ${sim.dayIndex} 天 ${String(Math.floor(cm / 60)).padStart(2, '0')}:${String(cm % 60).padStart(2, '0')} · ${sim.segName}`;
    frames = 0; hudT = 0;

    updateToolbar();
    if (!bannerShown) {
      const st = sim.stats;
      let over = null;
      if (st.zombie === 0 && st.infected === 0 && st.civ > 0) over = '感染已清除';
      else if (st.civ === 0) over = '城市沦陷';
      if (over) {
        showBanner(over);
        setTimeout(() => {
          if (sim && !document.getElementById('report')) openReport(sim);
        }, 2400);
      }
    }
  }
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

boot().catch(e => fail('启动失败：' + (e?.message || e)));













































