// Solid modeling operations built on the planar B-rep + BSP CSG kernel.

import {
  Vec2,
  Vec3,
  add3,
  cross3,
  dist3,
  dot3,
  len3,
  mid3,
  neg3,
  norm3,
  rotateAbout,
  scale3,
  sub3,
  clamp,
} from './vec';
import {
  Edge,
  Face,
  Region2,
  Solid,
  Tri,
  basisFor,
  facesToTris,
  makePlane,
  orientSolid,
  interiorPoint,
  pointInPolygon,
  removeCollinear,
  signedArea2,
  triangulateLoops,
  trisToSolid,
} from './solid';
import { CPoly, csgIntersect, csgSubtract, csgUnion, clipPolysByHalfSpace, makePoly } from './csg';

export interface Frame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

export const frameXY: Frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
export const frameXZ: Frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] };
export const frameYZ: Frame = { origin: [0, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] };

export function frameFromPlane(n: Vec3, origin: Vec3): Frame {
  const [u, v] = basisFor(n);
  return { origin, u, v, n: norm3(n) };
}

export const to3D = (f: Frame, p: Vec2): Vec3 =>
  add3(f.origin, add3(scale3(f.u, p[0]), scale3(f.v, p[1])));

export const to2D = (f: Frame, p: Vec3): Vec2 => {
  const d = sub3(p, f.origin);
  return [dot3(d, f.u), dot3(d, f.v)];
};

const cleanLoop = (loop: Vec2[]): Vec2[] => {
  const out: Vec2[] = [];
  for (const p of loop) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push(p);
  }
  if (out.length > 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  }
  return removeCollinear(out, 1e-7);
};

const orientLoop = (loop: Vec2[], wantCCW: boolean): Vec2[] => {
  const a = signedArea2(loop);
  return (a > 0) === wantCCW ? loop : loop.slice().reverse();
};

const faceFromLoop3D = (loop: Vec3[]): Face | null => {
  if (loop.length < 3) return null;
  const n = norm3(cross3(sub3(loop[1], loop[0]), sub3(loop[2], loop[0])));
  if (len3(n) < 0.5) return null;
  const d = dot3(n, loop[0]);
  // Orient the loop so it follows the normal (right-hand rule).
  const [u, v] = basisFor(n);
  const p2 = loop.map((p): Vec2 => [dot3(sub3(p, loop[0]), u), dot3(sub3(p, loop[0]), v)]);
  if (signedArea2(p2) < 0) loop = loop.slice().reverse();
  return { plane: { n, d }, loops: [loop] };
};

/** Extrude closed regions (outer loop + holes) to a solid. */
export function extrudeRegions(regions: Region2[], frame: Frame, height: number): Solid {
  const faces: Face[] = [];
  const n = frame.n;
  const h = height;
  if (Math.abs(h) < 1e-7) return { faces: [] };

  for (const region of regions) {
    const outer = cleanLoop(region.outer);
    if (outer.length < 3) continue;
    const holes = region.holes.map(cleanLoop).filter((l) => l.length >= 3);
    const loops2 = [orientLoop(outer, true), ...holes.map((h2) => orientLoop(h2, false))];

    const bottom = loops2.map((l) => l.map((p) => to3D(frame, p)));
    const top = loops2.map((l) => l.map((p) => add3(to3D(frame, p), scale3(n, h))));

    const baseD = dot3(n, frame.origin);
    // Bottom cap faces -n: reverse loops so they wind correctly w.r.t. -n.
    faces.push({
      plane: { n: neg3(n), d: -baseD },
      loops: bottom.map((l) => l.slice().reverse()),
    });
    faces.push({
      plane: { n, d: baseD + h },
      loops: top,
    });

    loops2.forEach((l, li) => {
      const bt = bottom[li];
      const tp = top[li];
      for (let i = 0; i < l.length; i++) {
        const j = (i + 1) % l.length;
        const quad: Vec3[] = [bt[i], bt[j], tp[j], tp[i]];
        const f = faceFromLoop3D(quad);
        if (f) faces.push(f);
      }
    });
  }

  const s: Solid = { faces };
  orientSolid(s);
  return s;
}

