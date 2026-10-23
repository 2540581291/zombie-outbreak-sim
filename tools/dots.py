import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

# 1) 远距离改用纯色圆点：第二条 InstancedMesh
s = s.replace("const MIN_SCREEN_PX = 6.0;",
"""const MIN_SCREEN_PX = 6.0;      // 精灵至少占这么多像素
const DOT_BELOW_PX = 2.2;       // 自然尺寸低于这个就改画纯色圆点
const DOT_PX = 5.0;             // 圆点直径（屏幕像素）""")

s = s.replace("""    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);""",
"""    // ---- 远距离用的纯色圆点 ----
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

    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);""")

# 2) update：两条通道分开写
s = s.replace("    let k = 0;", "    let k = 0, dk = 0;\n    const dots = this.dotCol.array;\n    const dotWorld = DOT_PX / Math.max(pxPerM, 1e-4);")
s = s.replace("""      let scaleX = px * M_PER_PX * (sp.scale || 1);
      let scaleZ = py * M_PER_PX * (sp.scale || 1);
      // 远看：放大到最小屏幕尺寸（保持长宽比），变成一块能分辨的颜色
      const big = Math.max(scaleX, scaleZ);
      if (big < minWorld) {
        const k = minWorld / big;
        scaleX *= k; scaleZ *= k;
      }""",
"""      let scaleX = px * M_PER_PX * (sp.scale || 1);
      let scaleZ = py * M_PER_PX * (sp.scale || 1);
      const naturalPx = Math.max(scaleX, scaleZ) * pxPerM;

      // 极远：画纯色圆点（放大精灵在这个尺度只会糊成毛边）
      if (naturalPx < DOT_BELOW_PX) {
        if (dk >= CAP) continue;
        dummy.position.set(x, 0.7, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(dotWorld, 1, dotWorld);
        dummy.updateMatrix();
        dummy.matrix.toArray(this.dotMesh.instanceMatrix.array, dk * 16);
        // 颜色与精灵一致
        const b2 = UNIT_COLOR[colorClassOf(kind, st)] || [1, 1, 1];
        dots[dk * 3] = b2[0]; dots[dk * 3 + 1] = b2[1]; dots[dk * 3 + 2] = b2[2];
        dk++;
        continue;
      }

      // 远看但还没到圆点档：等比放大到最小屏幕尺寸
      const big = Math.max(scaleX, scaleZ);
      if (big < minWorld) {
        const kk = minWorld / big;
        scaleX *= kk; scaleZ *= kk;
      }""")

# 3) 收尾：写入两条通道的 count
s = s.replace("""    this.mesh.count = k;
    this.count = k;""",
"""    this.mesh.count = k;
    this.dotMesh.count = dk;
    this.dotMesh.instanceMatrix.needsUpdate = true;
    this.dotCol.needsUpdate = true;
    this.count = k + dk;""")

# 4) 导入配色
s = s.replace("import { SP, SPECIES, TEAM, UNIT_COLOR, colorClassOf } from './species.js';",
              "import { SP, SPECIES, TEAM, UNIT_COLOR, colorClassOf } from './species.js';")
io.open(p, "w", encoding="utf-8").write(s)
print("圆点通道已加")
