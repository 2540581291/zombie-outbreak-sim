// ============================================================
//  ZOS-R · 主程序：装配、相机、循环、UI
// ============================================================
import * as THREE from 'three';
import { buildCity, buildSatelliteGround, localizeCityNames } from './city.js';
import { cityFull, cityShort, cityNewspaper, cityInfo } from './citymeta.js';
import { buildNav, Sim, ST, GOAL } from './sim.js';
import { loadCollision, collisionStats } from './collision.js';
import { applyLayerPatch } from './layerpatch.js';
import { AgentRenderer } from './agents.js';
import { TOOLS, TOOL_BY_ID, HOTKEYS, fmtWan, fmtMoney } from './tools.js';
import { profileFor, shortName } from './people.js';
import { setCountry } from './profiles.js';
import { kinList, ageOfAgent } from './family.js';
import { SPECIES, SP } from './species.js';
import { weaponOf } from './weapons.js';
import { stockText } from './storage.js';
import { AudioEngine } from './audio.js';
import { openReport, closeReport, isReportOpen } from './report.js';
import { openForce, openSanit, openChaosInfo, openInfectInfo, openAwareInfo } from './status.js';
import { openGov, closeGov, isGovOpen } from './gov.js';
import { initNews, resetNews } from './news.js';
import { openOverview, close as closeOverview, toggle as toggleOverview, isOpen as overviewIsOpen } from './overview.js';
import { SpriteView } from '../src/sprite/index.js';
import { TerrainOverlay } from './overlay.js';
import { LayerEditor } from './editmode.js';

const $ = (id) => document.getElementById(id);
// 构建戳：控制台输入 window.__BUILD 就能确认跑的是不是最新一版
window.__BUILD = '2026-03-24-label1';
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
  else if (e.code === 'Escape' && isGovOpen()) closeGov();
  if (HOTKEYS[e.code]) selectTool(HOTKEYS[e.code]);
});
addEventListener('keyup', (e) => keys.delete(e.code));

let drag = null;
// 右键拖拽的位移先攒在 panPending 里，每帧按指数衰减地消化掉 ——
// 直接 add 到 target 上会跟着鼠标事件一跳一跳（尤其高刷新率鼠标），加了这个就变成顺滑滑动+收尾减速
const panPending = new THREE.Vector3();

// 别处（比如武力面板里的警局卡片）请求把镜头移过去：
// 复用右键拖拽那套"攒位移 + 主循环衰减消化"的做法，镜头是滑过去的，不是瞬移。
addEventListener('zos:focus', (e) => {
  const d = (e && e.detail) || {};
  if (typeof d.x !== 'number' || typeof d.z !== 'number') return;
  followSelected = false;                       // 别让"跟随选中"把镜头拽回去
  panPending.x += d.x - rig.target.x;
  panPending.z += d.z - rig.target.z;
  // 只在"离得太远"时拉近，不把已经放大过的镜头拉远。
  // 2D 的 dist 语义和 3D 完全不同（2D: 视高 ≈ 0.095×dist，3D: 视高 ≈ 0.975×dist）
  const near = retroMode ? 2600 : 320;
  if (rig.dist > near) rig.dist = near;
  applyCamera();
});
// 左键框选：只框"可指挥单位"（士兵/重装兵/装甲车），框住的一起下命令
function updateGroupBadge() {
  let b = document.getElementById('selgroup');
  if (!multiSel.size) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'selgroup';
    b.style.cssText = 'position:fixed;left:18px;top:110px;z-index:41;pointer-events:none;' +
      'background:rgba(10,20,30,.82);border:1px solid rgba(127,224,255,.6);color:#9fe8ff;' +
      'font:700 12px/1.3 ui-monospace,monospace;padding:4px 9px;border-radius:6px';
    document.body.appendChild(b);
  }
  b.style.display = 'block';
  b.textContent = '编组 ' + multiSel.size + ' · 右键移动';
}

