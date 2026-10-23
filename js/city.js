// ============================================================
//  ZOS-R · 城市几何构建
//  OSM 数据 → Three.js 几何（挤出建筑 + 程序化立面 + 道路/水系/绿地）
// ============================================================
import * as THREE from 'three';

export const PALETTE = [
  [0.46, 0.44, 0.40], [0.52, 0.48, 0.42], [0.40, 0.40, 0.41],
  [0.55, 0.51, 0.45], [0.44, 0.42, 0.38], [0.36, 0.37, 0.38],
  [0.50, 0.45, 0.40], [0.42, 0.39, 0.35],
];

function hash(n) {
  let x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

// 2D 多边形三角化（返回三角形顶点扁平数组）
function triangulate(pts) {
  const v2 = pts.map(p => new THREE.Vector2(p[0], p[1]));
  const idx = THREE.ShapeUtils.triangulateShape(v2, []);
  const out = [];
  for (const t of idx) {
    out.push(pts[t[0]], pts[t[1]], pts[t[2]]);
  }
  return out;
}

const facadeVert = /* glsl */`
attribute float aU;
attribute float aH;
attribute float aSeed;
attribute float aRoof;
attribute vec3  aTint;
varying vec3  vN;
varying vec3  vTint;
varying vec3  vWorld;
varying float vU;
varying float vSeed;
varying float vRoof;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN     = normalize(mat3(modelMatrix) * normal);
  vTint  = aTint;
  vU     = aU;
  vSeed  = aSeed;
  vRoof  = aRoof;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const facadeFrag = /* glsl */`
precision highp float;
uniform vec3  uSun;
uniform vec3  uFog;
uniform vec3  uCam;
uniform float uNight;
uniform float uFogNear;
uniform float uFogFar;
uniform float uRoofCut;
varying vec3  vN;
varying vec3  vTint;
varying vec3  vWorld;
varying float vU;
varying float vSeed;
varying float vRoof;

float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec3  N = normalize(vN);
  vec3  col;
  vec3  emis = vec3(0.0);
  float floorH = 3.35;

  // 近处掀掉屋顶（玩偶屋视角），否则里面的人永远被盖住
  if (vRoof > 0.5 && distance(vWorld, uCam) < uRoofCut) discard;

  if (vRoof > 0.5) {
    // ---------- 屋顶 ----------
    float rdc = distance(vWorld, uCam);
    float raa = smoothstep(280.0, 950.0, rdc);
    float n = mix(h21(floor(vWorld.xz * 0.7)), 0.5, raa);
    col = vec3(0.115, 0.12, 0.13) * (0.7 + 0.7 * n);
    float blk = step(0.86, h21(floor(vWorld.xz * 0.9) + vSeed)) * (1.0 - raa);
    col += blk * 0.035;
  } else {
    // ---------- 立面 ----------
    float fy   = vWorld.y / floorH;
    float fid  = floor(fy);
    float vy   = fract(fy);
    float uu   = fract(vU / 3.05);

    float winX = step(0.16, uu) * step(uu, 0.82);
    float winY = step(0.24, vy) * step(vy, 0.84);
    float isWin = winX * winY;

    // 首层商铺（更宽的橱窗）
    float ground = step(vWorld.y, floorH);
    float shopWin = step(0.06, uu) * step(uu, 0.94) * step(vWorld.y, floorH * 0.86) * step(0.55, vWorld.y);

    vec3 wall = vTint * (0.82 + 0.30 * h21(vec2(fid * 0.7, vSeed)) + 0.10 * vy);
    // 立面竖向污渍
    wall *= 0.90 + 0.12 * h21(vec2(floor(vU * 3.0), vSeed * 3.0));

    vec3 glass = vec3(0.052, 0.068, 0.085) * (0.7 + 0.6 * h21(vec2(fid, floor(vU / 3.05))));

    col = mix(wall, glass, isWin);
    col = mix(col, vec3(0.06, 0.07, 0.08), shopWin * 0.85);

    // 夜间亮灯
    float lit = step(0.60, h21(vec2(fid, floor(vU / 3.05)) + vSeed * 11.0));
    emis += isWin * lit * uNight * vec3(1.0, 0.80, 0.50) * 2.1;
    float litShop = step(0.45, h21(vec2(fid, floor(vU * 0.7)) + vSeed * 5.0));
    emis += shopWin * litShop * uNight * vec3(1.0, 0.72, 0.38) * 2.6;

    // 远景抗锯齿：远离相机时把窗格细节淡出成平均墙面色，消除摩尔纹
    float dcam = distance(vWorld, uCam);
    float aa = smoothstep(280.0, 950.0, dcam);
    col   = mix(col, vTint * 0.92, aa * 0.90);
    emis *= (1.0 - aa);

    // 底部遮蔽（近似 AO）
    col *= mix(0.45, 1.0, smoothstep(0.0, 14.0, vWorld.y));
  }

  // ---------- 光照 ----------
  float ndl = max(dot(N, normalize(uSun)), 0.0);
  float sky = 0.40 + 0.18 * max(N.y, 0.0);
  vec3 lit  = col * (sky + 0.72 * ndl) * (1.0 - 0.40 * uNight);
  lit += emis;

  // ---------- 雾 ----------
  float d = distance(vWorld, uCam);
  float f = smoothstep(uFogNear, uFogFar, d);
  lit = mix(lit, uFog, f);

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildCity(city) {
  const group = new THREE.Group();
  const [W, H] = city.size;
  const halfW = W / 2, halfH = H / 2;
  const toW = (x, y) => [x, y];   // city.json 已经是世界坐标（z 南正），不用翻

  // ---------------- 建筑 ----------------
  const P = [], N = [], AU = [], AH = [], AS = [], AR = [], AT = [];
  let seedN = 1;

  for (const b of city.buildings) {
    const pts = b.p;
    const n = pts.length;
    if (n < 3) continue;
    const h = b.h;
    const seed = hash(seedN++);
    const tint = PALETTE[Math.floor(seed * PALETTE.length) % PALETTE.length];

    const wp = [];
    for (let i = 0; i < n; i++) {
      const [wx, wz] = toW(pts[i][0], pts[i][1]);
      wp.push([wx, wz]);
    }

    // 质心（用于判断外法线）
    let cx = 0, cz = 0;
    for (const p of wp) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;

    // 墙体
    for (let i = 0; i < n; i++) {
      const [x0, z0] = wp[i];
      const [x1, z1] = wp[(i + 1) % n];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;

      // 法线（两个候选，取背离质心的）
      let nx = dz / len, nz = -dx / len;
      const mx = (x0 + x1) / 2 - cx, mz = (z0 + z1) / 2 - cz;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }

      // 相邻楼经常共用一堵墙 → 两片完全共面 → z-fighting 闪烁。
      // 每栋楼把墙沿法线外推 1~3cm，把这个平局破掉（肉眼看不出）。
      const eps = 0.012 + (seedN % 4) * 0.006;
      const ex0 = x0 + nx * eps, ez0 = z0 + nz * eps;
      const ex1 = x1 + nx * eps, ez1 = z1 + nz * eps;

      // 两个三角形
      const quad = [
        [ex0, 0, ez0, 0], [ex1, 0, ez1, len], [ex1, h, ez1, len],
        [ex0, 0, ez0, 0], [ex1, h, ez1, len], [ex0, h, ez0, 0],
      ];
      for (const q of quad) {
        P.push(q[0], q[1], q[2]);
        N.push(nx, 0, nz);
        AU.push(q[3]);
        AH.push(h); AS.push(seed); AR.push(0);
        AT.push(tint[0], tint[1], tint[2]);
      }
    }

    // 屋顶
    const tri = triangulate(wp);
    for (const p of tri) {
      P.push(p[0], h, p[1]);
      N.push(0, 1, 0);
      AU.push(0); AH.push(h); AS.push(seed); AR.push(1);
      AT.push(tint[0], tint[1], tint[2]);
    }
  }

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  bg.setAttribute('aU', new THREE.Float32BufferAttribute(AU, 1));
  bg.setAttribute('aH', new THREE.Float32BufferAttribute(AH, 1));
  bg.setAttribute('aSeed', new THREE.Float32BufferAttribute(AS, 1));
  bg.setAttribute('aRoof', new THREE.Float32BufferAttribute(AR, 1));
  bg.setAttribute('aTint', new THREE.Float32BufferAttribute(AT, 3));
  bg.computeBoundingSphere();

  const bMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(-0.55, 0.62, 0.55).normalize() },
      uFog: { value: new THREE.Color(0x1b2028) },
      uCam: { value: new THREE.Vector3() },
      uNight: { value: 0.0 },
      uRoofCut: { value: 420 },
      uFogNear: { value: 600 },
      uFogFar: { value: 3600 },
    },
    vertexShader: facadeVert,
    fragmentShader: facadeFrag,
    side: THREE.DoubleSide,
    fog: false,
  });

  const bMesh = new THREE.Mesh(bg, bMat);
  bMesh.frustumCulled = false;
  bMesh.userData.kind = 'buildings';
  group.add(bMesh);

  // ---------------- 地面 ----------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 5, H * 5),
    new THREE.MeshBasicMaterial({ color: 0x2c3034, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.userData.kind = 'ground';
  group.add(ground);

  // ---------------- 绿地 ----------------
  const parkP = [];
  for (const z of city.parks || []) {
    const pts = z.p.map(p => toW(p[0], p[1]));
    const tri = triangulate(pts);
    for (const p of tri) parkP.push(p[0], 0.02, p[1]);
  }
  if (parkP.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(parkP, 3));
    g.computeVertexNormals();
    const pm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2d3d28, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    pm.userData.kind = 'parks';
    group.add(pm);
  }

  // ---------------- 水系 ----------------
  const waterP = [];
  for (const z of city.water || []) {
    const pts = z.p.map(p => toW(p[0], p[1]));
    const tri = triangulate(pts);
    for (const p of tri) waterP.push(p[0], 0.04, p[1]);
  }
  if (waterP.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(waterP, 3));
    g.computeVertexNormals();
    const wm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1b2c3a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    wm.userData.kind = 'water';
    group.add(wm);
  }

  // ---------------- 道路 ----------------
  const roadP = [];
  for (const r of city.roads || []) {
    const pts = r.p;
    const w = r.w / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = toW(pts[i][0], pts[i][1]);
      const [x1, z1] = toW(pts[i + 1][0], pts[i + 1][1]);
      let dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      dx /= len; dz /= len;
      const nx = -dz * w, nz = dx * w;
      const y = 0.03;
      // 四边形 → 两个三角形
      const a = [x0 + nx, y, z0 + nz], b = [x1 + nx, y, z1 + nz];
      const c = [x1 - nx, y, z1 - nz], d = [x0 - nx, y, z0 - nz];
      roadP.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  if (roadP.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(roadP, 3));
    g.computeVertexNormals();
    const rm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4b5056, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    rm.userData.kind = 'roads';
    group.add(rm);
  }

  // ---------------- 树 ----------------
  const trees = city.trees || [];
  if (trees.length) {
    const tg = new THREE.ConeGeometry(1.7, 5.2, 5);
    tg.translate(0, 2.6, 0);
    const tm = new THREE.MeshLambertMaterial({ color: 0x1c2b1a });
    const inst = new THREE.InstancedMesh(tg, tm, Math.min(trees.length, 24000));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let k = 0;
    for (const t of trees) {
      if (k >= inst.count) break;
      const [wx, wz] = toW(t[0], t[1]);
      const sc = 0.6 + hash(k * 3.7) * 0.8;
      s.set(sc, 0.7 + hash(k * 1.3) * 0.7, sc);
      m.compose(new THREE.Vector3(wx, 0, wz), q, s);
      inst.setMatrixAt(k++, m);
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.kind = 'trees';
    group.add(inst);
  }

  return { group, buildingMat: bMat, size: [W, H] };
}







