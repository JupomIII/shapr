// Sketch-engine sanity checks (run with node via esbuild bundle).
import { addCircle, addLine, addRectangle } from '../src/sketch/create';
import { sketchRegions } from '../src/sketch/geometry';
import { openEndpoints, sketchDiagnostics } from '../src/sketch/diagnostics';
import { Sketch } from '../src/sketch/types';
import { solveSketch } from '../src/sketch/solver';

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

/* --------------------------- relations actually move geometry ------------- */

const applySolve = (sk: Sketch) => {
  const solved = solveSketch(sk);
  sk.points = solved.points;
  for (const e of sk.entities) if (e.kind === 'circle' && solved.radii[e.id] !== undefined) e.r = solved.radii[e.id];
  return solved;
};

const direction = (sk: Sketch, id: string): [number, number] => {
  const e = sk.entities.find((x) => x.id === id) as any;
  const a = sk.points[e.a];
  const b = sk.points[e.b];
  return [b[0] - a[0], b[1] - a[1]];
};

const parallelCase = emptySketch();
const pl1 = addLine(parallelCase, [0, 0], [40, 0]);
const pl2 = addLine(parallelCase, [0, 10], [30, 45]);
parallelCase.constraints.push({ id: 'c_par', kind: 'parallel', refs: [pl1, pl2] });
const parSolved = applySolve(parallelCase);
const [d1, d2] = [direction(parallelCase, pl1), direction(parallelCase, pl2)];
const crossNorm =
  Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) /
  (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]));
check('parallel relation makes two lines parallel', parSolved.satisfied && crossNorm < 1e-3, `cross ${crossNorm.toExponential(1)}`);

const perpCase = emptySketch();
const ql1 = addLine(perpCase, [0, 0], [40, 0]);
const ql2 = addLine(perpCase, [0, 10], [35, 30]);
perpCase.constraints.push({ id: 'c_perp', kind: 'perpendicular', refs: [ql1, ql2] });
const perpSolved = applySolve(perpCase);
const [e1, e2] = [direction(perpCase, ql1), direction(perpCase, ql2)];
const dotNorm =
  Math.abs(e1[0] * e2[0] + e1[1] * e2[1]) /
  (Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1]));
check('perpendicular relation makes two lines perpendicular', perpSolved.satisfied && dotNorm < 1e-3, `dot ${dotNorm.toExponential(1)}`);

const equalCase = emptySketch();
addCircle(equalCase, [0, 0], 8);
addCircle(equalCase, [50, 0], 17);
const [ec1, ec2] = equalCase.entities.filter((e) => e.kind === 'circle') as any[];
equalCase.constraints.push({ id: 'c_eq', kind: 'equal', refs: [ec1.id, ec2.id] });
const equalSolved = applySolve(equalCase);
check(
  'equal relation matches two radii',
  equalSolved.satisfied && Math.abs(ec1.r - ec2.r) < 1e-3,
  `r ${ec1.r.toFixed(3)} / ${ec2.r.toFixed(3)}`,
);

const tangentCase = emptySketch();
const tc = addCircle(tangentCase, [0, 0], 10);
const tl = addLine(tangentCase, [-30, 24], [30, 28]);
tangentCase.constraints.push({ id: 'c_tan', kind: 'tangent', refs: [tl, tc] });
const tanSolved = applySolve(tangentCase);
const lineEnt = tangentCase.entities.find((e) => e.id === tl) as any;
const la = tangentCase.points[lineEnt.a];
const lb = tangentCase.points[lineEnt.b];
const circleEnt = tangentCase.entities.find((e) => e.id === tc) as any;
const centre = tangentCase.points[circleEnt.c];
const distToLine =
  Math.abs((lb[0] - la[0]) * (la[1] - centre[1]) - (la[0] - centre[0]) * (lb[1] - la[1])) /
  Math.hypot(lb[0] - la[0], lb[1] - la[1]);
check(
  'tangent relation puts the line on the circle',
  tanSolved.satisfied && Math.abs(distToLine - circleEnt.r) < 5e-2,
  `distance ${distToLine.toFixed(3)} vs r ${circleEnt.r.toFixed(3)}`,
);

/* -------------------- degenerate input must not fake a profile ------------ */

const flat = emptySketch();
addRectangle(flat, [0, 0], [40, 0]);
check('a collapsed rectangle has no profile', sketchRegions(flat).length === 0, `${sketchRegions(flat).length} regions`);

const circleOnly = emptySketch();
addCircle(circleOnly, [0, 0], 20);
check('closed circle is a profile with no open ends', sketchRegions(circleOnly).length === 1 && openEndpoints(circleOnly).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nall sketch checks passed');
if (failures) process.exitCode = 1;