/** Revolve closed regions about an in-plane axis. */
export function revolveRegions(
  regions: Region2[],
  frame: Frame,
  axis: { a: Vec2; b: Vec2 },
  segments = 64,
  angle = Math.PI * 2,
): Solid {
  const faces: Face[] = [];
  const A = to3D(frame, axis.a);
  const B = to3D(frame, axis.b);
  const dir = norm3(sub3(B, A));
  if (len3(dir) < 0.5) return { faces: [] };
  const full = Math.abs(Math.abs(angle) - Math.PI * 2) < 1e-6;
  const steps = Math.max(3, segments);

  for (const region of regions) {
    const outer = cleanLoop(region.outer);
    if (outer.length < 3) continue;
    const holes = region.holes.map(cleanLoop).filter((l) => l.length >= 3);
    const loops2 = [orientLoop(outer, true), ...holes.map((h2) => orientLoop(h2, false))];
    const loops3 = loops2.map((l) => l.map((p) => to3D(frame, p)));

    loops3.forEach((loop) => {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        for (let k = 0; k < steps; k++) {
          const a0 = (angle * k) / steps;
          const a1 = full && k === steps - 1 ? angle : (angle * (k + 1)) / steps;
          const p0 = rotateAbout(sub3(p, A), dir, a0);
          const q0 = rotateAbout(sub3(q, A), dir, a0);
          const p1 = rotateAbout(sub3(p, A), dir, a1);
          const q1 = rotateAbout(sub3(q, A), dir, a1);
          const quad: Vec3[] = [
            add3(A, p0),
            add3(A, q0),
            add3(A, q1),
            add3(A, p1),
          ];
          // Skip slivers created by profile edges lying on the axis.
          const area =
            len3(cross3(sub3(quad[1], quad[0]), sub3(quad[2], quad[0]))) +
            len3(cross3(sub3(quad[2], quad[0]), sub3(quad[3], quad[0])));
          if (area < 1e-9) continue;
          const f = faceFromLoop3D(quad);
          if (f) faces.push(f);
        }
      }
    });

    if (!full) {
      const startLoops = loops3;
      const endLoops = loops3.map((l) => l.map((p) => add3(A, rotateAbout(sub3(p, A), dir, angle))));
      for (const caps of [startLoops, endLoops]) {
        const outerLoop = caps[0];
        const holesCap = caps.slice(1);
        const n = norm3(cross3(sub3(outerLoop[1], outerLoop[0]), sub3(outerLoop[2], outerLoop[0])));
        if (len3(n) < 0.5) continue;
        faces.push({ plane: makePlane(n, outerLoop[0]), loops: [outerLoop, ...holesCap] });
        // Opposite cap
        const n2 = neg3(n);
        faces.push({
          plane: makePlane(n2, outerLoop[0]),
          loops: caps.map((l) => l.slice().reverse()),
        });
      }
    }
  }

  const s: Solid = { faces };
  orientSolid(s);
  return s;
}

const toPolys = (s: Solid): CPoly[] => facesToTris(s).map((t) => makePoly(t));

const fromPolys = (polys: CPoly[]): Solid => {
  const tris: Tri[] = [];
  for (const p of polys) {
    const v = p.verts;
    for (let i = 1; i + 1 < v.length; i++) tris.push([v[0], v[i], v[i + 1]]);
  }
  return trisToSolid(tris);
};

export const unionSolids = (a: Solid, b: Solid): Solid => {
  if (!a.faces.length) return b;
  if (!b.faces.length) return a;
  return fromPolys(csgUnion(toPolys(a), toPolys(b)));
};

export const subtractSolids = (a: Solid, b: Solid): Solid => {
  if (!a.faces.length || !b.faces.length) return a;
  return fromPolys(csgSubtract(toPolys(a), toPolys(b)));
};

