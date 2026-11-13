// Sketch authoring helpers: point sharing, entity creation, automatic
// constraints, dimensions and freehand shape recognition.

import {
  Vec2,
  dist2,
  dot2,
  lerp2,
  len2,
  norm2,
  scale2,
  sub2,
} from '../kernel/vec';
import { Constraint, ConstraintKind, Sketch } from './types';

export const newPoint = (draft: Sketch, p: Vec2, tol = 1e-3): string => {
  for (const [id, existing] of Object.entries(draft.points)) {
    if (dist2(existing, p) < tol) return id;
  }
  const id = `p_${Math.random().toString(36).slice(2, 9)}`;
  draft.points[id] = [p[0], p[1]];
  return id;
};

export const addConstraint = (
  draft: Sketch,
  kind: ConstraintKind,
  refs: string[],
  value?: number,
): string => {
  const id = `c_${Math.random().toString(36).slice(2, 9)}`;
  const c: Constraint = { id, kind, refs, value };
  draft.constraints.push(c);
  return id;
};

export const addLine = (draft: Sketch, a: Vec2, b: Vec2, construction = false): string => {
  const id = `e_${Math.random().toString(36).slice(2, 9)}`;
  draft.entities.push({
    id,
    kind: 'line',
    a: newPoint(draft, a),
    b: newPoint(draft, b),
    construction,
  });
  return id;
};

export const addCircle = (draft: Sketch, c: Vec2, r: number, construction = false): string => {
  const id = `e_${Math.random().toString(36).slice(2, 9)}`;
  draft.entities.push({ id, kind: 'circle', c: newPoint(draft, c), r: Math.max(0.05, r), construction });
  return id;
};

export const addArc = (draft: Sketch, a: Vec2, b: Vec2, mid: Vec2, construction = false): string => {
  const id = `e_${Math.random().toString(36).slice(2, 9)}`;
  draft.entities.push({
    id,
    kind: 'arc',
    a: newPoint(draft, a),
    b: newPoint(draft, b),
    mid: newPoint(draft, mid),
    construction,
  });
  return id;
};

export const addSpline = (draft: Sketch, pts: Vec2[], closed = false, construction = false): string => {
  const id = `e_${Math.random().toString(36).slice(2, 9)}`;
  const ids = pts.map((p) => newPoint(draft, p));
  draft.entities.push({ id, kind: 'spline', pts: ids, closed, construction });
  return id;
};

export const autoAxisConstraint = (draft: Sketch, lineId: string, a: Vec2, b: Vec2) => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dx < 1e-6 && dy < 1e-6) return;
  if (dy < 1e-4) addConstraint(draft, 'horizontal', [lineId]);
  else if (dx < 1e-4) addConstraint(draft, 'vertical', [lineId]);
};

export interface RectResult {
  lines: string[];
  width: number;
  height: number;
}

export const addRectangle = (draft: Sketch, a: Vec2, b: Vec2): RectResult => {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const p1: Vec2 = [x0, y0];
  const p2: Vec2 = [x1, y0];
  const p3: Vec2 = [x1, y1];
  const p4: Vec2 = [x0, y1];
  const l1 = addLine(draft, p1, p2);
  const l2 = addLine(draft, p2, p3);
  const l3 = addLine(draft, p3, p4);
  const l4 = addLine(draft, p4, p1);
  addConstraint(draft, 'horizontal', [l1]);
  addConstraint(draft, 'vertical', [l2]);
  addConstraint(draft, 'horizontal', [l3]);
  addConstraint(draft, 'vertical', [l4]);
  return { lines: [l1, l2, l3, l4], width: x1 - x0, height: y1 - y0 };
};

/* ------------------------------ recognition ------------------------------- */

export type Recognized =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'rect'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'arc'; a: Vec2; b: Vec2; mid: Vec2 }
  | { kind: 'spline'; pts: Vec2[]; closed: boolean };

const rdp = (points: Vec2[], eps: number): Vec2[] => {
  if (points.length < 3) return points.slice();
  let maxD = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  const ab = sub2(b, a);
  const abLen = len2(ab) || 1e-9;
  for (let i = 1; i < points.length - 1; i++) {
    const ap = sub2(points[i], a);
    const d = Math.abs(ap[0] * ab[1] - ap[1] * ab[0]) / abLen;
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, index + 1), eps);
    const right = rdp(points.slice(index), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
};

