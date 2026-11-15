// High-level modelling commands used by the UI bars. They either open a
// pending operation (live preview + numeric entry) or commit a feature.

import { Vec2, Vec3 } from '../kernel/vec';
import { solidEdges } from '../kernel/solid';
import {
  ChamferFeature,
  ExtrudeFeature,
  ExtrudeOperation,
  Feature,
  FilletFeature,
  LoftFeature,
  MirrorFeature,
  PatternFeature,
  RevolveFeature,
  ShellFeature,
  SplitFeature,
  SweepFeature,
} from '../model/types';
import { sketchOpenChains, sketchRegions } from '../sketch/geometry';
import { solveSketch } from '../sketch/solver';
import { ConstraintKind } from '../sketch/types';
import * as S from './store';

/**
 * Adds a relation between two sketch elements and keeps it only if the solver can
 * still satisfy the whole sketch. A conflicting relation is rolled back instead of
 * leaving geometry that can no longer be solved.
 */
export function applySketchConstraint(
  sketchId: string,
  kind: ConstraintKind,
  refs: string[],
  label: string,
) {
  const sk = S.sketchById(sketchId);
  if (!sk) return;
  const exists = sk.constraints.some(
    (c) => c.kind === kind && c.refs.length === refs.length && refs.every((r) => c.refs.includes(r)),
  );
  if (exists) {
    S.toast(`Already ${label.toLowerCase()}`);
    return;
  }
  S.editSketch(sketchId, (draft) => {
    draft.constraints.push({ id: S.uid('c'), kind, refs });
  });
  const after = S.sketchById(sketchId);
  const solved = after ? solveSketch(after) : null;
  if (!solved || !solved.satisfied) {
    S.undo();
    S.toast(`${label} conflicts with the existing constraints`);
    return;
  }
  S.toast(`${label} applied`);
}

const featureName = (kind: string, label: string): string => {
  const count = S.store.state.doc.features.filter((f) => f.kind === kind).length + 1;
  return `${label} ${String(count).padStart(3, '0')}`;
};

const selected = () => S.store.state.selection[0] ?? null;

export function selectionKind(): 'none' | 'region' | 'face' | 'edge' | 'body' | 'sketchEntity' {
  const items = S.store.state.selection;
  if (!items.length) return 'none';
  return items[0].kind === 'sketch' ? 'sketchEntity' : items[0].kind;
}

export function startExtrude(operation: ExtrudeOperation = 'new', throughAll = false) {
  const sel = selected();
  if (!sel || sel.kind !== 'region' || !sel.sketchId) {
    S.toast('Select a sketch profile first');
    return;
  }
  const sk = S.sketchById(sel.sketchId);
  if (!sk) return;
  const feature: ExtrudeFeature = {
    id: S.uid('ft'),
    name: featureName('extrude', operation === 'cut' ? 'Cut' : 'Extrude'),
    kind: 'extrude',
    sketchId: sk.id,
    height: 10,
    operation,
    direction: 1,
    throughAll,
    regionIndex: sel.regionIndex ?? null,
  };
  S.setPending(
    S.makePending('extrude', feature, 10, {
      title: operation === 'cut' ? 'Cut' : 'Extrude',
      step: 1,
      min: 0.2,
      hint: 'Drag in the viewport to adjust',
    }),
  );
}

export function startRevolve() {
  const sel = selected();
  if (!sel || sel.kind !== 'region' || !sel.sketchId) {
    S.toast('Select a sketch profile first');
    return;
  }
  const sk = S.sketchById(sel.sketchId);
  if (!sk) return;
  const regions = sketchRegions(sk);
  const region = regions[sel.regionIndex ?? 0];
  if (!region) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of region.outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const axisX = minX;
  const feature: RevolveFeature = {
    id: S.uid('ft'),
    name: featureName('revolve', 'Revolve'),
    kind: 'revolve',
    sketchId: sk.id,
    axis: { a: [axisX, minY - 20], b: [axisX, maxY + 20] },
    angle: 360,
    operation: 'new',
    regionIndex: sel.regionIndex ?? null,
  };
  S.setPending(
    S.makePending('revolve', feature, 360, {
      title: 'Revolve',
      step: 5,
      min: 1,
      unit: 'deg',
      hint: 'Revolves about the profile’s left edge',
    }),
  );
}

