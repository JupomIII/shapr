// Sketch geometry helpers: sampling, loop detection, region building, picking
// and snapping. Pure functions over the sketch data model.

import {
  Vec2,
  cross2,
  dist2,
  dot2,
  len2,
  lerp2,
  norm2,
  scale2,
  sub2,
  add2,
} from '../kernel/vec';
import { Region2, pointInPolygon, signedArea2 } from '../kernel/solid';
import {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchEntity,
  SketchLine,
  SketchSpline,
} from './types';

const TWO_PI = Math.PI * 2;
const normAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

export function circleFrom3(a: Vec2, b: Vec2, m: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const m2 = m[0] * m[0] + m[1] * m[1];
  const cx = (a2 * (b[1] - m[1]) + b2 * (m[1] - a[1]) + m2 * (a[1] - b[1])) / d;
  const cy = (a2 * (m[0] - b[0]) + b2 * (a[0] - m[0]) + m2 * (b[0] - a[0])) / d;
  return { c: [cx, cy], r: Math.hypot(a[0] - cx, a[1] - cy) };
}

export interface ArcGeom {
  c: Vec2;
  r: number;
  a0: number;
  sweep: number;
}

export function arcGeom(sk: Sketch, e: SketchArc): ArcGeom | null {
  const a = sk.points[e.a];
  const b = sk.points[e.b];
  const m = sk.points[e.mid];
  if (!a || !b || !m) return null;
  const circ = circleFrom3(a, b, m);
  if (!circ || circ.r < 1e-6) return null;
  const a0 = Math.atan2(a[1] - circ.c[1], a[0] - circ.c[0]);
  const a1 = Math.atan2(b[1] - circ.c[1], b[0] - circ.c[0]);
  const am = Math.atan2(m[1] - circ.c[1], m[0] - circ.c[0]);
  let sweep = normAngle(a1 - a0);
  const midSweep = normAngle(am - a0);
  if (midSweep > sweep) sweep = sweep - TWO_PI;
  return { c: circ.c, r: circ.r, a0, sweep };
}

export function arcPoint(g: ArcGeom, t: number): Vec2 {
  const a = g.a0 + g.sweep * t;
  return [g.c[0] + Math.cos(a) * g.r, g.c[1] + Math.sin(a) * g.r];
}

