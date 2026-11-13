// A real geometric constraint solver: Levenberg–Marquardt on the residual
// vector of the sketch constraints, with a numeric Jacobian. The solver moves
// actual geometry; it is not a display-only annotation system.

import { Vec2, cross2, dist2, dot2, len2, sub2 } from '../kernel/vec';
import { arcGeom } from './geometry';
import { Constraint, Sketch, SketchEntity, SketchSolveResult } from './types';

interface Problem {
  x: number[];
  pointIdx: Map<string, number>;
  radiusIdx: Map<string, number>;
  fixed: boolean[];
}

const EPS = 1e-9;

function buildProblem(sk: Sketch, pinned: Set<string>): Problem {
  const x: number[] = [];
  const pointIdx = new Map<string, number>();
  const radiusIdx = new Map<string, number>();
  const fixed: boolean[] = [];

  const fixedPoints = new Set<string>(pinned);
  for (const c of sk.constraints) {
    if (c.kind === 'fixed' && c.refs[0]) fixedPoints.add(c.refs[0]);
  }

  for (const id of Object.keys(sk.points).sort()) {
    const p = sk.points[id];
    if (!p) continue;
    pointIdx.set(id, x.length);
    x.push(p[0], p[1]);
    const isFixed = fixedPoints.has(id);
    fixed.push(isFixed, isFixed);
  }
  for (const e of sk.entities) {
    if (e.kind === 'circle') {
      radiusIdx.set(e.id, x.length);
      x.push(e.r);
      fixed.push(false);
    }
  }
  return { x, pointIdx, radiusIdx, fixed };
}

function pointsFrom(sk: Sketch, p: Problem, x: number[]): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const [id, i] of p.pointIdx) out[id] = [x[i], x[i + 1]];
  return out;
}

function circleRadius(sk: Sketch, p: Problem, x: number[], id: string): number {
  const idx = p.radiusIdx.get(id);
  return idx === undefined ? 0 : x[idx];
}

