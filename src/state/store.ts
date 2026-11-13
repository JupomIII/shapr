// Central app state: document, derived geometry, selection, history and the
// transient "pending operation" used for live-preview direct manipulation.

import { useSyncExternalStore } from 'react';
import { Vec2, Vec3 } from '../kernel/vec';
import { Solid } from '../kernel/solid';
import { Sketch } from '../sketch/types';
import { sketchRegions } from '../sketch/geometry';
import { solveSketch } from '../sketch/solver';
import {
  EvalBody,
  EvalResult,
  evaluate,
} from '../model/evaluate';
import {
  Feature,
  ProjectDoc,
  SketchFeature,
  UnitSystem,
  newDoc,
} from '../model/types';
import {
  ProjectRecord,
  deleteProject as dbDelete,
  duplicateProject as dbDuplicate,
  getProject,
  listProjects,
  saveProject,
} from '../storage/db';

export type Mode = 'select' | 'sketch';
export type SketchTool =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'spline'
  | 'auto'
  | 'dimension';
export type Panel = 'none' | 'projects' | 'measure' | 'help';

export interface SelectionItem {
  kind: 'face' | 'edge' | 'body' | 'region' | 'sketchEntity' | 'sketch';
  bodyId?: string;
  faceIndex?: number;
  edgeKey?: string;
  sketchId?: string;
  entityId?: string;
  regionIndex?: number;
  point?: Vec3;
  normal?: Vec3;
}

/** One row of the stacked-selection picker (Shapr3D's overlapping list). */
export interface PickEntry {
  id: string;
  label: string;
  hint?: string;
  item: SelectionItem;
}

export interface PickerState {
  x: number;
  y: number;
  entries: PickEntry[];
}

export type PendingKind = 'extrude' | 'revolve' | 'fillet' | 'chamfer' | 'pushpull';

export interface PendingOp {
  kind: PendingKind;
  title: string;
  value: number;
  step: number;
  min?: number;
  unit: 'mm' | 'deg';
  feature: Feature;
  preview: EvalBody[];
  anchor?: { x: number; y: number };
  hint?: string;
}

export interface AppState {
  doc: ProjectDoc;
  evalResult: EvalResult;
  projects: ProjectRecord[];
  mode: Mode;
  sketchTool: SketchTool;
  activeSketchId: string | null;
  /** Sketches the user explicitly made visible in the 3D workspace. */
  visibleSketchIds: string[];
  selection: SelectionItem[];
  hover: SelectionItem | null;
  /** Open when a tap hits several stacked items; null otherwise. */
  picker: PickerState | null;
  /** Documents plus the selection each step started from, so undo restores both. */
  history: {
    past: ProjectDoc[];
    future: ProjectDoc[];
    pastSel: SelectionItem[][];
    futureSel: SelectionItem[][];
  };
  panel: Panel;
  /** The feature tree lives in a standing panel, so it is not a transient panel. */
  featuresOpen: boolean;
  pending: PendingOp | null;
  toast: { id: number; text: string } | null;
  autoLineArc: boolean;
  showGrid: boolean;
  snapEnabled: boolean;
  gridSize: number;
  saving: boolean;
  desktop: boolean;
  /** Increments whenever geometry changes (drives the renderer). */
  geometryVersion: number;
}

const emptyEval: EvalResult = {
  bodies: [],
  errors: {},
  version: 0,
  regions: {},
};

const initialDoc = newDoc();

