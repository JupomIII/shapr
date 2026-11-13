import { useEffect, useRef, useState } from 'react';
import { Vec3 } from '../kernel/vec';
import { faceArea, measureSolid, solidEdges } from '../kernel/solid';
import { sketchLoops, polygonCentroid } from '../sketch/geometry';
import {
  download,
  exportDXF,
  exportOBJ,
  exportSTEP,
  exportSTL,
  exportSVG,
  importOBJ,
  importSTL,
  SketchExportEntity,
} from '../kernel/exporters';
import * as S from '../state/store';
import * as OPS from '../state/ops';
import { Feature, UNIT_FACTOR, UnitSystem, fromDisplay, toDisplay } from '../model/types';
import { Icon, IconName } from './Icons';
import { fmtNum } from './Chips';

const NumField = ({
  label,
  value,
  step = 1,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  suffix?: string;
  onCommit: (v: number) => void;
}) => {
  // Values are stored in mm; length fields display in the project unit.
  const isLength = suffix === 'mm';
  const units = S.store.state.doc.units;
  const shown = isLength ? toDisplay(value, units) : value;
  const [text, setText] = useState(fmtNum(shown, 3));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmtNum(shown, 3));
  }, [shown, focused]);
  const commit = () => {
    const typed = parseFloat(text.replace(',', '.'));
    if (!isFinite(typed)) {
      setText(fmtNum(shown, 3));
      return;
    }
    const v = isLength ? fromDisplay(typed, units) : typed;
    if (Math.abs(v - value) > 1e-9) onCommit(v);
    else setText(fmtNum(shown, 3));
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          value={text}
          inputMode="decimal"
          step={step}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix ? (
          <span style={{ color: 'var(--muted)', width: 26 }}>{isLength ? units : suffix}</span>
        ) : null}
      </div>
    </div>
  );
};

const iconForFeature = (f: Feature): IconName => {
  switch (f.kind) {
    case 'sketch':
      return 'sketch';
    case 'extrude':
      return f.operation === 'cut' ? 'cut' : 'extrude';
    case 'revolve':
      return 'revolve';
    case 'fillet':
      return 'fillet';
    case 'chamfer':
      return 'chamfer';
    case 'pushpull':
      return 'extrude';
    case 'pattern':
      return 'pattern';
    case 'mirror':
      return 'mirror';
    case 'transform':
      return 'cube';
    case 'import':
      return 'folder';
    default:
      return 'cube';
  }
};

const unitsNow = (): UnitSystem => S.store.state.doc.units;
const lenText = (mm: number, digits = 2): string =>
  `${fmtNum(toDisplay(mm, unitsNow()), digits)} ${unitsNow()}`;
const volText = (mm3: number, digits = 1): string => {
  const f = UNIT_FACTOR[unitsNow()];
  return `${fmtNum(mm3 / (f * f * f), digits)} ${unitsNow()}³`;
};

const featureMeta = (f: Feature): string => {
  const units = S.store.state.doc.units;
  const len = (mm: number, digits = 2) => `${fmtNum(toDisplay(mm, units), digits)} ${units}`;
  switch (f.kind) {
    case 'sketch':
      return 'sketch';
    case 'extrude':
      return `${f.operation} ${f.throughAll ? 'thru' : len(f.height, 1)}`;
    case 'revolve':
      return `${fmtNum(f.angle, 0)}°`;
    case 'fillet':
      return `R${len(f.radius)}`;
    case 'chamfer':
      return len(f.distance);
    case 'pushpull':
      return len(f.distance);
    case 'pattern':
      return `${f.mode} ×${f.count}`;
    case 'mirror':
      return f.plane;
    case 'transform':
      return 'move';
    case 'import':
      return 'mesh';
    default:
      return '';
  }
};

