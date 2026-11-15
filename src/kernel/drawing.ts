// 2D drawing sheets: orthographic views with hidden-line removal, a title
// block and dimensions, written to SVG, PDF or DXF. Geometry comes straight
// from the B-rep solids, so the drawing always matches the model.

import { Vec2, Vec3, add3, cross3, dist3, dot3, norm3, scale3, sub3 } from './vec';
import { Edge, Solid, solidEdges } from './solid';

export type DrawingViewName = 'front' | 'top' | 'right' | 'iso';

export interface DrawingOptions {
  views: DrawingViewName[];
  /** Drawing scale denominator: 1 = 1:1, 2 = 1:2 … */
  scale: number;
  title: string;
  partNumber: string;
  revision: string;
  material: string;
  /** 'first' or 'third' angle projection. */
  projection: 'first' | 'third';
  units: string;
}

export interface DrawingLine {
  a: Vec2;
  b: Vec2;
  hidden: boolean;
}

export interface DrawingView {
  name: DrawingViewName;
  label: string;
  lines: DrawingLine[];
  /** Model extents in the view, in mm. */
  modelWidth: number;
  modelHeight: number;
  /** Placement of the view centre on the sheet (mm, y down). */
  cx: number;
  cy: number;
  scale: number;
}

export interface DrawingSheet {
  width: number;
  height: number;
  views: DrawingView[];
  options: DrawingOptions;
  date: string;
}

interface ViewFrame {
  right: Vec3;
  up: Vec3;
  normal: Vec3;
}

const VIEWS: Record<DrawingViewName, { frame: ViewFrame; label: string }> = {
  front: {
    label: 'FRONT',
    frame: { right: [1, 0, 0], up: [0, 0, 1], normal: [0, -1, 0] },
  },
  top: {
    label: 'TOP',
    frame: { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  },
  right: {
    label: 'RIGHT',
    frame: { right: [0, 1, 0], up: [0, 0, 1], normal: [1, 0, 0] },
  },
  iso: {
    label: 'ISOMETRIC',
    frame: {
      right: norm3([1, -1, 0]),
      up: norm3([-1, -1, 2]),
      normal: norm3([1, -1, 1]),
    },
  },
};

const A3 = { width: 420, height: 297 };
const MARGIN = 12;
const TITLE_W = 168;
const TITLE_H = 52;

const project = (f: ViewFrame, p: Vec3): Vec2 => [dot3(p, f.right), dot3(p, f.up)];

/** Möller–Trumbore: does the ray from `o` along `d` hit the triangle? */
function rayHitsTriangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const e1 = sub3(b, a);
  const e2 = sub3(c, a);
  const p = cross3(d, e2);
  const det = dot3(e1, p);
  if (Math.abs(det) < 1e-10) return false;
  const inv = 1 / det;
  const t = sub3(o, a);
  const u = dot3(t, p) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return false;
  const q = cross3(t, e1);
  const v = dot3(d, q) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return false;
  const dist = dot3(e2, q) * inv;
  return dist > 1e-3;
}

interface Tri3 {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  min: Vec2;
  max: Vec2;
}

function collectTriangles(bodies: { solid: Solid }[], f: ViewFrame): Tri3[] {
  const out: Tri3[] = [];
  for (const body of bodies) {
    for (const face of body.solid.faces) {
      const loop = face.loops[0];
      if (!loop || loop.length < 3) continue;
      for (let i = 1; i + 1 < loop.length; i++) {
        const a = loop[0];
        const b = loop[i];
        const c = loop[i + 1];
        const pa = project(f, a);
        const pb = project(f, b);
        const pc = project(f, c);
        out.push({
          a,
          b,
          c,
          min: [Math.min(pa[0], pb[0], pc[0]), Math.min(pa[1], pb[1], pc[1])],
          max: [Math.max(pa[0], pb[0], pc[0]), Math.max(pa[1], pb[1], pc[1])],
        });
      }
    }
  }
  return out;
}