export const intersectSolids = (a: Solid, b: Solid): Solid => {
  if (!a.faces.length || !b.faces.length) return { faces: [] };
  return fromPolys(csgIntersect(toPolys(a), toPolys(b)));
};

/** Chain segments into closed loops on a plane. */
function loopsFromSegments(segs: [Vec3, Vec3][]): Vec3[][] {
  if (segs.length < 3) return [];
  const q = 1e5;
  const keyOf = (p: Vec3) =>
    `${Math.round(p[0] * q)},${Math.round(p[1] * q)},${Math.round(p[2] * q)}`;
  const edges = segs.map(([a, b]) => ({ a: keyOf(a), b: keyOf(b), pa: a, pb: b, used: false }));
  const at = new Map<string, number[]>();
  const addAt = (k: string, i: number) => {
    const arr = at.get(k);
    if (arr) arr.push(i);
    else at.set(k, [i]);
  };
  edges.forEach((e, i) => {
    addAt(e.a, i);
    addAt(e.b, i);
  });

  const loops: Vec3[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const e0 = edges[i];
    e0.used = true;
    const startKey = e0.a;
    const pts: Vec3[] = [e0.pa];
    let endKey = e0.b;
    let closed = false;
    let guard = 0;
    while (guard++ < edges.length + 4) {
      if (endKey === startKey) {
        closed = true;
        break;
      }
      const cands = at.get(endKey) || [];
      let next = -1;
      for (const c of cands) {
        if (!edges[c].used) {
          next = c;
          break;
        }
      }
      if (next < 0) break;
      const e = edges[next];
      e.used = true;
      if (e.a === endKey) {
        pts.push(e.pa);
        endKey = e.b;
      } else {
        pts.push(e.pb);
        endKey = e.a;
      }
    }
    if (closed && pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/**
 * Exact section of the solid with a plane: one crossing segment per face loop.
 * Chaining these (rather than triangle splits) gives a clean cap boundary.
 */
function sectionSegments(solid: Solid, n: Vec3, d: number): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  const eps = 1e-9;
  for (const f of solid.faces) {
    for (const loop of f.loops) {
      let allZero = true;
      for (const p of loop) if (Math.abs(dot3(n, p) - d) > eps) allZero = false;
      if (allZero) continue;
      const pts: Vec3[] = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const da = dot3(n, a) - d;
        const db = dot3(n, b) - d;
        if (Math.abs(da) < eps) {
          pts.push(a);
          continue;
        }
        if (da < 0 !== db < 0) {
          const t = da / (da - db);
          pts.push(add3(a, scale3(sub3(b, a), t)));
        }
      }
      const uniq: Vec3[] = [];
      for (const p of pts) if (!uniq.some((q) => dist3(p, q) < 1e-6)) uniq.push(p);
      if (uniq.length === 2) out.push([uniq[0], uniq[1]]);
      else for (let i = 0; i + 1 < uniq.length; i += 2) out.push([uniq[i], uniq[i + 1]]);
    }
  }
  return out;
}

function capTriangles(segs: [Vec3, Vec3][], capNormal: Vec3): Tri[] {
  const loops = loopsFromSegments(segs);
  if (!loops.length) return [];
  const [u, v] = basisFor(capNormal);
  const origin = loops[0][0];
  const items = loops
    .map((loop3) => {
      const loop2 = removeCollinear(
        loop3.map((p): Vec2 => {
          const dd = sub3(p, origin);
          return [dot3(dd, u), dot3(dd, v)];
        }),
        1e-6,
      );
      const area = Math.abs(signedArea2(loop2));
      return { loop2, area };
    })
    .filter((it) => it.loop2.length >= 3 && it.area > 1e-9);
  if (!items.length) return [];

  const depth = items.map((it, i) => {
    const pt = interiorPoint(it.loop2);
    let cnt = 0;
    items.forEach((other, j) => {
      if (j !== i && other.area > items[i].area && pointInPolygon(pt, other.loop2)) cnt++;
    });
    return cnt;
  });
  const outerIdx = items.map((_, i) => i).filter((i) => depth[i] % 2 === 0);
  const tris: Tri[] = [];
  for (const oi of outerIdx) {
    const holes = items
      .map((it, i) => ({ it, i }))
      .filter(({ i }) => depth[i] % 2 === 1)
      .filter(({ it }) => {
        const pt = interiorPoint(it.loop2);
        if (!pointInPolygon(pt, items[oi].loop2)) return false;
        let parent = -1;
        let bestArea = Infinity;
        items.forEach((other, k) => {
          if (depth[k] % 2 !== 0 || k === oi) return;
          if (other.area <= items[oi].area) return;
          if (pointInPolygon(pt, other.loop2) && other.area < bestArea) {
            parent = k;
            bestArea = other.area;
          }
        });
        return parent === oi;
      })
      .map(({ it }) => it.loop2);

    const outer2 = items[oi].loop2;
    const outerOriented = signedArea2(outer2) > 0 ? outer2 : outer2.slice().reverse();
    const loop3s: Vec3[][] = [outerOriented.map((p) => add3(origin, add3(scale3(u, p[0]), scale3(v, p[1]))))];
    for (const h of holes) {
      const hh = signedArea2(h) < 0 ? h : h.slice().reverse();
      loop3s.push(hh.map((p) => add3(origin, add3(scale3(u, p[0]), scale3(v, p[1])))));
    }
    tris.push(...triangulateLoops(loop3s, capNormal));
  }
  return tris;
}

/** Clip a solid by a plane, capping the cut with a new face. */
export function clipSolid(
  solid: Solid,
  n: Vec3,
  d: number,
  keepPositive: boolean,
): Solid {
  const polys = toPolys(solid);
  const { kept } = clipPolysByHalfSpace(polys, n, d, keepPositive);
  const tris: Tri[] = [];
  for (const p of kept) {
    const verts = p.verts;
    for (let i = 1; i + 1 < verts.length; i++) tris.push([verts[0], verts[i], verts[i + 1]]);
  }
  const segs = sectionSegments(solid, n, d);
  const capNormal = keepPositive ? neg3(n) : n;
  tris.push(...capTriangles(segs, capNormal));
  return trisToSolid(tris);
}

interface EdgeContext {
  M: Vec3;
  e: Vec3;
  u1: Vec3;
  u2: Vec3;
  p1: { n: Vec3; d: number };
  p2: { n: Vec3; d: number };
  convex: boolean;
}

function edgeContext(solid: Solid, edge: Edge): EdgeContext | null {
  if (edge.faces.length < 2) return null;
  const f1 = solid.faces[edge.faces[0]];
  const f2 = solid.faces[edge.faces[1]];
  if (!f1 || !f2) return null;
  const n1 = f1.plane.n;
  const n2 = f2.plane.n;
  const e = norm3(sub3(edge.b, edge.a));
  if (len3(e) < 0.5) return null;
  const M = mid3(edge.a, edge.b);

  let u1 = norm3(cross3(n1, e));
  if (len3(u1) < 0.5) return null;
  if (dot3(u1, n2) > 0) u1 = neg3(u1);
  let u2 = norm3(cross3(n2, e));
  if (len3(u2) < 0.5) return null;
  if (dot3(u2, n1) > 0) u2 = neg3(u2);

  const convex = dot3(n1, u2) < -1e-6 && dot3(n2, u1) < -1e-6;
  return { M, e, u1, u2, p1: f1.plane, p2: f2.plane, convex };
}

export function boxSolid(min: Vec3, max: Vec3): Solid {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces: Face[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    const f = faceFromLoop3D([a, b, c, d]);
    if (f) faces.push(f);
  };
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  const s: Solid = { faces };
  orientSolid(s);
  return s;
}

/**
 * Half-space cuts are global. Restrict the material they remove to the
 * neighbourhood of the edge, so a fillet never eats an unrelated feature.
 */
function localizeCut(original: Solid, clipped: Solid, edge: Edge, margin: number): Solid {
  const removed = subtractSolids(original, clipped);
  if (!removed.faces.length) return clipped;
  const min: Vec3 = [
    Math.min(edge.a[0], edge.b[0]) - margin,
    Math.min(edge.a[1], edge.b[1]) - margin,
    Math.min(edge.a[2], edge.b[2]) - margin,
  ];
  const max: Vec3 = [
    Math.max(edge.a[0], edge.b[0]) + margin,
    Math.max(edge.a[1], edge.b[1]) + margin,
    Math.max(edge.a[2], edge.b[2]) + margin,
  ];
  const local = intersectSolids(removed, boxSolid(min, max));
  if (!local.faces.length) return original;
  const out = subtractSolids(original, local);
  return out.faces.length ? out : original;
}

/** Chamfer one convex edge. Exact: a single planar cut removes the wedge. */
export function chamferEdge(solid: Solid, edge: Edge, distance: number): Solid | null {
  const ctx = edgeContext(solid, edge);
  if (!ctx || !ctx.convex) return null;
  const t = Math.abs(distance);
  if (t < 1e-6) return solid;
  const P1 = add3(ctx.M, scale3(ctx.u1, t));
  const P2 = add3(ctx.M, scale3(ctx.u2, t));
  let m = norm3(cross3(ctx.e, sub3(P2, P1)));
  if (len3(m) < 0.5) return null;
  if (dot3(m, add3(ctx.p1.n, ctx.p2.n)) < 0) m = neg3(m);
  const d = dot3(m, P1);
  return localizeCut(solid, clipSolid(solid, m, d, false), edge, t * 1.8 + 0.2);
}

/**
 * Fillet one convex edge. The cylindrical surface is approximated by
 * tangent planes (segments controls the facet count); every tangent plane
 * is exactly tangent to the true fillet cylinder, so the shape is a
 * tessellation of the fillet, not an arbitrary bevel.
 */
export function filletEdge(
  solid: Solid,
  edge: Edge,
  radius: number,
  segments = 8,
): Solid | null {
  const ctx = edgeContext(solid, edge);
  if (!ctx || !ctx.convex) return null;
  const r = Math.abs(radius);
  if (r < 1e-6) return solid;

  const d1 = ctx.p1.d;
  const d2 = ctx.p2.d;
  const n1 = ctx.p1.n;
  const n2 = ctx.p2.n;
  const den1 = dot3(ctx.u1, n2);
  const den2 = dot3(ctx.u2, n1);
  if (Math.abs(den1) < 1e-6 || Math.abs(den2) < 1e-6) return null;
  const s1 = (d2 - r - dot3(ctx.M, n2)) / den1;
  const s2 = (d1 - r - dot3(ctx.M, n1)) / den2;
  const C = add3(ctx.M, add3(scale3(ctx.u1, s1), scale3(ctx.u2, s2)));

  const cosA = clamp(dot3(n1, n2), -1, 1);
  const total = Math.acos(cosA);
  if (total < 1e-4) return null;
  const sign = dot3(cross3(n1, n2), ctx.e) >= 0 ? 1 : -1;

  let out = solid;
  const steps = Math.max(2, Math.min(24, Math.round(segments)));
  for (let i = 1; i < steps; i++) {
    const ang = (total * i) / steps;
    const m = norm3(rotateAbout(n1, ctx.e, sign * ang));
    const off = dot3(m, C) + r;
    out = clipSolid(out, m, off, false);
  }
  return localizeCut(solid, out, edge, r * 1.8 + 0.2);
}

/** Push/pull a planar face by rebuilding it as an extrusion (real CSG). */
export function pushPullFace(solid: Solid, faceIndex: number, distance: number): Solid | null {
  const f = solid.faces[faceIndex];
  if (!f || f.loops.length === 0) return null;
  if (Math.abs(distance) < 1e-6) return solid;
  const n = f.plane.n;
  const frame = frameFromPlane(n, f.loops[0][0]);
  const region: Region2 = {
    outer: f.loops[0].map((p) => to2D(frame, p)),
    holes: f.loops.slice(1).map((l) => l.map((p) => to2D(frame, p))),
  };
  const tool = extrudeRegions([region], frame, distance);
  if (!tool.faces.length) return null;
  return distance > 0 ? unionSolids(solid, tool) : subtractSolids(solid, tool);
}

export function transformSolid(s: Solid, m: number[]): Solid {
  const apply = (p: Vec3): Vec3 => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  const newell = (loop: Vec3[]): Vec3 => {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return norm3([nx, ny, nz]);
  };
  const faces: Face[] = [];
  for (const f of s.faces) {
    const loops = f.loops.map((l) => l.map(apply));
    const n = newell(loops[0]);
    if (len3(n) < 0.5) continue;
    faces.push({ plane: { n, d: dot3(n, loops[0][0]) }, loops });
  }
  const out: Solid = { faces };
  orientSolid(out);
  return out;
}

export function translateSolid(s: Solid, t: Vec3): Solid {
  return transformSolid(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]);
}