function FeatureFields({ f }: { f: Feature }) {
  const update = (patch: Partial<Feature>) => S.updateFeature(f.id, patch);
  switch (f.kind) {
    case 'extrude':
      return (
        <>
          <NumField label="Height" value={f.height} suffix="mm" onCommit={(v) => update({ height: v } as Partial<Feature>)} />
          <div className="field">
            <label>Operation</label>
            <select
              value={f.operation}
              onChange={(e) => update({ operation: e.target.value as never })}
            >
              <option value="new">New body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
              <option value="intersect">Intersect</option>
            </select>
          </div>
          <div className="field">
            <label>Through all</label>
            <input
              type="checkbox"
              checked={!!f.throughAll}
              style={{ width: 18, height: 18 }}
              onChange={(e) => update({ throughAll: e.target.checked } as Partial<Feature>)}
            />
          </div>
          <div className="field">
            <label>Direction</label>
            <select
              value={f.direction}
              onChange={(e) => update({ direction: Number(e.target.value) as 1 | -1 } as Partial<Feature>)}
            >
              <option value={1}>Along normal</option>
              <option value={-1}>Against normal</option>
            </select>
          </div>
        </>
      );
    case 'revolve':
      return (
        <>
          <NumField label="Angle" value={f.angle} suffix="°" onCommit={(v) => update({ angle: v } as Partial<Feature>)} />
          <div className="field">
            <label>Operation</label>
            <select value={f.operation} onChange={(e) => update({ operation: e.target.value as never })}>
              <option value="new">New body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
        </>
      );
    case 'fillet':
      return (
        <>
          <NumField label="Radius" value={f.radius} suffix="mm" onCommit={(v) => update({ radius: Math.max(0.05, v) } as Partial<Feature>)} />
          <NumField label="Facets" value={f.segments ?? 8} onCommit={(v) => update({ segments: Math.round(Math.max(2, Math.min(24, v))) } as Partial<Feature>)} />
        </>
      );
    case 'chamfer':
      return (
        <NumField label="Distance" value={f.distance} suffix="mm" onCommit={(v) => update({ distance: Math.max(0.05, v) } as Partial<Feature>)} />
      );
    case 'pushpull':
      return (
        <NumField label="Offset" value={f.distance} suffix="mm" onCommit={(v) => update({ distance: v } as Partial<Feature>)} />
      );
    case 'pattern':
      return (
        <>
          <div className="field">
            <label>Mode</label>
            <select value={f.mode} onChange={(e) => update({ mode: e.target.value as never })}>
              <option value="linear">Linear</option>
              <option value="circular">Circular</option>
            </select>
          </div>
          <NumField label="Count" value={f.count} onCommit={(v) => update({ count: Math.max(1, Math.round(v)) } as Partial<Feature>)} />
          {f.mode === 'linear' ? (
            <NumField label="Spacing" value={f.spacing} suffix="mm" onCommit={(v) => update({ spacing: v } as Partial<Feature>)} />
          ) : (
            <NumField label="Sweep" value={f.angle} suffix="°" onCommit={(v) => update({ angle: v } as Partial<Feature>)} />
          )}
        </>
      );
    case 'mirror':
      return (
        <div className="field">
          <label>Plane</label>
          <select value={f.plane} onChange={(e) => update({ plane: e.target.value as never })}>
            <option value="YZ">YZ</option>
            <option value="XZ">XZ</option>
            <option value="XY">XY</option>
          </select>
        </div>
      );
    case 'transform':
      return (
        <>
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <NumField
              key={axis}
              label={`Move ${axis}`}
              value={f.translation[i]}
              suffix="mm"
              onCommit={(v) => {
                const t = [...f.translation] as Vec3;
                t[i] = v;
                update({ translation: t } as Partial<Feature>);
              }}
            />
          ))}
          <NumField
            label="Rotate Z"
            value={f.rotationAngle ?? 0}
            suffix="°"
            onCommit={(v) => update({ rotationAngle: v, rotationAxis: [0, 0, 1] } as Partial<Feature>)}
          />
        </>
      );
    default:
      return null;
  }
}