export function startFillet() {
  const sel = selected();
  if (!sel || sel.kind !== 'edge' || !sel.bodyId || !sel.edgeKey) {
    S.toast('Select an edge first');
    return;
  }
  const body = S.store.state.evalResult.bodies.find((b) => b.id === sel.bodyId);
  if (!body) return;
  const edge = solidEdges(body.solid).find((e) => e.key === sel.edgeKey);
  if (!edge) {
    S.toast('Edge no longer available');
    return;
  }
  if (edge.faces.length < 2) {
    S.toast('Fillet needs an edge between two faces');
    return;
  }
  const feature: FilletFeature = {
    id: S.uid('ft'),
    name: featureName('fillet', 'Fillet'),
    kind: 'fillet',
    bodyId: sel.bodyId,
    edgeKey: sel.edgeKey,
    radius: 2,
    segments: 8,
  };
  S.setPending(
    S.makePending('fillet', feature, 2, {
      title: 'Fillet',
      step: 0.5,
      min: 0.1,
      hint: 'Drag up / down or type a radius',
    }),
  );
}

export function startChamfer() {
  const sel = selected();
  if (!sel || sel.kind !== 'edge' || !sel.bodyId || !sel.edgeKey) {
    S.toast('Select an edge first');
    return;
  }
  const feature: ChamferFeature = {
    id: S.uid('ft'),
    name: featureName('chamfer', 'Chamfer'),
    kind: 'chamfer',
    bodyId: sel.bodyId,
    edgeKey: sel.edgeKey,
    distance: 1,
  };
  S.setPending(
    S.makePending('chamfer', feature, 1, {
      title: 'Chamfer',
      step: 0.5,
      min: 0.1,
      hint: 'Drag up / down or type a distance',
    }),
  );
}

export function startPushPull() {
  const sel = selected();
  if (!sel || sel.kind !== 'face' || !sel.bodyId || sel.faceIndex === undefined) {
    S.toast('Select a face first');
    return;
  }
  const body = S.store.state.evalResult.bodies.find((b) => b.id === sel.bodyId);
  const face = body?.solid.faces[sel.faceIndex];
  if (!face) return;
  const feature: Feature = {
    id: S.uid('ft'),
    name: featureName('pushpull', 'Move Face'),
    kind: 'pushpull',
    bodyId: sel.bodyId,
    faceRef: { point: sel.point ?? face.loops[0][0], normal: face.plane.n },
    distance: 5,
  };
  S.setPending(
    S.makePending('pushpull', feature, 5, {
      title: 'Offset Face',
      step: 1,
      hint: 'Positive moves outward',
    }),
  );
}

export function deleteSelection() {
  const s = S.store.state;
  if (s.pending) {
    S.cancelPending();
    return;
  }
  const sel = selected();
  if (!sel) return;
  if (sel.kind === 'body' && sel.bodyId) {
    S.deleteBody(sel.bodyId);
    return;
  }
  if (sel.kind === 'sketchEntity' && sel.entityId && sel.sketchId) {
    S.editSketch(sel.sketchId, (draft) => {
      draft.entities = draft.entities.filter((e) => e.id !== sel.entityId);
      draft.constraints = draft.constraints.filter((c) => !c.refs.includes(sel.entityId!));
    });
    S.setSelection([]);
    return;
  }
  if (sel.kind === 'region' && sel.sketchId) {
    // Removing the profile means editing the sketch; guide the user there.
    S.setSelection([]);
    S.toast('Open the sketch to delete profile geometry');
    return;
  }
  S.toast('Select a body or sketch entity to delete');
}

export function hideSelection() {
  const sel = selected();
  if (!sel?.bodyId) return;
  const body = S.store.state.evalResult.bodies.find((b) => b.id === sel.bodyId);
  if (!body) return;
  S.toggleFeatureHidden(body.featureId);
}