/** Rigid transform: rotation about `axis` through `pivot`, then translation. */
export function rotateSolid(
  s: Solid,
  axis: Vec3,
  angle: number,
  pivot: Vec3 = [0, 0, 0],
  translate: Vec3 = [0, 0, 0],
): Solid {
  const a = norm3(axis);
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const t = 1 - c;
  const r = [
    t * a[0] * a[0] + c,
    t * a[0] * a[1] + sn * a[2],
    t * a[0] * a[2] - sn * a[1],
    t * a[0] * a[1] - sn * a[2],
    t * a[1] * a[1] + c,
    t * a[1] * a[2] + sn * a[0],
    t * a[0] * a[2] + sn * a[1],
    t * a[1] * a[2] - sn * a[0],
    t * a[2] * a[2] + c,
  ];
  const m = [
    r[0], r[1], r[2], 0,
    r[3], r[4], r[5], 0,
    r[6], r[7], r[8], 0,
    pivot[0] - (r[0] * pivot[0] + r[3] * pivot[1] + r[6] * pivot[2]) + translate[0],
    pivot[1] - (r[1] * pivot[0] + r[4] * pivot[1] + r[7] * pivot[2]) + translate[1],
    pivot[2] - (r[2] * pivot[0] + r[5] * pivot[1] + r[8] * pivot[2]) + translate[2],
    1,
  ];
  return transformSolid(s, m);
}

