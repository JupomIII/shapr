// Import/export for the kernel. Only formats that are genuinely implemented are
// exposed in the UI.

import { Vec2, Vec3 } from './vec';
import { Face, Solid, facesToTris, keyOfPoint } from './solid';

const fmt = (n: number, digits = 6): string => {
  if (!isFinite(n)) n = 0;
  const s = n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '.0');
  return s === '-0.0' ? '0.0' : s;
};

/* ------------------------------ STL (binary) ------------------------------ */

export function exportSTL(solids: Solid[], name = 'part'): { data: Blob; filename: string } {
  const tris: [Vec3, Vec3, Vec3][] = [];
  for (const s of solids) tris.push(...facesToTris(s));
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  const header = `SHAPR binary STL ${name}`;
  for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const p of [a, b, c]) {
      view.setFloat32(o, p[0], true);
      view.setFloat32(o + 4, p[1], true);
      view.setFloat32(o + 8, p[2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return { data: new Blob([buf], { type: 'model/stl' }), filename: `${name}.stl` };
}

/* ---------------------------------- OBJ ---------------------------------- */

export function exportOBJ(solids: Solid[], name = 'part'): { data: Blob; filename: string } {
  const lines: string[] = ['# SHAPR export', `o ${name}`];
  let base = 1;
  for (const s of solids) {
    const tris = facesToTris(s);
    for (const t of tris) for (const p of t) lines.push(`v ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`);
    for (let i = 0; i < tris.length; i++) {
      lines.push(`f ${base + i * 3} ${base + i * 3 + 1} ${base + i * 3 + 2}`);
    }
    base += tris.length * 3;
  }
  return { data: new Blob([lines.join('\n')], { type: 'text/plain' }), filename: `${name}.obj` };
}

/* --------------------------------- STEP ---------------------------------- */

/**
 * Writes an AP214 faceted B-rep (FACETED_BREP / ADVANCED_FACE / PLANE /
 * POLY_LOOP). The topology is exact for planar bodies; tessellated fillets and
 * revolved surfaces are exported as their facets, which is a standard faceted
 * representation that STEP readers accept.
 */
export function exportSTEP(solids: Solid[], name = 'part'): { data: Blob; filename: string } {
  let id = 0;
  const lines: string[] = [];
  const next = () => ++id;
  const emit = (s: string) => lines.push(s);

  const ctx = next();
  emit(`#${ctx}=APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies');`);
  emit(`#${next()}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctx});`);
  const pctx = next();
  emit(`#${pctx}=PRODUCT_CONTEXT('',#${ctx},'mechanical');`);
  const product = next();
  emit(`#${product}=PRODUCT('${name}','${name}','',(#${pctx}));`);
  const pdf = next();
  emit(`#${pdf}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${product},.NOT_KNOWN.);`);
  const pdctx = next();
  emit(`#${pdctx}=PRODUCT_DEFINITION_CONTEXT('part definition',#${ctx},'design');`);
  const pd = next();
  emit(`#${pd}=PRODUCT_DEFINITION('design','',#${pdf},#${pdctx});`);
  const pds = next();
  emit(`#${pds}=PRODUCT_DEFINITION_SHAPE('','',#${pd});`);
  const lenUnit = next();
  emit(`#${lenUnit}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
  const angUnit = next();
  emit(`#${angUnit}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));`);
  const solUnit = next();
  emit(`#${solUnit}=(NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.));`);
  const uncert = next();
  emit(
    `#${uncert}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${lenUnit},'distance_accuracy_value','confusion accuracy');`,
  );
  const repCtx = next();
  emit(
    `#${repCtx}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncert})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${angUnit},#${solUnit})) REPRESENTATION_CONTEXT('',''));`,
  );
  const origin = next();
  emit(`#${origin}=CARTESIAN_POINT('',(0.,0.,0.));`);
  const zDir = next();
  emit(`#${zDir}=DIRECTION('',(0.,0.,1.));`);
  const xDir = next();
  emit(`#${xDir}=DIRECTION('',(1.,0.,0.));`);
  const worldAxis = next();
  emit(`#${worldAxis}=AXIS2_PLACEMENT_3D('',#${origin},#${zDir},#${xDir});`);

  const pointIds = new Map<string, number>();
  const pointRef = (p: Vec3): string => {
    const k = keyOfPoint(p);
    const hit = pointIds.get(k);
    if (hit) return `#${hit}`;
    const pid = next();
    pointIds.set(k, pid);
    emit(`#${pid}=CARTESIAN_POINT('',(${fmt(p[0])},${fmt(p[1])},${fmt(p[2])}));`);
    return `#${pid}`;
  };

  const shells: string[] = [];
  for (const solid of solids) {
    const faceRefs: string[] = [];
    for (const face of solid.faces) {
      if (!face.loops.length || face.loops[0].length < 3) continue;
      const bounds: string[] = [];
      face.loops.forEach((loop, li) => {
        if (loop.length < 3) return;
        const pts = loop.map((p) => pointRef(p));
        const poly = next();
        emit(`#${poly}=POLY_LOOP('',(${pts.map((p) => p).join(',')}));`);
        const bound = next();
        emit(`#${bound}=FACE_BOUND('',#${poly},.T.);`);
        bounds.push(`#${bound}`);
      });
      if (!bounds.length) continue;

      // Plane placement: origin on the face, axis = face normal.
      const n = face.plane.n;
      const p0 = face.loops[0][0];
      const p0id = pointRef(p0);
      const nid = next();
      emit(`#${nid}=DIRECTION('',(${fmt(n[0])},${fmt(n[1])},${fmt(n[2])}));`);
      const ref = Math.abs(n[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
      // refDir = normalize(ref - n*(n.ref)); stable and perpendicular enough.
      const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
      const rx = ref[0] - n[0] * d;
      const ry = ref[1] - n[1] * d;
      const rz = ref[2] - n[2] * d;
      const rl = Math.hypot(rx, ry, rz) || 1;
      const rid = next();
      emit(
        `#${rid}=DIRECTION('',(${fmt(rx / rl)},${fmt(ry / rl)},${fmt(rz / rl)}));`,
      );
      const place = next();
      emit(`#${place}=AXIS2_PLACEMENT_3D('',#${p0id},#${nid},#${rid});`);
      const plane = next();
      emit(`#${plane}=PLANE('',#${place});`);
      const af = next();
      emit(`#${af}=ADVANCED_FACE('',(${bounds.join(',')}),#${plane},.T.);`);
      faceRefs.push(`#${af}`);
    }
    if (!faceRefs.length) continue;
    const shell = next();
    emit(`#${shell}=CLOSED_SHELL('',(${faceRefs.join(',')}));`);
    const brep = next();
    emit(`#${brep}=FACETED_BREP('${name}',#${shell});`);
    shells.push(`#${brep}`);
  }

  const shapeRep = next();
  emit(
    `#${shapeRep}=ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${[...shells, `#${worldAxis}`].join(',')}),#${repCtx});`,
  );
  emit(`#${next()}=SHAPE_DEFINITION_REPRESENTATION(#${pds},#${shapeRep});`);

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('SHAPR faceted B-rep export'),'2;1');",
    `FILE_NAME('${name}.step','${new Date().toISOString().slice(0, 19)}',('SHAPR'),('SHAPR'),'SHAPR','SHAPR','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ];
  return {
    data: new Blob([header.join('\n')], { type: 'application/step' }),
    filename: `${name}.step`,
  };
}

/* ------------------------------- 2D exports ------------------------------ */

export interface SketchExportEntity {
  kind: 'line' | 'circle' | 'arc' | 'spline';
  points: Vec2[];
  radius?: number;
  center?: Vec2;
}

export function exportSVG(loops: Vec2[][], name = 'sketch'): { data: Blob; filename: string } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of loops)
    for (const p of l) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 10;
    maxY = 10;
  }
  const pad = 2;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const paths = loops
    .map(
      (l) =>
        `<path d="M ${l
          .map((p) => `${(p[0] - minX + pad).toFixed(3)} ${(maxY - p[1] + pad).toFixed(3)}`)
          .join(' L ')} Z" fill="none" stroke="#000" stroke-width="0.25"/>`,
    )
    .join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n${paths}\n</svg>\n`;
  return { data: new Blob([svg], { type: 'image/svg+xml' }), filename: `${name}.svg` };
}

/** Minimal DXF (R12) writer: LINE, CIRCLE, ARC entities in millimetres. */
export function exportDXF(entities: SketchExportEntity[], name = 'sketch'): { data: Blob; filename: string } {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const n = (v: number) => v.toFixed(6);
  for (const e of entities) {
    if (e.kind === 'line' && e.points.length >= 2) {
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i];
        const b = e.points[i + 1];
        out.push('0', 'LINE', '8', '0', '10', n(a[0]), '20', n(a[1]), '30', '0');
        out.push('11', n(b[0]), '21', n(b[1]), '31', '0');
      }
    } else if (e.kind === 'circle' && e.center && e.radius) {
      out.push('0', 'CIRCLE', '8', '0', '10', n(e.center[0]), '20', n(e.center[1]), '30', '0', '40', n(e.radius));
    } else if (e.kind === 'arc' && e.center && e.radius) {
      const a = Math.atan2(e.points[1][1] - e.center[1], e.points[1][0] - e.center[0]);
      const b = Math.atan2(e.points[0][1] - e.center[1], e.points[0][0] - e.center[0]);
      out.push(
        '0', 'ARC', '8', '0',
        '10', n(e.center[0]), '20', n(e.center[1]), '30', '0', '40', n(e.radius),
        '50', n(((a * 180) / Math.PI + 360) % 360),
        '51', n(((b * 180) / Math.PI + 360) % 360),
      );
    } else if (e.kind === 'spline' && e.points.length >= 2) {
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i];
        const b = e.points[i + 1];
        out.push('0', 'LINE', '8', '0', '10', n(a[0]), '20', n(a[1]), '30', '0');
        out.push('11', n(b[0]), '21', n(b[1]), '31', '0');
      }
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return { data: new Blob([out.join('\n')], { type: 'application/dxf' }), filename: `${name}.dxf` };
}

/* --------------------------------- import -------------------------------- */

export function importSTL(buffer: ArrayBuffer): { positions: Vec3[] } {
  const view = new DataView(buffer);
  const tris: [Vec3, Vec3, Vec3][] = [];
  const looksAscii = (() => {
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(200, buffer.byteLength)));
    return /^\s*solid/i.test(head) && buffer.byteLength > 0;
  })();

  if (!looksAscii && buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    const expected = 84 + count * 50;
    if (count > 0 && Math.abs(expected - buffer.byteLength) <= 4) {
      let o = 84;
      for (let i = 0; i < count; i++) {
        o += 12;
        const a: Vec3 = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
        o += 12;
        const b: Vec3 = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
        o += 12;
        const c: Vec3 = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
        o += 14;
        tris.push([a, b, c]);
      }
      return { positions: tris.flat() };
    }
  }

  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const verts: Vec3[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.toLowerCase().startsWith('vertex')) continue;
    const parts = t.split(/\s+/);
    verts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
  }
  return { positions: verts };
}

export function importOBJ(text: string): { positions: Vec3[] } {
  const verts: Vec3[] = [];
  const indices: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('v ')) {
      const p = t.split(/\s+/);
      verts.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (t.startsWith('f ')) {
      const p = t.split(/\s+/).slice(1);
      const idx = p.map((s) => {
        const i = parseInt(s.split('/')[0], 10);
        return i > 0 ? i - 1 : verts.length + i;
      });
      for (let i = 1; i + 1 < idx.length; i++) indices.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  const out: Vec3[] = [];
  for (const i of indices) out.push(verts[i] ?? [0, 0, 0]);
  return { positions: out };
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
