// Sketch-engine sanity checks (run with node via esbuild bundle).
import { addCircle, addLine, addRectangle } from '../src/sketch/create';
import { sketchRegions } from '../src/sketch/geometry';
import { openEndpoints, sketchDiagnostics } from '../src/sketch/diagnostics';
import { Sketch } from '../src/sketch/types';

const emptySketch = (): Sketch => ({
  id: 'sk',
  name: 'Sketch 001',
  plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  planeLabel: 'XY',
  points: {},
  entities: [],
  constraints: [],
  visible: true,
});

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------ profile holes ----------------------------- */

const holed = emptySketch();
addRectangle(holed, [-45, -28], [45, 28]);
addCircle(holed, [0, 0], 14);
const holedRegions = sketchRegions(holed);
check('rectangle with inner circle is one profile', holedRegions.length === 1, `${holedRegions.length} regions`);
check('inner circle becomes a hole', holedRegions[0]?.holes.length === 1, `${holedRegions[0]?.holes.length} holes`);
const outer = holedRegions[0].outer;
const outerArea = Math.abs(
  outer.reduce((sum, p, i) => {
    const q = outer[(i + 1) % outer.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2,
);
check('hole does not change the outer loop', Math.abs(outerArea - 90 * 56) < 1e-6, outerArea.toFixed(3));

/* ----------------------------- open sketch ends --------------------------- */

const rect = emptySketch();
addRectangle(rect, [-40, -25], [40, 25]);
check('closed rectangle has no open ends', openEndpoints(rect).length === 0, `${openEndpoints(rect).length}`);

addLine(rect, [10, 40], [60, 40]);
check('stray line reports two open ends', openEndpoints(rect).length === 2, `${openEndpoints(rect).length}`);
check('stray line does not create a second profile', sketchRegions(rect).length === 1, `${sketchRegions(rect).length}`);

/* --------------------------- constraint state ----------------------------- */

const under = sketchDiagnostics(rect);
check('rectangle is under-defined', !under.fullyDefined && under.dof > 0, `dof ${under.dof}`);

const locked = emptySketch();
addRectangle(locked, [-40, -25], [40, 25]);
for (const [i, id] of Object.keys(locked.points).entries()) {
  locked.constraints.push({ id: `c_fix_${i}`, kind: 'fixed', refs: [id], target: locked.points[id].slice() as [number, number] });
}
const defined = sketchDiagnostics(locked);
check('locked rectangle is fully defined', defined.fullyDefined, `dof ${defined.dof}`);

/* --------------------------- circle-only profile -------------------------- */

const circleOnly = emptySketch();
addCircle(circleOnly, [0, 0], 20);
check('closed circle is a profile with no open ends', sketchRegions(circleOnly).length === 1 && openEndpoints(circleOnly).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nall sketch checks passed');
if (failures) process.exitCode = 1;
