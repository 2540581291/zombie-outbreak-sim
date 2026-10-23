import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';
const city = loadCity();
const nav = await loadCollision(city);
console.log(`城市 ${city.size[0].toFixed(0)}×${city.size[1].toFixed(0)} m  建筑 ${city.buildings.length}  水线 ${(city.water_lines||[]).length} 条`);
console.log(`碰撞层 ${nav.cols}×${nav.rows} @${nav.cell}m  = ${(nav.cols*nav.cell).toFixed(0)}×${(nav.rows*nav.cell).toFixed(0)} m`);
let block = 0; for (let i = 0; i < nav.grid.length; i++) if (!(nav.grid[i] & 1)) block++;
console.log(`不可通行 ${(block/nav.grid.length*100).toFixed(1)}%`);
// 四角必须不可走（地图边界外）
console.log('四角:', [nav.walkable(-nav.halfW+1,-nav.halfH+1), nav.walkable(nav.halfW-1,-nav.halfH+1),
  nav.walkable(-nav.halfW+1,nav.halfH-1), nav.walkable(nav.halfW-1,nav.halfH-1)].join(','));