export const store = {
  state: {
    doc: initialDoc,
    evalResult: { ...emptyEval, regions: {} },
    projects: [] as ProjectRecord[],
    mode: 'select' as Mode,
    sketchTool: 'select' as SketchTool,
    activeSketchId: null,
    visibleSketchIds: [] as string[],
    selection: [] as SelectionItem[],
    hover: null,
    picker: null as PickerState | null,
    history: {
      past: [] as ProjectDoc[],
      future: [] as ProjectDoc[],
      pastSel: [] as SelectionItem[][],
      futureSel: [] as SelectionItem[][],
    },
    panel: 'none' as Panel,
    featuresOpen: true,
    pending: null,
    toast: null,
    autoLineArc: true,
    showGrid: true,
    snapEnabled: true,
    gridSize: 1,
    saving: false,
    desktop: false,
    geometryVersion: 1,
  } as AppState,
  listeners: new Set<() => void>(),
  subscribe(fn: () => void) {
    store.listeners.add(fn);
    return () => store.listeners.delete(fn);
  },
  set(patch: Partial<AppState>) {
    store.state = { ...store.state, ...patch };
    store.listeners.forEach((l) => l());
  },
};

export const cloneDoc = (doc: ProjectDoc): ProjectDoc => JSON.parse(JSON.stringify(doc));

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, () => store.state, () => store.state);
}

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  store.set({ toast: { id, text } });
  setTimeout(() => {
    if (store.state.toast?.id === id) store.set({ toast: null });
  }, 3200);
}

/* ------------------------------- persistence ------------------------------ */

let saveTimer: number | null = null;
let thumbnailProvider: (() => string | null) | null = null;

export function setThumbnailProvider(fn: () => string | null) {
  thumbnailProvider = fn;
}

function scheduleAutosave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void persist(false);
  }, 900);
}

export async function persist(manual: boolean) {
  const s = store.state;
  const record: ProjectRecord = {
    id: s.doc.id,
    name: s.doc.name,
    createdAt: s.doc.createdAt,
    updatedAt: Date.now(),
    doc: s.doc,
    thumbnail: thumbnailProvider?.() ?? undefined,
  };
  try {
    await saveProject(record);
    const projects = await listProjects();
    store.set({ projects, saving: false });
    if (manual) toast('Project saved');
  } catch (err) {
    store.set({ saving: false });
    if (manual) toast('Could not save project');
  }
}

export async function refreshProjects() {
  const projects = await listProjects();
  store.set({ projects });
}

/* --------------------------------- history -------------------------------- */

const deepClone = cloneDoc;

function applyDoc(doc: ProjectDoc, geometryChanged = true) {
  const evalResult = evaluate(doc);
  store.set({
    doc,
    evalResult: geometryChanged
      ? { ...evalResult, version: store.state.geometryVersion + 1 }
      : evalResult,
    geometryVersion: geometryChanged
      ? store.state.geometryVersion + 1
      : store.state.geometryVersion,
  });
}

export interface CommitOptions {
  label?: string;
  /** Mutate a copy of the document in place. */
  mutate: (doc: ProjectDoc) => void;
  select?: SelectionItem[];
  keepPendingValue?: number;
}

export function commit({ mutate, select, label }: CommitOptions) {
  const s = store.state;
  const before = deepClone(s.doc);
  const doc = deepClone(s.doc);
  mutate(doc);
  doc.updatedAt = Date.now();
  const past = [...s.history.past, before].slice(-80);
  const pastSel = [...s.history.pastSel, s.selection].slice(-80);
  const evalResult = evaluate(doc);
  const geometryVersion = s.geometryVersion + 1;
  store.set({
    doc,
    evalResult,
    geometryVersion,
    history: { past, future: [], pastSel, futureSel: [] },
    picker: null,
    ...(select !== undefined ? { selection: select } : {}),
  });
  scheduleAutosave();
  if (label) console.debug('[shapr]', label);
}

/** Keep only the references that still resolve in the restored document. */
function revivableSelection(
  items: SelectionItem[] | undefined,
  doc: ProjectDoc,
  ev: EvalResult,
): SelectionItem[] {
  if (!items?.length) return [];
  const bodyIds = new Set(ev.bodies.map((b) => b.id));
  const sketchIds = new Set(doc.sketches.map((s) => s.id));
  return items.filter((it) => {
    if (it.kind === 'region' || it.kind === 'sketchEntity') {
      return !!it.sketchId && sketchIds.has(it.sketchId);
    }
    return !it.bodyId || bodyIds.has(it.bodyId);
  });
}

