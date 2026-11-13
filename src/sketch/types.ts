// Sketch data model. Points are shared between entities, so geometric
// coincidence is expressed by point identity and the solver works on a flat
// point table plus circle radii.

import { Vec2 } from '../kernel/vec';

export type SketchEntityKind = 'line' | 'circle' | 'arc' | 'spline';

export interface SketchLine {
  id: string;
  kind: 'line';
  a: string;
  b: string;
  construction?: boolean;
}
export interface SketchCircle {
  id: string;
  kind: 'circle';
  c: string;
  r: number;
  construction?: boolean;
}
export interface SketchArc {
  id: string;
  kind: 'arc';
  /** Endpoints plus a point on the arc (three-point arc definition). */
  a: string;
  b: string;
  mid: string;
  construction?: boolean;
}
export interface SketchSpline {
  id: string;
  kind: 'spline';
  pts: string[];
  closed?: boolean;
  construction?: boolean;
}

export type SketchEntity = SketchLine | SketchCircle | SketchArc | SketchSpline;

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'concentric'
  | 'tangent'
  | 'fixed'
  | 'distance'
  | 'length'
  | 'radius'
  | 'diameter'
  | 'angle';

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  refs: string[];
  /** Dimension / angle value, in mm or degrees. */
  value?: number;
  /** Target coordinates for `fixed`. */
  target?: Vec2;
}

export interface Sketch {
  id: string;
  name: string;
  /** Sketch plane, stored as a resolved frame so it survives serialization. */
  plane: { origin: [number, number, number]; u: [number, number, number]; v: [number, number, number]; n: [number, number, number] };
  planeLabel: string;
  /** Body/face association when the sketch was created on a face. */
  onFace?: { featureId: string };
  points: Record<string, Vec2>;
  entities: SketchEntity[];
  constraints: Constraint[];
  visible: boolean;
}

export interface SketchSolveResult {
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  satisfied: boolean;
  maxResidual: number;
  dof: number;
  fullyConstrained: boolean;
  updated: boolean;
}