export function mirrorSolid(s: Solid, n: Vec3, d: number): Solid {
  const nn = norm3(n);
  const m = [
    1 - 2 * nn[0] * nn[0], -2 * nn[0] * nn[1], -2 * nn[0] * nn[2], 0,
    -2 * nn[0] * nn[1], 1 - 2 * nn[1] * nn[1], -2 * nn[1] * nn[2], 0,
    -2 * nn[0] * nn[2], -2 * nn[1] * nn[2], 1 - 2 * nn[2] * nn[2], 0,
    2 * d * nn[0], 2 * d * nn[1], 2 * d * nn[2], 1,
  ];
  return transformSolid(s, m);
}

export function linearPattern(
  s: Solid,
  dir: Vec3,
  count: number,
  spacing: number,
): Solid {
  let out = s;
  for (let i = 1; i < Math.max(1, Math.round(count)); i++) {
    out = unionSolids(out, translateSolid(s, scale3(norm3(dir), spacing * i)));
  }
  return out;
}

export function circularPattern(
  s: Solid,
  axis: Vec3,
  count: number,
  totalAngle: number,
  pivot: Vec3 = [0, 0, 0],
): Solid {
  let out = s;
  const c = Math.max(1, Math.round(count));
  for (let i = 1; i < c; i++) {
    out = unionSolids(out, rotateSolid(s, axis, (totalAngle * i) / c, pivot));
  }
  return out;
}

export function offsetFaceOutward(s: Solid, faceIndex: number, distance: number): Solid | null {
  return pushPullFace(s, faceIndex, distance);
}
