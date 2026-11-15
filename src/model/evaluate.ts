// Deterministic feature evaluation: walks the tree, resolves referenced
// geometry by position (so it survives upstream edits), and records per-feature
// errors instead of failing the whole model.

import {
  Vec2,
  Vec3,
  add3,
  dist3,
  dot3,
  mid3,
  neg3,
  norm3,
  scale3,
  sub3,
} from '../kernel/vec';
import {
  Edge,
  Face,
  Solid,
  SolidMeasure,
  facesToTris,
  measureSolid,
  solidEdges,
  trisToSolid,
} from '../kernel/solid';
import {
  Frame,
  chamferEdge,
  circularPattern,
  extrudeRegions,
  filletEdge,
  intersectSolids,
  linearPattern,
  loftSolid,
  mirrorSolid,
  pushPullFace,
  revolveRegions,
  rotateSolid,
  shellSolid,
  splitByPlane,
  subtractSolids,
  sweepRegions,
  to3D,
  transformSolid,
  translateSolid,
  unionSolids,
} from '../kernel/ops';
import { sketchOpenChains, sketchRegions } from '../sketch/geometry';
import {
  ChamferFeature,
  ExtrudeFeature,
  Feature,
  FilletFeature,
  LoftFeature,
  MirrorFeature,
  PatternFeature,
  ProjectDoc,
  PushPullFeature,
  RevolveFeature,
  ShellFeature,
  SplitFeature,
  SweepFeature,
  TransformFeature,
} from './types';

export interface EvalBody {
  id: string;
  name: string;
  featureId: string;
  solid: Solid;
  measure: SolidMeasure;
  hidden: boolean;
  /** Display / export colour; undefined falls back to the viewport default. */
  color?: string;
}

export interface EvalResult {
  bodies: EvalBody[];
  errors: Record<string, string>;
  /** Bumped whenever geometry changes so renderers can diff cheaply. */
  version: number;
  /** Sketch id -> generated regions, reused by the viewport for picking. */
  regions: Record<string, { outer: Vec2[]; holes: Vec2[][] }[]>;
}

const frameOf = (plane: {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  n: [number, number, number];
}): Frame => ({
  origin: plane.origin as Vec3,
  u: plane.u as Vec3,
  v: plane.v as Vec3,
  n: plane.n as Vec3,
});