function catmullRom(pts: Vec2[], samplesPerSeg = 10): Vec2[] {
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Polyline approximation of an entity, suitable for profiles and display. */
export function sampleEntity(sk: Sketch, e: SketchEntity, tol = 0.35): Vec2[] {
  switch (e.kind) {
    case 'line': {
      const a = sk.points[e.a];
      const b = sk.points[e.b];
      return a && b ? [a, b] : [];
    }
    case 'circle': {
      const c = sk.points[e.c];
      if (!c) return [];
      const n = Math.max(24, Math.min(160, Math.ceil((TWO_PI * e.r) / tol)));
      const out: Vec2[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI;
        out.push([c[0] + Math.cos(a) * e.r, c[1] + Math.sin(a) * e.r]);
      }
      return out;
    }
    case 'arc': {
      const g = arcGeom(sk, e);
      if (!g) return [];
      const n = Math.max(8, Math.min(180, Math.ceil((Math.abs(g.sweep) * g.r) / tol)));
      const out: Vec2[] = [];
      for (let i = 0; i <= n; i++) out.push(arcPoint(g, i / n));
      return out;
    }
    case 'spline': {
      const pts = e.pts.map((id) => sk.points[id]).filter(Boolean) as Vec2[];
      return catmullRom(pts);
    }
  }
}

export function entityEndpoints(sk: Sketch, e: SketchEntity): [Vec2, Vec2] | null {
  if (e.kind === 'line') {
    const a = sk.points[e.a];
    const b = sk.points[e.b];
    return a && b ? [a, b] : null;
  }
  if (e.kind === 'arc') {
    const a = sk.points[e.a];
    const b = sk.points[e.b];
    return a && b ? [a, b] : null;
  }
  if (e.kind === 'spline') {
    const a = sk.points[e.pts[0]];
    const b = sk.points[e.pts[e.pts.length - 1]];
    return a && b ? [a, b] : null;
  }
  return null;
}

export function entityCenter(sk: Sketch, e: SketchEntity): Vec2 | null {
  if (e.kind === 'circle') return sk.points[e.c] ?? null;
  if (e.kind === 'arc') {
    const g = arcGeom(sk, e);
    return g ? g.c : null;
  }
  return null;
}

export function entityRadius(sk: Sketch, e: SketchEntity): number | null {
  if (e.kind === 'circle') return e.r;
  if (e.kind === 'arc') {
    const g = arcGeom(sk, e);
    return g ? g.r : null;
  }
  return null;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  if (l2 < 1e-12) return dist2(p, a);
  let t = dot2(sub2(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, add2(a, scale2(ab, t)));
}

export function distanceToEntity(sk: Sketch, e: SketchEntity, p: Vec2): number {
  const poly = sampleEntity(sk, e, 0.4);
  if (poly.length < 2) return Infinity;
  let best = Infinity;
  const closed = e.kind === 'circle' || (e.kind === 'spline' && e.closed);
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Closed loops formed by connected sketch geometry (excluding construction). */
export function sketchLoops(sk: Sketch): Vec2[][] {
  const tol = 1e-3;
  const chains: Vec2[][] = [];
  const closed: Vec2[][] = [];

  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.kind === 'circle') {
      closed.push(sampleEntity(sk, e));
      continue;
    }
    if (e.kind === 'spline' && e.closed) {
      closed.push(sampleEntity(sk, e));
      continue;
    }
    const poly = sampleEntity(sk, e);
    if (poly.length < 2) continue;
    chains.push(poly);
  }

  const same = (a: Vec2, b: Vec2) => dist2(a, b) < tol;
  let merged = true;
  const used = new Array(chains.length).fill(false);
  const result: Vec2[][] = [];
  for (let i = 0; i < chains.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let path = chains[i].slice();
    merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < chains.length; j++) {
        if (used[j]) continue;
        const c = chains[j];
        const start = path[0];
        const end = path[path.length - 1];
        if (same(end, c[0])) {
          path = path.concat(c.slice(1));
        } else if (same(end, c[c.length - 1])) {
          path = path.concat(c.slice(0, -1).reverse());
        } else if (same(start, c[c.length - 1])) {
          path = c.slice(0, -1).concat(path);
        } else if (same(start, c[0])) {
          path = c.slice(0, -1).reverse().concat(path);
        } else continue;
        used[j] = true;
        merged = true;
        break;
      }
    }
    if (path.length > 3 && same(path[0], path[path.length - 1])) {
      path.pop();
      result.push(path);
    }
  }

  for (const loop of closed) {
    if (loop.length >= 3 && Math.abs(signedArea2(loop)) > 1e-6) result.push(loop);
  }
  const seen = new Set<string>();
  const unique: Vec2[][] = [];
  for (const l of result) {
    const key = `${l.length}:${l[0][0].toFixed(4)},${l[0][1].toFixed(4)}:${l[1][0].toFixed(4)},${l[1][1].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(l);
  }
  return unique;
}

export function buildRegions(input: Vec2[][]): Region2[] {
  // A loop with no area is not a profile. Collapsed geometry (two coincident
  // corners, a retraced line) used to be handed to the modelling tools, which
  // then failed with "produced no solid".
  const loops = input.filter((l) => l.length >= 3 && Math.abs(signedArea2(l)) > 1e-4);
  if (!loops.length) return [];
  const areas = loops.map((l) => Math.abs(signedArea2(l)));
  const depth = loops.map((l, i) => {
    const pt = l[0];
    let cnt = 0;
    for (let j = 0; j < loops.length; j++) {
      if (j === i) continue;
      if (areas[j] <= areas[i]) continue;
      if (pointInPolygon(pt, loops[j])) cnt++;
    }
    return cnt;
  });
  const regions: Region2[] = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes: Vec2[][] = [];
    loops.forEach((h, j) => {
      if (depth[j] % 2 !== 1) return;
      if (areas[j] >= areas[i]) return;
      // The hole has to sit inside this outer loop. Test the hole's own point:
      // a corner of the outer loop is never inside the hole.
      const hp = h[0];
      if (!pointInPolygon(hp, l)) return;
      // Smallest containing outer is this one.
      let parentArea = Infinity;
      let parent = -1;
      loops.forEach((o, k) => {
        if (depth[k] % 2 !== 0 || k === j) return;
        if (pointInPolygon(hp, o) && areas[k] < parentArea) {
          parent = k;
          parentArea = areas[k];
        }
      });
      if (parent === i) holes.push(h);
    });
    const outer = signedArea2(l) > 0 ? l : l.slice().reverse();
    regions.push({
      outer,
      holes: holes.map((h) => (signedArea2(h) < 0 ? h : h.slice().reverse())),
    });
  });
  return regions;
}

export function sketchRegions(sk: Sketch): Region2[] {
  return buildRegions(sketchLoops(sk));
}

export function regionContains(region: Region2, p: Vec2): boolean {
  if (!pointInPolygon(p, region.outer)) return false;
  for (const h of region.holes) if (pointInPolygon(p, h)) return false;
  return true;
}

/* --------------------------------- snapping ------------------------------- */

export interface SnapCandidate {
  p: Vec2;
  kind: 'endpoint' | 'midpoint' | 'center' | 'grid' | 'intersection';
  entityId?: string;
}

export function snapCandidates(sk: Sketch, gridSize: number): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const seen = new Set<string>();
  const push = (p: Vec2, kind: SnapCandidate['kind'], entityId?: string) => {
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ p, kind, entityId });
  };
  for (const e of sk.entities) {
    if (e.kind === 'line' || e.kind === 'arc') {
      const a = sk.points[e.a];
      const b = sk.points[e.b];
      if (a) push(a, 'endpoint', e.id);
      if (b) push(b, 'endpoint', e.id);
      if (a && b) push(lerp2(a, b, 0.5), 'midpoint', e.id);
    }
    if (e.kind === 'circle') {
      const c = sk.points[e.c];
      if (c) push(c, 'center', e.id);
    }
    if (e.kind === 'arc') {
      const g = arcGeom(sk, e);
      if (g) push(g.c, 'center', e.id);
    }
    if (e.kind === 'spline') {
      for (const id of e.pts) {
        const p = sk.points[id];
        if (p) push(p, 'endpoint', e.id);
      }
    }
  }
  if (gridSize > 0) {
    // Grid candidates are generated on demand by the caller.
  }
  return out;
}

export interface SnapResult {
  p: Vec2;
  kind: SnapCandidate['kind'] | 'free';
  entityId?: string;
  /** Inferred axis alignment relative to the anchor point. */
  inference?: 'horizontal' | 'vertical' | 'parallel' | 'perpendicular';
}

export function snapPoint(
  sk: Sketch,
  raw: Vec2,
  opts: {
    gridSize: number;
    snapEnabled: boolean;
    threshold: number;
    anchor?: Vec2 | null;
    anchorDir?: Vec2 | null;
  },
): SnapResult {
  const candidates = snapCandidates(sk, opts.gridSize);
  let best: SnapCandidate | null = null;
  let bestD = opts.threshold;
  for (const c of candidates) {
    const d = dist2(raw, c.p);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best && opts.snapEnabled) return { p: best.p, kind: best.kind, entityId: best.entityId };

  // Axis / relation inference relative to the anchor point.
  if (opts.anchor && opts.snapEnabled) {
    const a = opts.anchor;
    const dx = raw[0] - a[0];
    const dy = raw[1] - a[1];
    if (Math.abs(dx) < opts.threshold && Math.abs(dy) > opts.threshold * 0.5)
      return { p: [a[0], raw[1]], kind: 'free', inference: 'vertical' };
    if (Math.abs(dy) < opts.threshold && Math.abs(dx) > opts.threshold * 0.5)
      return { p: [raw[0], a[1]], kind: 'free', inference: 'horizontal' };
    if (opts.anchorDir) {
      const ad = norm2(opts.anchorDir);
      // Parallel inference.
      const cross = Math.abs(cross2(ad, [dx, dy]));
      const along = Math.abs(dot2(ad, [dx, dy]));
      if (cross < opts.threshold * 0.6) {
        return {
          p: add2(a, scale2(ad, dot2(ad, [dx, dy]))),
          kind: 'free',
          inference: 'parallel',
        };
      }
      if (along < opts.threshold * 0.6) {
        const perp: Vec2 = [-ad[1], ad[0]];
        return { p: add2(a, scale2(perp, dot2(perp, [dx, dy]))), kind: 'free', inference: 'perpendicular' };
      }
    }
  }

  if (opts.snapEnabled && opts.gridSize > 0) {
    const gx = Math.round(raw[0] / opts.gridSize) * opts.gridSize;
    const gy = Math.round(raw[1] / opts.gridSize) * opts.gridSize;
    if (dist2(raw, [gx, gy]) < opts.threshold) return { p: [gx, gy], kind: 'grid' };
  }
  return { p: raw, kind: 'free' };
}

/* ------------------------------ rectangles -------------------------------- */

export function isAxisAligned(a: Vec2, b: Vec2, tol = 1e-6): boolean {
  return Math.abs(a[1] - b[1]) < tol || Math.abs(a[0] - b[0]) < tol;
}

export function polylineLength(poly: Vec2[]): number {
  let l = 0;
  for (let i = 0; i + 1 < poly.length; i++) l += dist2(poly[i], poly[i + 1]);
  return l;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) return poly[0] ?? [0, 0];
  return [cx / (6 * a), cy / (6 * a)];
}

export { len2, norm2, cross2, dot2, scale2, sub2, add2 };
