// Parametric document: sketches plus an ordered feature list. Everything here is
// serializable; geometry is always regenerated from this data.

import { Vec2, Vec3 } from '../kernel/vec';
import { Sketch } from '../sketch/types';

export type FeatureKind =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'pushpull'
  | 'pattern'
  | 'mirror'
  | 'transform'
  | 'import';

export interface FeatureBase {
  id: string;
  name: string;
  hidden?: boolean;
  suppressed?: boolean;
}

export interface SketchFeature extends FeatureBase {
  kind: 'sketch';
  sketchId: string;
}

export type ExtrudeOperation = 'new' | 'join' | 'cut' | 'intersect';

export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude';
  sketchId: string;
  height: number;
  operation: ExtrudeOperation;
  direction: 1 | -1;
  throughAll?: boolean;
  targetBodyId?: string | null;
  /** Which profile of the sketch to use (null = all profiles). */
  regionIndex?: number | null;
}

export interface RevolveFeature extends FeatureBase {
  kind: 'revolve';
  sketchId: string;
  /** Axis in sketch coordinates. */
  axis: { a: Vec2; b: Vec2 };
  /** Sweep in degrees. */
  angle: number;
  operation: 'new' | 'join' | 'cut';
  targetBodyId?: string | null;
  regionIndex?: number | null;
}

export interface FilletFeature extends FeatureBase {
  kind: 'fillet';
  bodyId: string;
  edgeKey: string;
  radius: number;
  segments?: number;
}

export interface ChamferFeature extends FeatureBase {
  kind: 'chamfer';
  bodyId: string;
  edgeKey: string;
  distance: number;
}

export interface FaceRef {
  point: Vec3;
  normal: Vec3;
}

export interface PushPullFeature extends FeatureBase {
  kind: 'pushpull';
  bodyId: string;
  faceRef: FaceRef;
  distance: number;
}

export interface PatternFeature extends FeatureBase {
  kind: 'pattern';
  bodyId: string;
  mode: 'linear' | 'circular';
  count: number;
  spacing: number;
  angle: number;
  direction?: Vec3;
  axis?: Vec3;
}

export interface MirrorFeature extends FeatureBase {
  kind: 'mirror';
  bodyId: string;
  plane: 'XY' | 'YZ' | 'XZ';
}

export interface TransformFeature extends FeatureBase {
  kind: 'transform';
  bodyId: string;
  translation: Vec3;
  rotationAxis?: Vec3;
  rotationAngle?: number;
}

export interface ImportFeature extends FeatureBase {
  kind: 'import';
  /** Triangle soup in mm, stored as a flat array of points. */
  positions: Vec3[];
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | PushPullFeature
  | PatternFeature
  | MirrorFeature
  | TransformFeature
  | ImportFeature;

export type UnitSystem = 'mm' | 'cm' | 'm' | 'in';

export interface ProjectDoc {
  version: 1;
  id: string;
  name: string;
  units: UnitSystem;
  sketches: Sketch[];
  features: Feature[];
  /** Number of features evaluated (roll-back bar). null = all. */
  rollback?: number | null;
  createdAt: number;
  updatedAt: number;
}

export const UNIT_FACTOR: Record<UnitSystem, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export const UNIT_LABEL: Record<UnitSystem, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
};

export function toDisplay(mm: number, units: UnitSystem): number {
  return mm / UNIT_FACTOR[units];
}
export function fromDisplay(value: number, units: UnitSystem): number {
  return value * UNIT_FACTOR[units];
}

export function newDoc(name = 'Untitled'): ProjectDoc {
  const now = Date.now();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    sketches: [],
    features: [],
    rollback: null,
    createdAt: now,
    updatedAt: now,
  };
}