// 选中单位的脚下光圈（框选/单选的士兵都有，一眼能看出选中了谁）
const selRings = [];          // 复用的 ring mesh 池
function ensureSelRings(n) {
  const need = Math.min(80, n);
  while (selRings.length < need) {
    const geo = new THREE.RingGeometry(1.15, 1.7, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fe0ff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 8;
    m.visible = false;
    scene.add(m);
    selRings.push(m);
  }
  for (let k = need; k < selRings.length; k++) selRings[k].visible = false;
}
function updateSelRings() {
  if (!sim) return;
  const list = multiSel.size ? [...multiSel] : (selected >= 0 ? [selected] : []);
  ensureSelRings(list.length);
  for (let k = 0; k < selRings.length; k++) {
    const m = selRings[k];
    const i = list[k];
    // 无效/已死/已撤离 → 隐藏并跳过（之前少了 continue：visible=false 之后立刻又被 true，
    // 还把位置设成 undefined → NaN，圈会残留在上次的位置上）
    if (i === undefined || sim.state[i] === ST.CORPSE || sim.state[i] === ST.SAVED) {
      m.visible = false;
      continue;
    }
    m.visible = true;
    m.position.set(sim.px[i], 0.08, sim.pz[i]);
    const sc = multiSel.size ? 1 : 1.15;      // 单选的圈略大一点，更醒目
    m.scale.set(sc, sc, sc);
  }
}

let boxStart = null;                 // { x, y } 屏幕坐标
let boxEl = null;                    // 选框 DOM
const multiSel = new Set();          // 被框选的单位下标（不含 clicked 单个选中的那个）

function ensureBoxEl() {
  if (boxEl) return boxEl;
  boxEl = document.createElement('div');
  boxEl.id = 'selbox';
  boxEl.style.cssText = 'position:fixed;border:1px solid #7fe0ff;background:rgba(127,224,255,.14);' +
    'pointer-events:none;z-index:40;display:none;border-radius:2px';
  document.body.appendChild(boxEl);
  return boxEl;
}

/** 屏幕矩形里有哪些可指挥单位（士兵/重装兵/装甲车） */
function unitsInRect(x0, y0, x1, y1) {
  const out = [];
  if (!sim) return out;
  const cam = activeCamera();
  const v = new THREE.Vector3();
  const lx = Math.min(x0, x1), rx = Math.max(x0, x1);
  const ty = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let i = 0; i < sim.n; i++) {
    const st = sim.state[i];
    if (st !== ST.SOLDIER) continue;
    v.set(sim.px[i], 0.9, sim.pz[i]).project(cam);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (sx >= lx && sx <= rx && sy >= ty && sy <= by) out.push(i);
  }
  return out;
}
const el = renderer.domElement;
el.addEventListener('contextmenu', (e) => e.preventDefault());

el.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0, btn: e.button, sx: e.clientX, sy: e.clientY };
  if (e.button === 0) boxStart = { x: e.clientX, y: e.clientY };
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

  if (drag.btn === 0 && boxStart && drag.moved > 6) {
    const b = ensureBoxEl();
    b.style.display = 'block';
    b.style.left = Math.min(boxStart.x, e.clientX) + 'px';
    b.style.top = Math.min(boxStart.y, e.clientY) + 'px';
    b.style.width = Math.abs(e.clientX - boxStart.x) + 'px';
    b.style.height = Math.abs(e.clientY - boxStart.y) + 'px';
    return;                                  // 框选时不平移
  }
  if (drag.btn === 2) {
    // 右键 = 平移（灵敏度 0.0016 → 0.00085 → 0.00062）
    // 位移先进 panPending，由主循环平滑消化（见 loop 里 panPending 那段）
    const k = rig.dist * 0.00062;
    panPending.addScaledVector(fwd, dy * k).addScaledVector(right, -dx * k);
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
  // ---- 左键框选结算 ----
  let boxed = null;
  if (drag && drag.btn === 0 && boxStart && drag.moved > 6) {
    boxed = unitsInRect(boxStart.x, boxStart.y, e.clientX, e.clientY);
  }
  if (boxEl) boxEl.style.display = 'none';
  boxStart = null;
  drag = null;
  if (boxed) {
    if (boxed.length) {
      selectAgent(boxed[0]);
      multiSel.clear();
      for (const i of boxed) multiSel.add(i);
      updateGroupBadge();
      toast(`框选 ${boxed.length} 个单位 · 右键下达移动命令`);
    } else {
      toast('框选区域里没有可指挥的单位（只有士兵/重装兵能指挥）');
    }
    return;
  }
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
      // 有框选就整队一起走（散开成一个小队形，免得挤成一坨）
      const group = multiSel.size ? [...multiSel] : [selected];
      let n = 0;
      for (let gi = 0; gi < group.length; gi++) {
        const ui = group[gi];
        // 多人时按环形散开 3~6m
        const ang = (gi / Math.max(1, group.length)) * Math.PI * 2;
        const rr = group.length > 1 ? 3 + 3 * (gi % 2) : 0;
        if (sim.orderMove(ui, hit2.x + Math.cos(ang) * rr, hit2.z + Math.sin(ang) * rr)) n++;
      }
      if (n > 0) {
        toast(n > 1 ? `命令：${n} 个单位移动` : '命令：移动到此处');
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
        let cand = pickAgents(e.clientX, e.clientY, 22);
        if (!cand.length) cand = pickAgents(e.clientX, e.clientY, 44);   // 拉远时点得更虚，放宽一倍
        const prev = selected;
        if (cand.length) {
          // 人群中几个个体可能重叠在同一个像素上：优先切到"不是当前选中"的那个，
          // 否则点旁边的人会一直返回到原来那位（这就是"点了没反应"的原因）
          const pick = cand.find((c) => c.i !== selected) || cand[0];
          selectAgent(pick.i);
          console.log('[SEL] ' + prev + ' -> ' + pick.i + '（候选 ' + cand.length + '）');
        } else { deselectAgent(); console.log('[SEL] 空点击（候选 0）'); }
      } else {
        useToolAt(hit.x, hit.z);
      }
    }
  }
});

// ---------- 个体选择 ----------
let selected = -1;
let cardShownFor = -1;      // 卡片当前画的是谁（和 selected 不一致就重画）
let followSelected = false;

