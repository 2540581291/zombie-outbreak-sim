import { loadCity } from './_city.mjs';
import { loadCollision } from '../js/collision.js';

const city = loadCity();
const nav = await loadCollision(city);
console.log('nav.cell=', nav.cell, ' cols=', nav.cols, ' rows=', nav.rows);
console.log('typeof nav.indoor =', typeof nav.indoor, ' walkable =', typeof nav.walkable, ' doorPoint =', typeof nav.doorPoint);

let b = null;
for (const bb of city.buildings) {
  const xs = bb.p.map((q) => q[0]), zs = bb.p.map((q) => q[1]);
  if (Math.max(...xs) - Math.min(...xs) > 30 && Math.max(...zs) - Math.min(...zs) > 30) { b = bb; break; }
}
const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
console.log(`楼: x ${x0.toFixed(0)}..${x1.toFixed(0)}  z ${z0.toFixed(0)}..${z1.toFixed(0)}`);

const pts = [[-363, 623], [-319, 623], [-295, 623], [-339, 575], [-299, 571], [-379, 579]];
for (const [x, z] of pts) {
  const inPoly = x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const indoor = nav.indoor ? nav.indoor(x, z) : 'n/a';
  const walk = nav.walkable ? nav.walkable(x, z) : 'n/a';
  const dp = nav.doorPoint ? nav.doorPoint(x, z) : null;
  console.log(`(${x},${z}) 楼框内=${inPoly} indoor=${indoor} walkable=${walk} door=${dp ? dp.x.toFixed(0) + ',' + dp.z.toFixed(0) : 'null'}`);
}