export function undo() {
  const s = store.state;
  if (!s.history.past.length) {
    toast('Nothing to undo');
    return;
  }
  const past = s.history.past.slice();
  const prev = past.pop()!;
  const pastSel = s.history.pastSel.slice();
  const restoreSel = pastSel.pop();
  const future = [deepClone(s.doc), ...s.history.future].slice(0, 80);
  const futureSel = [s.selection, ...s.history.futureSel].slice(0, 80);
  const evalResult = evaluate(prev);
  store.set({
    doc: prev,
    evalResult,
    geometryVersion: s.geometryVersion + 1,
    history: { past, future, pastSel, futureSel },
    selection: revivableSelection(restoreSel, prev, evalResult),
    pending: null,
    picker: null,
    hover: null,
  });
  scheduleAutosave();
}

export function redo() {
  const s = store.state;
  if (!s.history.future.length) {
    toast('Nothing to redo');
    return;
  }
  const future = s.history.future.slice();
  const next = future.shift()!;
  const futureSel = s.history.futureSel.slice();
  const restoreSel = futureSel.shift();
  const past = [...s.history.past, deepClone(s.doc)].slice(-80);
  const pastSel = [...s.history.pastSel, s.selection].slice(-80);
  const evalResult = evaluate(next);
  store.set({
    doc: next,
    evalResult,
    geometryVersion: s.geometryVersion + 1,
    history: { past, future, pastSel, futureSel },
    selection: revivableSelection(restoreSel, next, evalResult),
    pending: null,
    picker: null,
    hover: null,
  });
  scheduleAutosave();
}

/* --------------------------------- sketches -------------------------------- */

export const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export function sketchById(id: string | null | undefined): Sketch | null {
  if (!id) return null;
  return store.state.doc.sketches.find((s) => s.id === id) ?? null;
}

export function activeSketch(): Sketch | null {
  return sketchById(store.state.activeSketchId);
}

export function beginSketch(planeId: 'XY' | 'XZ' | 'YZ' | 'face', face?: SelectionItem) {
  let frame: Sketch['plane'];
  let label = planeId as string;

  if (planeId === 'face' && face?.point && face.normal) {
    const n = face.normal;
    const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const ux: Vec3 = [
      ref[1] * n[2] - ref[2] * n[1],
      ref[2] * n[0] - ref[0] * n[2],
      ref[0] * n[1] - ref[1] * n[0],
    ];
    const ul = Math.hypot(...ux) || 1;
    const u: Vec3 = [ux[0] / ul, ux[1] / ul, ux[2] / ul];
    const v: Vec3 = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];
    frame = { origin: face.point, u, v, n };
    label = 'Face';
  } else if (planeId === 'XZ') {
    frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] };
  } else if (planeId === 'YZ') {
    frame = { origin: [0, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] };
  } else {
    frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  }

  const sketch: Sketch = {
    id: uid('sk'),
    name: `Sketch ${String(store.state.doc.sketches.length + 1).padStart(3, '0')}`,
    plane: frame,
    planeLabel: label,
    points: {},
    entities: [],
    constraints: [],
    visible: true,
    onFace: face?.bodyId ? { featureId: face.bodyId } : undefined,
  };
  const feature: SketchFeature = {
    id: uid('ft'),
    name: sketch.name,
    kind: 'sketch',
    sketchId: sketch.id,
  };

  commit({
    mutate: (doc) => {
      doc.sketches.push(sketch);
      doc.features.push(feature as Feature);
    },
    label: 'sketch:new',
  });
  store.set({
    mode: 'sketch',
    activeSketchId: sketch.id,
    sketchTool: 'line',
    selection: [],
    picker: null,
    hover: null,
    visibleSketchIds: [...store.state.visibleSketchIds, sketch.id],
    panel: store.state.panel === 'projects' ? 'none' : store.state.panel,
  });
  return sketch.id;
}

