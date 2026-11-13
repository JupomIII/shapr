// Temporary kernel sanity checks (run with node via esbuild bundle).
import { extrudeRegions, subtractSolids, filletEdge, chamferEdge, pushPullFace, frameXY, revolveRegions, frameXZ } from '../src/kernel/ops';
import { measureSolid, solidEdges, facesToTris, trisToSolid } from '../src/kernel/solid';
import { unionSolids } from '../src/kernel/ops';
import { exportSTEP, exportSTL } from '../src/kernel/exporters';

const rect = { outer: [[0, 0], [50, 0], [50, 30], [0, 30]] as [number, number][], holes: [] as [number, number][][] };
const s = extrudeRegions([rect], frameXY, 20);
const m = measureSolid(s);
console.log('extrude volume', m.volume.toFixed(3), 'expect 30000');
console.log('extrude area', m.area.toFixed(3), 'expect 6200');
console.log('faces', s.faces.length, 'expect 6');

const circle: [number, number][] = [];
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  circle.push([25 + Math.cos(a) * 5, 15 + Math.sin(a) * 5]);
}
const cut = extrudeRegions([{ outer: circle, holes: [] }], frameXY, 40);
const holed = subtractSolids(s, cut);
const hm = measureSolid(holed);
console.log('holed volume', hm.volume.toFixed(2), 'expect ~', (30000 - Math.PI * 25 * 20).toFixed(2));
console.log('holed faces', holed.faces.length, 'expect 7 (64-facet cylinder merges)');

const edges = solidEdges(s);
console.log('edge count', edges.length, 'expect 12');
const vertical = edges.find((e) => Math.abs(e.a[2] - e.b[2]) > 1);
console.log('vertical edge found', !!vertical, vertical?.faces.length);
if (vertical) {
  const ch = chamferEdge(s, vertical, 2);
  console.log('chamfer volume', ch ? measureSolid(ch).volume.toFixed(2) : 'FAIL', 'expect ~', (30000 - 0.5 * 4 * 20).toFixed(2));
  const fl = filletEdge(s, vertical, 2, 8);
  console.log('fillet volume', fl ? measureSolid(fl).volume.toFixed(2) : 'FAIL', 'expect ~', (30000 - (4 - Math.PI) * 20).toFixed(2));
}

const rev = revolveRegions([{ outer: [[10, 0], [20, 0], [20, 10], [10, 10]], holes: [] }], frameXZ, { a: [0, 0], b: [0, 50] }, 64);
console.log('revolve volume', measureSolid(rev).volume.toFixed(1), 'expect ~', (Math.PI * (400 - 100) * 10).toFixed(1));

const pushed = pushPullFace(s, 2, 5);
console.log('pushpull volume', pushed ? measureSolid(pushed).volume.toFixed(1) : 'FAIL', 'expect 37500');

// Regression: a fillet must not cut unrelated geometry elsewhere in the body.
const twoBoxes = unionSolids(
  extrudeRegions([rect], frameXY, 20),
  extrudeRegions([{ outer: [[80, 0], [110, 0], [110, 30], [80, 30]], holes: [] }], frameXY, 20),
);
const e2 = solidEdges(twoBoxes).find(
  (e) => Math.abs(e.a[2] - e.b[2]) > 1 && Math.abs(e.a[0]) < 1e-6 && Math.abs(e.a[1]) < 1e-6,
);
const localized = e2 ? filletEdge(twoBoxes, e2, 2, 8) : null;
// 50x30x20 box + 30x30x20 box, minus a 2 mm fillet along one 20 mm edge.
console.log(
  'localized fillet volume',
  localized ? measureSolid(localized).volume.toFixed(2) : 'FAIL',
  'expect ~',
  (30000 + 18000 - (4 - Math.PI) * 20).toFixed(2),
);

const step = exportSTEP([holed], 'test');
const stl = exportSTL([holed], 'test');
console.log('step bytes', step.data.size, 'stl bytes', stl.data.size);
const round = trisToSolid(facesToTris(holed));
console.log('roundtrip volume', measureSolid(round).volume.toFixed(2));
