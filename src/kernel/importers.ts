// Importers for 2D (DXF) and faceted STEP. Both are parsed into plain data so
// the store can turn them into parametric document objects: a DXF becomes a
// real sketch (editable, constrainable), a faceted STEP becomes a body.

import { Vec2, Vec3, cross3, len3, norm3, sub3 } from './vec';
import { Face, Solid, facesToTris } from './solid';

/* ----------------------------------- DXF ---------------------------------- */

export type DxfShape =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'arc'; a: Vec2; b: Vec2; mid: Vec2 };

export interface DxfImport {
  shapes: DxfShape[];
  /** Entities the parser deliberately ignores (TEXT, DIMENSION, …). */
  skipped: number;
  unitScale: number;
}

interface DxfGroup {
  type: string;
  codes: [number, string][];
}

const num = (groups: DxfGroup, code: number, fallback = NaN): number => {
  const hit = groups.codes.find(([c]) => c === code);
  return hit ? parseFloat(hit[1]) : fallback;
};

const nums = (groups: DxfGroup, code: number): number[] =>
  groups.codes.filter(([c]) => c === code).map(([, v]) => parseFloat(v));

/** DXF group codes are a flat list of (code, value) pairs, one per line. */
export function importDXF(text: string): DxfImport {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!isFinite(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }

  let unitScale = 1;
  const insUnits = pairs.findIndex(([c, v], i) => c === 9 && v === '$INSUNITS' && pairs[i + 1]?.[0] === 70);
  if (insUnits >= 0) {
    const unit = parseInt(pairs[insUnits + 1][1], 10);
    if (unit === 1) unitScale = 25.4; // inches
    else if (unit === 2) unitScale = 304.8; // feet
    else if (unit === 5) unitScale = 10; // centimetres
    else if (unit === 6) unitScale = 1000; // metres
  }

  const groups: DxfGroup[] = [];
  for (const [code, value] of pairs) {
    if (code === 0) groups.push({ type: value.toUpperCase(), codes: [] });
    else if (groups.length) groups[groups.length - 1].codes.push([code, value]);
  }

  const shapes: DxfShape[] = [];
  let skipped = 0;

  const arcPoints = (c: Vec2, r: number, a0: number, a1: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    let start = rad(a0);
    let end = rad(a1);
    while (end <= start) end += Math.PI * 2;
    const a: Vec2 = [c[0] + Math.cos(start) * r, c[1] + Math.sin(start) * r];
    const b: Vec2 = [c[0] + Math.cos(end) * r, c[1] + Math.sin(end) * r];
    const mid: Vec2 = [
      c[0] + Math.cos((start + end) / 2) * r,
      c[1] + Math.sin((start + end) / 2) * r,
    ];
    return { a, b, mid };
  };

  const polyline = (pts: Vec2[], closed: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) shapes.push({ kind: 'line', a: pts[i], b: pts[i + 1] });
    if (closed && pts.length > 2) shapes.push({ kind: 'line', a: pts[pts.length - 1], b: pts[0] });
  };

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    switch (g.type) {
      case 'LINE': {
        shapes.push({
          kind: 'line',
          a: [num(g, 10), num(g, 20)],
          b: [num(g, 11), num(g, 21)],
        });
        break;
      }
      case 'CIRCLE': {
        shapes.push({ kind: 'circle', c: [num(g, 10), num(g, 20)], r: num(g, 40) });
        break;
      }
      case 'ARC': {
        const c: Vec2 = [num(g, 10), num(g, 20)];
        const r = num(g, 40);
        const { a, b, mid } = arcPoints(c, r, num(g, 50, 0), num(g, 51, 360));
        shapes.push({ kind: 'arc', a, b, mid });
        break;
      }
      case 'LWPOLYLINE': {
        const xs = nums(g, 10);
        const ys = nums(g, 20);
        const pts: Vec2[] = xs.map((x, k) => [x, ys[k] ?? 0]);
        polyline(pts, (num(g, 70, 0) & 1) === 1);
        break;
      }
      case 'POLYLINE': {
        const closed = (num(g, 70, 0) & 1) === 1;
        const pts: Vec2[] = [];
        let j = i + 1;
        for (; j < groups.length; j++) {
          if (groups[j].type === 'VERTEX') pts.push([num(groups[j], 10), num(groups[j], 20)]);
          else if (groups[j].type === 'SEQEND') break;
          else if (groups[j].type !== 'VERTEX') break;
        }
        if (pts.length > 1) polyline(pts, closed);
        i = j;
        break;
      }
      case 'ENDSEC':
      case 'SECTION':
      case 'TABLE':
      case 'ENDTAB':
      case 'EOF':
      case 'HEADER':
      case 'ENTITIES':
        break;
      default:
        if (g.codes.length) skipped++;
        break;
    }
  }

  const scaled: DxfShape[] = shapes.map((s) => {
    if (unitScale === 1) return s;
    const m = (p: Vec2): Vec2 => [p[0] * unitScale, p[1] * unitScale];
    if (s.kind === 'line') return { kind: 'line', a: m(s.a), b: m(s.b) };
    if (s.kind === 'circle') return { kind: 'circle', c: m(s.c), r: s.r * unitScale };
    return { kind: 'arc', a: m(s.a), b: m(s.b), mid: m(s.mid) };
  });

  return { shapes: scaled, skipped, unitScale };
}

