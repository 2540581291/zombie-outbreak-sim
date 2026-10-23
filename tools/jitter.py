import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

# 1) 每个个体一个稳定的随机数（只算一次）
s = s.replace("    this.dummy = new THREE.Object3D();",
"""    this.dummy = new THREE.Object3D();
    // 每体的稳定随机种子：同一帧内不变，但个体之间不同
    this.seed = new Float32Array(CAP);
    this.seed2 = new Float32Array(CAP);
    for (let i = 0; i < CAP; i++) {
      const h = (i * 2654435761) >>> 0;
      this.seed[i] = ((h ^ (h >>> 13)) & 0xffff) / 65535;
      this.seed2[i] = ((h * 1597334677) >>> 0 & 0xffff) / 65535;
    }""")

# 2) 色相/明度抖动
s = s.replace("  _frames(type, anim) {",
"""  /** 在阵营基色上做个体差异：色相 ±32°、饱和 ±25%、明度 ±22% */
  _jitter(base, i) {
    const r = base[0], g = base[1], b = base[2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 1e-5) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (mx === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    const sv = mx > 1e-5 ? d / mx : 0;
    // 个体差异
    h = (h + (this.seed[i] - 0.5) * 0.18 + 1) % 1;
    let sat = Math.min(1, sv * (0.75 + this.seed2[i] * 0.55));
    let val = Math.min(1.35, mx * (0.78 + this.seed2[i] * 0.5));
    // hsv → rgb
    const f = (n) => {
      const k = (n + h * 6) % 6;
      return val - val * sat * Math.max(0, Math.min(Math.min(k, 4 - k), 1));
    };
    return [f(5), f(3), f(1)];
  }

  _frames(type, anim) {""")

# 3) 用抖动替代纯基色
s = s.replace("""      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const K = 0.35;
      let c = [
        1 * (1 - K) + base[0] * K * 1.9,
        1 * (1 - K) + base[1] * K * 1.9,
        1 * (1 - K) + base[2] * K * 1.9,
      ];""",
"""      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const jc = this._jitter(base, i % CAP);
      const K = 0.35;
      let c = [
        1 * (1 - K) + jc[0] * K * 1.9,
        1 * (1 - K) + jc[1] * K * 1.9,
        1 * (1 - K) + jc[2] * K * 1.9,
      ];""")
io.open(p, "w", encoding="utf-8").write(s)
print("个体颜色抖动已加")