/** Apply an edit to the active sketch and re-solve its constraints. */
export function editSketch(
  sketchId: string,
  mutate: (draft: Sketch) => void,
  opts: { pinned?: string[]; label?: string } = {},
) {
  commit({
    mutate: (doc) => {
      const sk = doc.sketches.find((s) => s.id === sketchId);
      if (!sk) return;
      mutate(sk);
      const result = solveSketch(sk, new Set(opts.pinned ?? []));
      if (result.maxResidual < 1e-4) {
        sk.points = result.points;
        for (const e of sk.entities) {
          if (e.kind === 'circle' && result.radii[e.id] !== undefined) {
            e.r = result.radii[e.id];
          }
        }
      }
    },
    label: opts.label ?? 'sketch:edit',
  });
}

export function finishSketch() {
  const sk = activeSketch();
  if (sk && !sk.entities.length) {
    // Empty sketch: drop it so the tree stays meaningful.
    commit({
      mutate: (doc) => {
        doc.sketches = doc.sketches.filter((s) => s.id !== sk.id);
        doc.features = doc.features.filter(
          (f) => !(f.kind === 'sketch' && f.sketchId === sk.id),
        );
      },
      label: 'sketch:discard',
    });
  }
  // A finished sketch stays visible so its profiles can still be picked and dragged;
  // it is only hidden once a solid feature consumes it. A single closed profile is
  // selected outright, so the extrude gizmo is right there to be dragged.
  const regions = sk ? sketchRegions(sk) : [];
  store.set({
    mode: 'select',
    activeSketchId: null,
    sketchTool: 'select',
    selection:
      sk && regions.length === 1
        ? [{ kind: 'region', sketchId: sk.id, regionIndex: 0 }]
        : [],
    visibleSketchIds: sk
      ? Array.from(new Set([...store.state.visibleSketchIds, sk.id]))
      : store.state.visibleSketchIds,
  });
}

export function deleteSketch(sketchId: string) {
  commit({
    mutate: (doc) => {
      doc.sketches = doc.sketches.filter((s) => s.id !== sketchId);
      doc.features = doc.features.filter(
        (f) => !((f.kind === 'sketch' && f.sketchId === sketchId) || (f as any).sketchId === sketchId),
      );
    },
    label: 'sketch:delete',
  });
  store.set({ selection: [], activeSketchId: null, mode: 'select' });
}

/* ------------------------------- feature ops ------------------------------- */

export function addFeature(feature: Feature, selection: SelectionItem[] = []) {
  commit({
    mutate: (doc) => {
      doc.features.push(feature);
    },
    select: selection,
    label: `feature:${feature.kind}`,
  });
}

export function deleteFeature(id: string) {
  commit({
    mutate: (doc) => {
      doc.features = doc.features.filter((f) => f.id !== id);
    },
    select: [],
    label: 'feature:delete',
  });
}

export function updateFeature(id: string, patch: Partial<Feature>) {
  commit({
    mutate: (doc) => {
      const f = doc.features.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    },
    label: 'feature:update',
  });
}

export function toggleFeatureHidden(id: string) {
  const f = store.state.doc.features.find((x) => x.id === id);
  if (!f) return;
  if (f.kind === 'sketch') {
    // Sketch visibility lives in the view state, not only on the feature.
    const shown = store.state.visibleSketchIds.includes(f.sketchId);
    store.set({
      visibleSketchIds: shown
        ? store.state.visibleSketchIds.filter((x) => x !== f.sketchId)
        : [...store.state.visibleSketchIds, f.sketchId],
    });
    updateFeature(id, { hidden: shown } as Partial<Feature>);
    return;
  }
  updateFeature(id, { hidden: !f.hidden } as Partial<Feature>);
}

export function toggleFeatureSuppressed(id: string) {
  const f = store.state.doc.features.find((x) => x.id === id);
  if (!f) return;
  updateFeature(id, { suppressed: !f.suppressed } as Partial<Feature>);
}