export function mirrorSelected() {
  const sel = selected();
  if (!sel?.bodyId) {
    S.toast('Select a body to mirror');
    return;
  }
  const feature: MirrorFeature = {
    id: S.uid('ft'),
    name: featureName('mirror', 'Mirror'),
    kind: 'mirror',
    bodyId: sel.bodyId,
    plane: 'YZ',
  };
  S.addFeature(feature);
  S.toast('Mirrored across the YZ plane');
}

export function patternSelected(mode: 'linear' | 'circular') {
  const sel = selected();
  if (!sel?.bodyId) {
    S.toast('Select a body to pattern');
    return;
  }
  const body = S.store.state.evalResult.bodies.find((b) => b.id === sel.bodyId);
  if (!body) return;
  const size = Math.max(
    body.measure.bboxMax[0] - body.measure.bboxMin[0],
    body.measure.bboxMax[1] - body.measure.bboxMin[1],
  );
  const feature: PatternFeature = {
    id: S.uid('ft'),
    name: featureName('pattern', 'Pattern'),
    kind: 'pattern',
    bodyId: sel.bodyId,
    mode,
    count: mode === 'linear' ? 2 : 4,
    spacing: size * 1.4,
    angle: 360,
    direction: [1, 0, 0],
    axis: [0, 0, 1],
  };
  S.addFeature(feature);
  S.toast(mode === 'linear' ? 'Linear pattern added' : 'Circular pattern added');
}

export function extrudeCutThrough() {
  startExtrude('cut', true);
}

/* --------------------- shell, split, sweep, loft, isolate ------------------ */

export function startShell() {
  const s = S.store.state;
  const faces = s.selection.filter(
    (x) => x.kind === 'face' && !!x.bodyId && !!x.point && !!x.normal,
  );
  const bodyId =
    (faces[0]?.bodyId as string | undefined) ??
    s.selection.find((x) => !!x.bodyId)?.bodyId;
  if (!bodyId) {
    S.toast('Select the face(s) to open, or a body to hollow');
    return;
  }
  const feature: ShellFeature = {
    id: S.uid('ft'),
    name: featureName('shell', 'Shell'),
    kind: 'shell',
    bodyId,
    thickness: 2,
    openFaces: faces.map((x) => ({ point: x.point as Vec3, normal: x.normal as Vec3 })),
  };
  S.addFeature(feature, [{ kind: 'body', bodyId }]);
  S.toast(
    faces.length
      ? `Shell 2 mm · ${faces.length} face${faces.length > 1 ? 's' : ''} removed`
      : 'Shell 2 mm · edit the wall in Features',
  );
}

export function startSplit() {
  const sel = S.store.state.selection.find((x) => !!x.bodyId);
  if (!sel?.bodyId) {
    S.toast('Select a body to split');
    return;
  }
  const body = S.store.state.evalResult.bodies.find((b) => b.id === sel.bodyId);
  if (!body) return;
  const m = body.measure;
  const ext = [
    m.bboxMax[0] - m.bboxMin[0],
    m.bboxMax[1] - m.bboxMin[1],
    m.bboxMax[2] - m.bboxMin[2],
  ];
  const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
  const feature: SplitFeature = {
    id: S.uid('ft'),
    name: featureName('split', 'Split body'),
    kind: 'split',
    bodyId: sel.bodyId,
    plane: axis === 0 ? 'YZ' : axis === 1 ? 'XZ' : 'XY',
    offset: Math.round(m.centroid[axis] * 10) / 10,
  };
  S.addFeature(feature, []);
  S.toast('Body split in two — edit the plane in Features');
}

export function startSweep() {
  const s = S.store.state;
  const region = s.selection.find((x) => x.kind === 'region' && !!x.sketchId);
  if (!region?.sketchId) {
    S.toast('Select a profile to sweep');
    return;
  }
  const sk = S.sketchById(region.sketchId);
  if (!sk) return;
  const candidates = s.doc.sketches
    .filter((x) => x.id !== sk.id)
    .filter((x) => sketchOpenChains(x).some((c) => c.length >= 2));
  if (!candidates.length) {
    S.toast('Draw the path first: an open line, arc or spline in another sketch');
    return;
  }
  const feature: SweepFeature = {
    id: S.uid('ft'),
    name: featureName('sweep', 'Sweep'),
    kind: 'sweep',
    sketchId: sk.id,
    regionIndex: region.regionIndex ?? null,
    pathSketchId: candidates[candidates.length - 1].id,
    twist: 0,
    scale: 1,
    operation: 'new',
  };
  S.addFeature(feature, []);
  S.toast(`Swept along ${candidates[candidates.length - 1].name}`);
}

