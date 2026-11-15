// Checks for the features added on top of the original kernel: shell, sweep,
// loft, split, draft, 3MF, DXF/STEP import and the 2D drawing sheet.
// Run: npm run test:features
import {
  extrudeRegions,
  frameXY,
  loftSolid,
  shellSolid,
  splitByPlane,
  sweepRegions,
} from '../src/kernel/ops';
import { measureSolid, facesToTris } from '../src/kernel/solid';
import { export3MF, exportSTEP, exportSTL } from '../src/kernel/exporters';
import { importDXF, importSTEP } from '../src/kernel/importers';
import { buildDrawingSheet, drawingDXF, drawingPDF, drawingSVG } from '../src/kernel/drawing';

let failures = 0;
const near = (label: string, got: number, want: number, tolPct = 0.5) => {
  const tol = Math.abs(want) * (tolPct / 100);
  const ok = Math.abs(got - want) <= tol || Math.abs(got - want) < 1e-6;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${got.toFixed(3)} (expected ${want.toFixed(3)} ±${tol.toFixed(3)})`,
  );
};
const expect = (label: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const rect = {
  outer: [
    [0, 0],
    [50, 0],
    [50, 30],
    [0, 30],
  ] as [number, number][],
  holes: [] as [number, number][][],
};
const box = extrudeRegions([rect], frameXY, 20);
near('box volume', measureSolid(box).volume, 30000, 0.01);

/* ---------------------------------- draft --------------------------------- */

{
  const draft = 10;
  const h = 20;
  const k = Math.tan((draft * Math.PI) / 180);
  // Cross-section is (50+2s)x(30+2s) with s = k*z, so the volume integrates
  // exactly to 1500h + 160kh²/2 + 4k²h³/3.
  const want = 1500 * h + (160 * k * h * h) / 2 + (4 * k * k * h * h * h) / 3;
  const tapered = extrudeRegions([rect], frameXY, h, draft);
  near('draft 10° volume', measureSolid(tapered).volume, want, 0.2);
  const m = measureSolid(tapered);
  near('draft widens top by 2·h·tan10°', m.bboxMax[0] - m.bboxMin[0], 50 + 2 * h * k, 0.2);
  expect('draft keeps 6 side/cap faces merged', tapered.faces.length <= 7, `${tapered.faces.length} faces`);
}

/* ---------------------------------- shell --------------------------------- */

{
  const topFace = {
    point: [25, 15, 20] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
  };
  const opened = shellSolid(box, 2, [topFace]);
  const want = 30000 - (50 - 4) * (30 - 4) * (20 - 2);
  near('shell 2 mm with open top', opened ? measureSolid(opened).volume : 0, want, 1);
  const closed = shellSolid(box, 2, []);
  near('shell 2 mm closed', closed ? measureSolid(closed).volume : 0, 30000 - 46 * 26 * 16, 1);
  expect('shell fails cleanly with an impossible wall', shellSolid(box, 40, []) === null);
}

/* ---------------------------------- split --------------------------------- */

{
  const halves = splitByPlane(box, [0, 0, 1], 10);
  near('split +Z half', halves.positive ? measureSolid(halves.positive).volume : 0, 15000, 0.5);
  near('split -Z half', halves.negative ? measureSolid(halves.negative).volume : 0, 15000, 0.5);
  const outside = splitByPlane(box, [0, 0, 1], 100);
  expect('split outside the body yields no positive half', outside.positive === null);
}

/* ----------------------------------- loft --------------------------------- */

{
  const circle = (r: number, z: number): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    return pts;
  };
  const lofted = loftSolid([circle(10, 0), circle(5, 20)]);
  const want = (Math.PI * 20 * (100 + 50 + 25)) / 3;
  near('loft frustum volume (48-gon)', lofted ? measureSolid(lofted).volume : 0, want, 1);
  expect('loft needs two profiles', loftSolid([circle(10, 0)]) === null);
}

/* ---------------------------------- sweep --------------------------------- */

{
  const profile = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ] as [number, number][],
    holes: [] as [number, number][][],
  };
  const swept = sweepRegions([profile], frameXY, [
    [0, 0, 0],
    [0, 0, 25],
    [0, 0, 50],
  ]);
  near('sweep 50 mm straight', swept ? measureSolid(swept).volume : 0, 2000, 1);
  const twisting = sweepRegions([profile], frameXY, [
    [0, 0, 0],
    [0, 0, 50],
  ], { twist: 90 });
  expect('swept + twisted solid has geometry', !!twisting && twisting.faces.length > 0);
}

/* ----------------------------------- 3MF ---------------------------------- */

const readZipEntries = (bytes: Uint8Array): Map<string, { crc: number; data: Uint8Array }> => {
  const out = new Map<string, { crc: number; data: Uint8Array }>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Walk the central directory from the end-of-central-directory record.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    const crc = view.getUint32(off + 16, true);
    const size = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nameLen));
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtra = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + localNameLen + localExtra;
    out.set(name, { crc, data: bytes.slice(start, start + size) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crcOf = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

{
  const threeMf = export3MF([
    { name: 'Body 1', solid: box, color: '#c8d3c6' },
    { name: 'Body 2', solid: box, color: '#b9c6d2' },
  ], 'test');
  const bytes = new Uint8Array(await threeMf.data.arrayBuffer());
  expect('3MF is a ZIP package', bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes.length} bytes`);
  const entries = readZipEntries(bytes);
  expect('3MF has OPC content types', entries.has('[Content_Types].xml'));
  expect('3MF has relationships', entries.has('_rels/.rels'));
  const modelEntry = entries.get('3D/3dmodel.model');
  expect('3MF has a model part', !!modelEntry);
  if (modelEntry) {
    expect('3MF model CRC is valid', crcOf(modelEntry.data) === modelEntry.crc);
    const xml = new TextDecoder().decode(modelEntry.data);
    expect('3MF model declares millimetres', /unit="millimeter"/.test(xml));
    expect('3MF carries body colours', (xml.match(/displaycolor="#[0-9A-F]{6}FF"/g) ?? []).length === 2);
    expect('3MF has both objects', (xml.match(/<object /g) ?? []).length === 2);
    expect('3MF has triangles', /<triangle v1="0"/.test(xml));
  }
}