function visibleAt(f: ViewFrame, tris: Tri3[], p: Vec3, p2: Vec2): boolean {
  const o = add3(p, scale3(f.normal, 1e-2));
  const pad = 1e-4;
  for (const t of tris) {
    if (
      p2[0] < t.min[0] - pad ||
      p2[0] > t.max[0] + pad ||
      p2[1] < t.min[1] - pad ||
      p2[1] > t.max[1] + pad
    )
      continue;
    if (rayHitsTriangle(o, f.normal, t.a, t.b, t.c)) return false;
  }
  return true;
}

function edgesOf(bodies: { solid: Solid }[]): Edge[] {
  const out: Edge[] = [];
  for (const body of bodies) out.push(...solidEdges(body.solid));
  return out;
}

/**
 * One orthographic view: project every B-rep edge, subdivide it and test each
 * sample against the whole model so occluded runs become dashed hidden lines.
 */
function buildView(
  name: DrawingViewName,
  bodies: { solid: Solid }[],
  sheetScale: number,
): DrawingView {
  const { frame, label } = VIEWS[name];
  const edges = edgesOf(bodies);
  const tris = collectTriangles(bodies, frame);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tris) {
    minX = Math.min(minX, t.min[0]);
    minY = Math.min(minY, t.min[1]);
    maxX = Math.max(maxX, t.max[0]);
    maxY = Math.max(maxY, t.max[1]);
  }
  for (const e of edges) {
    for (const p of [e.a, e.b]) {
      const q = project(frame, p);
      minX = Math.min(minX, q[0]);
      minY = Math.min(minY, q[1]);
      maxX = Math.max(maxX, q[0]);
      maxY = Math.max(maxY, q[1]);
    }
  }
  const modelWidth = isFinite(minX) ? maxX - minX : 0;
  const modelHeight = isFinite(minY) ? maxY - minY : 0;
  const diag = Math.hypot(modelWidth, modelHeight) || 1;
  const step = Math.max(0.4, diag / 160);

  const lines: DrawingLine[] = [];
  for (const e of edges) {
    const len = dist3(e.a, e.b);
    const parts = Math.max(1, Math.ceil(len / step));
    const vis: boolean[] = [];
    for (let i = 0; i < parts; i++) {
      const t = (i + 0.5) / parts;
      const p3 = add3(e.a, scale3(sub3(e.b, e.a), t));
      const p2 = project(frame, p3);
      vis.push(visibleAt(frame, tris, p3, p2));
    }
    // Merge consecutive runs of the same visibility into single lines.
    let start = 0;
    for (let i = 1; i <= parts; i++) {
      if (i === parts || vis[i] !== vis[start]) {
        const t0 = start / parts;
        const t1 = i / parts;
        lines.push({
          a: project(frame, add3(e.a, scale3(sub3(e.b, e.a), t0))),
          b: project(frame, add3(e.a, scale3(sub3(e.b, e.a), t1))),
          hidden: !vis[start],
        });
        start = i;
      }
    }
  }

  return {
    name,
    label,
    lines,
    modelWidth,
    modelHeight,
    cx: 0,
    cy: 0,
    scale: sheetScale,
  };
}