/* ---------------------------------- STEP ---------------------------------- */

export interface StepImport {
  positions: Vec3[];
  faces: number;
}

const pointTriple = (args: string): Vec3 | null => {
  const m = /\(\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*\)/.exec(args);
  if (!m) return null;
  const p: Vec3 = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  return p.some((v) => !isFinite(v)) ? null : p;
};

/**
 * Faceted STEP import: reads the AP203/AP214 `FACETED_BREP` topology our own
 * writer produces (ADVANCED_FACE → FACE_BOUND → POLY_LOOP → CARTESIAN_POINT).
 * Files that describe analytic or NURBS surfaces instead are rejected with an
 * explanation rather than silently producing nothing.
 */
export function importSTEP(text: string): StepImport {
  const dataStart = text.indexOf('DATA;');
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;
  const statements = body.split(';');
  const points = new Map<number, Vec3>();
  const polyloops = new Map<number, number[]>();
  const bounds = new Map<number, number>();
  const faces: number[][] = [];

  const idOf = (s: string): number => parseInt(s.replace('#', '').trim(), 10);

  for (const raw of statements) {
    const stmt = raw.trim();
    if (!stmt.startsWith('#')) continue;
    const eq = stmt.indexOf('=');
    if (eq < 0) continue;
    const id = idOf(stmt.slice(0, eq));
    if (!isFinite(id)) continue;
    const rhs = stmt.slice(eq + 1).trim();
    const typeMatch = /^([A-Z_0-9]+)\s*\(/.exec(rhs);
    if (!typeMatch) continue;
    const type = typeMatch[1];
    const args = rhs.slice(typeMatch[0].length - 1);

    if (type === 'CARTESIAN_POINT') {
      const p = pointTriple(args);
      if (p) points.set(id, p);
    } else if (type === 'POLY_LOOP') {
      const m = /\(([^()]*)\)/.exec(args);
      if (!m) continue;
      const ids = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('#'))
        .map(idOf)
        .filter((v) => isFinite(v));
      if (ids.length >= 3) polyloops.set(id, ids);
    } else if (type === 'FACE_BOUND' || type === 'FACE_OUTER_BOUND') {
      const m = /#(\d+)/.exec(args);
      if (m) bounds.set(id, idOf(m[1]));
    } else if (type === 'ADVANCED_FACE' || type === 'FACE_SURFACE') {
      const m = /\(([^()]*)\)/.exec(args);
      if (!m) continue;
      const boundIds = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('#'))
        .map(idOf);
      faces.push(boundIds);
    }
  }

  if (!faces.length) {
    throw new Error(
      'This STEP file has no faceted faces. SHAPR imports faceted B-rep STEP (POLY_LOOP geometry).',
    );
  }

  const solidFaces: Face[] = [];
  for (const boundIds of faces) {
    const loops: Vec3[][] = [];
    for (const bId of boundIds) {
      const polyId = bounds.get(bId);
      if (polyId === undefined) continue;
      const ids = polyloops.get(polyId);
      if (!ids) continue;
      const loop = ids.map((i) => points.get(i)).filter((p): p is Vec3 => !!p);
      if (loop.length >= 3) loops.push(loop);
    }
    if (!loops.length) continue;
    const outer = loops[0];
    const n = norm3(cross3(sub3(outer[1], outer[0]), sub3(outer[2], outer[0])));
    if (len3(n) < 0.5) continue;
    solidFaces.push({ plane: { n, d: n[0] * outer[0][0] + n[1] * outer[0][1] + n[2] * outer[0][2] }, loops });
  }

  if (!solidFaces.length) {
    throw new Error('STEP file contained no usable faceted boundaries.');
  }

  const solid: Solid = { faces: solidFaces };
  const positions: Vec3[] = [];
  for (const t of facesToTris(solid)) positions.push(t[0], t[1], t[2]);
  return { positions, faces: solidFaces.length };
}
