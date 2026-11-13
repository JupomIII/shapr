import { useEffect, useState } from 'react';
import { Vec2, Vec3 } from '../kernel/vec';
import { to3D } from '../kernel/ops';
import { arcGeom } from '../sketch/geometry';
import { Sketch, SketchEntity } from '../sketch/types';
import { viewportRef } from '../render/viewportRef';
import * as S from '../state/store';

/**
 * Constraints of the selected sketch element, shown at the element itself the
 * way Shapr3D highlights connected constraints. Tapping one deletes it, which
 * is the fastest way to make an over-constrained sketch editable again.
 */

const GLYPH: Record<string, string> = {
  horizontal: 'H',
  vertical: 'V',
  perpendicular: '⊥',
  parallel: '∥',
  equal: '=',
  concentric: '◎',
  tangent: 'T',
  coincident: '◦',
  fixed: '◉',
  distance: '↔',
  length: '↔',
  radius: 'R',
  diameter: '⌀',
  angle: '∠',
};

const NAME: Record<string, string> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  equal: 'Equal',
  concentric: 'Concentric',
  tangent: 'Tangent',
  coincident: 'Coincident',
  fixed: 'Fixed',
  distance: 'Distance',
  length: 'Length',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
};

const refPointsOf = (e: SketchEntity): string[] => {
  if (e.kind === 'line' || e.kind === 'arc') return [e.a, e.b];
  if (e.kind === 'circle') return [e.c];
  if (e.kind === 'spline') return e.pts;
  return [];
};

const entityMid = (sk: Sketch, e: SketchEntity): Vec2 | null => {
  if (e.kind === 'line') {
    const a = sk.points[e.a];
    const b = sk.points[e.b];
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  }
  if (e.kind === 'circle') return sk.points[e.c] ?? null;
  if (e.kind === 'arc') {
    const g = arcGeom(sk, e);
    return g ? g.c : null;
  }
  if (e.kind === 'spline') {
    const pts = e.pts.map((id) => sk.points[id]).filter(Boolean) as Vec2[];
    return pts.length ? pts[Math.floor(pts.length / 2)] : null;
  }
  return null;
};

export function SketchBadges() {
  const s = S.useApp();
  const [, setTick] = useState(0);
  const sel = s.selection.find((x) => x.kind === 'sketchEntity');
  const sk = s.doc.sketches.find((x) => x.id === sel?.sketchId) ?? null;
  const e = sk?.entities.find((x) => x.id === sel?.entityId) ?? null;

  // The badges sit at a world point, so they follow the camera.
  useEffect(() => {
    if (!e) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id]);

  const vp = viewportRef.current;
  if (!sk || !e || !vp || s.mode !== 'sketch') return null;

  const refs = refPointsOf(e);
  const list = sk.constraints.filter(
    (c) => c.refs.includes(e.id) || c.refs.some((r) => refs.includes(r)),
  );
  const mid = entityMid(sk, e);
  if (!mid || !list.length) return null;

  const frame = {
    origin: sk.plane.origin as Vec3,
    u: sk.plane.u as Vec3,
    v: sk.plane.v as Vec3,
    n: sk.plane.n as Vec3,
  };
  const at = vp.worldToScreen(to3D(frame, mid));

  const remove = (constraintId: string, label: string) => {
    S.editSketch(sk.id, (d) => {
      d.constraints = d.constraints.filter((c) => c.id !== constraintId);
    });
    S.toast(`${label} constraint removed`);
  };

  return (
    <div className="constraint-row" style={{ left: at.x, top: at.y - 48 }}>
      {list.map((c) => {
        const label = NAME[c.kind] ?? c.kind;
        return (
          <button
            key={c.id}
            className={`constraint-badge ${c.value != null ? 'dim' : ''}`}
            title={`${label} — tap to remove`}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={() => remove(c.id, label)}
          >
            {c.value != null ? (
              <span>
                {GLYPH[c.kind] ?? label[0]}
                {Math.round(c.value * 100) / 100}
              </span>
            ) : (
              <span>{GLYPH[c.kind] ?? label[0]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