function pickAgents(clientX, clientY, radius = 22) {
  if (!sim) return [];
  const cam = activeCamera();
  const v = new THREE.Vector3();
  const out = [];
  const n = sim.n;
  const r2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const st = sim.state[i];
    if (st === ST.CORPSE || st === ST.SAVED) continue;
    v.set(sim.px[i], 0.9, sim.pz[i]).project(cam);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -40 || sy < -40 || sx > window.innerWidth + 40 || sy > window.innerHeight + 40) continue;
    const d = (sx - clientX) * (sx - clientX) + (sy - clientY) * (sy - clientY);
    if (d < r2) out.push({ i, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, 8);
}

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
  // 死了 / 已撤离 / 已尸变的人没有"正在走的路"——否则会从尸体上拉出一条线到旧目标
  {
    const st = sim.state[selected];
    if (st === ST.CORPSE || st === ST.SAVED || st === ST.ZOMBIE) {
      pathLine.visible = false;
      pathRing.visible = false;
      return;
    }
  }
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
  // 绿带就画在 escapeLine() 那条线上，厚度取"偏移量的 2 倍"（最小 12m），
  // 这样 UI 和判定用的是同一个位置，不会再错位。
  const off = sim.escapeOffset ? sim.escapeOffset() : 30;
  const depth = Math.max(12, off * 2);
  const geo = new THREE.PlaneGeometry(len, depth);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x43e08a, transparent: true, opacity: 0.45, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  if (horizontal) m.position.set(0, 1.2, side.z);
  else {
    m.rotation.z = Math.PI / 2;
    m.position.set(side.x, 1.2, 0);
  }
  m.renderOrder = 3;
  scene.add(m);
  escapeMark = m;
}

let lastCardHtml = '';       // 卡片内容缓存：内容没变就不重建 DOM
let lastCardT = 0;           // 上次刷新卡片的时间戳（节流到 200ms）

/** 城市选择弹窗：缩略图网格 + 按国家分栏 */
const COUNTRY_ORDER = ['中国', '德国', '日本', '英国', '美国', '巴西', '加拿大', '澳大利亚', '其他'];
/** 城市面积（km²），size 是米 */
function areaKm2(c) {
  const s = c && c.size;
  if (!s || s.length < 2) return '—';
  const a = (s[0] * s[1]) / 1e6;
  return a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a.toFixed(3);
}

function openCityPicker() {
  const cityIndex = window.__cityIndex || [];   // cityIndex / CID 都是 boot() 里的局部变量
  const CID = window.__CID || '';
  if (!cityIndex.length) return;
  let box = document.getElementById('citypicker');
  if (box) { box.remove(); return; }               // 再点一次关闭
  box = document.createElement('div');
  box.id = 'citypicker';
  // 官方地图单独一栏（不参与国家分组，也不出现在「全部」里）
  const official = cityIndex.filter(c => c.official);
  const local = cityIndex.filter(c => !c.official);
  const groups = new Map();
  for (const c of local) {
    const info = cityInfo(c.id, c.name);
    const country = info.country || '其他';
    if (!groups.has(country)) groups.set(country, []);
    groups.get(country).push(c);
  }
  const countries = [...groups.keys()].sort((a, b) => {
    const ia = COUNTRY_ORDER.indexOf(a), ib = COUNTRY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const tabs = [{ key: '全部', list: local }];
  for (const c of countries) tabs.push({ key: c, list: groups.get(c) });
  if (official.length) tabs.push({ key: '官方', list: official, special: true });   // 官方放最右
  const cardHtml = (c) => {
    const info = cityInfo(c.id, c.name);
    const on = c.id === CID ? ' on' : '';
    return `<button class="cp-card${on}${c.official ? ' official' : ''}" data-city="${c.id}" title="${cityFull(c.id, c.name)}">
      <img src="数据库/cities/${c.id}/thumb.jpg" alt="" loading="lazy">
      <span class="cp-name">${cityShort(c.id, c.name)}</span>
      <span class="cp-meta">${areaKm2(c)} km² · ${(c.buildings || 0).toLocaleString()} 栋 · ${(c.cell || 1).toFixed(2)}m</span>
      <span class="cp-flag">${info.country || ''}</span>
    </button>`;
  };
  const body = tabs.map((t, idx) => `
    <div class="cp-pane${idx === 0 ? ' on' : ''}" data-tab="${t.key}">
      <div class="cp-grid">${t.list.map(cardHtml).join('')}</div>
    </div>`).join('');
  box.innerHTML = `
    <div class="cp-mask"></div>
    <div class="cp-panel">
      <div class="cp-head">
        <b>切换地图</b>
        <span class="cp-count">${cityIndex.length} 张</span>
        <button class="cp-close">✕</button>
      </div>
      <div class="cp-tabs">${tabs.map((t, i) => `<button class="cp-tab${t.special ? ' official' : ''}${i === 0 ? ' on' : ''}" data-tab="${t.key}">${t.key} <em>${t.list.length}</em></button>`).join('')}</div>
      <div class="cp-body">${body}</div>
    </div>`;
  document.body.appendChild(box);
  box.querySelector('.cp-mask').onclick = () => box.remove();
  box.querySelector('.cp-close').onclick = () => box.remove();
  box.querySelectorAll('.cp-tab').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('.cp-tab').forEach(x => x.classList.toggle('on', x === b));
      box.querySelectorAll('.cp-pane').forEach(p => p.classList.toggle('on', p.dataset.tab === b.dataset.tab));
    };
  });
  box.querySelectorAll('.cp-card').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.city;
      if (id === CID) { box.remove(); return; }
      const u = new URL(location.href);
      u.searchParams.set('city', id);
      location.href = u.toString();
    };
  });
  addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { box.remove(); removeEventListener('keydown', esc); }
  });
}