export function startLoft() {
  const s = S.store.state;
  const picked = s.selection.filter((x) => x.kind === 'region' && !!x.sketchId);
  if (picked.length < 2) {
    S.toast('Select two or more profiles — tap each one in turn');
    return;
  }
  // Two profiles sitting on the same plane have nothing to loft between.
  const planes = picked.map((p) => S.sketchById(p.sketchId)?.plane ?? null);
  const samePlane =
    planes.length > 1 &&
    planes.every(
      (pl) =>
        !!pl &&
        Math.abs(Math.abs(pl.n[0]) - Math.abs(planes[0]!.n[0])) < 1e-6 &&
        Math.abs(Math.abs(pl.n[1]) - Math.abs(planes[0]!.n[1])) < 1e-6 &&
        Math.abs(Math.abs(pl.n[2]) - Math.abs(planes[0]!.n[2])) < 1e-6 &&
        Math.hypot(
          pl.origin[0] - planes[0]!.origin[0],
          pl.origin[1] - planes[0]!.origin[1],
          pl.origin[2] - planes[0]!.origin[2],
        ) < 1e-6,
    );
  if (samePlane) {
    S.toast('Loft needs profiles on different planes or heights');
    return;
  }

  const order = new Map<string, number>();
  s.doc.features.forEach((f, i) => {
    if (f.kind === 'sketch') order.set(f.sketchId, i);
  });
  const profiles = picked
    .map((p) => ({ sketchId: p.sketchId as string, regionIndex: p.regionIndex ?? null }))
    .sort(
      (a, b) => (order.get(a.sketchId) ?? 0) - (order.get(b.sketchId) ?? 0),
    );
  const feature: LoftFeature = {
    id: S.uid('ft'),
    name: featureName('loft', 'Loft'),
    kind: 'loft',
    profiles,
    closed: false,
    operation: 'new',
  };
  S.addFeature(feature, []);
  S.store.set({ additiveSelect: false });
  S.toast(`Loft through ${profiles.length} profiles`);
}

export function isolateSelection() {
  const ids = Array.from(
    new Set(S.store.state.selection.map((x) => x.bodyId).filter((x): x is string => !!x)),
  );
  if (!ids.length) {
    S.toast('Select a body to isolate');
    return;
  }
  S.isolateBodies(ids);
  S.toast(`Isolated ${ids.length} bod${ids.length > 1 ? 'ies' : 'y'}`);
}

export function showAllBodies() {
  S.clearIsolate();
}

export function measureSelection() {
  S.store.set({ panel: 'measure' });
}

export function selectionSummary(): string {
  const s = S.store.state;
  const sel = selected();
  if (!sel) return '';
  if (sel.kind === 'face' && sel.bodyId !== undefined && sel.faceIndex !== undefined) {
    const body = s.evalResult.bodies.find((b) => b.id === sel.bodyId);
    if (!body) return 'Face';
    return `Face · ${body.name}`;
  }
  if (sel.kind === 'edge') return 'Edge';
  if (sel.kind === 'body') {
    const body = s.evalResult.bodies.find((b) => b.id === sel.bodyId);
    if (!body) return 'Body';
    return body.name;
  }
  if (sel.kind === 'region') {
    const sk = s.doc.sketches.find((x) => x.id === sel.sketchId);
    return sk ? `Profile · ${sk.name}` : 'Profile';
  }
  if (sel.kind === 'sketchEntity') return 'Sketch entity';
  return '';
}

export const vec3 = (v: Vec3): Vec3 => v;
export const vec2 = (v: Vec2): Vec2 => v;
