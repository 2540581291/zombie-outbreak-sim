// ============================================================
//  src/sprite/atlas.js  ——  v2 图集的加载与查询
//
//  图集由 tools/build_atlas.py 从 reference/core 生成，
//  格式见 assets/atlas/README.md。
// ============================================================

export class Atlas {
  constructor(json) {
    this.json = json;
    this.w = json.w;
    this.h = json.h;
    this.clips = json.clips;
    this.shadowRect = json.shadow || null;
    this._miss = new Set();
    this.byBody = null;
  }

  static async load(url = 'assets/atlas/atlas.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('atlas.json ' + res.status);
    return new Atlas(await res.json()).index();
  }

  /** clip key 是 "<body>/<anim>"，剪影加后缀 @sil。 */
  clip(key, sil) {
    const k = sil ? key + '@sil' : key;
    return this.clips[k] || null;
  }

  /**
   * 取 clip，缺了就退到同体型的 walk / idle01。
   * v2 图集里 68 支动画都齐（警察的 4 支僵尸动画在构建时就并成了自己的 key），
   * 所以走到兜底基本说明动画名拼错了 —— 记一条日志，别静默变形。
   */
  clipOr(key, sil) {
    const c = this.clip(key, sil);
    if (c) return c;
    const body = key.split('/')[0];
    for (const alt of ['walk', 'idle01', 'zattack01']) {
      const c2 = this.clip(body + '/' + alt, sil) || this.clip(body + '/' + alt, false);
      if (c2) {
        if (!this._miss.has(key)) {
          this._miss.add(key);
          console.warn('[sprite] 缺动画 ' + key + '，退到 ' + body + '/' + alt);
        }
        return c2;
      }
    }
    return null;
  }

  /** 动画时长（秒）= 帧数 × 帧长。 */
  dur(key) {
    const c = this.clip(key, false);
    return c ? (c.n * c.ms) / 1000 : 0;
  }

  /**
   * 热路径版查询：body/anim 直接两级属性访问，不拼字符串。
   * （20k 个体 × 每帧一次 "body/anim@sil" 拼接是白给的 GC 压力）
   */
  index() {
    this.byBody = Object.create(null);
    for (const k in this.clips) {
      const slash = k.indexOf('/');
      const body = k.slice(0, slash);
      let anim = k.slice(slash + 1);
      const sil = anim.endsWith('@sil');
      if (sil) anim = anim.slice(0, -4);
      let m = this.byBody[body];
      if (!m) m = this.byBody[body] = Object.create(null);
      m[sil ? anim + '@' : anim] = this.clips[k];
    }
    return this;
  }

  /** 两级查表；缺动画时回落到同体型的 walk。 */
  clipFast(body, anim, sil) {
    const m = this.byBody && this.byBody[body];
    if (!m) return null;
    const c = m[sil ? anim + '@' : anim];
    if (c) return c;
    const w = m[sil ? 'walk@' : 'walk'];
    if (w && !this._miss.has(body + '/' + anim)) {
      this._miss.add(body + '/' + anim);
      console.warn('[sprite] 缺动画 ' + body + '/' + anim + '，退到 walk');
    }
    return w || null;
  }

  /** 某体型某动作的帧数 / 帧长（给时序模块用）。 */
  meta(key) {
    const c = this.clip(key, false);
    return c ? { n: c.n, ms: c.ms, loop: c.loop } : null;
  }
}

