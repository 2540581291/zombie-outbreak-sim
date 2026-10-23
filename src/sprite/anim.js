// ============================================================
//  src/sprite/anim.js  ——  帧号计算（纯函数，没有 three 依赖）
//
//  三条规则，和原版 _si973.draw() 对齐：
//    * 循环动画： floor(t / ms) % n
//    * 一次性动画：min(n-1, floor(t / ms))   ← 末帧定格
// ============================================================

/** 按"已过秒数"取帧号。t 单位秒，clip.ms 是毫秒。 */
export function frameAt(clip, t) {
  const n = clip.n;
  const ms = clip.ms || 150;
  let f = Math.floor((t * 1000) / ms);
  if (clip.loop) return ((f % n) + n) % n;
  return f < 0 ? 0 : (f >= n ? n - 1 : f);
}

/** 阶段动画的进度（0..1），给透明度/时序判断用。 */
export function stageProgress(clip, t) {
  const d = (clip.n * clip.ms) / 1000;
  if (d <= 0) return 1;
  return Math.min(1, Math.max(0, t / d));
}

/** 一次性动画的总秒数。 */
export function duration(clip) {
  return (clip.n * clip.ms) / 1000;
}