function selectAgent(i) {
  if (multiSel.size) { multiSel.clear(); updateGroupBadge(); }
  if (i === selected) {
    // 同一个人的情况下也要能"从地点视图回到他本人"
    renderAgentCard();
    return;
  }
  // 换人 = 全新的一次选择：上一个人身上的所有临时状态一律清掉
  clearLink();                // 黑色连线
  pathKey = '';               // 路径缓存失效
  if (pathLine) pathLine.visible = false;
  if (pathRing) pathRing.visible = false;
  selected = i;
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

/**
 * UI 自适应缩放：先按视口给基准根字号，再按"内容是否装得下"整体缩放。
 * 顶栏是单行不换行布局，内容宽度随根字号线性变化，所以量一次 scrollWidth
 * 就能算出需要的比例；面板高度同理。
 */

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
  cardShownFor = -1;
  clearLink();                // 点空白：连线一并消失
  followSelected = false;
  if (multiSel.size) { multiSel.clear(); updateGroupBadge(); }   // 编组一起清掉
  const f = document.getElementById('ac-follow');
  if (f) f.textContent = '跟随镜头';
  const el = document.getElementById('agentcard');
  if (el) el.classList.add('hidden');
}

const KIND_NAME = {
  police: '警察局', hospital: '医院', school: '学校', market: '超市',
  transit: '车站', pharmacy: '药店', gov: '政府', fire: '消防',
};

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
  function behaviorBlock(i) {
    if (!sim.statusOf) return '';
    const b = sim.statusOf(i);
    const cls = b.tag === 'pol' ? 'pol' : b.tag === 'zomb' ? 'bad' : b.tag === 'flee' ? 'hot' : b.tag === 'inf' ? 'bad' : '';
    return `
      <div class="ac-row"><span>当前行为</span><em><b class="ac-chip ${cls}" style="font-size:11.5px">${b.name}</b>${b.detail ? ' <span style="color:#8a98a6">· ' + b.detail + '</span>' : ''}</em></div>`;
  }

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

  cardShownFor = selected;
  const p = profileFor(sim, selected);
  document.getElementById('ac-name').textContent = p.name;
  document.getElementById('ac-sub').textContent = p.isAnimal
    ? `${p.nameEn} · 动物 · ${p.job}`
    : `${p.nameEn} · ${p.male ? '男' : '女'} ${p.age} 岁 · ${p.job}`;
  document.getElementById('ac-vip').style.display = p.vip ? 'inline-block' : 'none';

  const px = sim.px[selected], pz = sim.pz[selected];
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

  const sp = sim.speciesOf ? sim.speciesOf(selected) : null;
  const spTxt = sp
    ? `<b class="ac-spec ${sp.cls}">${sp.label}</b>${sp.from ? ` <span style="color:#8a98a6">· ${sp.from}</span>` : ''}${sp.pet !== undefined ? ` <span style="color:#8a98a6">· ${sp.pet ? '家养' : '野生'}</span>` : ''}`
    : '';
  const sec0 = sp ? `
    <div class="ac-spec-row"><span>种族</span><em>${spTxt}</em></div>` : '';

  const sec1 = `
    <div class="ac-sec">身份</div>
    ${isAnimal
      ? `<div class="ac-row"><span>来历</span><em>${sim.pet && sim.pet[selected] ? '有主人的' : '街头的'}${kindName}，没有职业</em></div>`
      : `<div class="ac-row"><span>职业</span><em>${p.job}</em></div>
         ${kinHtml}`}`;

  const sec2 = `
    <div class="ac-sec">状态</div>
    <div class="ac-row"><span>状态</span><em>${(() => {
        const b = sim.statusOf ? sim.statusOf(selected) : null;
        if (!b) return `<b class="st-${p.stateColor}">${p.stateTxt}</b>`;
        return `<b class="st-${p.stateColor}">${p.stateTxt}</b> <span style="color:#8ff0d6">→ ${b.name}</span>${b.detail ? ` <span style="color:#8a98a6">· ${b.detail}</span>` : ''}`;
      })()}</em></div>
    <div class="ac-row"><span>行程</span><em>${sim.itineraryOf ? sim.itineraryOf(selected) : (p.social || '—')}</em></div>
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

  const bodyHtml = sec0 + sec1 + sec2 + fleeBlock(selected) + statBlock(selected) + sec3 + sec4 +
    `<div class="ac-sec">当前状态</div>` + stateChips(selected, p) +
    attrBlock(selected) + explainBlock(selected);
  const bodyEl = document.getElementById('ac-body');
  if (bodyEl && bodyHtml !== lastCardHtml) {
    const keepTop = bodyEl.scrollTop;          // 记住滚到哪，替换 DOM 后还原
    bodyEl.innerHTML = bodyHtml;
    lastCardHtml = bodyHtml;
    bodyEl.scrollTop = keepTop;
  }
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
  for (const it of poiLabelEls) {
    if (!show) { it.el.style.display = 'none'; continue; }
    _pv.set(it.x, 24, it.z).project(cam);
    const inView = _pv.z < 1 && _pv.x > -1.15 && _pv.x < 1.15 && _pv.y > -1.15 && _pv.y < 1.15;
    if (!inView) { it.el.style.display = 'none'; continue; }
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
  // 2D 最近视距按地图大小自适应：小图（莱斯特 507m）能拉到 90，视高约 8.5m
  //   大图（柏林 2401m）仍是 300（视高 28m）
  // 注意：nav 是 boot() 里的局部变量，模块作用域里没有它 —— 这里必须用 CITY_HALF
  const mapH = CITY_HALF ? CITY_HALF[1] * 2 : 900;
  const zoomLoMap = Math.max(90, Math.min(300, mapH / 6));
  const lo = retroMode ? zoomLoMap : 26;
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
let satMesh = null;
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
//  世界坐标约定：东 = +x，西 = -x，南 = +z，北 = -z（2D 模式正北朝上）
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
    <label class="p-row"><span>点位数</span><input type="range" id="o-points" min="1" max="12" step="1" value="${MOPT.points}"><b id="v-points">${MOPT.points}</b></label>`,
  stealth: () => `
    <label class="p-row"><span>零号病人</span><input type="range" id="o-carriers" min="1" max="3" step="1" value="${MOPT.carriers}"><b id="v-carriers">${MOPT.carriers}</b></label>`,
  waves: () => `
    <label class="p-row"><span>波数</span><input type="range" id="o-waves" min="1" max="12" step="1" value="${MOPT.waves}"><b id="v-waves">${MOPT.waves}</b></label>
    <label class="p-row"><span>间隔</span><input type="range" id="o-waveint" min="10" max="120" step="5" value="${MOPT.waveInterval}"><b id="v-waveint">${MOPT.waveInterval}s</b></label>`,
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
  bind('o-carriers', 'carriers');
  bind('o-waves', 'waves');
  bind('o-waveint', 'waveInterval', (v) => v + 's');
}

