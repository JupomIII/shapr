import { useEffect, useState } from 'react';
import { Vec3 } from '../kernel/vec';
import { to3D } from '../kernel/ops';
import { entityMidpoint } from '../sketch/diagnostics';
import { SketchEntity } from '../sketch/types';
import { viewportRef } from '../render/viewportRef';
import * as S from '../state/store';
import * as OPS from '../state/ops';

/**
 * Relations between two selected sketch elements. Constraining is not only about
 * removing constraints: pick two lines and make them perpendicular or parallel,
 * two arcs and make them equal, a line and a circle and make them tangent.
 */

const isLine = (e: SketchEntity) => e.kind === 'line';
const isRound = (e: SketchEntity) => e.kind === 'circle' || e.kind === 'arc';

interface Option {
  kind: 'perpendicular' | 'parallel' | 'equal' | 'tangent';
  glyph: string;
  label: string;
  ok: boolean;
}

export function SketchConstraints() {
  const s = S.useApp();
  const [, setTick] = useState(0);
  const items = s.selection.filter((x) => x.kind === 'sketchEntity');
  const sketchId = items[0]?.sketchId ?? null;
  const sk = s.doc.sketches.find((x) => x.id === sketchId) ?? null;

  useEffect(() => {
    if (items.length !== 2) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, items[0]?.entityId, items[1]?.entityId]);

  const vp = viewportRef.current;
  if (s.mode !== 'sketch' || !sk || !vp || items.length !== 2) return null;

  const a = sk.entities.find((e) => e.id === items[0].entityId);
  const b = sk.entities.find((e) => e.id === items[1].entityId);
  if (!a || !b) return null;

  const options: Option[] = [
    {
      kind: 'perpendicular',
      glyph: '⟂',
      label: 'Perpendicular',
      ok: isLine(a) && isLine(b),
    },
    { kind: 'parallel', glyph: '∥', label: 'Parallel', ok: isLine(a) && isLine(b) },
    { kind: 'equal', glyph: '=', label: 'Equal', ok: a.kind === b.kind },
    {
      kind: 'tangent',
      glyph: 'T',
      label: 'Tangent',
      ok: (isRound(a) || isRound(b)) && a.kind !== 'spline' && b.kind !== 'spline',
    },
  ];

  const ma = entityMidpoint(sk, a);
  const mb = entityMidpoint(sk, b);
  if (!ma || !mb) return null;

  const frame = {
    origin: sk.plane.origin as Vec3,
    u: sk.plane.u as Vec3,
    v: sk.plane.v as Vec3,
    n: sk.plane.n as Vec3,
  };
  const mid = to3D(frame, [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2]);
  const at = vp.worldToScreen(mid);
  const width = 216;
  const left = Math.max(10, Math.min(window.innerWidth - width - 10, at.x - width / 2));
  const top = Math.max(10, Math.min(window.innerHeight - 60, at.y + 46));

  const apply = (opt: Option) => {
    if (!opt.ok) return;
    OPS.applySketchConstraint(sk.id, opt.kind, [a.id, b.id], opt.label);
  };

  return (
    <div
      className="constraint-bar"
      style={{ left, top, width }}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <span className="constraint-bar-title">Constraint</span>
      {options.map((opt) => (
        <button
          key={opt.kind}
          className="constraint-btn"
          disabled={!opt.ok}
          title={opt.ok ? opt.label : `${opt.label} — needs matching elements`}
          aria-label={opt.label}
          onClick={() => apply(opt)}
        >
          {opt.glyph}
        </button>
      ))}
      <button
        className="constraint-btn ghost"
        title="Clear selection"
        aria-label="Clear selection"
        onClick={() => S.setSelection([])}
      >
        ×
      </button>
    </div>
  );
}