// ============================================================
//  卫星影像地面（按 sat.json 的经纬度边界铺到世界坐标）
// ============================================================
export function buildSatelliteGround(city, meta, tex) {
  const [lon0, lat0] = city.origin;
  const [W, H] = city.size;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320;
  const ky = 110540;
  const toWorld = (lon, lat) => [
    (lon - lon0) * kx,
    -((lat - lat0) * ky),
  ];
  const [w, s, e, n] = meta.bounds;
  // 卫星图比城市大一圈（瓦片对齐），按城市 bbox 裁掉，保证"看到的 = 能走的"
  const [cMinLat, cMinLon, cMaxLat, cMaxLon] = city.bbox;
  const u0 = (cMinLon - w) / (e - w), u1 = (cMaxLon - w) / (e - w);
  const v0 = (cMinLat - s) / (n - s), v1 = (cMaxLat - s) / (n - s);
  const nw = toWorld(cMinLon, cMaxLat), ne = toWorld(cMaxLon, cMaxLat);
  const se = toWorld(cMaxLon, cMinLat), sw = toWorld(cMinLon, cMinLat);
  const y = 0.012;
  const pos = [
    nw[0], y, nw[1],
    ne[0], y, ne[1],
    se[0], y, se[1],
    sw[0], y, sw[1],
  ];
  // u=0 西, v=1 北（three 默认 flipY，图片顶行对应 v=1）
  const uv = [u0, v1, u1, v1, u1, v0, u0, v0];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);

  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  const m = new THREE.MeshBasicMaterial({
    map: tex,
    toneMapped: false,      // 卫星图保持原色，不被 ACES 压暗
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.kind = 'satellite';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}






// ---------------- 建筑名中文化 ----------------
// OSM 的名字是德语/日语/英语，游戏里一律显示中文：
//   认识的词根走词典，不认识的按"类型 + 序号"生成，保证不出现拉丁字母。
export const KIND_CN = {
  police: '警察局', hospital: '医院', school: '学校', market: '超市',
  transit: '车站', pharmacy: '药店', gov: '政府大楼', fire: '消防站',
};
const WORD_CN = [
  [/polizei|police/i, '警察局'], [/krankenhaus|hospital|clinic/i, '医院'],
  [/schule|school|gymnasium|lycee/i, '学校'], [/universit|hochschule|college/i, '学院'],
  [/markt|market|supermarkt|kaufhaus|store|shop/i, '超市'],
  [/bahnhof|station|hauptbahnhof|u-bahn|s-bahn/i, '车站'],
  [/apotheke|pharmacy|drogerie/i, '药店'], [/rathaus|amt|behörde|ministerium/i, '政府大楼'],
  [/feuerwehr|fire/i, '消防站'], [/kirche|church|dom|kapelle/i, '教堂'],
  [/museum/i, '博物馆'], [/theater|oper|bühne/i, '剧院'], [/bibliothek|library/i, '图书馆'],
  [/park|garten|grün/i, '公园'], [/hotel/i, '酒店'], [/bank/i, '银行'],
  [/restaurant|café|cafe|imbiss/i, '餐馆'], [/tankstelle/i, '加油站'],
  [/friedhof|cemetery/i, '墓地'], [/post/i, '邮局'], [/bad|schwimm/i, '游泳馆'],
];

/** 给一座城市的所有 POI/街道名换成中文（就地修改） */
export function localizeCityNames(city) {
  if (!city) return city;
  const isLatin = (s) => /[A-Za-zÀ-ÿĀ-ſ]/.test(s) || /[\u3040-\u30ff]/.test(s);
  const byKind = new Map();
  const list = city.pois || [];
  for (const p of list) {
    const kind = KIND_CN[p.k] || '建筑';
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    const n = byKind.get(kind);
    const raw = p.n || '';
    if (!isLatin(raw)) continue;            // 已经是中文就不动
    let hit = null;
    for (const [re, cn] of WORD_CN) { if (re.test(raw)) { hit = cn; break; } }
    p.n = hit ? (hit + ' ' + n + ' 号') : (kind + ' ' + n + ' 号');
  }
  // 街道名
  if (Array.isArray(city.streets)) {
    let i = 0;
    for (const s of city.streets) {
      if (typeof s === 'string' && isLatin(s)) city.streets[i] = '第 ' + (++i) + ' 街';
      else if (s && typeof s.n === 'string' && isLatin(s.n)) s.n = '第 ' + (++i) + ' 街';
    }
  }
  return city;
}