// ---------- 参数 ----------
const sPop = $('s-pop'), sZ0 = $('s-z0');
const sArm = $('s-arm'), sPol = $('s-pol');

// 难度档：一次调四组参数（人口 / 初始尸 / 持枪率 / 警力）
// 城市名中文化
// 城市名统一走 js/citymeta.js（国家在前、城市在后）
const cnCity = (id, fallback) => cityShort(id, fallback);   // 城市短名（不带国家）
let NEWS_NAMES = null;   // 给新闻模块用的 {full, short, paper}，boot 时填

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
    cityId: window.__CID || '',   // CID 是 boot() 里的局部变量，这里读暴露的副本
    country: window.__CID ? cityInfo(window.__CID).country : '',
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
  restoreNavBase();          // 墙壁/门窗的运行时改动在这里丢掉，回到开局的碰撞层
  sim.reset(readParams());
  resetNews(sim, NEWS_NAMES);
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
/** 把碰撞层恢复到"游戏开始时"的样子（编辑器改动全部丢弃，门场重建） */
function restoreNavBase() {
  if (overlay && overlay.clearRubble) overlay.clearRubble();
  const base = layerEdit && layerEdit.ctx && layerEdit.ctx.baseGrid;
  const nv = (sim && sim.nav) || null;      // nav 是 boot() 里的局部变量，这里要用 sim.nav
  if (!base || !nv) return false;
  nv.grid.set(base);
  if (layerEdit.ops) layerEdit.ops.length = 0;
  try { if (layerEdit.storageKey) localStorage.removeItem(layerEdit.storageKey); } catch (e) {}
  if (nv.buildDoorField) nv.buildDoorField();
  return true;
}
window.__zosRestart = () => { clearLink(); deselectAgent(); restoreNavBase(); sim.reset(readParams()); resetNews(sim, NEWS_NAMES); buildEscapeMarker(); buildPoiLabels(); hideBanner(); };
$('btn-seed').onclick = () => { clearLink(); deselectAgent(); restoreNavBase(); seed = (Math.random() * 1e9) | 0; sim.reset(readParams()); resetNews(sim, NEWS_NAMES); buildEscapeMarker(); buildPoiLabels(); hideBanner(); };
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
// 顶栏的"声音"按钮已移除：音频仍在首次交互时自动初始化（默认开启）