export function buildDrawingSheet(
  bodies: { solid: Solid }[],
  options: DrawingOptions,
): DrawingSheet {
  const views = options.views.length ? options.views : (['front', 'top', 'right', 'iso'] as DrawingViewName[]);
  const built = views.map((v) => buildView(v, bodies, 1 / Math.max(1, options.scale)));

  const gridW = (A3.width - MARGIN * 2 - TITLE_W - 8) / 2;
  const gridH = (A3.height - MARGIN * 2) / 2;
  const cells: { x: number; y: number; w: number; h: number }[] = [
    { x: MARGIN, y: MARGIN, w: gridW, h: gridH },
    { x: MARGIN + gridW + 8, y: MARGIN, w: gridW, h: gridH },
    { x: MARGIN, y: MARGIN + gridH, w: gridW, h: gridH },
    { x: MARGIN + gridW + 8, y: MARGIN + gridH, w: gridW, h: gridH },
  ];

  built.forEach((view, i) => {
    const cell = cells[i % cells.length];
    const fit = Math.min(
      (cell.w - 16) / Math.max(1e-6, view.modelWidth),
      (cell.h - 30) / Math.max(1e-6, view.modelHeight),
    );
    const scale = Math.min(view.scale, fit);
    view.scale = scale > 0 && isFinite(scale) ? scale : view.scale;
    view.cx = cell.x + cell.w / 2;
    view.cy = cell.y + cell.h / 2;
  });

  return {
    width: A3.width,
    height: A3.height,
    views: built,
    options: { ...options, views: views as DrawingViewName[] },
    date: new Date().toISOString().slice(0, 10),
  };
}

/** Sheet-space coordinates for a view's lines (y down, mm). */
function viewLine(view: DrawingView, line: DrawingLine): { x1: number; y1: number; x2: number; y2: number } {
  const map = (p: Vec2): Vec2 => [
    view.cx + p[0] * view.scale,
    view.cy - p[1] * view.scale,
  ];
  const a = map(line.a);
  const b = map(line.b);
  return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
}

const viewBounds = (view: DrawingView) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of view.lines) {
    const s = viewLine(view, l);
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!isFinite(minX)) {
    minX = view.cx - 10;
    minY = view.cy - 10;
    maxX = view.cx + 10;
    maxY = view.cy + 10;
  }
  return { minX, minY, maxX, maxY };
};

const f2 = (v: number) => v.toFixed(2);
const scaleLabel = (denominator: number): string =>
  denominator <= 1 ? '1:1' : `1:${denominator}`;

/* ----------------------------------- SVG ---------------------------------- */

export function drawingSVG(sheet: DrawingSheet): string {
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}mm" height="${sheet.height}mm" viewBox="0 0 ${sheet.width} ${sheet.height}">`,
  );
  out.push(`<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="#fff"/>`);
  out.push(
    `<rect x="${MARGIN / 2}" y="${MARGIN / 2}" width="${sheet.width - MARGIN}" height="${sheet.height - MARGIN}" fill="none" stroke="#000" stroke-width="0.5"/>`,
  );
  for (const view of sheet.views) {
    const visible: string[] = [];
    const hidden: string[] = [];
    for (const line of view.lines) {
      const s = viewLine(view, line);
      (line.hidden ? hidden : visible).push(
        `M ${f2(s.x1)} ${f2(s.y1)} L ${f2(s.x2)} ${f2(s.y2)}`,
      );
    }
    if (visible.length)
      out.push(
        `<path d="${visible.join(' ')}" fill="none" stroke="#000" stroke-width="0.35" stroke-linecap="round"/>`,
      );
    if (hidden.length)
      out.push(
        `<path d="${hidden.join(' ')}" fill="none" stroke="#000" stroke-width="0.18" stroke-dasharray="2 1.4" stroke-linecap="round"/>`,
      );
    const b = viewBounds(view);
    out.push(
      `<text x="${f2(view.cx)}" y="${f2(b.maxY + 8)}" font-family="Helvetica, Arial, sans-serif" font-size="3.6" text-anchor="middle" fill="#000">${view.label}  ${scaleLabel(sheet.options.scale)}</text>`,
    );
    // Overall dimensions.
    out.push(
      `<path d="M ${f2(b.minX)} ${f2(b.maxY + 3)} L ${f2(b.maxX)} ${f2(b.maxY + 3)}" stroke="#000" stroke-width="0.18"/>`,
    );
    out.push(
      `<text x="${f2((b.minX + b.maxX) / 2)}" y="${f2(b.maxY + 2)}" font-family="Helvetica, Arial, sans-serif" font-size="3" text-anchor="middle" fill="#000">${f2(view.modelWidth)} ${sheet.options.units}</text>`,
    );
    out.push(
      `<path d="M ${f2(b.minX - 3)} ${f2(b.minY)} L ${f2(b.minX - 3)} ${f2(b.maxY)}" stroke="#000" stroke-width="0.18"/>`,
    );
    out.push(
      `<text x="${f2(b.minX - 4)}" y="${f2((b.minY + b.maxY) / 2)}" font-family="Helvetica, Arial, sans-serif" font-size="3" text-anchor="middle" fill="#000" transform="rotate(-90 ${f2(b.minX - 4)} ${f2((b.minY + b.maxY) / 2)})">${f2(view.modelHeight)} ${sheet.options.units}</text>`,
    );
  }
  out.push(titleBlockSVG(sheet));
  out.push('</svg>');
  return out.join('\n');
}

