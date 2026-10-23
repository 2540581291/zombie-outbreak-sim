// ============================================================
//  ZOS-R · 地形图层叠加
//  把碰撞层（每格一个字节）直接画成一张覆盖全城的贴图，
//  一眼看出哪些格子不能走。
// ============================================================
import * as THREE from 'three';
import { CL } from './collision.js';

// 每格的调试配色（alpha 越大越"堵"）
const COLORS = {
  [CL.WALL]:   [0.90, 0.10, 0.10, 0.95],   // 墙 / 栅栏 —— 不可通行
  [CL.WATER]:  [0.10, 0.40, 1.00, 0.95],   // 水 —— 不可通行
  [CL.FENCE]:  [0.95, 0.80, 0.15, 0.80],   // 围栏 —— 不可通行（但通视线）
  [CL.WINDOW]: [0.20, 0.95, 0.95, 0.80],   // 窗 —— 不可通行
  [CL.DOOR]:   [0.20, 1.00, 0.35, 0.85],   // 门 —— 可通行
  [CL.INSIDE]: [1.00, 0.55, 0.10, 0.45],   // 室内 —— 可通行
  [CL.COVER]:  [0.20, 0.70, 0.25, 0.35],   // 林地 —— 可通行
  [CL.OPEN]:   [0.85, 0.85, 0.85, 0.10],   // 空地 —— 可通行（几乎透明）
};

export class TerrainOverlay {
  constructor(scene, nav, city) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const { cols, rows, grid, cell } = nav;
    const [W, H] = city.size;
    const data = new Uint8Array(cols * rows * 4);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r * cols + c];
        const col = COLORS[v] || [1, 0, 1, 0.6];
        const j = (r * cols + c) * 4;
        data[j] = col[0] * 255;
        data[j + 1] = col[1] * 255;
        data[j + 2] = col[2] * 255;
        data[j + 3] = col[3] * 255;
      }
    }

    const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.tex = tex;
    // 编辑模式要局部重画，所以留着 data / 尺寸
    this.data = data;
    this.nav = nav;
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.halfW = nav.halfW;
    this.halfH = nav.halfH;

    const geo = new THREE.PlaneGeometry(W, H);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.3;          // 在地面之上、单位之下，不遮住小人
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.mesh = mesh;

    this.refreshStats();
  }

  /** 世界坐标 → 格子下标（和 collision.js 的 idx 同一套：第 0 行在南边） */
  cellAt(x, z) {
    return [
      Math.floor((x + this.halfW) / this.cell),
      Math.floor((this.halfH - z) / this.cell),
    ];
  }

  /** 把 nav.grid 的某块重新灌进贴图（编辑模式每涂一笔调用一次） */
  repaintRect(c0, r0, c1, r1) {
    const { cols, rows, nav, data } = this;
    const a = Math.max(0, Math.min(c0, c1)), b = Math.min(cols - 1, Math.max(c0, c1));
    const c = Math.max(0, Math.min(r0, r1)), d = Math.min(rows - 1, Math.max(r0, r1));
    for (let r = c; r <= d; r++) {
      for (let col = a; col <= b; col++) {
        const v = nav.grid[r * cols + col];
        const col4 = COLORS[v] || [1, 0, 1, 0.6];
        const j = (r * cols + col) * 4;
        data[j] = col4[0] * 255;
        data[j + 1] = col4[1] * 255;
        data[j + 2] = col4[2] * 255;
        data[j + 3] = col4[3] * 255;
      }
    }
    this.tex.needsUpdate = true;
  }

  refreshStats() {
    const grid = this.nav.grid;
    let block = 0, room = 0;
    for (let i = 0; i < grid.length; i++) {
      if (!(grid[i] & CL.WALK)) block++;
      if (grid[i] === CL.INSIDE) room++;
    }
    this.stats = { block, room, total: grid.length, pct: block / grid.length * 100,
                   roomPct: room / grid.length * 100 };
    return this.stats;
  }

  set visible(v) { this.group.visible = !!v; }
  get visible() { return this.group.visible; }
}
