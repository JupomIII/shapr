import { useState } from 'react';
import { viewportRef } from '../render/viewportRef';
import { measureSolid } from '../kernel/solid';
import { UNIT_FACTOR } from '../model/types';
import * as S from '../state/store';
import * as OPS from '../state/ops';
import type { SketchDiagnostics } from '../sketch/diagnostics';
import { Icon, IconName } from './Icons';

const fmt = (v: number, digits = 2): string => {
  if (!isFinite(v)) return '0';
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, '') || '0';
};

const fmtMeasure = (v: number): string => fmt(v, Math.abs(v) >= 1000 ? 0 : 2);

/* ------------------------------- primitives ------------------------------- */

const Act = ({
  icon,
  label,
  hint,
  active,
  primary,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    className={`act ${active ? 'active' : ''} ${primary ? 'primary' : ''}`}
    title={hint ?? label}
    aria-disabled={disabled ? 'true' : undefined}
    disabled={disabled}
    onClick={onClick}
  >
    <span className="act-btn">
      <Icon name={icon} size={17} />
    </span>
    <span className="act-label">
      {label}
      {hint ? <small>{hint}</small> : null}
    </span>
  </button>
);

const RoundBtn = ({
  icon,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: IconName;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    className={`round-btn ${active ? 'on' : ''}`}
    title={title}
    disabled={disabled}
    onClick={onClick}
  >
    <Icon name={icon} size={17} />
  </button>
);

const Scrim = ({ onClose }: { onClose: () => void }) => (
  <div className="scrim" onPointerDown={onClose} />
);

/* -------------------------------- top cluster ------------------------------ */

const TOOL_LABELS: Record<S.SketchTool, string> = {
  select: 'Select',
  line: 'Line',
  polyline: 'Polyline',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  spline: 'Spline',
  auto: 'Line / Arc',
  dimension: 'Dimension',
};

export function TopBar() {
  const s = S.useApp();
  const [menu, setMenu] = useState(false);
  const [persp, setPersp] = useState(true);
  const togglePanel = (p: S.Panel) => S.store.set({ panel: s.panel === p ? 'none' : p });

  const activeSketch = s.doc.sketches.find((x) => x.id === s.activeSketchId);
  const toolLabel = s.pending
    ? s.pending.title
    : s.mode === 'sketch' && activeSketch
      ? TOOL_LABELS[s.sketchTool]
      : null;

  return (
    <div className="dock-top">
      <div className="cluster">
        <button className="home-btn" title="Projects" onClick={() => togglePanel('projects')}>
          <Icon name="home" size={17} />
        </button>
        <button className="project-pill" onClick={() => togglePanel('projects')} title="Rename or open">
          <span className="name">{s.doc.name}</span>
          <Icon name="chevronDown" size={13} />
        </button>
        <button
          className="icon-btn"
          title="More"
          onClick={() => setMenu((v) => !v)}
          style={{ marginLeft: 2 }}
        >
          <Icon name="more" size={17} />
        </button>
        <button className="primary-pill" onClick={() => void S.persist(true)} title="Save project">
          Save
        </button>
      </div>

      {toolLabel ? (
        <div className="tool-pill">
          <span>{toolLabel}</span>
          <Icon name="chevronDown" size={12} />
        </div>
      ) : null}

      {menu && (
        <>
          <Scrim onClose={() => setMenu(false)} />
          <div className="popover" style={{ top: 46, right: 4 }}>
            <button
              className="menu-row"
              onClick={() => {
                void S.createProject();
                setMenu(false);
              }}
            >
              <Icon name="plus" size={15} />
              New project
            </button>
            <button
              className="menu-row"
              onClick={() => {
                S.store.set({ featuresOpen: !s.featuresOpen });
                setMenu(false);
              }}
            >
              <Icon name="layers" size={15} />
              {s.featuresOpen ? 'Hide feature tree' : 'Show feature tree'}
              <span className="k">H</span>
            </button>
            <button
              className="menu-row"
              onClick={() => {
                togglePanel('measure');
                setMenu(false);
              }}
            >
              <Icon name="measure" size={15} />
              Measure
            </button>
            <div className="menu-sep" />
            <button
              className={`menu-row ${persp ? 'on' : ''}`}
              onClick={() => {
                const next = !persp;
                setPersp(next);
                viewportRef.current?.setProjection(next);
                setMenu(false);
              }}
            >
              <Icon name="cube" size={15} />
              {persp ? 'Perspective' : 'Orthographic'}
              {persp ? (
                <span className="tick">
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </button>
            <button
              className={`menu-row ${s.showGrid ? 'on' : ''}`}
              onClick={() => {
                S.store.set({ showGrid: !s.showGrid });
                setMenu(false);
              }}
            >
              <Icon name="grid" size={15} />
              Grid
              {s.showGrid ? (
                <span className="tick">
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </button>
            <div className="menu-sep" />
            <button
              className="menu-row"
              onClick={() => {
                togglePanel('help');
                setMenu(false);
              }}
            >
              <Icon name="help" size={15} />
              Gestures & shortcuts
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------- left dock ------------------------------- */

const SKETCH_TOOLS: { id: S.SketchTool; icon: IconName; label: string }[] = [
  { id: 'select', icon: 'select', label: 'Select' },
  { id: 'auto', icon: 'auto', label: 'Line / Arc' },
  { id: 'spline', icon: 'spline', label: 'Spline' },
  { id: 'polyline', icon: 'polyline', label: 'Polyline' },
  { id: 'rect', icon: 'rect', label: 'Rectangle' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'arc', icon: 'arc', label: 'Arc' },
  { id: 'line', icon: 'line', label: 'Line' },
];

function SketchDock() {
  const s = S.useApp();
  const hasEntity = s.selection.some((x) => x.kind === 'sketchEntity');

  return (
    <div className="dock-left">
      {SKETCH_TOOLS.map((t) => (
        <Act
          key={t.id}
          icon={t.icon}
          label={t.label}
          active={s.sketchTool === t.id}
          onClick={() => S.store.set({ sketchTool: t.id, selection: [] })}
        />
      ))}
      <div className="act-divider" />
      <Act
        icon="snap"
        label="Snapping"
        hint={s.snapEnabled ? 'On' : 'Off'}
        active={s.snapEnabled}
        onClick={() => S.store.set({ snapEnabled: !s.snapEnabled })}
      />
      <Act
        icon="auto"
        label="Auto line / arc"
        hint={s.autoLineArc ? 'On' : 'Off'}
        active={s.autoLineArc}
        onClick={() => S.store.set({ autoLineArc: !s.autoLineArc })}
      />
      {hasEntity ? (
        <Act icon="trash" label="Delete" onClick={() => OPS.deleteSelection()} />
      ) : null}
      <div className="act-divider" />
      <Act icon="check" label="Finish sketch" primary onClick={() => S.finishSketch()} />
    </div>
  );
}

function ContextDock() {
  const s = S.useApp();
  const sel = s.selection[0];
  if (!sel) return null;

  const acts: JSX.Element[] = [
    <Act
      key="deselect"
      icon="close"
      label="Deselect"
      onClick={() => S.setSelection([])}
    />,
  ];

  if (sel.kind === 'region') {
    acts.push(
      <Act key="x" icon="extrude" label="Extrude" primary onClick={() => OPS.startExtrude('new')} />,
      <Act key="c" icon="cut" label="Cut" onClick={() => OPS.extrudeCutThrough()} />,
      <Act key="r" icon="revolve" label="Revolve" onClick={() => OPS.startRevolve()} />,
      <Act key="m" icon="measure" label="Measure" onClick={() => OPS.measureSelection()} />,
    );
  } else if (sel.kind === 'face') {
    acts.push(
      <Act
        key="p"
        icon="extrude"
        label="Offset face"
        primary
        onClick={() => OPS.startPushPull()}
      />,
      <Act key="s" icon="sketch" label="Sketch on face" onClick={() => S.beginSketch('face', sel)} />,
      <Act key="m" icon="measure" label="Measure" onClick={() => OPS.measureSelection()} />,
    );
  } else if (sel.kind === 'edge') {
    acts.push(
      <Act key="f" icon="fillet" label="Fillet" primary onClick={() => OPS.startFillet()} />,
      <Act key="c" icon="chamfer" label="Chamfer" onClick={() => OPS.startChamfer()} />,
      <Act key="m" icon="measure" label="Measure" onClick={() => OPS.measureSelection()} />,
    );
  } else if (sel.kind === 'body') {
    acts.push(
      <Act key="m" icon="measure" label="Measure" onClick={() => OPS.measureSelection()} />,
      <Act key="h" icon="eyeOff" label="Hide" onClick={() => OPS.hideSelection()} />,
      <Act key="mi" icon="mirror" label="Mirror" onClick={() => OPS.mirrorSelected()} />,
      <Act key="pl" icon="pattern" label="Pattern" onClick={() => OPS.patternSelected('linear')} />,
      <Act key="d" icon="trash" label="Delete" onClick={() => OPS.deleteSelection()} />,
    );
  } else if (sel.kind === 'sketchEntity') {
    acts.push(<Act key="d" icon="trash" label="Delete" onClick={() => OPS.deleteSelection()} />);
  }

  return <div className="dock-left">{acts}</div>;
}

export function Rail() {
  const s = S.useApp();
  const [planeMenu, setPlaneMenu] = useState(false);
  const face = s.selection.find((x) => x.kind === 'face');

  if (s.mode === 'sketch') return <SketchDock />;
  if (s.selection.length) return <ContextDock />;

  return (
    <>
      <div className="dock-left">
        <Act
          icon="sketch"
          label="Sketch"
          active={planeMenu}
          onClick={() => setPlaneMenu((v) => !v)}
        />
        <Act
          icon="measure"
          label="Measure"
          active={s.panel === 'measure'}
          onClick={() => OPS.measureSelection()}
        />
        <Act
          icon="layers"
          label="Features"
          active={s.featuresOpen}
          onClick={() => S.store.set({ featuresOpen: !s.featuresOpen })}
        />
      </div>
      {planeMenu && (
        <>
          <Scrim onClose={() => setPlaneMenu(false)} />
          <div className="plane-popover">
            <div className="menu-title">Sketch plane</div>
            <button
              className="row"
              onClick={() => {
                S.beginSketch('XY');
                setPlaneMenu(false);
              }}
            >
              <span className="tree-icon">
                <Icon name="plane" size={15} />
              </span>
              <span className="name">XY plane</span>
              <span className="meta">Top</span>
            </button>
            <button
              className="row"
              onClick={() => {
                S.beginSketch('XZ');
                setPlaneMenu(false);
              }}
            >
              <span className="tree-icon">
                <Icon name="plane" size={15} />
              </span>
              <span className="name">XZ plane</span>
              <span className="meta">Front</span>
            </button>
            <button
              className="row"
              onClick={() => {
                S.beginSketch('YZ');
                setPlaneMenu(false);
              }}
            >
              <span className="tree-icon">
                <Icon name="plane" size={15} />
              </span>
              <span className="name">YZ plane</span>
              <span className="meta">Right</span>
            </button>
            <button
              className="row"
              disabled={!face}
              style={{ opacity: face ? 1 : 0.4 }}
              onClick={() => {
                if (!face) return;
                S.beginSketch('face', face);
                setPlaneMenu(false);
              }}
            >
              <span className="tree-icon">
                <Icon name="cube" size={15} />
              </span>
              <span className="name">Selected face</span>
              <span className="meta">{face ? 'Planar' : 'None'}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

/* -------------------------------- right dock ------------------------------- */

export function ViewCubeOverlay() {
  const s = S.useApp();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [persp, setPersp] = useState(true);
  const vp = viewportRef.current;
  const set = (v: 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom' | 'iso') => () =>
    vp?.setView(v, s.evalResult.bodies);

  return (
    <div className="dock-right">
      <div className="viewcube">
        <svg viewBox="0 0 92 92" aria-hidden="true">
          {/* iso cube */}
          <polygon className="cube-face" points="46,10 80,27 46,44 12,27" onClick={set('top')}>
            <title>Top view</title>
          </polygon>
          <polygon className="cube-face" points="12,27 46,44 46,82 12,65" onClick={set('front')}>
            <title>Front view</title>
          </polygon>
          <polygon className="cube-face" points="80,27 46,44 46,82 80,65" onClick={set('right')}>
            <title>Right view</title>
          </polygon>
          <text className="cube-label" x="46" y="30" textAnchor="middle">
            TOP
          </text>
          <text className="cube-label" x="28" y="58" textAnchor="middle">
            F
          </text>
          <text className="cube-label" x="64" y="58" textAnchor="middle">
            R
          </text>
          {/* axis ticks */}
          <line className="cube-axis" x1="46" y1="44" x2="46" y2="2" stroke="#44618c" />
          <text className="cube-axis-label" x="49" y="6" fill="#5f86b8">
            Z
          </text>
          <line className="cube-axis" x1="46" y1="44" x2="89" y2="67" stroke="#4c7a50" />
          <text className="cube-axis-label" x="84" y="78" fill="#6c9c70">
            Y
          </text>
          <line className="cube-axis" x1="46" y1="44" x2="3" y2="67" stroke="#8f4a44" />
          <text className="cube-axis-label" x="2" y="78" fill="#b46b64">
            X
          </text>
        </svg>
      </div>

      <div className="right-strip">
        <button
          className={`unit-btn ${unitsOpen ? 'on' : ''}`}
          title="Units"
          onClick={() => setUnitsOpen((v) => !v)}
        >
          <span className="u-scale">1</span>
          <span>{s.doc.units}</span>
        </button>
        <button
          className={`icon-btn ${settings ? 'active' : ''}`}
          title="View settings"
          onClick={() => setSettings((v) => !v)}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>

      {unitsOpen && (
        <>
          <Scrim onClose={() => setUnitsOpen(false)} />
          <div className="popover" style={{ top: 46, right: 0 }}>
            <div className="menu-title">Units</div>
            {(['mm', 'cm', 'm', 'in'] as const).map((u) => (
              <button
                key={u}
                className={`menu-row ${s.doc.units === u ? 'on' : ''}`}
                onClick={() => {
                  S.setUnits(u);
                  setUnitsOpen(false);
                }}
              >
                {u === 'mm' ? 'Millimetres' : u === 'cm' ? 'Centimetres' : u === 'm' ? 'Metres' : 'Inches'}
                {s.doc.units === u ? (
                  <span className="tick">
                    <Icon name="check" size={14} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}

      {settings && (
        <>
          <Scrim onClose={() => setSettings(false)} />
          <div className="popover" style={{ top: 46, right: 0 }}>
            <button
              className="menu-row"
              onClick={() => {
                const next = !persp;
                setPersp(next);
                vp?.setProjection(next);
                setSettings(false);
              }}
            >
              <Icon name="cube" size={15} />
              {persp ? 'Perspective' : 'Orthographic'}
            </button>
            <button
              className="menu-row"
              onClick={() => {
                S.store.set({ showGrid: !s.showGrid });
                setSettings(false);
              }}
            >
              <Icon name="grid" size={15} />
              Grid
              {s.showGrid ? (
                <span className="tick">
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </button>
            <button
              className="menu-row"
              onClick={() => {
                vp?.setView('iso', s.evalResult.bodies);
                setSettings(false);
              }}
            >
              <Icon name="cube" size={15} />
              Isometric
              <span className="k">7</span>
            </button>
            <button
              className="menu-row"
              onClick={() => {
                vp?.fitAll(s.evalResult.bodies);
                setSettings(false);
              }}
            >
              <Icon name="fit" size={15} />
              Fit all
              <span className="k">F</span>
            </button>
            <div className="menu-sep" />
            <button
              className="menu-row"
              onClick={() => {
                S.store.set({ panel: 'help' });
                setSettings(false);
              }}
            >
              <Icon name="help" size={15} />
              Gestures & shortcuts
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- bottom dock ------------------------------- */

export function StatusRight({ diag }: { diag?: SketchDiagnostics | null }) {
  const s = S.useApp();
  const bodies = s.evalResult.bodies;
  const errors = Object.keys(s.evalResult.errors).length;
  const unit = s.doc.units;
  const f = UNIT_FACTOR[unit];

  let area = 0;
  let volume = 0;
  for (const b of bodies) {
    if (b.hidden) continue;
    const m = measureSolid(b.solid);
    area += m.area;
    volume += m.volume;
  }

  const summary = s.selection.length ? OPS.selectionSummary() : null;

  return (
    <div className="dock-bottom">
      <div className="dock-corner">
        <RoundBtn
          icon="undo"
          title="Undo"
          disabled={!s.history.past.length}
          onClick={() => S.undo()}
        />
        <RoundBtn
          icon="redo"
          title="Redo"
          disabled={!s.history.future.length}
          onClick={() => S.redo()}
        />
        <RoundBtn icon="fit" title="Fit all (F)" onClick={() => viewportRef.current?.fitAll(bodies)} />
        <RoundBtn
          icon="grid"
          title="Grid"
          active={s.showGrid}
          onClick={() => S.store.set({ showGrid: !s.showGrid })}
        />
      </div>

      <div className="stats">
        {s.mode === 'sketch' && s.activeSketchId ? (
          <>
            <span className={`stat-item ${diag?.fullyDefined ? 'ok' : ''}`}>
              {diag?.fullyDefined ? 'Fully defined' : `${diag?.dof ?? 0} dof`}
            </span>
            <span
              className={`stat-item ${(s.evalResult.regions[s.activeSketchId]?.length ?? 0) ? '' : 'err'}`}
            >
              <b>{s.evalResult.regions[s.activeSketchId]?.length ?? 0}</b>{' '}
              {(s.evalResult.regions[s.activeSketchId]?.length ?? 0) === 1 ? 'profile' : 'profiles'}
            </span>
            {diag?.open.length ? (
              <span className="stat-item warn">
                {diag.open.length} open {diag.open.length === 1 ? 'end' : 'ends'}
              </span>
            ) : null}
          </>
        ) : null}
        {summary ? <span className="stat-item">{summary}</span> : null}
        {errors > 0 ? (
          <span className="stat-item err">
            {errors} feature error{errors > 1 ? 's' : ''}
          </span>
        ) : null}
        <span className="stat-item">
          <b>{bodies.length}</b> {bodies.length === 1 ? 'body' : 'bodies'}
        </span>
        {bodies.length ? (
          <>
            <span className="stat-item optional">
              <b>{fmtMeasure(area / (f * f))}</b> {unit}²
            </span>
            <span className="stat-item optional">
              <b>{fmtMeasure(volume / (f * f * f))}</b> {unit}³
            </span>
          </>
        ) : null}
      </div>

      <div className="dock-corner" />
    </div>
  );
}

/* ---------------------------------- overlays -------------------------------- */

export function Toast() {
  const s = S.useApp();
  if (!s.toast) return null;
  return <div className="toast">{s.toast.text}</div>;
}

export function EmptyHint() {
  const s = S.useApp();
  if (s.evalResult.bodies.length || s.doc.sketches.length) return null;
  return (
    <div className="empty-hint">
      <strong>Start a sketch</strong>
      <span>Pick a plane, draw a profile, then drag it into a solid</span>
    </div>
  );
}
