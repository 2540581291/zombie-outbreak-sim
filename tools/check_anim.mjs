// 校验步态频率
import { readFileSync } from 'node:fs';
const sp = await import('../js/species.js');
for (const [k, v] of Object.entries(sp.SPECIES)) {
  const stride = 1.45 * (v.scale || 1);
  const hz = v.speed / stride;
  console.log(`${v.name.padEnd(4)} 速度 ${v.speed.toFixed(1)}m/s  步幅 ${stride.toFixed(2)}m  → ${hz.toFixed(2)} 周期/秒`);
}
