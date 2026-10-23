// ============================================================
//  src/sprite/layers.js  ——  四层实例化网格
//
//  actor   活人/丧尸/动物：贴地 quad，按朝向旋转，opaque + depthWrite
//  decal   尸体：同一套 shader，y 压低一点，永远压在 actor 下面
//  shadow  阴影：单独的透明材质（主材质是 discard + 不透明，会把阴影切成硬边）
//  dots    远看时的纯色圆点
//
//  shader 与旧 retro.js 逐字一致（衣服换色 / 皮肤保护 / discard 0.45），
//  因为 2D 的观感就是靠这几行维持的。
// ============================================================
import * as THREE from 'three';

const SPRITE_VERT = /* glsl */`
attribute vec4 aRect;
attribute vec3 aTint;
attribute float aHue;
varying vec2 vUv;
varying vec3 vTint;
varying float vHue;
uniform vec2 uAtlas;
void main() {
  float vy = aRect.y + (1.0 - uv.y) * aRect.w;
  vUv = vec2(aRect.x + uv.x * aRect.z, vy) / uAtlas;
  vTint = aTint;
  vHue = aHue;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SPRITE_FRAG = /* glsl */`
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
  // 只处理"有颜色、不太暗"的像素：描边和阴影不参与换色，否则会发黑
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mx = max(max(col.r, col.g), col.b);
  float mn = min(min(col.r, col.g), col.b);
  float sat = mx > 0.02 ? (mx - mn) / mx : 0.0;
  float cloth = step(0.16, lum) * smoothstep(0.10, 0.28, sat);
  // 皮肤保护
  float skin = 1.0 - smoothstep(0.09, 0.20, distance(col, vec3(0.95, 0.80, 0.62)));
  vec3 warm = vec3(1.0 + vHue * 0.45, 1.0 + vHue * 0.10, 1.0 - vHue * 0.35);
  vec3 cool = vec3(1.0 - vHue * 0.35, 1.0 + vHue * 0.15, 1.0 + vHue * 0.45);
  vec3 mulv = mix(warm, cool, step(0.0, vHue));
  mulv = clamp(mulv, 0.55, 1.55);
  col = mix(col, clamp(col * mulv, 0.0, 1.0), cloth * (1.0 - skin));
  gl_FragColor = vec4(col * vTint, 1.0);
}
`;

const SHADOW_VERT = /* glsl */`
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRect;      // 阴影贴图在图集里的 (x, y, w, h)
uniform vec2 uAtlas;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = (uRect.xy + vec2(vUv.x, 1.0 - vUv.y) * uRect.zw) / uAtlas;
  float a = texture2D(uTex, p).a;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.07), a * uAlpha * vA);
}
`;

const DOT_VERT = /* glsl */`
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv; vCol = aColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const DOT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float d = length(vUv - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.40, d);
  gl_FragColor = vec4(vCol * (0.85 + a * 0.35), 1.0);
}
`;

function quadGeometry() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);        // 摊平到 XZ 平面：精灵是"贴在地上的图"
  return g;
}

/** 一组实例化精灵网格（actor / decal 共用这套 shader）。 */
export function makeSpriteMesh(cap, tex, atlasW, atlasH, y) {
  const geo = quadGeometry();
  const rects = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const hues = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  rects.setUsage(THREE.DynamicDrawUsage);
  tints.setUsage(THREE.DynamicDrawUsage);
  hues.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRect', rects);
  geo.setAttribute('aTint', tints);
  geo.setAttribute('aHue', hues);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uAtlas: { value: new THREE.Vector2(atlasW, atlasH) } },
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: false, depthWrite: true, depthTest: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.userData.y = y;
  return { mesh, rects, tints, hues };
}

/** 阴影层：透明 + 不写深度，先于 actor 绘制。 */
export function makeShadowMesh(cap, tex, atlasW, atlasH, rect) {
  const geo = quadGeometry();
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', alpha);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex },
      uAtlas: { value: new THREE.Vector2(atlasW, atlasH) },
      uRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) },
      uAlpha: { value: 0.6 },
    },
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 1;           // 在 opaque 之后、按透明排序，depthTest 会挡住被身体覆盖的部分
  return { mesh, alpha };
}

/** 远看的纯色圆点。 */
export function makeDotMesh(cap) {
  const geo = quadGeometry();
  const col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aColor', col);
  const mat = new THREE.ShaderMaterial({
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG,
    depthWrite: true, depthTest: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, col };
}