/* --------------------------------- imports -------------------------------- */

{
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0',
    '0', 'CIRCLE', '8', '0', '10', '50', '20', '50', '40', '10',
    '0', 'ARC', '8', '0', '10', '0', '20', '0', '40', '20', '50', '0', '51', '90',
    '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '10', '0', '20', '10',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  const parsed = importDXF(dxf);
  const lines = parsed.shapes.filter((s) => s.kind === 'line');
  expect('DXF LINE imported', parsed.shapes.some((s) => s.kind === 'line'));
  expect('DXF CIRCLE imported', parsed.shapes.some((s) => s.kind === 'circle'));
  expect('DXF ARC imported', parsed.shapes.some((s) => s.kind === 'arc'));
  expect('DXF LWPOLYLINE closed → 4 lines', lines.length === 5, `${lines.length} lines`);

  const step = exportSTEP([box], 'roundtrip');
  const text = await step.data.text();
  const back = importSTEP(text);
  near('STEP faceted roundtrip volume', volumeOfPolySoup(back.positions), 30000, 0.5);
  expect('STEP import reports faces', back.faces > 0, `${back.faces} faces`);

  let rejected = false;
  try {
    importSTEP('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=B_SPLINE_SURFACE(\'\',1,1,1,1);\nENDSEC;\nEND-ISO-10303-21;');
  } catch {
    rejected = true;
  }
  expect('analytic-only STEP is rejected with a message', rejected);
}

function volumeOfPolySoup(positions: [number, number, number][]): number {
  let v = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const [a, b, c] = [positions[i], positions[i + 1], positions[i + 2]];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return Math.abs(v);
}

/* --------------------------------- drawing -------------------------------- */

{
  const sheet = buildDrawingSheet([{ solid: box }], {
    views: ['front', 'top', 'right', 'iso'],
    scale: 1,
    title: 'Test part',
    partNumber: 'SHP-001',
    revision: 'A',
    material: 'Aluminium',
    projection: 'third',
    units: 'mm',
  });
  const total = sheet.views.reduce((a, v) => a + v.lines.length, 0);
  const hidden = sheet.views.reduce((a, v) => a + v.lines.filter((l) => l.hidden).length, 0);
  expect('drawing has 4 views', sheet.views.length === 4);
  expect('drawing projects edges', total > 24, `${total} edges`);
  expect('drawing finds hidden edges', hidden > 0, `${hidden} hidden`);
  const svg = drawingSVG(sheet);
  expect('drawing SVG has paths and title block', svg.includes('<path') && svg.includes('PART NO.'));
  const dxf = drawingDXF(sheet);
  expect('drawing DXF has visible and hidden layers', dxf.includes('VISIBLE') && dxf.includes('HIDDEN'));
  const pdf = new Uint8Array(await drawingPDF(sheet).arrayBuffer());
  const pdfText = new TextDecoder('latin1').decode(pdf);
  expect('drawing PDF header', pdfText.startsWith('%PDF-1.4'));
  const startxref = parseInt(/startxref\s+(\d+)/.exec(pdfText)![1], 10);
  expect('drawing PDF xref offset points at the table', pdfText.slice(startxref, startxref + 4) === 'xref');
  const offsets = [...pdfText.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => parseInt(m[1], 10));
  expect('drawing PDF object offsets are real', offsets.length === 5 && offsets.every((o) => /^\d+ 0 obj/.test(pdfText.slice(o))));
}

/* ---------------------------------- misc ---------------------------------- */

{
  const stl = exportSTL([box], 'test');
  expect('STL still exports', stl.data.size > 84);
  const tris = facesToTris(box);
  expect('box tessellates', tris.length === 12, `${tris.length} triangles`);
}

console.log(failures === 0 ? '\nAll feature checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exitCode = 1;
