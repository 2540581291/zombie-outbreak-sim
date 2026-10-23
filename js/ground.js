// ============================================================
//  ZOS-R · 分块地面
//  远景用一张缩略图（overview），近景按视野加载 4096px 瓦片。
//  单张纹理不再超过浏览器的解码上限，显存也按需占用。
// ============================================================
import * as THREE from 'three';

const MAX_TILES = 14;          // 同时驻留的瓦片数（14 × 4096² ≈ 940 MB 峰值）
const TILE_ZOOM_DIST = 1800;   // 相机距离小于这个值才开始加载瓦片

export class TiledGround {
  constructor(scene, city, tileset) {
    this.group = new THREE.Group();
    this.group.visible = true;
    scene.add(this.group);
    this.city = city;
    this.ts = tileset;

    const [lon0, lat0] = city.origin;
    this.kx = Math.cos(lat0 * Math.PI / 180) * 111320;
    this.ky = 110540;
    this.lon0 = lon0;
    this.lat0 = lat0;

    const [w, s, e, n] = tileset.bounds;
    this.wl = w; this.sl = s; this.el = e; this.nl = n;
    this.cols = tileset.cols;
    this.rows = tileset.rows;
    this.TN = tileset.tileSize;
    this.imgW = tileset.imageW;
    this.imgH = tileset.imageH;

    this.loaded = new Map();   // key -> { mesh, tex, used }
    this.pending = new Set();
    this.overview = null;
    this.frame = 0;
  }

  // 像素坐标 → 世界坐标
  _world(px, py) {
    const lon = this.wl + (this.el - this.wl) * (px / this.imgW);
    const lat = this.nl - (this.nl - this.sl) * (py / this.imgH);
    return [(lon - this.lon0) * this.kx, -((lat - this.lat0) * this.ky)];
  }

  _tileRect(c, r) {
    const x0 = c * this.TN, y0 = r * this.TN;
    const x1 = Math.min(this.imgW, x0 + this.TN);
    const y1 = Math.min(this.imgH, y0 + this.TN);
    const nw = this._world(x0, y0);
    const se = this._world(x1, y1);
    return { nw, se, x0, y0, x1, y1 };
  }

  async load() {
    // 远景缩略图
    const tex = await new THREE.TextureLoader().loadAsync(`${this.ts.dir}/overview.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;

    const nw = this._world(0, 0), se = this._world(this.imgW, this.imgH);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      nw[0], 0.010, nw[1], se[0], 0.010, nw[1],
      se[0], 0.010, se[1], nw[0], 0.010, se[1],
    ], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.MeshBasicMaterial({
      map: tex, toneMapped: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.kind = 'ground-overview';
    this.group.add(mesh);
    this.overview = mesh;
    return this;
  }

  _loadTile(c, r) {
    const key = c + '_' + r;
    if (this.loaded.has(key) || this.pending.has(key)) return;
    this.pending.add(key);
    const url = `${this.ts.dir}/${this.ts.pattern.replace('{c}', c).replace('{r}', r)}`;
    new THREE.TextureLoader().load(url, (tex) => {
      this.pending.delete(key);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;

      const { nw, se } = this._tileRect(c, r);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        nw[0], 0.014, nw[1], se[0], 0.014, nw[1],
        se[0], 0.014, se[1], nw[0], 0.014, se[1],
      ], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.MeshBasicMaterial({
        map: tex, toneMapped: false, fog: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData.kind = 'ground-tile';
      this.group.add(mesh);
      this.loaded.set(key, { mesh, tex, used: this.frame });
      this._evict();
    }, undefined, () => {
      this.pending.delete(key);      // 加载失败就别再重试
      this.loaded.set(key, { mesh: null, tex: null, used: this.frame });
    });
  }

  // 超出上限就卸载最久没用的
  _evict() {
    if (this.loaded.size <= MAX_TILES) return;
    const arr = [...this.loaded.entries()]
      .filter(([, v]) => v.mesh)
      .sort((a, b) => a[1].used - b[1].used);
    while (this.loaded.size > MAX_TILES && arr.length) {
      const [k, v] = arr.shift();
      this.group.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.tex.dispose();
      this.loaded.delete(k);
    }
  }

  /** 每帧调用：按视野决定加载/隐藏哪些瓦片 */
  update(cam) {
    this.frame++;
    const dist = cam.dist || 0;
    const tileTime = dist > 0 && dist < TILE_ZOOM_DIST;

    if (this.overview) this.overview.visible = dist >= TILE_ZOOM_DIST;

    if (!tileTime) {
      // 拉远了：把所有瓦片收掉，省显存
      for (const [k, v] of this.loaded) {
        if (v.mesh) {
          this.group.remove(v.mesh);
          v.mesh.geometry.dispose();
          v.tex.dispose();
        }
        this.loaded.delete(k);
      }
      return;
    }

    const R = Math.max(cam.halfW || 0, cam.halfH || 0) * 1.5 + 200;
    const cx = cam.cx, cz = cam.cz;
    // 用整幅图的世界包围盒换算，不假设它以原点对称
    const x0w = (this.wl - this.lon0) * this.kx;
    const x1w = (this.el - this.lon0) * this.kx;
    const z0w = -((this.nl - this.lat0) * this.ky);
    const z1w = -((this.sl - this.lat0) * this.ky);
    const perX = (x1w - x0w) / this.cols;
    const perZ = (z1w - z0w) / this.rows;

    const c0 = Math.max(0, Math.floor((cx - R - x0w) / perX));
    const c1 = Math.min(this.cols - 1, Math.ceil((cx + R - x0w) / perX));
    const r0 = Math.max(0, Math.floor((cz - R - z0w) / perZ));
    const r1 = Math.min(this.rows - 1, Math.ceil((cz + R - z0w) / perZ));

    // 窗口太大就裁到相机附近，保证不超过驻留上限（否则每帧都在换）
    let cc0 = c0, cc1 = c1, rr0 = r0, rr1 = r1;
    while ((cc1 - cc0 + 1) * (rr1 - rr0 + 1) > MAX_TILES) {
      if (cc1 - cc0 > rr1 - rr0) {
        if (Math.abs(cx - (x0w + (cc0 + 0.5) * perX)) < Math.abs(cx - (x0w + (cc1 + 0.5) * perX))) cc1--;
        else cc0++;
      } else {
        if (Math.abs(cz - (z0w + (rr0 + 0.5) * perZ)) < Math.abs(cz - (z0w + (rr1 + 0.5) * perZ))) rr1--;
        else rr0++;
      }
    }

    for (let r = rr0; r <= rr1; r++) {
      for (let c = cc0; c <= cc1; c++) {
        const key = c + '_' + r;
        const hit = this.loaded.get(key);
        if (hit) { hit.used = this.frame; continue; }
        this._loadTile(c, r);
      }
    }
  }

  set visible(v) { this.group.visible = !!v; }
  get visible() { return this.group.visible; }

  get stats() {
    let n = 0, bytes = 0;
    for (const v of this.loaded.values()) {
      if (v.mesh) { n++; bytes += this.TN * this.TN * 4; }
    }
    return { tiles: n, memMB: Math.round(bytes / 1048576) };
  }
}

