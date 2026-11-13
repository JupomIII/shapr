// Planar B-rep representation.
//
// A Solid is a set of planar faces. Each face owns an outer loop and optional
// hole loops, all expressed in world space as polygon vertices (mm). Edges are
// derived from loop topology on demand. All measurements (volume, area,
// centroid, bounding box) are computed analytically from this topology rather
// than from a render mesh.

import earcut from 'earcut';
import {
  Vec2,
  Vec3,
  add3,
  cross3,
  dist3,
  dot3,
  len3,
  norm3,
  scale3,
  sub3,
  neg3,
} from './vec';

export interface Plane {
  n: Vec3;
  d: number;
}

export interface Face {
  plane: Plane;
  /** loops[0] is the outer boundary, the rest are holes. */
  loops: Vec3[][];
}

export interface Solid {
  faces: Face[];
}

export type Tri = [Vec3, Vec3, Vec3];

export interface Region2 {
  outer: Vec2[];
  holes: Vec2[][];
}

export interface Edge {
  a: Vec3;
  b: Vec3;
  /** Stable-ish key based on the rounded midpoint, used by feature references. */
  key: string;
  /** Indices of the faces sharing this edge. */
  faces: number[];
}

export const keyOfPoint = (p: Vec3): string =>
  `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;

/** Orthonormal basis of a plane, with u x v = n. */
export function basisFor(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm3(cross3(ref, n));
  const v = norm3(cross3(n, u));
  return [u, v];
}

export const makePlane = (n: Vec3, point: Vec3): Plane => ({
  n: norm3(n),
  d: dot3(norm3(n), point),
});

export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const n = cross3(sub3(b, a), sub3(c, a));
  if (len3(n) < 1e-9) return null;
  return makePlane(n, a);
}

export const signedArea2 = (poly: Vec2[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** A point comfortably inside a simple polygon (vertex average with fallback). */
export function interiorPoint(poly: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p[0];
    cy += p[1];
  }
  cx /= poly.length;
  cy /= poly.length;
  if (pointInPolygon([cx, cy], poly)) return [cx, cy];
  // Fallback: nudge from a vertex midpoint toward the centroid.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (const t of [0.5, 0.25, 0.75, 0.1]) {
      const mx = a[0] + (b[0] - a[0]) * t;
      const my = a[1] + (b[1] - a[1]) * t;
      const px = mx + (cx - mx) * 0.01;
      const py = my + (cy - my) * 0.01;
      if (pointInPolygon([px, py], poly)) return [px, py];
    }
  }
  return [cx, cy];
}

export function removeCollinear(poly: Vec2[], tol = 1e-7): Vec2[] {
  if (poly.length < 4) return poly;
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const cur = poly[i];
    const next = poly[(i + 1) % poly.length];
    const ax = cur[0] - prev[0];
    const ay = cur[1] - prev[1];
    const bx = next[0] - cur[0];
    const by = next[1] - cur[1];
    const cross = Math.abs(ax * by - ay * bx);
    const dot = ax * bx + ay * by;
    const scaled = cross / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-12);
    if (scaled < tol && dot > 0) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : poly;
}

export function triangulateLoops(loops: Vec3[][], n: Vec3): Tri[] {
  if (!loops.length) return [];
  const outer = loops[0];
  if (!outer || outer.length < 3) return [];
  const [u, v] = basisFor(n);
  const o = outer[0];
  const flat: number[] = [];
  const holes: number[] = [];
  const pts: Vec3[] = [];
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li];
    if (loop.length < 3) continue;
    if (li > 0) holes.push(flat.length / 2);
    for (const p of loop) {
      const d = sub3(p, o);
      flat.push(dot3(d, u), dot3(d, v));
      pts.push(p);
    }
  }
  if (pts.length < 3) return [];
  let idx: number[];
  try {
    idx = earcut(flat, holes.length ? holes : undefined, 2);
  } catch {
    idx = [];
  }
  const tris: Tri[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = pts[idx[i]];
    const b = pts[idx[i + 1]];
    const c = pts[idx[i + 2]];
    if (!a || !b || !c) continue;
    const nn = cross3(sub3(b, a), sub3(c, a));
    if (len3(nn) < 1e-12) continue;
    if (dot3(nn, n) < 0) tris.push([a, c, b]);
    else tris.push([a, b, c]);
  }
  return tris;
}

export function faceTriangles(f: Face): Tri[] {
  return triangulateLoops(f.loops, f.plane.n);
}

export function facesToTris(s: Solid): Tri[] {
  const out: Tri[] = [];
  for (const f of s.faces) out.push(...faceTriangles(f));
  return out;
}

export function faceArea(f: Face): number {
  let a = 0;
  for (const [p, q, r] of faceTriangles(f)) {
    a += 0.5 * len3(cross3(sub3(q, p), sub3(r, p)));
  }
  return a;
}

export interface SolidMeasure {
  volume: number;
  area: number;
  bboxMin: Vec3;
  bboxMax: Vec3;
  centroid: Vec3;
  triangles: number;
}

export function measureSolid(s: Solid): SolidMeasure {
  const tris = facesToTris(s);
  let volume = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const [a, b, c] of tris) {
    const t = dot3(a, cross3(b, c)) / 6;
    volume += t;
    cx += ((a[0] + b[0] + c[0]) / 4) * t;
    cy += ((a[1] + b[1] + c[1]) / 4) * t;
    cz += ((a[2] + b[2] + c[2]) / 4) * t;
    area += 0.5 * len3(cross3(sub3(b, a), sub3(c, a)));
    for (const p of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        if (p[i] < mn[i]) mn[i] = p[i];
        if (p[i] > mx[i]) mx[i] = p[i];
      }
    }
  }
  const v = Math.abs(volume);
  const centroid: Vec3 =
    Math.abs(volume) > 1e-9 ? [cx / volume, cy / volume, cz / volume] : [0, 0, 0];
  if (!isFinite(mn[0])) {
    mn[0] = mn[1] = mn[2] = 0;
    mx[0] = mx[1] = mx[2] = 0;
  }
  return { volume: v, area, bboxMin: mn, bboxMax: mx, centroid, triangles: tris.length };
}

/** Ensure every face points outward (positive enclosed volume). */
export function orientSolid(s: Solid) {
  let vol = 0;
  for (const [a, b, c] of facesToTris(s)) vol += dot3(a, cross3(b, c)) / 6;
  if (vol >= 0) return;
  for (const f of s.faces) {
    f.loops = f.loops.map((l) => l.slice().reverse());
    f.plane = { n: neg3(f.plane.n), d: -f.plane.d };
  }
}

/** Bounding-box diagonal based tolerance. */
function diagonal(tris: Tri[]): number {
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (const p of t)
      for (let i = 0; i < 3; i++) {
        if (p[i] < mn[i]) mn[i] = p[i];
        if (p[i] > mx[i]) mx[i] = p[i];
      }
  if (!isFinite(mn[0])) return 1;
  return Math.max(1e-6, len3(sub3(mx, mn)));
}

/**
 * Split triangle edges where other vertices lie mid-edge (T-junctions). CSG
 * output routinely contains them, and they prevent boundary loops from
 * cancelling into clean face outlines.
 */
function resolveTJunctions(tris: number[][], verts: Vec3[], tol: number): number[][] {
  if (tris.length < 2) return tris;
  const ids = new Set<number>();
  for (const t of tris) for (const i of t) ids.add(i);
  const all = [...ids];
  const out: number[][] = [];
  const tol2 = tol * 4;

  for (const t of tris) {
    const polygon: number[] = [];
    let changed = false;
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      polygon.push(a);
      const A = verts[a];
      const B = verts[b];
      const ab = sub3(B, A);
      const l2 = dot3(ab, ab);
      if (l2 < 1e-16) continue;
      const minX = Math.min(A[0], B[0]) - tol2;
      const maxX = Math.max(A[0], B[0]) + tol2;
      const minY = Math.min(A[1], B[1]) - tol2;
      const maxY = Math.max(A[1], B[1]) + tol2;
      const minZ = Math.min(A[2], B[2]) - tol2;
      const maxZ = Math.max(A[2], B[2]) + tol2;
      const hits: { id: number; t: number }[] = [];
      for (const v of all) {
        if (v === a || v === b) continue;
        const P = verts[v];
        if (P[0] < minX || P[0] > maxX || P[1] < minY || P[1] > maxY || P[2] < minZ || P[2] > maxZ)
          continue;
        const ap = sub3(P, A);
        const tt = dot3(ap, ab) / l2;
        if (tt <= 1e-7 || tt >= 1 - 1e-7) continue;
        const close: Vec3 = [A[0] + ab[0] * tt, A[1] + ab[1] * tt, A[2] + ab[2] * tt];
        if (dist3(close, P) > tol2) continue;
        hits.push({ id: v, t: tt });
      }
      if (hits.length) {
        hits.sort((x, y) => x.t - y.t);
        for (const h of hits) polygon.push(h.id);
        changed = true;
      }
    }
    if (!changed) {
      out.push(t);
      continue;
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0];
      const b = polygon[i];
      const c = polygon[i + 1];
      if (a === b || b === c || a === c) continue;
      out.push([a, b, c]);
    }
  }
  return out;
}

/**
 * Rebuild a B-rep from a triangle soup: weld vertices, group coplanar
 * triangles, then extract boundary loops (with holes) per planar region.
 */
export function trisToSolid(tris: Tri[]): Solid {
  const solid: Solid = { faces: [] };
  if (!tris.length) return solid;
  const diag = diagonal(tris);
  const tol = Math.max(1e-7, diag * 1e-6);
  const inv = 1 / tol;

  const verts: Vec3[] = [];
  const weld = new Map<string, number>();
  const vid = (p: Vec3): number => {
    const k = `${Math.round(p[0] * inv)},${Math.round(p[1] * inv)},${Math.round(p[2] * inv)}`;
    const found = weld.get(k);
    if (found !== undefined) return found;
    const i = verts.length;
    verts.push(p);
    weld.set(k, i);
    return i;
  };

  const triIdx: number[][] = [];
  for (const t of tris) {
    const a = vid(t[0]);
    const b = vid(t[1]);
    const c = vid(t[2]);
    if (a === b || b === c || a === c) continue;
    triIdx.push([a, b, c]);
  }

  interface Grp {
    n: Vec3;
    d: number;
    tris: number[][];
  }
  const groups: Grp[] = [];
  const planeTol = Math.max(tol * 4, diag * 1e-6);
  for (const t of triIdx) {
    const A = verts[t[0]];
    const B = verts[t[1]];
    const C = verts[t[2]];
    const nn = cross3(sub3(B, A), sub3(C, A));
    const l = len3(nn);
    if (l < 1e-14) continue;
    const n = scale3(nn, 1 / l);
    const d = dot3(n, A);
    let g = groups.find((gr) => dot3(gr.n, n) > 1 - 1e-6 && Math.abs(gr.d - d) < planeTol);
    if (!g) {
      g = { n, d, tris: [] };
      groups.push(g);
    }
    g.tris.push(t);
  }

  for (const g of groups) {
    g.tris = resolveTJunctions(g.tris, verts, tol);
    // Directed edge bookkeeping; net count gives boundary orientations.
    const counts = new Map<string, number>();
    for (const t of g.tris) {
      for (let i = 0; i < 3; i++) {
        const a = t[i];
        const b = t[(i + 1) % 3];
        const k = `${a},${b}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    const bedges: { a: number; b: number; used: boolean }[] = [];
    for (const [k, c] of counts) {
      const [a, b] = k.split(',').map(Number);
      const rev = counts.get(`${b},${a}`) || 0;
      const net = c - rev;
      for (let i = 0; i < net; i++) bedges.push({ a, b, used: false });
    }
    const starts = new Map<number, number[]>();
    bedges.forEach((e, i) => {
      const arr = starts.get(e.a);
      if (arr) arr.push(i);
      else starts.set(e.a, [i]);
    });

    const loopsV: number[][] = [];
    for (let i = 0; i < bedges.length; i++) {
      if (bedges[i].used) continue;
      const loop: number[] = [];
      let cur = i;
      let guard = 0;
      let closed = false;
      while (cur >= 0 && guard++ < bedges.length + 4) {
        const e = bedges[cur];
        if (e.used) break;
        e.used = true;
        loop.push(e.a);
        if (e.b === loop[0]) {
          closed = true;
          break;
        }
        const cands = starts.get(e.b) || [];
        let next = -1;
        for (const c of cands) {
          if (!bedges[c].used) {
            next = c;
            break;
          }
        }
        cur = next;
      }
      if (closed && loop.length >= 3) loopsV.push(loop);
    }

    if (!loopsV.length) {
      for (const t of g.tris) {
        const loops = [t.map((i) => verts[i])];
        solid.faces.push({ plane: { n: g.n, d: g.d }, loops });
      }
      continue;
    }

    const [u, v] = basisFor(g.n);
    const origin = verts[loopsV[0][0]];
    const polys2: Vec2[][] = [];
    const polys3: Vec3[][] = [];
    for (const ids of loopsV) {
      const p3 = ids.map((i) => verts[i]);
      const p2 = p3.map((p): Vec2 => {
        const d = sub3(p, origin);
        return [dot3(d, u), dot3(d, v)];
      });
      const clean = removeCollinear(p2, 1e-5);
      if (clean.length < 3) continue;
      polys2.push(clean);
      polys3.push(clean.map((q) => add3(origin, add3(scale3(u, q[0]), scale3(v, q[1])))));
    }
    if (!polys2.length) continue;

    const areas = polys2.map((p) => signedArea2(p));
    const absAreas = areas.map(Math.abs);
    const depth = polys2.map((p, i) => {
      const pt = interiorPoint(p);
      let cnt = 0;
      for (let j = 0; j < polys2.length; j++) {
        if (j === i) continue;
        if (absAreas[j] <= absAreas[i]) continue;
        if (pointInPolygon(pt, polys2[j])) cnt++;
      }
      return cnt;
    });

    const outers = depth.map((d, i) => (d % 2 === 0 ? i : -1)).filter((i) => i >= 0);
    for (const oi of outers) {
      const holesFor: number[] = [];
      for (let j = 0; j < polys2.length; j++) {
        if (depth[j] % 2 !== 1) continue;
        const pt = interiorPoint(polys2[j]);
        if (!pointInPolygon(pt, polys2[oi])) continue;
        // Immediate parent: smallest containing outer loop.
        let parent = -1;
        let parentArea = Infinity;
        for (const k of outers) {
          if (k === oi) continue;
          if (absAreas[k] >= absAreas[oi]) continue;
          if (pointInPolygon(pt, polys2[k]) && absAreas[k] < parentArea) {
            parent = k;
            parentArea = absAreas[k];
          }
        }
        if (parent === -1 || parent === oi) holesFor.push(j);
      }

      const loops: Vec3[][] = [];
      const outerLoop = polys3[oi].slice();
      if (signedArea2(polys2[oi]) < 0) outerLoop.reverse();
      loops.push(outerLoop);
      for (const h of holesFor) {
        const hl = polys3[h].slice();
        if (signedArea2(polys2[h]) > 0) hl.reverse();
        loops.push(hl);
      }
      solid.faces.push({ plane: { n: g.n, d: g.d }, loops });
    }
  }

  orientSolid(solid);
  return solid;
}