export function renameFeature(id: string, name: string) {
  updateFeature(id, { name } as Partial<Feature>);
}

export function deleteBody(bodyId: string) {
  const f = store.state.evalResult.bodies.find((b) => b.id === bodyId);
  if (!f) return;
  // Remove the producing feature and everything that depends on it.
  const doc = store.state.doc;
  const kill = new Set<string>([f.featureId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const feat of doc.features) {
      const fid = (feat as any).bodyId as string | undefined;
      if (fid && [...kill].some((k) => fid.startsWith(k))) {
        if (!kill.has(feat.id)) {
          kill.add(feat.id);
          changed = true;
        }
      }
    }
  }
  commit({
    mutate: (d) => {
      d.features = d.features.filter((feat) => !kill.has(feat.id));
    },
    select: [],
    label: 'body:delete',
  });
}

export function setRollback(index: number | null) {
  commit({
    mutate: (doc) => {
      doc.rollback = index;
    },
    select: [],
    label: 'rollback',
  });
}

/* ----------------------------- pending operations -------------------------- */

export function setPending(pending: PendingOp | null) {
  store.set({ pending });
}

export function computePreview(feature: Feature): EvalBody[] {
  const doc = deepClone(store.state.doc);
  doc.features.push(feature);
  try {
    return evaluate(doc).bodies;
  } catch {
    return [];
  }
}

export function makePending(
  kind: PendingKind,
  feature: Feature,
  value: number,
  opts: { title: string; step?: number; min?: number; unit?: 'mm' | 'deg'; hint?: string },
): PendingOp {
  const pending: PendingOp = {
    kind,
    title: opts.title,
    value,
    step: opts.step ?? 1,
    min: opts.min,
    unit: opts.unit ?? 'mm',
    feature,
    preview: [],
    hint: opts.hint,
  };
  pending.preview = computePreview(feature);
  return pending;
}

export function updatePendingValue(value: number) {
  const p = store.state.pending;
  if (!p) return;
  const v = p.min !== undefined ? Math.max(p.min, value) : value;
  const feature = cloneDoc({ ...store.state.doc, features: [p.feature] }).features[0];
  applyValueToFeature(feature, v);
  const next: PendingOp = { ...p, value: v, feature, preview: computePreview(feature) };
  store.set({ pending: next });
}

export function applyValueToFeature(feature: Feature, value: number) {
  switch (feature.kind) {
    case 'extrude':
      feature.height = Math.abs(value);
      break;
    case 'fillet':
      feature.radius = Math.abs(value);
      break;
    case 'chamfer':
      feature.distance = Math.abs(value);
      break;
    case 'pushpull':
      feature.distance = value;
      break;
    case 'revolve':
      feature.angle = Math.abs(value);
      break;
    default:
      break;
  }
}

export function confirmPending() {
  const p = store.state.pending;
  if (!p) return;
  const feature = p.feature;
  const doc = deepClone(store.state.doc);
  doc.features.push(feature);
  const evalResult = evaluate(doc);
  const past = [...store.state.history.past, deepClone(store.state.doc)].slice(-80);
  // The profile has become solid geometry: hide its sketch to keep the view clean.
  const consumed =
    (feature.kind === 'extrude' || feature.kind === 'revolve') && 'sketchId' in feature
      ? feature.sketchId
      : null;
  if (consumed) {
    const sketchFeature = doc.features.find(
      (f) => f.kind === 'sketch' && f.sketchId === consumed,
    );
    if (sketchFeature) sketchFeature.hidden = true;
  }
  store.set({
    doc,
    evalResult,
    geometryVersion: store.state.geometryVersion + 1,
    history: {
      past,
      future: [],
      pastSel: [...store.state.history.pastSel, store.state.selection].slice(-80),
      futureSel: [],
    },
    pending: null,
    selection: [],
    visibleSketchIds: consumed
      ? store.state.visibleSketchIds.filter((id) => id !== consumed)
      : store.state.visibleSketchIds,
  });
  scheduleAutosave();
}