const bboxOf = (pts: Vec2[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};

const polyArea = (pts: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
};

/** Recognize an intended primitive from a freehand pencil stroke. */
export function recognizeShape(points: Vec2[]): Recognized | null {
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const bb = bboxOf(points);
  const diag = Math.hypot(bb.w, bb.h);
  if (diag < 1e-3) return null;
  const closed = dist2(first, last) < Math.max(bb.w, bb.h) * 0.28;

  if (closed) {
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p[0];
      cy += p[1];
    }
    cx /= points.length;
    cy /= points.length;
    const radii = points.map((p) => dist2(p, [cx, cy]));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const variance = radii.reduce((a, b) => a + (b - mean) * (b - mean), 0) / radii.length;
    const sd = Math.sqrt(variance);
    if (mean > 0 && sd / mean < 0.11) {
      return { kind: 'circle', c: [cx, cy], r: mean };
    }
    const simplified = rdp(points, diag * 0.05);
    const ratio = polyArea(points) / Math.max(1e-9, bb.w * bb.h);
    if (simplified.length >= 4 && simplified.length <= 6 && ratio > 0.62) {
      return { kind: 'rect', a: [bb.minX, bb.minY], b: [bb.maxX, bb.maxY] };
    }
    return { kind: 'spline', pts: points, closed: true };
  }

  // Open stroke: line, arc or spline.
  const chord = sub2(last, first);
  const chordLen = len2(chord);
  if (chordLen < diag * 0.5) return { kind: 'spline', pts: points, closed: false };
  const dir = norm2(chord);
  let maxDev = 0;
  let maxIdx = 0;
  let maxSigned = 0;
  points.forEach((p, i) => {
    const ap = sub2(p, first);
    const dev = ap[0] * dir[1] - ap[1] * dir[0];
    if (Math.abs(dev) > Math.abs(maxSigned)) {
      maxSigned = dev;
      maxIdx = i;
    }
    maxDev = Math.max(maxDev, Math.abs(dev));
  });
  if (maxDev < chordLen * 0.045) {
    return { kind: 'line', a: first, b: last };
  }
  // Constant curvature fit through the three extreme points.
  const mid = points[maxIdx];
  const r1 = dist2(first, mid);
  const r2 = dist2(mid, last);
  if (Math.abs(r1 - r2) < chordLen * 0.22) {
    const deviations: number[] = [];
    const cross = (a: Vec2, b: Vec2, c: Vec2) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d = 2 * (first[0] * (mid[1] - last[1]) + mid[0] * (last[1] - first[1]) + last[0] * (first[1] - mid[1]));
    if (Math.abs(d) > 1e-9) {
      const a2 = first[0] * first[0] + first[1] * first[1];
      const b2 = mid[0] * mid[0] + mid[1] * mid[1];
      const c2 = last[0] * last[0] + last[1] * last[1];
      const cx = (a2 * (mid[1] - last[1]) + b2 * (last[1] - first[1]) + c2 * (first[1] - mid[1])) / d;
      const cy = (a2 * (last[0] - mid[0]) + b2 * (first[0] - last[0]) + c2 * (mid[0] - first[0])) / d;
      const radius = Math.hypot(first[0] - cx, first[1] - cy);
      for (const p of points) deviations.push(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius));
      const worst = Math.max(...deviations);
      if (worst < radius * 0.14) return { kind: 'arc', a: first, b: last, mid };
    }
  }
  return { kind: 'spline', pts: points, closed: false };
}

/** Apply a recognized shape to the sketch draft. */
export function applyRecognized(draft: Sketch, rec: Recognized): void {
  switch (rec.kind) {
    case 'line': {
      const id = addLine(draft, rec.a, rec.b);
      autoAxisConstraint(draft, id, rec.a, rec.b);
      break;
    }
    case 'rect': {
      const r = addRectangle(draft, rec.a, rec.b);
      if (r.width > 1e-6) addConstraint(draft, 'length', [r.lines[0]], r.width);
      if (r.height > 1e-6) addConstraint(draft, 'length', [r.lines[1]], r.height);
      break;
    }
    case 'circle': {
      const id = addCircle(draft, rec.c, rec.r);
      addConstraint(draft, 'diameter', [id], rec.r * 2);
      break;
    }
    case 'arc':
      addArc(draft, rec.a, rec.b, rec.mid);
      break;
    case 'spline':
      addSpline(draft, rec.pts, rec.closed);
      break;
  }
}

/** Public helper used by the dimension chips. */
export function lineMidpoint(draft: Sketch, entityId: string): Vec2 | null {
  const e = draft.entities.find((x) => x.id === entityId);
  if (!e || e.kind !== 'line') return null;
  const a = draft.points[e.a];
  const b = draft.points[e.b];
  if (!a || !b) return null;
  return lerp2(a, b, 0.5);
}

export function lineLength(draft: Sketch, entityId: string): number | null {
  const e = draft.entities.find((x) => x.id === entityId);
  if (!e || e.kind !== 'line') return null;
  const a = draft.points[e.a];
  const b = draft.points[e.b];
  if (!a || !b) return null;
  return dist2(a, b);
}

export function lineDirection(draft: Sketch, entityId: string): Vec2 | null {
  const e = draft.entities.find((x) => x.id === entityId);
  if (!e || e.kind !== 'line') return null;
  const a = draft.points[e.a];
  const b = draft.points[e.b];
  if (!a || !b) return null;
  return norm2(sub2(b, a));
}

export const scaleVec = scale2;
export const dotVec = dot2;