/** All edges of the solid, shared face indices included. */
export function solidEdges(s: Solid): Edge[] {
  const map = new Map<string, Edge>();
  const pos = new Map<string, number>();
  const posOf = (p: Vec3): number => {
    const k = `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`;
    const f = pos.get(k);
    if (f !== undefined) return f;
    const i = pos.size;
    pos.set(k, i);
    return i;
  };
  s.faces.forEach((f, fi) => {
    for (const loop of f.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const ia = posOf(a);
        const ib = posOf(b);
        if (ia === ib) continue;
        const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
        const existing = map.get(key);
        if (existing) {
          if (!existing.faces.includes(fi)) existing.faces.push(fi);
        } else {
          const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          map.set(key, { a, b, key: keyOfPoint(mid), faces: [fi] });
        }
      }
    }
  });
  return [...map.values()];
}

/** Render-ready triangle soup with a per-triangle face index. */
export function buildRenderData(s: Solid): {
  positions: Float32Array;
  normals: Float32Array;
  faceIds: Uint32Array;
} {
  const tris: Tri[] = [];
  const ids: number[] = [];
  s.faces.forEach((f, fi) => {
    for (const t of faceTriangles(f)) {
      tris.push(t);
      ids.push(fi);
    }
  });
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    const n = norm3(cross3(sub3(t[1], t[0]), sub3(t[2], t[0])));
    for (let k = 0; k < 3; k++) {
      const p = t[k];
      positions[i * 9 + k * 3] = p[0];
      positions[i * 9 + k * 3 + 1] = p[1];
      positions[i * 9 + k * 3 + 2] = p[2];
      normals[i * 9 + k * 3] = n[0];
      normals[i * 9 + k * 3 + 1] = n[1];
      normals[i * 9 + k * 3 + 2] = n[2];
    }
  });
  return { positions, normals, faceIds: Uint32Array.from(ids) };
}

