import { UNIT_COLOR, colorClassOf, SP } from '../js/species.js';
const cases = [
  ["平民", SP.CIV1, 0], ["平民逃跑", SP.CIV2, 1], ["潜伏", SP.CIV1, 7],
  ["警察", SP.POLICE, 3], ["士兵", SP.SOLDIER, 6], ["重装", SP.ELITE, 6],
  ["丧尸", SP.ZOMBIE, 4], ["坦克", SP.TANK, 4], ["冲锋者", SP.CHARGER, 4],
  ["自爆者", SP.BOOMER, 4], ["喷吐者", SP.SPITTER, 4],
  ["狗", SP.DOG, 0], ["丧尸狗", SP.DOG, 4], ["熊", SP.BEAR, 9], ["虎", SP.TIGER, 9],
  ["装甲车", SP.APC, 6], ["尸体", SP.CIV1, 5],
];
for (const [name, k, st] of cases) {
  const cls = colorClassOf(k, st);
  const c = UNIT_COLOR[cls].map(v => Math.round(v * 255));
  console.log(`${name.padEnd(6)} → ${cls.padEnd(8)} rgb(${c.join(",")})`);
}
