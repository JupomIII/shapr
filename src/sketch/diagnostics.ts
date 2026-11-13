// Live sketch diagnostics: what still moves, and where the profile is broken.
// Shapr3D colours sketch geometry by constraint state (blue under-defined,
// green fully defined) and marks open sketch ends, so the user always knows
// whether the shape is real before leaving the sketch.

import { Vec2 } from '../kernel/vec';
import { Sketch } from './types';
import { solveSketch } from './solver';

export interface OpenEnd {
  id: string;
  p: Vec2;
}

/** Endpoints used by exactly one entity: the gaps in an open profile. */
export function openEndpoints(sk: Sketch): OpenEnd[] {
  const uses = new Map<string, number>();
  const bump = (id: string) => uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.kind === 'line' || e.kind === 'arc') {
      bump(e.a);
      bump(e.b);
    } else if (e.kind === 'spline' && !e.closed && e.pts.length) {
      bump(e.pts[0]);
      bump(e.pts[e.pts.length - 1]);
    }
  }
  const out: OpenEnd[] = [];
  for (const [id, n] of uses) {
    const p = sk.points[id];
    if (n === 1 && p) out.push({ id, p });
  }
  return out;
}

export interface SketchDiagnostics {
  dof: number;
  fullyDefined: boolean;
  open: OpenEnd[];
}

/**
 * Constraint state of one sketch. The solver is what decides this, so the
 * answer cannot drift from the geometry that is actually drawn.
 */
export function sketchDiagnostics(sk: Sketch): SketchDiagnostics {
  const solved = solveSketch(sk);
  return {
    dof: Math.max(0, solved.dof),
    fullyDefined: solved.fullyConstrained && sk.entities.length > 0,
    open: openEndpoints(sk),
  };
}