/** Silhouette line segments (all polygon boundary edges) for display. */
export function buildEdgeSegments(s: Solid, minAngleDeg = 12): Float32Array {
  // Only edges that read as model edges: boundaries and creases above the
  // threshold. Facets of tessellated cylinders and fillets stay smooth.
  const cosLimit = Math.cos((minAngleDeg * Math.PI) / 180);
  // Quantise to 1/100 mm so vertices produced by different faces still match.
  const k = (p: Vec3) =>
    `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`;
  const edges = new Map<string, { seg: [Vec3, Vec3]; normals: Vec3[] }>();

  for (const f of s.faces) {
    for (const loop of f.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const ka = k(a);
        const kb = k(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const existing = edges.get(key);
        if (existing) existing.normals.push(f.plane.n);
        else edges.set(key, { seg: [a, b], normals: [f.plane.n] });
      }
    }
  }

  const pts: number[] = [];
  for (const e of edges.values()) {
    if (e.normals.length === 2) {
      const [n1, n2] = e.normals;
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > cosLimit) continue;
    }
    pts.push(e.seg[0][0], e.seg[0][1], e.seg[0][2], e.seg[1][0], e.seg[1][1], e.seg[1][2]);
  }
  return new Float32Array(pts);
}

export const emptySolid: Solid = { faces: [] };
export const isSolidEmpty = (s: Solid): boolean => s.faces.length === 0;