function buildResiduals(sk: Sketch, p: Problem, x: number[]): number[] {
  const pts = pointsFrom(sk, p, x);
  const ent = new Map<string, SketchEntity>();
  for (const e of sk.entities) ent.set(e.id, e);
  const r: number[] = [];

  const lineDir = (id: string): Vec2 | null => {
    const e = ent.get(id);
    if (!e || e.kind !== 'line') return null;
    const a = pts[e.a];
    const b = pts[e.b];
    if (!a || !b) return null;
    return sub2(b, a);
  };
  const radiusOf = (id: string): number | null => {
    const e = ent.get(id);
    if (!e) return null;
    if (e.kind === 'circle') return circleRadius(sk, p, x, e.id);
    if (e.kind === 'arc') {
      const g = arcGeom(sk, e);
      return g ? g.r : null;
    }
    return null;
  };
  const centerOf = (id: string): Vec2 | null => {
    const e = ent.get(id);
    if (!e) return null;
    if (e.kind === 'circle') return pts[e.c] ?? null;
    if (e.kind === 'arc') {
      const g = arcGeom(sk, e);
      return g ? g.c : null;
    }
    return null;
  };
  const lenOf = (id: string): number | null => {
    const e = ent.get(id);
    if (!e) return null;
    if (e.kind === 'line') {
      const d = lineDir(e.id);
      return d ? len2(d) : null;
    }
    return null;
  };

  for (const c of sk.constraints) {
    switch (c.kind) {
      case 'coincident': {
        const a = pts[c.refs[0]];
        const b = pts[c.refs[1]];
        if (!a || !b) break;
        r.push(a[0] - b[0], a[1] - b[1]);
        break;
      }
      case 'horizontal': {
        const e = ent.get(c.refs[0]);
        if (!e || e.kind !== 'line') break;
        const a = pts[e.a];
        const b = pts[e.b];
        if (a && b) r.push(b[1] - a[1]);
        break;
      }
      case 'vertical': {
        const e = ent.get(c.refs[0]);
        if (!e || e.kind !== 'line') break;
        const a = pts[e.a];
        const b = pts[e.b];
        if (a && b) r.push(b[0] - a[0]);
        break;
      }
      case 'parallel': {
        const d1 = lineDir(c.refs[0]);
        const d2 = lineDir(c.refs[1]);
        if (!d1 || !d2) break;
        const l1 = len2(d1) || 1;
        const l2 = len2(d2) || 1;
        r.push((cross2(d1, d2) / (l1 * l2)) * 10);
        break;
      }
      case 'perpendicular': {
        const d1 = lineDir(c.refs[0]);
        const d2 = lineDir(c.refs[1]);
        if (!d1 || !d2) break;
        const l1 = len2(d1) || 1;
        const l2 = len2(d2) || 1;
        r.push((dot2(d1, d2) / (l1 * l2)) * 10);
        break;
      }
      case 'equal': {
        const d1 = lineDir(c.refs[0]);
        const d2 = lineDir(c.refs[1]);
        if (d1 && d2) {
          r.push(len2(d1) - len2(d2));
          break;
        }
        const r1 = radiusOf(c.refs[0]);
        const r2 = radiusOf(c.refs[1]);
        if (r1 !== null && r2 !== null) r.push(r1 - r2);
        break;
      }
      case 'concentric': {
        const a = centerOf(c.refs[0]);
        const b = centerOf(c.refs[1]);
        if (!a || !b) break;
        r.push(a[0] - b[0], a[1] - b[1]);
        break;
      }
      case 'tangent': {
        const line = ent.get(c.refs[0]);
        const circle = ent.get(c.refs[1]);
        if (!line || line.kind !== 'line' || !circle) break;
        const a = pts[line.a];
        const b = pts[line.b];
        if (!a || !b) break;
        const d = sub2(b, a);
        const l = len2(d) || 1;
        const cr = centerOf(circle.id);
        const rad = radiusOf(circle.id);
        if (!cr || rad === null) break;
        const dist = Math.abs(cross2(d, sub2(cr, a))) / l;
        r.push(dist - Math.abs(rad));
        break;
      }
      case 'fixed': {
        const a = pts[c.refs[0]];
        const t = c.target;
        if (!a || !t) break;
        r.push(a[0] - t[0], a[1] - t[1]);
        break;
      }
      case 'distance': {
        const a = pts[c.refs[0]];
        const b = pts[c.refs[1]];
        if (!a || !b || c.value === undefined) break;
        r.push(dist2(a, b) - c.value);
        break;
      }
      case 'length': {
        const l = lenOf(c.refs[0]);
        if (l === null || c.value === undefined) break;
        r.push(l - c.value);
        break;
      }
      case 'radius': {
        const rad = radiusOf(c.refs[0]);
        if (rad === null || c.value === undefined) break;
        r.push(rad - c.value);
        break;
      }
      case 'diameter': {
        const rad = radiusOf(c.refs[0]);
        if (rad === null || c.value === undefined) break;
        r.push(2 * rad - c.value);
        break;
      }
      case 'angle': {
        const d1 = lineDir(c.refs[0]);
        const d2 = lineDir(c.refs[1]);
        if (!d1 || !d2 || c.value === undefined) break;
        const l1 = len2(d1) || 1;
        const l2 = len2(d2) || 1;
        const cosA = Math.max(-1, Math.min(1, dot2(d1, d2) / (l1 * l2)));
        const angle = Math.acos(cosA);
        r.push(angle - (c.value * Math.PI) / 180);
        break;
      }
    }
  }
  return r;
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-14) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const d = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (Math.abs(f) < 1e-16) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function matrixRank(A: number[][], cols: number): number {
  if (!A.length || !cols) return 0;
  const m = A.map((r) => r.slice());
  let rank = 0;
  let row = 0;
  for (let col = 0; col < cols && row < m.length; col++) {
    let piv = -1;
    let best = 1e-9;
    for (let r = row; r < m.length; r++) {
      if (Math.abs(m[r][col]) > best) {
        best = Math.abs(m[r][col]);
        piv = r;
      }
    }
    if (piv < 0) continue;
    [m[row], m[piv]] = [m[piv], m[row]];
    const d = m[row][col];
    for (let c = col; c < cols; c++) m[row][c] /= d;
    for (let r = 0; r < m.length; r++) {
      if (r === row) continue;
      const f = m[r][col];
      if (Math.abs(f) < 1e-14) continue;
      for (let c = col; c < cols; c++) m[r][c] -= f * m[row][c];
    }
    row++;
    rank++;
  }
  return rank;
}