function titleBlockSVG(sheet: DrawingSheet): string {
  const x = sheet.width - MARGIN - TITLE_W;
  const y = sheet.height - MARGIN - TITLE_H;
  const rows = titleRows(sheet);
  const o: string[] = [];
  o.push(
    `<rect x="${x}" y="${y}" width="${TITLE_W}" height="${TITLE_H}" fill="none" stroke="#000" stroke-width="0.35"/>`,
  );
  rows.forEach((row, i) => {
    const ry = y + (i * TITLE_H) / rows.length;
    if (i > 0)
      o.push(`<path d="M ${x} ${f2(ry)} L ${x + TITLE_W} ${f2(ry)}" stroke="#000" stroke-width="0.15"/>`);
    o.push(
      `<text x="${x + 2}" y="${f2(ry + 3.4)}" font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#666">${row[0]}</text>`,
    );
    o.push(
      `<text x="${x + 24}" y="${f2(ry + 3.9)}" font-family="Helvetica, Arial, sans-serif" font-size="3.2" fill="#000">${row[1]}</text>`,
    );
  });
  return o.join('\n');
}

function titleRows(sheet: DrawingSheet): [string, string][] {
  const o = sheet.options;
  return [
    ['TITLE', o.title],
    ['PART NO.', o.partNumber],
    ['MATERIAL', o.material],
    ['REVISION', o.revision],
    ['SCALE', scaleLabel(o.scale)],
    ['UNITS', o.units],
    ['PROJECTION', o.projection === 'first' ? 'FIRST ANGLE' : 'THIRD ANGLE'],
    ['SHEET', `1 / 1`],
    ['DATE', sheet.date],
  ];
}

/* ----------------------------------- PDF ---------------------------------- */

const PT_PER_MM = 72 / 25.4;

const pdfEscape = (s: string): string =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');

/**
 * Minimal vector PDF (one page, Helvetica). Lines are real vector paths, so the
 * sheet prints sharply at any size instead of being a raster screenshot.
 */