export function FeaturePanel() {
  const s = S.useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const rollback = s.doc.rollback ?? null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>
          Feature tree <span className="sub">{s.doc.features.length} features</span>
        </span>
        <button className="icon-btn" onClick={() => S.store.set({ panel: 'none' })}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        {s.doc.features.length === 0 && (
          <div className="hint-text">No features yet. Start a sketch to build the first feature.</div>
        )}
        {s.doc.features.map((f, i) => {
          const err = s.evalResult.errors[f.id];
          const rolledBack = rollback !== null && i >= rollback;
          return (
            <div key={f.id}>
              <button
                className={`row ${editing === f.id ? 'selected' : ''}`}
                style={{ opacity: rolledBack ? 0.45 : 1 }}
                onClick={() => {
                  if (f.kind === 'sketch') {
                    S.store.set({
                      mode: 'sketch',
                      activeSketchId: f.sketchId,
                      sketchTool: 'select',
                      selection: [],
                      visibleSketchIds: Array.from(new Set([...s.visibleSketchIds, f.sketchId])),
                    });
                  }
                  setEditing(editing === f.id ? null : f.id);
                }}
              >
                <span className="tree-icon">
                  <Icon name={iconForFeature(f)} size={15} />
                </span>
                <span className="name">{f.name}</span>
                {err ? <span className="error-dot" title={err} /> : null}
                <span className="meta">{featureMeta(f)}</span>
                <span
                  className={`mini ${f.hidden ? '' : 'on'}`}
                  role="button"
                  title={f.hidden ? 'Show' : 'Hide'}
                  onClick={(e) => {
                    e.stopPropagation();
                    S.toggleFeatureHidden(f.id);
                  }}
                >
                  <Icon name={f.hidden ? 'eyeOff' : 'eye'} size={14} />
                </span>
                <span
                  className="mini"
                  role="button"
                  title="Delete feature"
                  onClick={(e) => {
                    e.stopPropagation();
                    S.deleteFeature(f.id);
                  }}
                >
                  <Icon name="trash" size={14} />
                </span>
              </button>
              {err ? (
                <div className="hint-text" style={{ color: '#e08d86', paddingTop: 0 }}>
                  {err}
                </div>
              ) : null}
              {editing === f.id && f.kind !== 'sketch' && (
                <div style={{ padding: '2px 6px 8px' }}>
                  <FeatureFields f={f} />
                  <button
                    className="format-btn"
                    style={{ marginLeft: 8, marginTop: 4 }}
                    onClick={() => S.setRollback(i)}
                  >
                    Roll back to before this feature
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {rollback !== null && (
          <button className="row" onClick={() => S.setRollback(null)}>
            <span className="tree-icon">
              <Icon name="rollback" size={15} />
            </span>
            <span className="name">Rollback active — resume all</span>
          </button>
        )}

        <div className="panel-section-title">Bodies</div>
        {s.evalResult.bodies.length === 0 && <div className="hint-text">No solid bodies yet.</div>}
        {s.evalResult.bodies.map((b) => (
          <button
            key={b.id}
            className={`row ${s.selection.some((x) => x.bodyId === b.id && x.kind === 'body') ? 'selected' : ''}`}
            onClick={() => S.setSelection([{ kind: 'body', bodyId: b.id }])}
          >
            <span className="tree-icon">
              <Icon name="cube" size={15} />
            </span>
            <span className="name">{b.name}</span>
            <span className="meta">{volText(b.measure.volume)}</span>
            <span
              className={`mini ${b.hidden ? '' : 'on'}`}
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                S.toggleFeatureHidden(b.featureId);
              }}
            >
              <Icon name={b.hidden ? 'eyeOff' : 'eye'} size={14} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- projects -------------------------------- */

const sketchEntitiesForExport = (sketchId: string): SketchExportEntity[] => {
  const sk = S.store.state.doc.sketches.find((x) => x.id === sketchId);
  if (!sk) return [];
  const out: SketchExportEntity[] = [];
  for (const e of sk.entities) {
    if (e.kind === 'line') {
      const a = sk.points[e.a];
      const b = sk.points[e.b];
      if (a && b) out.push({ kind: 'line', points: [a, b] });
    } else if (e.kind === 'circle') {
      const c = sk.points[e.c];
      if (c) out.push({ kind: 'circle', points: [c], center: c, radius: e.r });
    } else if (e.kind === 'arc') {
      const a = sk.points[e.a];
      const b = sk.points[e.b];
      const m = sk.points[e.mid];
      if (!a || !b || !m) continue;
      const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
      if (Math.abs(d) < 1e-9) continue;
      const a2 = a[0] * a[0] + a[1] * a[1];
      const b2 = b[0] * b[0] + b[1] * b[1];
      const m2 = m[0] * m[0] + m[1] * m[1];
      const cx = (a2 * (b[1] - m[1]) + b2 * (m[1] - a[1]) + m2 * (a[1] - b[1])) / d;
      const cy = (a2 * (m[0] - b[0]) + b2 * (a[0] - m[0]) + m2 * (b[0] - a[0])) / d;
      out.push({
        kind: 'arc',
        points: [b, a],
        center: [cx, cy],
        radius: Math.hypot(a[0] - cx, a[1] - cy),
      });
    }
  }
  return out;
};

export function ProjectsPanel() {
  const s = S.useApp();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.doc.name);
  const fileRef = useRef<HTMLInputElement>(null);

  const bodies = s.evalResult.bodies.filter((b) => !b.hidden).map((b) => b.solid);
  const activeSketch = s.activeSketchId ?? s.doc.sketches[s.doc.sketches.length - 1]?.id ?? null;

  const onImport = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.stl')) {
        const buf = await file.arrayBuffer();
        const { positions } = importSTL(buf);
        if (!positions.length) {
          S.toast('No triangles found in STL');
          return;
        }
        S.addFeature({
          id: S.uid('ft'),
          name: `Import ${file.name}`,
          kind: 'import',
          positions,
        });
        S.toast('Mesh imported as a body');
      } else if (file.name.toLowerCase().endsWith('.obj')) {
        const text = await file.text();
        const { positions } = importOBJ(text);
        if (!positions.length) {
          S.toast('No faces found in OBJ');
          return;
        }
        S.addFeature({
          id: S.uid('ft'),
          name: `Import ${file.name}`,
          kind: 'import',
          positions,
        });
        S.toast('Mesh imported as a body');
      } else {
        S.toast('Unsupported file. Use STL or OBJ.');
      }
    } catch {
      S.toast('Import failed');
    }
  };

  return (
    <div className="panel left">
      <div className="panel-head">
        <span>Projects</span>
        <button className="icon-btn" onClick={() => S.store.set({ panel: 'none' })}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        <div className="project-list">
          <button className="row" onClick={() => void S.createProject()}>
            <span className="tree-icon">
              <Icon name="plus" size={15} />
            </span>
            <span className="name">New project</span>
          </button>
          <button className="row" onClick={() => void S.persist(true)}>
            <span className="tree-icon">
              <Icon name="save" size={15} />
            </span>
            <span className="name">Save now</span>
            <span className="meta">{s.saving ? 'saving…' : 'autosave on'}</span>
          </button>
          <button className="row" onClick={() => void S.duplicateCurrentProject()}>
            <span className="tree-icon">
              <Icon name="folder" size={15} />
            </span>
            <span className="name">Duplicate current</span>
          </button>
          <button className="row" onClick={() => void S.removeProject(s.doc.id)}>
            <span className="tree-icon">
              <Icon name="trash" size={15} />
            </span>
            <span className="name">Delete current</span>
          </button>
        </div>

        {renaming ? (
          <div className="field">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim()) void S.renameCurrentProject(name.trim());
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        ) : (
          <div className="field">
            <label>Project name</label>
            <button
              className="format-btn"
              onClick={() => {
                setName(s.doc.name);
                setRenaming(true);
              }}
            >
              Rename
            </button>
          </div>
        )}

        <div className="field">
          <label>Units</label>
          <select
            value={s.doc.units}
            onChange={(e) => S.setUnits(e.target.value as UnitSystem)}
          >
            <option value="mm">Millimeters</option>
            <option value="cm">Centimeters</option>
            <option value="m">Meters</option>
            <option value="in">Inches</option>
          </select>
        </div>

        <div className="panel-section-title">Export</div>
        <div className="formats">
          <button
            className="format-btn"
            disabled={!bodies.length}
            onClick={() => {
              const { data, filename } = exportSTL(bodies, s.doc.name);
              download(data, filename);
              S.toast('STL exported');
            }}
          >
            STL
          </button>
          <button
            className="format-btn"
            disabled={!bodies.length}
            onClick={() => {
              const { data, filename } = exportOBJ(bodies, s.doc.name);
              download(data, filename);
              S.toast('OBJ exported');
            }}
          >
            OBJ
          </button>
          <button
            className="format-btn"
            disabled={!bodies.length}
            onClick={() => {
              const { data, filename } = exportSTEP(bodies, s.doc.name);
              download(data, filename);
              S.toast('STEP (faceted B-rep) exported');
            }}
          >
            STEP
          </button>
          <button
            className="format-btn"
            disabled={!activeSketch}
            onClick={() => {
              if (!activeSketch) return;
              const { data, filename } = exportDXF(sketchEntitiesForExport(activeSketch), s.doc.name);
              download(data, filename);
              S.toast('DXF exported');
            }}
          >
            DXF (sketch)
          </button>
          <button
            className="format-btn"
            disabled={!activeSketch}
            onClick={() => {
              if (!activeSketch) return;
              const sk = s.doc.sketches.find((x) => x.id === activeSketch);
              if (!sk) return;
              const { data, filename } = exportSVG(sketchLoops(sk), s.doc.name);
              download(data, filename);
              S.toast('SVG exported');
            }}
          >
            SVG (sketch)
          </button>
          <button className="format-btn" disabled title="3MF is not implemented">
            3MF
          </button>
        </div>
        <div className="hint-text">
          STEP is written as a faceted B-rep (exact for planar bodies, tessellated for fillets and
          revolves). 3MF export and STEP import are not implemented.
        </div>

        <div className="panel-section-title">Import</div>
        <div className="formats">
          <button className="format-btn" onClick={() => fileRef.current?.click()}>
            STL / OBJ
          </button>
          <button className="format-btn" disabled title="STEP import is not implemented">
            STEP
          </button>
          <button className="format-btn" disabled title="DXF import is not implemented">
            DXF
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".stl,.obj"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />

        <div className="panel-section-title">Recent</div>
        <div className="project-list">
          {s.projects.length === 0 && <div className="hint-text">No saved projects yet.</div>}
          {s.projects.map((p) => (
            <div
              key={p.id}
              className={`project-card ${p.id === s.doc.id ? 'current' : ''}`}
              onClick={() => void S.openProject(p.id)}
            >
              <div
                className="thumb"
                style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined}
              />
              <div className="info">
                <strong>{p.name}</strong>
                <span>{new Date(p.updatedAt).toLocaleString()}</span>
              </div>
              <button
                className="mini"
                title="Delete project"
                onClick={(e) => {
                  e.stopPropagation();
                  void S.removeProject(p.id);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- measure --------------------------------- */

export function MeasurePanel() {
  const s = S.useApp();
  const sel = s.selection[0];
  const rows: [string, string][] = [];
  const unit = s.doc.units;
  const f = UNIT_FACTOR[unit];
  const L = (mm: number) => `${fmtNum(toDisplay(mm, unit), 2)} ${unit}`;
  const A = (mm2: number) => `${fmtNum(mm2 / (f * f), 2)} ${unit}²`;
  const V = (mm3: number) => `${fmtNum(mm3 / (f * f * f), 2)} ${unit}³`;

  const body = sel?.bodyId ? s.evalResult.bodies.find((b) => b.id === sel.bodyId) : null;

  if (body && sel?.kind === 'face' && sel.faceIndex !== undefined) {
    const face = body.solid.faces[sel.faceIndex];
    if (face) {
      rows.push(['Face area', A(faceArea(face))]);
      rows.push(['Normal', `(${face.plane.n.map((v) => fmtNum(v, 2)).join(', ')})`]);
      rows.push(['Plane offset', L(face.plane.d)]);
      rows.push(['Boundary loops', String(face.loops.length)]);
    }
  } else if (body && sel?.kind === 'edge' && sel.edgeKey) {
    const edge = solidEdges(body.solid).find((e) => e.key === sel.edgeKey);
    if (edge) {
      rows.push([
        'Edge length',
        L(Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1], edge.b[2] - edge.a[2])),
      ]);
      rows.push(['Faces', String(edge.faces.length)]);
    }
  } else if (body) {
    const m = measureSolid(body.solid);
    rows.push(['Volume', V(m.volume)]);
    rows.push(['Surface area', A(m.area)]);
    rows.push([
      'Bounding box',
      `${fmtNum(toDisplay(m.bboxMax[0] - m.bboxMin[0], unit), 2)} × ${fmtNum(toDisplay(m.bboxMax[1] - m.bboxMin[1], unit), 2)} × ${fmtNum(toDisplay(m.bboxMax[2] - m.bboxMin[2], unit), 2)} ${unit}`,
    ]);
    rows.push(['Center of mass', `(${m.centroid.map((v) => fmtNum(v, 2)).join(', ')})`]);
    rows.push(['Faces / triangles', `${body.solid.faces.length} / ${m.triangles}`]);
  } else if (sel?.kind === 'region' && sel.sketchId) {
    const sk = s.doc.sketches.find((x) => x.id === sel.sketchId);
    if (sk) {
      const loops = sketchLoops(sk);
      const l = loops[sel.regionIndex ?? 0];
      if (l) {
        let area = 0;
        let per = 0;
        for (let i = 0; i < l.length; i++) {
          const a = l[i];
          const b = l[(i + 1) % l.length];
          area += a[0] * b[1] - b[0] * a[1];
          per += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        rows.push(['Profile area', A(Math.abs(area / 2))]);
        rows.push(['Perimeter', L(per)]);
        const c = polygonCentroid(l);
        rows.push(['Centroid', `(${fmtNum(c[0], 2)}, ${fmtNum(c[1], 2)})`]);
      }
    }
  } else {
    const all = s.evalResult.bodies.filter((b) => !b.hidden);
    if (!all.length) {
      rows.push(['Model', 'no bodies']);
    } else {
      let vol = 0;
      let area = 0;
      for (const b of all) {
        const m = measureSolid(b.solid);
        vol += m.volume;
        area += m.area;
      }
      rows.push(['Bodies', String(all.length)]);
      rows.push(['Total volume', V(vol)]);
      rows.push(['Total area', A(area)]);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Measure</span>
        <button className="icon-btn" onClick={() => S.store.set({ panel: 'none' })}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        <div className="hint-text" style={{ paddingTop: 4 }}>
          {sel ? OPS.selectionSummary() : 'Nothing selected — showing the whole model.'}
        </div>
        {rows.map(([k, v]) => (
          <div className="stat" key={k}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------- help ---------------------------------- */

export function HelpPanel() {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>Interaction</span>
        <button className="icon-btn" onClick={() => S.store.set({ panel: 'none' })}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        <div className="panel-section-title">Apple Pencil</div>
        <div className="help-row">
          <span className="keys">Pencil drag</span>
          <span className="desc">Sketch, select, drag profiles, faces and edges</span>
        </div>
        <div className="help-row">
          <span className="keys">Pencil tap</span>
          <span className="desc">Select entity, face or edge</span>
        </div>
        <div className="help-row">
          <span className="keys">Pencil double tap</span>
          <span className="desc">Select the whole body</span>
        </div>
        <div className="help-row">
          <span className="keys">Side shake</span>
          <span className="desc">While drawing a line, switch it to an arc</span>
        </div>
        <div className="panel-section-title">Fingers</div>
        <div className="help-row">
          <span className="keys">1 finger drag</span>
          <span className="desc">
            Orbit on empty space. Without a Pencil, it draws in a sketch and drags faces and
            profiles directly.
          </span>
        </div>
        <div className="help-row">
          <span className="keys">2 fingers</span>
          <span className="desc">Pan, pinch to zoom, twist to rotate</span>
        </div>
        <div className="help-row">
          <span className="keys">Long press + drag</span>
          <span className="desc">Box-select bodies</span>
        </div>
        <div className="help-row">
          <span className="keys">Double tap</span>
          <span className="desc">Focus the camera on a face</span>
        </div>
        <div className="help-row">
          <span className="keys">3-finger swipe</span>
          <span className="desc">Left: undo — Right: redo</span>
        </div>
        <div className="panel-section-title">Mouse & trackpad</div>
        <div className="help-row">
          <span className="keys">Drag empty space</span>
          <span className="desc">Orbit the camera</span>
        </div>
        <div className="help-row">
          <span className="keys">Right-drag</span>
          <span className="desc">Pan</span>
        </div>
        <div className="help-row">
          <span className="keys">Scroll / pinch</span>
          <span className="desc">Zoom</span>
        </div>
        <div className="help-row">
          <span className="keys">Option / middle drag</span>
          <span className="desc">Orbit from anywhere, including over geometry</span>
        </div>
        <div className="panel-section-title">Keyboard</div>
        <div className="help-row">
          <span className="keys">
            <span className="kbd">V</span> <span className="kbd">S</span> <span className="kbd">L</span>{' '}
            <span className="kbd">R</span> <span className="kbd">C</span>
          </span>
          <span className="desc">Select, sketch, line, rectangle, circle</span>
        </div>
        <div className="help-row">
          <span className="keys">
            <span className="kbd">⌘/Ctrl Z</span>
          </span>
          <span className="desc">Undo (shift to redo), <span className="kbd">F</span> fit,{' '}
            <span className="kbd">G</span> grid</span>
        </div>
        <div className="panel-section-title">Not available yet</div>
        <div className="limit-note">
          <strong>Loft, sweep, shell, draft, split, 3MF export and STEP/DXF import</strong> are not
          implemented. Fillet and revolve surfaces are tessellated, so STEP output is a faceted
          B-rep.
        </div>
      </div>
    </div>
  );
}
