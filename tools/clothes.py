import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

# 1) 顶点着色器：增加 per-instance 色相偏移
s = s.replace("""attribute vec4 aRect;      // xy = 图集位置, zw = 尺寸
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
uniform vec2 uAtlas;
void main() {
  vUv = (aRect.xy + uv * aRect.zw) / uAtlas;
  vTint = aTint;""",
"""attribute vec4 aRect;      // xy = 图集位置, zw = 尺寸
attribute vec3 aTint;
attribute float aHue;      // 每件"衣服"的色相偏移（弧度）
varying vec2 vUv;
varying vec3 vTint;
varying float vHue;
uniform vec2 uAtlas;
void main() {
  vUv = (aRect.xy + uv * aRect.zw) / uAtlas;
  vTint = aTint;
  vHue = aHue;""")

# 2) 片元着色器：衣服换色，皮肤保护区
s = s.replace("""const frag = /* glsl */`
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec4 c = texture2D(uTex, vUv);
  if (c.a < 0.45) discard;
  gl_FragColor = vec4(c.rgb * vTint, 1.0);
}
`;""",
"""const frag = /* glsl */`
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
  // 皮肤保护：接近肤色的像素不做色相旋转，否则脸会变绿变紫
  float skin = 1.0 - smoothstep(0.09, 0.20, distance(col, vec3(0.95, 0.80, 0.62)));
  col = mix(hueShift(col, vHue), col, skin);
  gl_FragColor = vec4(col * vTint, 1.0);
}
`;""")

# 3) 属性缓冲
s = s.replace("""    const tints = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);""",
"""    const tints = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    const hues = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);""")
s = s.replace("""    geo.setAttribute('aTint', tints);""",
"""    geo.setAttribute('aTint', tints);
    geo.setAttribute('aHue', hues);""")
s = s.replace("""    this.rects = rects;
    this.tints = tints;""",
"""    this.rects = rects;
    this.tints = tints;
    this.hues = hues;""")

# 4) 阵营色恢复为固定值（不再抖动），颜色抖动改走 aHue
s = s.replace("""      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const jc = this._jitter(base, i % CAP);
      const K = 0.35;
      let c = [
        1 * (1 - K) + jc[0] * K * 1.9,
        1 * (1 - K) + jc[1] * K * 1.9,
        1 * (1 - K) + jc[2] * K * 1.9,
      ];""",
"""      // 阵营色固定（按属性）：平民绿 / 警察蓝 / 军绿 / 丧尸红 / 特感紫
      const base = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
      const K = 0.35;
      let c = [
        1 * (1 - K) + base[0] * K * 1.9,
        1 * (1 - K) + base[1] * K * 1.9,
        1 * (1 - K) + base[2] * K * 1.9,
      ];
      // 衣服随机：每个个体一个色相偏移（±50°），皮肤不受影响
      hues[k] = (this.seed[i] - 0.5) * 1.75;""")

# 5) 圆点里也用 seed 抖一点明度（保持可读性，不偏色相）
s = s.replace("""        const b2 = this._jitter(UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1], i % CAP);""",
"""        const b0 = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
        const v = 0.82 + this.seed2[i] * 0.38;
        const b2 = [b0[0] * v, b0[1] * v, b0[2] * v];""")

# 6) needsUpdate
s = s.replace("    this.tints.needsUpdate = true;", "    this.tints.needsUpdate = true;\n    this.hues.needsUpdate = true;")
io.open(p, "w", encoding="utf-8").write(s)
print("衣服换色已改为 shader 实现")