export function solveSketch(
  sk: Sketch,
  pinned: Set<string> = new Set(),
): SketchSolveResult {
  const problem = buildProblem(sk, pinned);
  const freeCols: number[] = [];
  problem.fixed.forEach((f, i) => {
    if (!f) freeCols.push(i);
  });

  let x = problem.x.slice();
  let best = buildResiduals(sk, problem, x);
  let cost = best.reduce((a, b) => a + b * b, 0);
  let lambda = 1e-6;

  const nRes = best.length;
  if (nRes > 0 && freeCols.length > 0) {
    for (let iter = 0; iter < 50; iter++) {
      const maxRes = Math.max(...best.map(Math.abs));
      if (maxRes < 1e-9) break;

      // Numeric Jacobian over free columns.
      const J: number[][] = [];
      const h = 1e-6;
      const cols: number[][] = [];
      for (const ci of freeCols) {
        const xs = x.slice();
        xs[ci] += h;
        const rr = buildResiduals(sk, problem, xs);
        const col: number[] = [];
        for (let i = 0; i < nRes; i++) col.push(((rr[i] ?? 0) - (best[i] ?? 0)) / h);
        cols.push(col);
      }
      for (let i = 0; i < nRes; i++) J.push(cols.map((c) => c[i]));

      const n = freeCols.length;
      const A: number[][] = [];
      const g: number[] = [];
      for (let i = 0; i < n; i++) {
        A.push(new Array(n).fill(0));
        let gi = 0;
        for (let k = 0; k < nRes; k++) gi += J[k][i] * best[k];
        g.push(gi);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
          let s = 0;
          for (let k = 0; k < nRes; k++) s += J[k][i] * J[k][j];
          A[i][j] = s;
          A[j][i] = s;
        }
        A[i][i] += lambda * (A[i][i] + 1e-6);
      }

      const dx = solveLinear(A, g.map((v) => -v));
      if (!dx) break;
      const xn = x.slice();
      let maxStep = 0;
      for (let i = 0; i < n; i++) {
        const step = Math.max(-50, Math.min(50, dx[i]));
        xn[freeCols[i]] += step;
        maxStep = Math.max(maxStep, Math.abs(step));
      }
      const rn = buildResiduals(sk, problem, xn);
      const costN = rn.reduce((a, b) => a + b * b, 0);
      if (costN < cost) {
        x = xn;
        best = rn;
        cost = costN;
        lambda = Math.max(1e-9, lambda / 3);
      } else {
        lambda *= 4;
        if (lambda > 1e8) break;
      }
      if (maxStep < 1e-10) break;
    }
  }

  const maxResidual = best.length ? Math.max(...best.map(Math.abs)) : 0;
  const dof = Math.max(0, freeCols.length - matrixRank(
    (() => {
      const rows: number[][] = [];
      const step = 1e-6;
      const cols: number[][] = [];
      for (const ci of freeCols) {
        const xs = x.slice();
        xs[ci] += step;
        const rr = buildResiduals(sk, problem, xs);
        cols.push(rr.map((v, i) => (v - best[i]) / step));
      }
      for (let i = 0; i < best.length; i++) rows.push(cols.map((c) => c[i]));
      return rows;
    })(),
    freeCols.length,
  ));

  const points = pointsFrom(sk, problem, x);
  const radii: Record<string, number> = {};
  for (const e of sk.entities) {
    if (e.kind === 'circle') radii[e.id] = circleRadius(sk, problem, x, e.id);
  }

  return {
    points,
    radii,
    satisfied: maxResidual < 1e-5,
    maxResidual,
    dof,
    fullyConstrained: dof === 0 && maxResidual < 1e-5,
    updated: true,
  };
}

export function constraintLabel(c: Constraint): string {
  switch (c.kind) {
    case 'distance':
      return `Distance ${c.value?.toFixed(2) ?? ''} mm`;
    case 'length':
      return `Length ${c.value?.toFixed(2) ?? ''} mm`;
    case 'radius':
      return `Radius ${c.value?.toFixed(2) ?? ''} mm`;
    case 'diameter':
      return `Diameter ${c.value?.toFixed(2) ?? ''} mm`;
    case 'angle':
      return `Angle ${c.value?.toFixed(1) ?? ''}°`;
    default:
      return c.kind[0].toUpperCase() + c.kind.slice(1);
  }
}