export function resolveEdge(solid: Solid, key: string): Edge | null {
  const edges = solidEdges(solid);
  const exact = edges.find((e) => e.key === key);
  if (exact) return exact;
  const parts = key.split(',').map(Number);
  if (parts.length !== 3 || parts.some((p) => !isFinite(p))) return null;
  const target: Vec3 = [parts[0], parts[1], parts[2]];
  let best: Edge | null = null;
  let bestD = 3;
  for (const e of edges) {
    const d = dist3(mid3(e.a, e.b), target);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function resolveFace(solid: Solid, ref: { point: Vec3; normal: Vec3 }): number | null {
  let best = -1;
  let bestScore = Infinity;
  solid.faces.forEach((f, i) => {
    const align = dot3(f.plane.n, norm3(ref.normal));
    if (align < 0.99) return;
    const dist = Math.abs(dot3(f.plane.n, ref.point) - f.plane.d);
    if (dist > 0.75) return;
    const score = dist;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best >= 0 ? best : null;
}

function targetBodies(bodies: EvalBody[], targetId?: string | null): EvalBody[] {
  if (targetId) return bodies.filter((b) => b.id === targetId);
  return bodies.slice();
}

function bboxExtentAlong(solid: Solid, origin: Vec3, n: Vec3): { lo: number; hi: number } {
  const m = measureSolid(solid);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? m.bboxMax[0] : m.bboxMin[0],
      i & 2 ? m.bboxMax[1] : m.bboxMin[1],
      i & 4 ? m.bboxMax[2] : m.bboxMin[2],
    ];
    const t = dot3(sub3(corner, origin), n);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (!isFinite(lo)) return { lo: 0, hi: 0 };
  return { lo, hi };
}

function makeBody(
  id: string,
  name: string,
  featureId: string,
  solid: Solid,
  hidden = false,
  color?: string,
): EvalBody {
  return { id, name, featureId, solid, measure: measureSolid(solid), hidden, color };
}

export function evaluate(doc: ProjectDoc): EvalResult {
  const errors: Record<string, string> = {};
  let bodies: EvalBody[] = [];
  const regions: EvalResult['regions'] = {};
  const limit = doc.rollback == null ? doc.features.length : Math.max(0, doc.rollback);

  const getSketch = (id: string) => doc.sketches.find((s) => s.id === id) ?? null;

  for (let idx = 0; idx < limit; idx++) {
    const f = doc.features[idx];
    if (!f || f.suppressed) continue;
    try {
      switch (f.kind) {
        case 'sketch': {
          const sk = getSketch(f.sketchId);
          if (sk && !regions[sk.id]) regions[sk.id] = sketchRegions(sk);
          break;
        }
        case 'extrude': {
          const feat = f as ExtrudeFeature;
          const sk = getSketch(feat.sketchId);
          if (!sk) {
            errors[f.id] = 'Sketch missing';
            break;
          }
          const frame = frameOf(sk.plane);
          const allRegs = regions[sk.id] ?? sketchRegions(sk);
          regions[sk.id] = allRegs;
          const regs =
            feat.regionIndex != null && allRegs[feat.regionIndex]
              ? [allRegs[feat.regionIndex]]
              : allRegs;
          if (!regs.length) {
            errors[f.id] = 'Sketch has no closed profile';
            break;
          }
          const targets = targetBodies(bodies, feat.targetBodyId);
          let tool: Solid;
          if (feat.throughAll) {
            let lo = 0;
            let hi = 0;
            for (const b of targets) {
              const e = bboxExtentAlong(b.solid, frame.origin, frame.n);
              lo = Math.min(lo, e.lo);
              hi = Math.max(hi, e.hi);
            }
            const h = hi - lo + 10;
            tool = extrudeRegions(regs, frame, h);
            tool = translateSolid(tool, scale3(frame.n, lo - 5));
          } else {
            const h = feat.height * feat.direction;
            tool = extrudeRegions(regs, frame, h, feat.draft ?? 0);
          }
          if (!tool.faces.length) {
            errors[f.id] = 'Extrusion produced no solid';
            break;
          }
          if (feat.operation === 'new') {
            bodies.push(
              makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden, feat.color),
            );
          } else if (feat.operation === 'join') {
            const target = targets[0] ?? bodies[bodies.length - 1];
            if (!target) {
              bodies.push(makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden));
            } else {
              const merged = unionSolids(target.solid, tool);
              if (!merged.faces.length) errors[f.id] = 'Join produced an empty body';
              else
                bodies = bodies.map((b) =>
                  b.id === target.id
                    ? makeBody(b.id, b.name, b.featureId, merged, b.hidden || f.hidden, b.color)
                    : b,
                );
            }
          } else if (feat.operation === 'cut') {
            const list = targets.length ? targets : bodies;
            let any = false;
            bodies = bodies.map((b) => {
              if (!list.includes(b)) return b;
              const res = subtractSolids(b.solid, tool);
              if (!res.faces.length) return b;
              any = true;
              return makeBody(b.id, b.name, b.featureId, res, b.hidden);
            });
            if (!any) errors[f.id] = 'Cut removed nothing';
          } else {
            const list = targets.length ? targets : bodies;
            bodies = bodies.map((b) => {
              if (!list.includes(b)) return b;
              const res = intersectSolids(b.solid, tool);
              if (!res.faces.length) return b;
              return makeBody(b.id, b.name, b.featureId, res, b.hidden);
            });
          }
          break;
        }
        case 'revolve': {
          const feat = f as RevolveFeature;
          const sk = getSketch(feat.sketchId);
          if (!sk) {
            errors[f.id] = 'Sketch missing';
            break;
          }
          const frame = frameOf(sk.plane);
          const allRegs = regions[sk.id] ?? sketchRegions(sk);
          regions[sk.id] = allRegs;
          const regs =
            feat.regionIndex != null && allRegs[feat.regionIndex]
              ? [allRegs[feat.regionIndex]]
              : allRegs;
          if (!regs.length) {
            errors[f.id] = 'Sketch has no closed profile';
            break;
          }
          const tool = revolveRegions(
            regs,
            frame,
            feat.axis,
            64,
            (feat.angle * Math.PI) / 180,
          );
          if (!tool.faces.length) {
            errors[f.id] = 'Revolve produced no solid';
            break;
          }
          if (feat.operation === 'new') {
            bodies.push(
              makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden, feat.color),
            );
          } else if (feat.operation === 'cut') {
            bodies = bodies.map((b) => {
              const res = subtractSolids(b.solid, tool);
              return res.faces.length ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b;
            });
          } else {
            const target = targetBodies(bodies, feat.targetBodyId)[0] ?? bodies[bodies.length - 1];
            if (target) {
              const merged = unionSolids(target.solid, tool);
              bodies = bodies.map((b) =>
                b.id === target.id
                  ? makeBody(b.id, b.name, b.featureId, merged, b.hidden, b.color)
                  : b,
              );
            }
          }
          break;
        }
        case 'fillet': {
          const feat = f as FilletFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const edge = resolveEdge(body.solid, feat.edgeKey);
          if (!edge) {
            errors[f.id] = 'Edge no longer exists';
            break;
          }
          const res = filletEdge(body.solid, edge, feat.radius, feat.segments ?? 8);
          if (!res) {
            errors[f.id] = 'Fillet not possible on this edge';
            break;
          }
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'chamfer': {
          const feat = f as ChamferFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const edge = resolveEdge(body.solid, feat.edgeKey);
          if (!edge) {
            errors[f.id] = 'Edge no longer exists';
            break;
          }
          const res = chamferEdge(body.solid, edge, feat.distance);
          if (!res) {
            errors[f.id] = 'Chamfer not possible on this edge';
            break;
          }
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'pushpull': {
          const feat = f as PushPullFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const fi = resolveFace(body.solid, feat.faceRef);
          if (fi === null) {
            errors[f.id] = 'Face no longer exists';
            break;
          }
          const res = pushPullFace(body.solid, fi, feat.distance);
          if (!res) {
            errors[f.id] = 'Face operation failed';
            break;
          }
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'pattern': {
          const feat = f as PatternFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const res =
            feat.mode === 'linear'
              ? linearPattern(body.solid, feat.direction ?? [1, 0, 0], feat.count, feat.spacing)
              : circularPattern(
                  body.solid,
                  feat.axis ?? [0, 0, 1],
                  feat.count,
                  (feat.angle * Math.PI) / 180,
                  body.measure.centroid,
                );
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'mirror': {
          const feat = f as MirrorFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const n: Vec3 =
            feat.plane === 'XY' ? [0, 0, 1] : feat.plane === 'YZ' ? [1, 0, 0] : [0, 1, 0];
          const mirrored = mirrorSolid(body.solid, n, 0);
          const res = unionSolids(body.solid, mirrored);
          bodies = bodies.map((b) =>
            b.id === body.id && res.faces.length
              ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color)
              : b,
          );
          break;
        }
        case 'transform': {
          const feat = f as TransformFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          let res = body.solid;
          if (feat.rotationAxis && feat.rotationAngle) {
            res = rotateSolid(
              res,
              feat.rotationAxis,
              (feat.rotationAngle * Math.PI) / 180,
              body.measure.centroid,
            );
          }
          if (feat.translation.some((v) => Math.abs(v) > 1e-9)) {
            res = translateSolid(res, feat.translation);
          }
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'shell': {
          const feat = f as ShellFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const res = shellSolid(body.solid, feat.thickness, feat.openFaces);
          if (!res) {
            errors[f.id] = 'Shell failed — try a thinner wall or fewer open faces';
            break;
          }
          bodies = bodies.map((b) =>
            b.id === body.id ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b,
          );
          break;
        }
        case 'sweep': {
          const feat = f as SweepFeature;
          const sk = getSketch(feat.sketchId);
          const pathSk = getSketch(feat.pathSketchId);
          if (!sk) {
            errors[f.id] = 'Profile sketch missing';
            break;
          }
          if (!pathSk) {
            errors[f.id] = 'Path sketch missing';
            break;
          }
          const frame = frameOf(sk.plane);
          const allRegs = regions[sk.id] ?? sketchRegions(sk);
          regions[sk.id] = allRegs;
          const regs =
            feat.regionIndex != null && allRegs[feat.regionIndex]
              ? [allRegs[feat.regionIndex]]
              : allRegs;
          if (!regs.length) {
            errors[f.id] = 'Profile sketch has no closed profile';
            break;
          }
          const chains = sketchOpenChains(pathSk);
          const chain = chains.slice().sort((a, b) => a.length - b.length).pop();
          if (!chain || chain.length < 2) {
            errors[f.id] = 'Path sketch has no open curve to sweep along';
            break;
          }
          const pathFrame = frameOf(pathSk.plane);
          const path3 = chain.map((p) => to3D(pathFrame, p));
          const tool = sweepRegions(regs, frame, path3, {
            twist: feat.twist,
            scale: feat.scale,
          });
          if (!tool) {
            errors[f.id] = 'Sweep produced no solid';
            break;
          }
          if (feat.operation === 'new') {
            bodies.push(
              makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden, feat.color),
            );
          } else if (feat.operation === 'cut') {
            bodies = bodies.map((b) => {
              const res = subtractSolids(b.solid, tool);
              return res.faces.length ? makeBody(b.id, b.name, b.featureId, res, b.hidden, b.color) : b;
            });
          } else {
            const target = bodies[bodies.length - 1];
            if (target) {
              const merged = unionSolids(target.solid, tool);
              bodies = bodies.map((b) =>
                b.id === target.id
                  ? makeBody(b.id, b.name, b.featureId, merged, b.hidden, b.color)
                  : b,
              );
            }
          }
          break;
        }
        case 'loft': {
          const feat = f as LoftFeature;
          const loops: Vec3[][] = [];
          for (const prof of feat.profiles) {
            const sk = getSketch(prof.sketchId);
            if (!sk) continue;
            const allRegs = regions[sk.id] ?? sketchRegions(sk);
            regions[sk.id] = allRegs;
            const reg = prof.regionIndex != null ? allRegs[prof.regionIndex] : allRegs[0];
            if (!reg) continue;
            const frame = frameOf(sk.plane);
            loops.push(reg.outer.map((p) => to3D(frame, p)));
          }
          if (loops.length < 2) {
            errors[f.id] = 'Loft needs at least two profiles';
            break;
          }
          const tool = loftSolid(loops, feat.closed);
          if (!tool || measureSolid(tool).volume < 1e-3) {
            errors[f.id] = 'Loft needs profiles on different planes or heights';
            break;
          }
          if (feat.operation === 'new') {
            bodies.push(
              makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden, feat.color),
            );
          } else {
            const target = bodies[bodies.length - 1];
            if (target) {
              const merged = unionSolids(target.solid, tool);
              bodies = bodies.map((b) =>
                b.id === target.id
                  ? makeBody(b.id, b.name, b.featureId, merged, b.hidden, b.color)
                  : b,
              );
            } else {
              bodies.push(
                makeBody(`${f.id}#${bodies.length}`, f.name, f.id, tool, f.hidden, feat.color),
              );
            }
          }
          break;
        }
        case 'split': {
          const feat = f as SplitFeature;
          const body = bodies.find((b) => b.id === feat.bodyId);
          if (!body) {
            errors[f.id] = 'Body missing';
            break;
          }
          const n: Vec3 =
            feat.plane === 'XY' ? [0, 0, 1] : feat.plane === 'YZ' ? [1, 0, 0] : [0, 1, 0];
          const halves = splitByPlane(body.solid, n, feat.offset ?? 0);
          const made: EvalBody[] = [];
          if (halves.positive)
            made.push(makeBody(`${f.id}#a`, `${body.name} A`, f.id, halves.positive, f.hidden, body.color));
          if (halves.negative)
            made.push(makeBody(`${f.id}#b`, `${body.name} B`, f.id, halves.negative, f.hidden, body.color));
          if (!made.length) {
            errors[f.id] = 'The plane does not cross the body';
            break;
          }
          bodies = bodies.flatMap((b) => (b.id === body.id ? made : [b]));
          break;
        }
        case 'import': {
          const pts = (f as { positions: Vec3[] }).positions;
          const tris: [Vec3, Vec3, Vec3][] = [];
          for (let i = 0; i + 2 < pts.length; i += 3) tris.push([pts[i], pts[i + 1], pts[i + 2]]);
          const solid = trisToSolid(tris);
          if (!solid.faces.length) {
            errors[f.id] = 'Imported mesh had no usable faces';
            break;
          }
          bodies.push(makeBody(`${f.id}#0`, f.name, f.id, solid, f.hidden, (f as { color?: string }).color));
          break;
        }
      }
    } catch (err) {
      errors[f.id] = err instanceof Error ? err.message : 'Feature failed';
    }
  }

  return { bodies, errors, version: Date.now(), regions };
}

/** Face centroid, handy for UI and for face references. */
export function faceCenter(f: Face): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const loop of f.loops)
    for (const p of loop) {
      x += p[0];
      y += p[1];
      z += p[2];
      n++;
    }
  return n ? [x / n, y / n, z / n] : [0, 0, 0];
}

export function solidBounds(solids: Solid[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    for (const t of facesToTris(s)) {
      for (const p of t)
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
    }
  }
  if (!isFinite(min[0])) return { min: [-50, -50, -50], max: [50, 50, 50] };
  return { min, max };
}