// ---------- 指挥工具：UI + 特效 ----------
let activeTool = 'select';
const ringPool = [], discPool = [], pingPool = [];

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
for (let i = 0; i < 20; i++) ringPool.push(makeRing());
for (let i = 0; i < 10; i++) discPool.push(makeDisc());

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
  const bg = document.getElementById('btn-gov');
  if (bg) bg.onclick = () => { if (sim) openGov(sim); };
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
      const s2 = sim.state[i];
      if (s2 !== ST.CORPSE && s2 !== ST.SAVED) { selectAgent(i); return; }
    }
  };
  const pv = document.getElementById('ac-prev');
  if (pv) pv.onclick = (ev) => { ev.stopPropagation(); step(-1); };
  const nx = document.getElementById('ac-next');
  if (nx) nx.onclick = (ev) => { ev.stopPropagation(); step(1); };


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
  // 建筑显隐由 B 键独立控制（面板里的「3D 建筑」开关已移除，这里不能再联动）
  // 雾保持常开：卫星贴图材质自己关了 fog，矢量地面才吃它
}

function setBuildings(v) {
  showBuildings = v;
  if (cityRef?.group) {
    for (const c of cityRef.group.children) {
      if (c.userData.kind === 'buildings') c.visible = v;
    }
  }
}

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
  document.documentElement.dataset.build = BUILD;
  console.log('[ZOS-R] build ' + BUILD);
  const lf = $('ld-fill'), lt = $('ld-txt');
  const Q = new URLSearchParams(location.search);
  if (Q.get('pop')) { sPop.value = Q.get('pop'); syncLabels(); }
  const setL = (p, t) => { lf.style.width = p + '%'; lt.textContent = t; };

  setL(6, '读取城市数据…');
  // ---------- 多城市：?city=<id>，默认 berlin ----------
  const CID = (Q.get('city') || 'berlin').replace(/[^a-z0-9_-]/gi, '');
  const CDIR = '数据库/cities/' + CID;
  setCountry(cityInfo(CID).country);   // 姓名池按国家切换（日本人名也用汉字；此处 city 还没加载，只用 CID）
  window.__CID = CID;   // 供模块级函数（城市选择弹窗）读取
  let cityIndex = [];
  try {
    const ir = await fetch('数据库/cities/index.json');
    if (ir.ok) { cityIndex = await ir.json(); window.__cityIndex = cityIndex; }
  } catch (e) { /* 没有索引就只跑默认城市 */ }

  const res = await fetch(CDIR + '/city.json');
  if (!res.ok) { fail('找不到 ' + CDIR + '/city.json —— 请先运行 数据库/烘焙/bake_pbf.py'); return; }
  const city = await res.json();
  // 默认三件套按面积等比缩放，基准 = 柏林（7.594 km² / 5 万人 / 1000 丧尸 / 1000 警察）
  // URL 显式给了 ?pop= 就不覆盖
  if (!Q.get('pop')) {
    const km2 = (city.size[0] * city.size[1]) / 1e6;
    const k = km2 / 7.594;                       // 面积比
    // ≤100 用精确值；>100 才按步长取整（步长只用于"好看"，不用于小数值）
    const cl = (v, el, st) => {
      const r = v <= 100 ? Math.round(v) : Math.round(v / st) * st;
      return Math.max(+el.min, Math.min(+el.max, r));
    };
    // 自动生成的人口上限 50000（手动拖动滑块不受此限制）
    sPop.value = cl(Math.min(50000, 50000 * k), sPop, 100);
    sZ0.value  = cl(1000 * k, sZ0, 10);
    sPol.value = cl(1000 * k, sPol, 10);
    if (typeof syncLabels === 'function') syncLabels();
    console.log('[ZOS-R] 面积 ' + km2.toFixed(2) + ' km²（柏林的 ' + (k * 100).toFixed(1) + '%）：人口 ' +
      (+sPop.value).toLocaleString() + ' · 丧尸 ' + sZ0.value + ' · 警察 ' + sPol.value);
  }
  if (Q.get('maxb')) city.buildings = city.buildings.slice(0, +Q.get('maxb'));
  cityRef = city;
  setL(30, `载入 ${cityFull(CID, city.name)}：${city.buildings.length.toLocaleString()} 栋建筑…`);

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
  if (!nav) nav = buildNav(city, 1);   // 兜底 1m/格

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
    {
      const sr = await fetch(CDIR + '/sat.json');
      if (sr.ok) {
        const meta = await sr.json();
        const tl = new THREE.TextureLoader();
        const tex = await tl.loadAsync(CDIR + '/' + meta.image);
        // 航测图带镂空：额外加载一张灰度遮罩，交给 alphaTest 丢弃范围外的像素
        let maskTex = null;
        if (meta.mask) {
          try { maskTex = await tl.loadAsync(CDIR + '/' + meta.mask); }
          catch (e) { console.warn('[ZOS-R] 遮罩加载失败，底图按矩形铺：', e); }
        }
        satMesh = buildSatelliteGround(city, meta, tex, maskTex);
        scene.add(satMesh);
        if (maskTex) console.log('[ZOS-R] 底图镂空已启用（' + meta.mask + '）');
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
  NEWS_NAMES = { full: cityFull(CID, city.name), short: cnCity(CID, city.name), paper: cityNewspaper(CID, city.name) };
  initNews(sim, NEWS_NAMES);

  agents = new AgentRenderer(scene, 160000);

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
    // 手绘墙之后：导航层整体重建（clearance + 8m 图 + 门 portal + 缓存），被墙盖住的人要挪出来
    onChange: () => {
      try {
        if (nav.__navWorld) {
          const ms = nav.__navWorld.rebuildAll();
          console.log('[ZOS-R] 手绘后导航图重建 ' + ms.toFixed(0) + ' ms');
        }
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
  // 调试：?boxall=1 在屏幕中央放 5 个士兵，然后用"框选"逻辑整队选中并下令（验证多选链路）
  if (Q.get('boxall')) {
    setTimeout(() => {
      if (!sim) return;
      const cx = rig.target.x, cz = rig.target.z;
      const ids = [];
      for (let k = 0; k < 5; k++) {
        const u = sim.addUnit(cx + (k - 2) * 4, cz + 6, 'soldier');
        if (u >= 0) ids.push(u);
      }
      const mode = Q.get('boxall');
      if (mode === '1') {
        const picked = unitsInRect(0, 0, window.innerWidth, window.innerHeight);
        selectAgent(picked[0]);
        multiSel.clear();
        for (const i of picked) multiSel.add(i);
        updateGroupBadge();
        const ok = picked.map((i) => sim.orderMove(i, cx + 30, cz + 30)).filter(Boolean).length;
        window.__boxDbg = 'soldiers=' + ids.length + ' pickedByRect=' + picked.length + ' ordered=' + ok;
      } else {
        window.__boxDbg = 'soldiers=' + ids.length;
      }
      const pre = document.createElement('pre');
      pre.id = 'boxdbg';
      pre.style.cssText = 'position:fixed;right:8px;bottom:120px;z-index:99;color:#9fe;background:rgba(0,0,0,.75);padding:6px;font:12px/1.3 monospace';
      pre.textContent = 'BOXTEST ' + (window.__boxDbg || '');
      document.body.appendChild(pre);
    }, 1200);
  }
  // 调试：?pickrole=police|zombie|vip|dog|flee 直接选中第一个该角色（看行为文案用）
  if (Q.get('pickrole')) {
    setTimeout(() => {
      if (!sim) return;
      const want = Q.get('pickrole');
      let hit = -1;
      for (let i = 0; i < sim.n; i++) {
        const st = sim.state[i], k = sim.kind[i];
        if (want === 'police' && (st === ST.POLICE || st === ST.SOLDIER)) { hit = i; break; }
        if (want === 'zombie' && st === ST.ZOMBIE) { hit = i; break; }
        if (want === 'flee' && st === ST.FLEE) { hit = i; break; }
        if (want === 'vip' && sim.vip && sim.vip[i]) { hit = i; break; }
        if (want === 'dog' && (k === 12 || k === 13)) { hit = i; break; }
      }
      if (hit >= 0) { selectAgent(hit); followSelected = true; }
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
      // 2D 精灵层有同屏上限（SpriteView 的 CAP）：超了就会有人画不出来，
      // 这里直接显式标出来，免得又出现"10 个人只画 5 个"的困惑
      const cap = (retro && retro.cap) || 0;
      const capTxt = sim && cap
        ? (sim.n > cap
            ? `\n⚠ 同屏上限 ${cap} < 总人数 ${sim.n}，多出的部分 2D 下不画`
            : `\n同屏：${sim.n} / 上限 ${cap}  无剪影/${(retro.noClip||0)} 缺帧/${(retro.noFrame||0)}`)
        : '';
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
        capTxt + '\n' +
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
  // 演示：现在只剩三个工具（查看 / 调度 / 空降兵），?demo 只丢这两种
  if (Q.get('demo')) {
    const fireDemo = () => {
      const ox = sim.origin[0], oz = sim.origin[1];
      sim.budget = 200;
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

  $('tb-city').textContent = cityFull(CID, city.name);   // 国家在前：德国 · 柏林·米特
  {
    // 2D 模式 / 地形 两个开关放在右侧「爆发参数 → 显示」里（不再占顶栏）
    const slot = $('disp-slot') || $('tb-tools') || $('topbar');
    const b = document.createElement('button');
    b.id = 'btn-retro';
    b.className = 'disp-btn';
    b.textContent = retroMode ? '🕹 2D 模式' : '🧊 3D 模式';   // 按钮显示当前模式
    b.title = '切换 2D / 3D 模式（Tab）';
    b.onclick = () => setRetro(!retroMode);
    slot && slot.appendChild(b);

    const b2 = document.createElement('button');
    b2.id = 'btn-overlay';
    b2.className = 'disp-btn';
    b2.textContent = '🗺 地形';
    b2.title = '叠加地形图层（C）：显示每格能不能走';
    b2.onclick = () => setOverlay(!overlayOn);
    slot && slot.appendChild(b2);

    // 城市选择：面板里一个按钮 → 打开大弹窗（缩略图网格 + 按国家分栏）
    if (cityIndex && cityIndex.length > 1) {
      const slot = document.getElementById('city-slot');
      if (slot) {
        const btn = document.createElement('button');
        btn.id = 'btn-citypick';
        btn.className = 'citypick';
        btn.title = '切换城市';
        const cur = cityIndex.find(c => c.id === CID);
        btn.innerHTML = '<span>' + (cur ? cityFull(CID, cur.name) : cityFull(CID, city.name)) +
          '</span><i>▾</i>';
        btn.onclick = openCityPicker;
        slot.appendChild(btn);
      }
    }
  }
  if (Q.get('selftest')) {
    setTimeout(() => {
      try { $('btn-restart').onclick(); console.log('[TEST] restart OK'); }
      catch (e) { console.log('[TEST] restart FAIL ' + (e && e.message)); }
    }, 2500);
  }
  if (Q.get('citypick')) setTimeout(openCityPicker, 1200);   // 调试：直接打开地图选择弹窗
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
  document.title = '生化危机模拟器 · ' + cityFull(CID, city.name);
  startLoop();
}

// 构建戳：改动后手动+1，浏览器控制台/页面属性都能看到，用来判断是不是旧缓存
const BUILD = 'b29-ui-fix';

// ---------- 主循环 ----------
let last = 0, acc = 0, frames = 0, fpsT = 0, hudT = 0, fc = 0, cardFrame = 0;
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
  // 右键平移的平滑消化：每帧吃掉一部分（指数衰减）
  //   系数越大 = 越快跟上鼠标 = 滑行越少。16 太滑 → 26，并提高收尾死区，松手很快就停。
  if (panPending.x !== 0 || panPending.z !== 0) {
    const f = 1 - Math.exp(-Math.max(0.001, dtReal) * 26);
    rig.target.x += panPending.x * f;
    rig.target.z += panPending.z * f;
    panPending.multiplyScalar(1 - f);
    if (Math.abs(panPending.x) < 0.3 && Math.abs(panPending.z) < 0.3) panPending.set(0, 0, 0);
    clampTarget();
  }
  updatePathLine();
  updateSelRings();
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
    // 但缩小到"俯瞰全城"时，近处的 3D 人物会变成亚像素的小黑点，
    // 而它们的**绿点是被 hide 掉的** —— 所以那一片人会看起来消失了。
    // 因此视距超过阈值就整片退回点阵。
    if (!retroMode) agents.unitsVisible = rig.dist < 700;
    // 视高 → 每米多少像素；交给 agents 决定"什么时候全场只剩点"
  const viewH = retroMode ? rig.dist * 0.095 : rig.dist * 0.975;
  agents.update(sim, camera.position, window.innerHeight / Math.max(1, viewH));
  }
  updateTracers();
  updateBooms(dtReal);
  // 墙体坍塌：尘雾 + 地形图层局部重绘 + HUD 计数
  if (sim && sim.wallDownQueue && sim.wallDownQueue.length) {
    for (const c of sim.wallDownQueue) {
      ping(new THREE.Vector3(c.x, 0.4, c.z), 0xbfa77a, 1.4);
      if (overlay) {
        if (overlay.markRubble) overlay.markRubble(c.c, c.r);
        if (overlay.repaintRect) overlay.repaintRect(c.c - 1, c.r - 1, c.c + 1, c.r + 1);
      }
    }
    sim.wallDownQueue.length = 0;
    const el = document.getElementById('n-wall');
    if (el) el.textContent = (sim.wallsDown || 0).toLocaleString();
  }
  updateFx(t);
  if (audio.ok) {
    const rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
    // 听者位置用 rig.target（相机盯住的地面点）：
    //   2D 模式渲染用的是 orthoCam，透视相机 camera 的位置是旧的/不动的，
    //   拿它当听者会让"整个地图的声音都在耳边"。
    const lx = Number.isFinite(rig.target.x) ? rig.target.x : 0;
    const lz = Number.isFinite(rig.target.z) ? rig.target.z : 0;
    audio.setView(lx, lz, rx, rz);
    if (sim) { sim.playerX = lx; sim.playerZ = lz; }
    audio.frame(sim);
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
    // 卡片强一致：选中的是谁就画谁（每帧校验一次，防止某条路径漏了 renderAgentCard）
    if (selected >= 0 && cardShownFor !== selected) renderAgentCard();
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
  // 卡片刷新：200ms 一次（血量/倒计时/距离变化很慢，没必要每帧拼字符串）
  if (sim && selected >= 0 && t - (lastCardT || 0) > 200) {
    lastCardT = t;
    const cEl = document.getElementById('agentcard');
    if (cEl && !cEl.classList.contains('hidden')) {
      try { renderAgentCard(); } catch (e) { window.__cardErr = String((e && e.message) || e); }
    }
  }
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
    if ($('n-saved')) $('n-saved').textContent = (sim.stats.saved || 0).toLocaleString();
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













































