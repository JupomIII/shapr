import { useEffect, useRef, useState } from 'react';
import { Vec2, Vec3 } from '../kernel/vec';
import { to3D } from '../kernel/ops';
import { solidEdges } from '../kernel/solid';
import { viewportRef } from '../render/viewportRef';
import * as S from '../state/store';
import * as OPS from '../state/ops';

/**
 * Direct-manipulation gizmo, the way Shapr3D and SolidWorks do it: the selected
 * profile or face grows an arrow at the geometry. Drag it for a live operation,
 * click it to enter an exact value. Nothing has to be hunted for in a toolbar.
 */

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

const centroid = (pts: Vec2[]): Vec2 => {
  if (!pts.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

type Target = {
  anchor: Vec3;
  axis: Vec3 | null; // null = screen-space drag (fillet radius)
  kind: 'extrude' | 'offset' | 'fillet';
  title: string;
  defaultValue: number;
};

function targetOf(): Target | null {
  const s = S.store.state;
  // The stacked-selection list owns the interaction while it is open.
  if (s.picker) return null;
  // While a feature is pending the arrow stays put and keeps driving its value.
  const sel = s.selection[0];
  if (!sel) return null;

  if (sel.kind === 'region' && sel.sketchId) {
    const sk = s.doc.sketches.find((x) => x.id === sel.sketchId);
    if (!sk) return null;
    const regions = S.sketchRegionsOf(sk.id);
    const reg = regions[sel.regionIndex ?? 0];
    if (!reg) return null;
    const frame = {
      origin: sk.plane.origin as Vec3,
      u: sk.plane.u as Vec3,
      v: sk.plane.v as Vec3,
      n: sk.plane.n as Vec3,
    };
    return {
      anchor: to3D(frame, centroid(reg.outer)),
      axis: frame.n,
      kind: 'extrude',
      title: 'Extrude',
      defaultValue: 10,
    };
  }

  if (sel.kind === 'face' && sel.bodyId && sel.faceIndex !== undefined) {
    const body = s.evalResult.bodies.find((b) => b.id === sel.bodyId);
    const face = body?.solid.faces[sel.faceIndex];
    if (!face) return null;
    return {
      anchor: (sel.point as Vec3) ?? mul3(face.plane.n as Vec3, face.plane.d),
      axis: face.plane.n as Vec3,
      kind: 'offset',
      title: 'Offset face',
      defaultValue: 5,
    };
  }

  if (sel.kind === 'edge' && sel.bodyId && sel.edgeKey) {
    const body = s.evalResult.bodies.find((b) => b.id === sel.bodyId);
    if (!body) return null;
    const edge = solidEdges(body.solid).find((e) => e.key === sel.edgeKey);
    if (!edge) return null;
    return {
      anchor: [
        (edge.a[0] + edge.b[0]) / 2,
        (edge.a[1] + edge.b[1]) / 2,
        (edge.a[2] + edge.b[2]) / 2,
      ],
      axis: null,
      kind: 'fillet',
      title: 'Fillet',
      defaultValue: 2,
    };
  }

  return null;
}

const PROJECTION = 12; // mm used to measure the on-screen direction of the axis

export function SelectionGizmo() {
  const s = S.useApp();
  const [, setFrame] = useState(0);
  const drag = useRef<{
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    perUnit: number;
    started: boolean;
    at: number;
    mx: number;
    my: number;
  } | null>(null);
  const target = targetOf();

  // Follow the camera: the gizmo lives at a world point, so its screen position
  // changes whenever the view animates.
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const loop = () => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!target, target?.anchor.join(','), target?.kind]);

  const vp = viewportRef.current;
  if (!target || !vp) return null;

  const head = vp.worldToScreen(target.anchor);
  const tip = target.axis
    ? vp.worldToScreen(add3(target.anchor, mul3(target.axis, PROJECTION)))
    : { x: head.x, y: head.y - 60 };
  let dx = tip.x - head.x;
  let dy = tip.y - head.y;
  let len = Math.hypot(dx, dy);
  if (target.axis && len < 6) {
    // Axis points at the camera: stand the arrow upright so it stays usable.
    dx = 0;
    dy = -1;
    len = 1;
  }
  if (!target.axis) {
    dx = 0;
    dy = -1;
    len = 60;
  }
  const dirX = dx / len;
  const dirY = dy / len;
  const perUnit = len / PROJECTION;
  const shaft = 62;

  const startOperation = (value: number) => {
    if (S.store.state.pending) return;
    if (target.kind === 'extrude') OPS.startExtrude('new');
    else if (target.kind === 'offset') OPS.startPushPull();
    else OPS.startFillet();
    const pending = S.store.state.pending;
    if (!pending) return;
    S.updatePendingValue(value);
    const after = S.store.state.pending;
    if (after) {
      S.setPending({
        ...(after as Record<string, unknown>),
        anchor: { x: head.x + dirX * (shaft + 56), y: head.y + dirY * (shaft + 56) },
      } as typeof after);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic pointers are not capturable */
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      dirX,
      dirY,
      perUnit: Math.max(0.2, perUnit),
      started: false,
      at: 0,
      mx: 0,
      my: 0,
    };
  };

  const applyValue = (d: { dirX: number; dirY: number; perUnit: number }, mx: number, my: number) => {
    const raw = target.axis ? (mx * d.dirX + my * d.dirY) / d.perUnit : -my * 0.35;
    const value = target.kind === 'fillet' ? Math.max(0.1, raw) : raw;
    const rounded = Math.round(value * 10) / 10;
    S.updatePendingValue(Math.abs(rounded) < 0.1 ? (rounded < 0 ? -0.1 : 0.1) : rounded);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    d.mx = mx;
    d.my = my;
    if (!d.started) {
      if (Math.hypot(mx, my) < 4) return;
      d.started = true;
      if (!S.store.state.pending) startOperation(0.1);
    }
    const now = performance.now();
    if (now - d.at < 40) return;
    d.at = now;
    applyValue(d, mx, my);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // A click (no drag) opens the operation with a sensible default to type into.
    if (d && !d.started && !S.store.state.pending) startOperation(target.defaultValue);
    // Flush the exact value of the final pointer position.
    else if (d) applyValue(d, d.mx, d.my);
  };

  return (
    <div
      className={`gizmo ${target.kind}`}
      style={{ left: head.x, top: head.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="gizmo-arrow"
        style={{ transform: `rotate(${Math.atan2(dirY, dirX) + Math.PI / 2}rad)`, height: shaft }}
      >
        <svg viewBox="0 0 12 76" preserveAspectRatio="none" aria-hidden="true">
          <line x1="6" y1="72" x2="6" y2="12" />
          <path d="M6 2l4.6 8.4H1.4z" />
        </svg>
      </div>
      <div
        className="gizmo-knob"
        style={{
          transform: `translate(${dirX * (shaft + 14)}px, ${dirY * (shaft + 14)}px) translate(-50%, -50%)`,
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title={`${target.title} — drag or click`}
      >
        <span>{target.title}</span>
      </div>
    </div>
  );
}
