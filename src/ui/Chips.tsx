import { useEffect, useState } from 'react';
import { Vec2, Vec3 } from '../kernel/vec';
import { arcGeom } from '../sketch/geometry';
import { to3D } from '../kernel/ops';
import { viewportRef } from '../render/viewportRef';
import * as S from '../state/store';
import { fromDisplay, toDisplay } from '../model/types';
import { Icon } from './Icons';

export const fmtNum = (v: number, digits = 2): string => {
  if (!isFinite(v)) return '0';
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, '') || '0';
};

const clampToViewport = (x: number, y: number) => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    left: Math.max(10, Math.min(w - 300, x)),
    top: Math.max(56, Math.min(h - 130, y)),
  };
};

/* ----------------------------- pending operation --------------------------- */

export function PendingChip() {
  const s = S.useApp();
  const p = s.pending;
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  const units = s.doc.units;
  useEffect(() => {
    if (!p) return;
    const shown = p.unit === 'deg' ? p.value : toDisplay(p.value, units);
    if (!focused) setText(fmtNum(shown, p.unit === 'deg' ? 1 : 2));
  }, [p?.value, p?.kind, focused, !!p, units]);

  if (!p) return null;

  const commitText = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (!isFinite(v)) return;
    S.updatePendingValue(p.unit === 'deg' ? v : fromDisplay(v, units));
  };

  const anchor = p.anchor;
  const style = anchor
    ? clampToViewport(anchor.x + 22, anchor.y - 16)
    : undefined;

  return (
    <div
      className={`chip ${anchor ? '' : 'center-bottom'}`}
      style={style as React.CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="chip-title">{p.title}</span>
      <button title="Decrease" onClick={() => S.updatePendingValue(p.value - p.step)}>
        <Icon name="minus" size={14} />
      </button>

      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setFocused(false);
            S.cancelPending();
          }
        }}
      />
      <span className="unit">{p.unit === 'deg' ? 'deg' : units}</span>
      <button title="Increase" onClick={() => S.updatePendingValue(p.value + p.step)}>
        <Icon name="plus" size={14} />
      </button>
      <span className="sep" />
      <button className="apply" title="Apply" onClick={() => S.confirmPending()}>
        <Icon name="check" size={15} />
      </button>
      <button title="Cancel" onClick={() => S.cancelPending()}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

/* ------------------------------ sketch dimension --------------------------- */

export function SketchDimensionChip() {
  const s = S.useApp();
  const vp = viewportRef.current;
  const sel = s.selection[0];
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  const sk = s.doc.sketches.find((x) => x.id === sel?.sketchId) ?? null;
  const e = sk?.entities.find((x) => x.id === sel?.entityId) ?? null;

  let value = 0;
  let label = 'Length';
  let screen: { x: number; y: number } | null = null;
  let point: Vec2 | null = null;

  if (sk && e) {
    const frame = {
      origin: sk.plane.origin as Vec3,
      u: sk.plane.u as Vec3,
      v: sk.plane.v as Vec3,
      n: sk.plane.n as Vec3,
    };
    if (e.kind === 'line') {
      const a = sk.points[e.a];
      const b = sk.points[e.b];
      if (a && b) {
        value = Math.hypot(b[0] - a[0], b[1] - a[1]);
        point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        label = 'Length';
      }
    } else if (e.kind === 'circle') {
      const c = sk.points[e.c];
      if (c) {
        value = e.r * 2;
        point = c;
        label = 'Diameter';
      }
    } else if (e.kind === 'arc') {
      const g = arcGeom(sk, e);
      if (g) {
        value = g.r;
        point = g.c;
        label = 'Radius';
      }
    }
    if (point && vp) {
      const p3 = to3D(frame, point);
      screen = vp.worldToScreen(p3);
    }
  }

  const units = s.doc.units;
  const valid = !!(s.mode === 'sketch' && e && value > 0);
  useEffect(() => {
    if (!valid) return;
    if (!focused) setText(fmtNum(toDisplay(value, units), 2));
  }, [value, valid, focused, e?.id, units]);

  if (!valid || !sk || !e) return null;

  const apply = () => {
    const typed = parseFloat(text.replace(',', '.'));
    if (!isFinite(typed) || typed <= 0) return;
    const v = fromDisplay(typed, units);
    const kind = e.kind === 'line' ? 'length' : e.kind === 'circle' ? 'diameter' : 'radius';
    S.editSketch(sk.id, (draft) => {
      const existing = draft.constraints.find((c) => c.kind === kind && c.refs[0] === e.id);
      if (existing) existing.value = v;
      else
        draft.constraints.push({
          id: `c_${Math.random().toString(36).slice(2, 9)}`,
          kind: kind as 'length' | 'diameter' | 'radius',
          refs: [e.id],
          value: v,
        });
    });
  };

  const style = screen ? clampToViewport(screen.x + 18, screen.y - 16) : undefined;

  return (
    <div
      className={`chip ${screen ? '' : 'center-bottom'}`}
      style={style as React.CSSProperties}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <span className="chip-title">{label}</span>
      <input
        value={text}
        inputMode="decimal"
        onChange={(ev) => setText(ev.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          apply();
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            apply();
            (ev.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="unit">{units}</span>
      <button className="apply" title="Set dimension" onClick={apply}>
        <Icon name="check" size={15} />
      </button>
    </div>
  );
}
