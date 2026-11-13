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
  MirrorFeature,
  PatternFeature,
  RevolveFeature,
} from '../model/types';
import { sketchRegions } from '../sketch/geometry';
import * as S from './store';

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