export function cancelPending() {
  store.set({ pending: null });
}

/* ------------------------------- project ops ------------------------------- */

export async function createProject() {
  const doc = newDoc(`Part ${new Date().toLocaleDateString()}`);
  const evalResult = evaluate(doc);
  store.set({
    doc,
    evalResult,
    geometryVersion: store.state.geometryVersion + 1,
    history: { past: [], future: [], pastSel: [], futureSel: [] },
    selection: [],
    mode: 'select',
    activeSketchId: null,
    pending: null,
    panel: 'none',
    visibleSketchIds: [],
  });
  void persist(false);
}

export async function openProject(id: string) {
  const rec = await getProject(id);
  if (!rec) {
    toast('Project not found');
    return;
  }
  const doc = rec.doc;
  // Recompute derived state; never trust stored geometry.
  const evalResult = evaluate(doc);
  store.set({
    doc,
    evalResult,
    geometryVersion: store.state.geometryVersion + 1,
    history: { past: [], future: [], pastSel: [], futureSel: [] },
    selection: [],
    mode: 'select',
    activeSketchId: null,
    pending: null,
    panel: 'none',
    visibleSketchIds: [],
  });
  toast(`Opened “${doc.name}”`);
}

export async function renameCurrentProject(name: string) {
  const doc = deepClone(store.state.doc);
  doc.name = name;
  doc.updatedAt = Date.now();
  store.set({ doc });
  void persist(false);
}

export async function duplicateCurrentProject() {
  await persist(false);
  const copy = await dbDuplicate(store.state.doc.id);
  await refreshProjects();
  if (copy) {
    await openProject(copy.id);
    toast('Project duplicated');
  }
}

export async function removeProject(id: string) {
  await dbDelete(id);
  await refreshProjects();
  if (store.state.doc.id === id) {
    await createProject();
  }
  toast('Project deleted');
}

/* --------------------------------- selection -------------------------------- */

export function sameSelection(a: SelectionItem, b: SelectionItem): boolean {
  return (
    a.kind === b.kind &&
    a.bodyId === b.bodyId &&
    a.faceIndex === b.faceIndex &&
    a.edgeKey === b.edgeKey &&
    a.sketchId === b.sketchId &&
    a.entityId === b.entityId &&
    a.regionIndex === b.regionIndex
  );
}

export function selectItem(item: SelectionItem | null, additive = false) {
  const s = store.state;
  if (!item) {
    store.set({ selection: additive ? s.selection : [] });
    return;
  }
  if (additive) {
    const exists = s.selection.some((x) => sameSelection(x, item));
    store.set({
      selection: exists ? s.selection.filter((x) => !sameSelection(x, item)) : [...s.selection, item],
    });
    return;
  }
  if (s.selection.length === 1 && sameSelection(s.selection[0], item)) return;
  store.set({ selection: [item] });
}

export function setSelection(items: SelectionItem[]) {
  store.set({ selection: items });
}

export function setHover(item: SelectionItem | null) {
  const cur = store.state.hover;
  if (!item && !cur) return;
  if (item && cur && sameSelection(item, cur)) return;
  store.set({ hover: item });
}

export function setUnits(units: UnitSystem) {
  commit({
    mutate: (doc) => {
      doc.units = units;
    },
    label: 'units',
  });
}

export function sketchRegionsOf(sketchId: string): { outer: Vec2[]; holes: Vec2[][] }[] {
  return store.state.evalResult.regions[sketchId] ?? [];
}

export function selectedBodies(): EvalBody[] {
  const s = store.state;
  const ids = new Set<string>();
  for (const sel of s.selection) {
    if (sel.bodyId) ids.add(sel.bodyId);
  }
  return s.evalResult.bodies.filter((b) => ids.has(b.id));
}

export function selectionSolids(): Solid[] {
  return selectedBodies().map((b) => b.solid);
}