export function drawingPDF(sheet: DrawingSheet): Blob {
  const pageW = sheet.width * PT_PER_MM;
  const pageH = sheet.height * PT_PER_MM;
  const y = (mm: number) => (sheet.height - mm) * PT_PER_MM;
  const x = (mm: number) => mm * PT_PER_MM;
  const ops: string[] = [];
  const stroke = (w: number, dash?: number[]) => {
    ops.push(`${w.toFixed(3)} w`);
    ops.push(dash ? `[${dash.map((d) => d.toFixed(2)).join(' ')}] 0 d` : '[] 0 d');
    ops.push('0 0 0 RG');
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ops.push(`${x(x1).toFixed(2)} ${y(y1).toFixed(2)} m ${x(x2).toFixed(2)} ${y(y2).toFixed(2)} l S`);
  };
  const text = (px: number, py: number, size: number, value: string) => {
    ops.push(
      `BT /F1 ${size.toFixed(2)} Tf ${x(px).toFixed(2)} ${y(py).toFixed(2)} Td (${pdfEscape(value)}) Tj ET`,
    );
  };

  stroke(0.5);
  line(MARGIN / 2, MARGIN / 2, sheet.width - MARGIN / 2, MARGIN / 2);
  line(sheet.width - MARGIN / 2, MARGIN / 2, sheet.width - MARGIN / 2, sheet.height - MARGIN / 2);
  line(sheet.width - MARGIN / 2, sheet.height - MARGIN / 2, MARGIN / 2, sheet.height - MARGIN / 2);
  line(MARGIN / 2, sheet.height - MARGIN / 2, MARGIN / 2, MARGIN / 2);

  for (const view of sheet.views) {
    const vis = view.lines.filter((l) => !l.hidden);
    const hid = view.lines.filter((l) => l.hidden);
    stroke(0.35);
    for (const l of vis) {
      const s = viewLine(view, l);
      line(s.x1, s.y1, s.x2, s.y2);
    }
    stroke(0.18, [2, 1.4]);
    for (const l of hid) {
      const s = viewLine(view, l);
      line(s.x1, s.y1, s.x2, s.y2);
    }
    const b = viewBounds(view);
    stroke(0.18);
    line(b.minX, b.maxY + 3, b.maxX, b.maxY + 3);
    line(b.minX - 3, b.minY, b.minX - 3, b.maxY);
    const label = `${view.label}  ${scaleLabel(sheet.options.scale)}`;
    ops.push(`BT /F1 3.4 Tf ${x(view.cx - label.length * 0.9).toFixed(2)} ${y(b.maxY + 9).toFixed(2)} Td (${pdfEscape(label)}) Tj ET`);
    const w = `${f2(view.modelWidth)} ${sheet.options.units}`;
    ops.push(`BT /F1 3 Tf ${x((b.minX + b.maxX) / 2 - 6).toFixed(2)} ${y(b.maxY + 2).toFixed(2)} Td (${pdfEscape(w)}) Tj ET`);
    const h = `${f2(view.modelHeight)} ${sheet.options.units}`;
    ops.push(
      `BT /F1 3 Tf 0 1 -1 0 ${x(b.minX - 5).toFixed(2)} ${y((b.minY + b.maxY) / 2).toFixed(2)} Tm (${pdfEscape(h)}) Tj ET`,
    );
  }

  const tx = sheet.width - MARGIN - TITLE_W;
  const ty = sheet.height - MARGIN - TITLE_H;
  const rows = titleRows(sheet);
  stroke(0.35);
  line(tx, ty, tx + TITLE_W, ty);
  line(tx + TITLE_W, ty, tx + TITLE_W, ty + TITLE_H);
  line(tx + TITLE_W, ty + TITLE_H, tx, ty + TITLE_H);
  line(tx, ty + TITLE_H, tx, ty);
  stroke(0.15);
  rows.forEach((row, i) => {
    const ry = ty + (i * TITLE_H) / rows.length;
    if (i > 0) line(tx, ry, tx + TITLE_W, ry);
    text(tx + 2, ry + 3.4, 2.6, row[0]);
    text(tx + 24, ry + 3.9, 3.2, row[1]);
  });

  const content = ops.join('\n');
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
  );
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}

/* ----------------------------------- DXF ---------------------------------- */

/** Sheet-space DXF: every edge as a LINE, hidden edges on the HIDDEN layer. */
export function drawingDXF(sheet: DrawingSheet): string {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const n = (v: number) => v.toFixed(4);
  for (const view of sheet.views) {
    for (const l of view.lines) {
      const s = viewLine(view, l);
      out.push('0', 'LINE', '8', l.hidden ? 'HIDDEN' : 'VISIBLE', '62', l.hidden ? '8' : '7');
      out.push('10', n(s.x1), '20', n(sheet.height - s.y1), '30', '0');
      out.push('11', n(s.x2), '21', n(sheet.height - s.y2), '31', '0');
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

export { A3 };
