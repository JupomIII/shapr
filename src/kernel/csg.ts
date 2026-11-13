// BSP-tree constructive solid geometry over polygons.
// This is the classic Sutherland/Hodgman + BSP CSG formulation. It is exact for
// planar-faced solids and produces the topology we rebuild into a B-rep.

import {
  Vec3,
  cross3,
  dot3,
  sub3,
  add3,
  scale3,
  neg3,
  len3,
  norm3,
} from './vec';

const EPS = 1e-7;

export interface CPoly {
  verts: Vec3[];
  n: Vec3;
  w: number;
}

export const planeFromVerts = (verts: Vec3[]): { n: Vec3; w: number } => {
  // Newell's method: stable for non-planar-ish polygons.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const n = norm3([nx, ny, nz]);
  if (len3(n) < 0.5) return { n: [0, 0, 0], w: 0 };
  return { n, w: dot3(n, verts[0]) };
};

export const makePoly = (verts: Vec3[]): CPoly => {
  const p = planeFromVerts(verts);
  return { verts, n: p.n, w: p.w };
};

const flipPoly = (p: CPoly): CPoly => ({
  verts: p.verts.slice().reverse(),
  n: neg3(p.n),
  w: -p.w,
});

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

function splitPolygon(
  n: Vec3,
  w: number,
  poly: CPoly,
  coFront: CPoly[],
  coBack: CPoly[],
  front: CPoly[],
  back: CPoly[],
) {
  let polyType = 0;
  const types: number[] = [];
  for (const v of poly.verts) {
    const t = dot3(n, v) - w;
    const type = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
    polyType |= type;
    types.push(type);
  }

  switch (polyType) {
    case COPLANAR:
      (dot3(n, poly.n) > 0 ? coFront : coBack).push(poly);
      break;
    case FRONT:
      front.push(poly);
      break;
    case BACK:
      back.push(poly);
      break;
    case SPANNING: {
      const f: Vec3[] = [];
      const b: Vec3[] = [];
      const count = poly.verts.length;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const ti = types[i];
        const tj = types[j];
        const vi = poly.verts[i];
        const vj = poly.verts[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(vi);
        if ((ti | tj) === SPANNING) {
          const t = (w - dot3(n, vi)) / dot3(n, sub3(vj, vi));
          const v = add3(vi, scale3(sub3(vj, vi), t));
          f.push(v);
          b.push(v);
        }
      }
      if (f.length >= 3) front.push(makePoly(f));
      if (b.length >= 3) back.push(makePoly(b));
      break;
    }
  }
}

class Node {
  plane: { n: Vec3; w: number } | null = null;
  front: Node | null = null;
  back: Node | null = null;
  polys: CPoly[] = [];

  constructor(polys?: CPoly[]) {
    if (polys && polys.length) this.build(polys);
  }

  invert() {
    for (const p of this.polys) {
      p.verts.reverse();
      p.n = neg3(p.n);
      p.w = -p.w;
    }
    if (this.plane) {
      this.plane.n = neg3(this.plane.n);
      this.plane.w = -this.plane.w;
    }
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }

  clipPolygons(polys: CPoly[]): CPoly[] {
    if (!this.plane) return polys.slice();
    let front: CPoly[] = [];
    let back: CPoly[] = [];
    for (const p of polys) splitPolygon(this.plane.n, this.plane.w, p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }

  clipTo(bsp: Node) {
    this.polys = bsp.clipPolygons(this.polys);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  allPolygons(): CPoly[] {
    let out = this.polys.slice();
    if (this.front) out = out.concat(this.front.allPolygons());
    if (this.back) out = out.concat(this.back.allPolygons());
    return out;
  }

  build(polys: CPoly[]) {
    if (!polys.length) return;
    if (!this.plane) this.plane = { n: polys[0].n, w: polys[0].w };
    const front: CPoly[] = [];
    const back: CPoly[] = [];
    for (const p of polys) {
      splitPolygon(
        this.plane.n,
        this.plane.w,
        p,
        this.polys,
        this.polys,
        front,
        back,
      );
    }
    if (front.length) {
      if (!this.front) this.front = new Node();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new Node();
      this.back.build(back);
    }
  }
}

export function csgUnion(a: CPoly[], b: CPoly[]): CPoly[] {
  const A = new Node(a);
  const B = new Node(b);
  A.clipTo(B);
  B.clipTo(A);
  B.invert();
  B.clipTo(A);
  B.invert();
  A.build(B.allPolygons());
  return A.allPolygons();
}

export function csgSubtract(a: CPoly[], b: CPoly[]): CPoly[] {
  const A = new Node(a);
  const B = new Node(b);
  A.invert();
  A.clipTo(B);
  B.clipTo(A);
  B.invert();
  B.clipTo(A);
  B.invert();
  A.build(B.allPolygons());
  A.invert();
  return A.allPolygons();
}

export function csgIntersect(a: CPoly[], b: CPoly[]): CPoly[] {
  const A = new Node(a);
  const B = new Node(b);
  A.invert();
  B.clipTo(A);
  B.invert();
  A.clipTo(B);
  B.clipTo(A);
  A.build(B.allPolygons());
  A.invert();
  return A.allPolygons();
}

/** Split polygons by a half space, discarding the other side. */
export function clipPolysByHalfSpace(
  polys: CPoly[],
  n: Vec3,
  w: number,
  keepPositive: boolean,
): { kept: CPoly[]; cutSegments: [Vec3, Vec3][] } {
  const kept: CPoly[] = [];
  const cut: [Vec3, Vec3][] = [];
  for (const poly of polys) {
    const pts = poly.verts;
    const out: Vec3[] = [];
    const seg: Vec3[] = [];
    const count = pts.length;
    for (let i = 0; i < count; i++) {
      const cur = pts[i];
      const nxt = pts[(i + 1) % count];
      const dc = dot3(n, cur) - w;
      const dn = dot3(n, nxt) - w;
      const cin = keepPositive ? dc >= -EPS : dc <= EPS;
      const nin = keepPositive ? dn >= -EPS : dn <= EPS;
      if (cin) out.push(cur);
      if (cin !== nin) {
        const t = dc / (dc - dn);
        const p: Vec3 = [
          cur[0] + (nxt[0] - cur[0]) * t,
          cur[1] + (nxt[1] - cur[1]) * t,
          cur[2] + (nxt[2] - cur[2]) * t,
        ];
        out.push(p);
        seg.push(p);
      }
    }
    if (out.length >= 3) kept.push(makePoly(out));
    if (seg.length === 2) cut.push([seg[0], seg[1]]);
  }
  return { kept, cutSegments: cut };
}
