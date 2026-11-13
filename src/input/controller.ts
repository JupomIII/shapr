// Interaction controller: turns recognised gestures into modelling operations.
// Pencil/mouse drive modelling; fingers drive camera; three fingers undo/redo.

import {
  Vec2,
  Vec3,
  add3,
  cross3,
  dist2,
  dot2,
  lerp2,
  norm2,
  norm3,
  sub2,
  sub3,
} from '../kernel/vec';
import { Frame, to2D, to3D } from '../kernel/ops';
import { DraftGeometry, Viewport } from '../render/Viewport';
import { GestureEngine, PointerSample } from './gestures';
import * as S from '../state/store';
import { PendingOp, SelectionItem, SketchTool } from '../state/store';
import {
  ExtrudeFeature,
  Feature,
  PushPullFeature,
  RevolveFeature,
} from '../model/types';
import { Sketch } from '../sketch/types';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  addSpline,
  applyRecognized,
  autoAxisConstraint,
  recognizeShape,
} from '../sketch/create';
import { arcGeom, distanceToEntity, regionContains, snapPoint } from '../sketch/geometry';

interface Stroke {
  tool: SketchTool;
  start: Vec2;
  current: Vec2;
  points: Vec2[];
  arcMode: boolean;
  sign: number;
  shakeCount: number;
  midPoint: Vec2 | null;
}

interface DragCtx {
  kind: 'extrude' | 'pushpull' | 'param';
  start: { x: number; y: number };
  anchor: Vec3;
  axis: Vec3 | null;
  feature: Feature | null;
  startValue: number;
  moved: boolean;
}

const frameOf = (sk: Sketch): Frame => ({
  origin: sk.plane.origin as Vec3,
  u: sk.plane.u as Vec3,
  v: sk.plane.v as Vec3,
  n: sk.plane.n as Vec3,
});

const featureName = (kind: string, label: string): string => {
  const count = S.store.state.doc.features.filter((f) => f.kind === kind).length + 1;
  return `${label} ${String(count).padStart(3, '0')}`;
};

export class InteractionController {
  private gesture: GestureEngine;
  private stroke: Stroke | null = null;
  private drag: DragCtx | null = null;
  private chain: Vec2 | null = null;
  private box: { start: { x: number; y: number }; el: HTMLDivElement } | null = null;
  private orbitDrag: { x: number; y: number } | null = null;
  private lastPendingAt = 0;
  private hoverRaf = 0;
  private lastHover: { x: number; y: number } | null = null;

  constructor(private vp: Viewport) {
    this.gesture = new GestureEngine({
      onPrimaryDown: (p) => this.primaryDown(p),
      onPrimaryMove: (p, e) => this.primaryMove(p, e),
      onPrimaryUp: (p) => this.primaryUp(p),
      onTap: (p) => this.handleTap(p),
      onDoubleTap: (p) => this.handleDoubleTap(p),
      onLongPress: (p) => this.beginBoxSelect(p),
      onHover: (p) => this.handleHover(p),
      onFingerDragStart: () => {},
      onFingerDrag: (p, dx, dy) => {
        if (this.box) this.updateBox(p);
        else this.vp.orbit(dx, dy);
      },
      onFingerDragEnd: () => this.endBox(),
      onTwoFinger: (dx, dy, scale, rotation) => {
        if (Math.abs(scale - 1) > 0.002) this.vp.zoom(scale);
        if (dx || dy) this.vp.pan(dx, dy);
        if (Math.abs(rotation) > 0.01) this.vp.orbit(rotation * 220, 0);
      },
      onTwoFingerEnd: () => {},
      onThreeFingerSwipe: (dir) => {
        if (dir === 'left') S.undo();
        else S.redo();
      },
      onZoom: (factor) => this.vp.zoom(factor),
      isPenActive: () => this.gesture.penActive(),
      onTouchModel: (p) => this.touchStartsModel(p),
    });
    this.gesture.attach(vp.domElement);
  }

  dispose() {
    this.gesture.detach();
    this.box?.el.remove();
  }

  cancel() {
    this.stroke = null;
    this.drag = null;
    this.orbitDrag = null;
    this.vp.setDraft(null);
    this.endBox();
    if (S.store.state.pending) S.cancelPending();
  }

  /* -------------------------------- pointer -------------------------------- */

  private primaryDown(p: PointerSample) {
    const s = S.store.state;
    if (this.box) return;
    if (s.pending) {
      this.beginParamDrag(p);
      return;
    }
    if (s.mode === 'sketch') this.sketchDown(p);
    else this.selectDown(p);
  }

  private primaryMove(p: PointerSample, e: PointerEvent) {
    if (this.stroke) {
      this.sketchMove(p, e);
      return;
    }
    if (this.orbitDrag) {
      const dx = p.x - this.orbitDrag.x;
      const dy = p.y - this.orbitDrag.y;
      if (dx || dy) {
        this.orbitDrag = { x: p.x, y: p.y };
        this.vp.orbit(dx, dy);
      }
      return;
    }
    if (this.drag) this.dragMove(p);
  }

  private primaryUp(p: PointerSample) {
    if (this.stroke) this.commitStroke();
    this.drag = null;
    this.orbitDrag = null;
    this.vp.setDraft(null);
  }

  /* ------------------------------- selection ------------------------------- */

  private selectDown(p: PointerSample) {
    const region = this.pickRegion(p.x, p.y);
    if (region) {
      S.selectItem(region);
      const sk = S.sketchById(region.sketchId) ?? null;
      if (sk) this.beginExtrudeDrag(p, sk, region.regionIndex ?? null);
      return;
    }
    const edge = this.vp.pickEdge(p.x, p.y);
    if (edge) {
      S.selectItem({
        kind: 'edge',
        bodyId: edge.bodyId,
        edgeKey: edge.edge.key,
        point: [
          (edge.edge.a[0] + edge.edge.b[0]) / 2,
          (edge.edge.a[1] + edge.edge.b[1]) / 2,
          (edge.edge.a[2] + edge.edge.b[2]) / 2,
        ],
      });
      return;
    }
    const face = this.vp.pickFace(p.x, p.y);
    if (face) {
      const body = S.store.state.evalResult.bodies.find((b) => b.id === face.bodyId);
      const f = body?.solid.faces[face.faceIndex];
      const item: SelectionItem = {
        kind: 'face',
        bodyId: face.bodyId,
        faceIndex: face.faceIndex,
        point: face.point,
        normal: f?.plane.n,
      };
      S.selectItem(item);
      if (f) this.beginPushPullDrag(p, item, f.plane.n, face.point);
      return;
    }
    S.selectItem(null);
    // Dragging empty space orbits, like a finger drag on the iPad. A click that
    // never moves still just deselects.
    if (p.kind === 'mouse') this.orbitDrag = { x: p.x, y: p.y };
  }

  /**
   * Single-finger contacts model instead of orbiting when there is no pen in the
   * session: drawing in a sketch, or touching geometry in the model.
   */
  private touchStartsModel(p: PointerSample): boolean {
    const s = S.store.state;
    if (this.gesture.hasPen()) return false;
    if (s.pending) return false;
    if (s.mode === 'sketch') {
      const sk = S.activeSketch();
      return !!sk && s.sketchTool !== 'select';
    }
    if (s.mode !== 'select') return false;
    if (this.pickRegion(p.x, p.y)) return true;
    // Edges select on tap but have no drag action, so a drag there still orbits.
    if (this.vp.pickEdge(p.x, p.y)) return false;
    return !!this.vp.pickFace(p.x, p.y);
  }

  private pickRegion(x: number, y: number): SelectionItem | null {
    const s = S.store.state;
    const visible = s.doc.sketches.filter(
      (sk) => s.visibleSketchIds.includes(sk.id) || sk.id === s.activeSketchId,
    );
    for (let i = visible.length - 1; i >= 0; i--) {
      const sk = visible[i];
      const frame = frameOf(sk);
      const p2 = this.vp.screenToPlane(x, y, frame);
      if (!p2) continue;
      // Only accept if the plane point is actually under the cursor in 3D:
      // the ray test is exact, so containment in a region is enough.
      const regions = S.sketchRegionsOf(sk.id);
      for (let r = regions.length - 1; r >= 0; r--) {
        if (regionContains(regions[r], p2)) {
          return {
            kind: 'region',
            sketchId: sk.id,
            regionIndex: r,
            point: to3D(frame, p2),
            normal: frame.n,
          };
        }
      }
    }
    return null;
  }

  private handleTap(p: PointerSample) {
    const s = S.store.state;
    // A tap anywhere dismisses the stacked-selection list first.
    if (s.picker) S.store.set({ picker: null });
    if (s.pending) {
      // Shapr3D finishes an operation when you tap empty space, so the check
      // lives on the geometry rather than in a toolbar.
      const onGeometry =
        !!this.pickRegion(p.x, p.y) || !!this.vp.pickEdge(p.x, p.y) || !!this.vp.pickFace(p.x, p.y);
      if (!onGeometry) S.confirmPending();
      return;
    }
    if (s.mode === 'sketch') {
      const sk = S.activeSketch();
      if (!sk) return;
      const frame = frameOf(sk);
      const p2 = this.vp.screenToPlane(p.x, p.y, frame);
      if (!p2) return;
      const tool = s.sketchTool;
      if (tool === 'select' || tool === 'dimension' || tool === 'line') {
        const id = this.pickSketchEntity(sk, p2);
        if (id) {
          S.setSelection([{ kind: 'sketchEntity', sketchId: sk.id, entityId: id }]);
          return;
        }
        if (tool === 'select') S.setSelection([]);
      }
      return;
    }
    // Select mode: resolve by proximity so finger taps work too. When several
    // items are stacked under the pointer, list them (Shapr3D's overlapping
    // list) instead of guessing or making the user tap repeatedly.
    const edge = this.vp.pickEdge(p.x, p.y);
    const face = this.vp.pickFace(p.x, p.y);
    const region = this.pickRegion(p.x, p.y);

    // Same precedence as pointer-down selection (profile, edge, face, body), so
    // the first row is the item the tap already picked.
    const candidates: SelectionItem[] = [];
    if (region) candidates.push(region);
    if (edge) candidates.push({ kind: 'edge', bodyId: edge.bodyId, edgeKey: edge.edge.key });
    if (face)
      candidates.push({
        kind: 'face',
        bodyId: face.bodyId,
        faceIndex: face.faceIndex,
        point: face.point,
      });
    if (face) candidates.push({ kind: 'body', bodyId: face.bodyId });

    if (!candidates.length) {
      S.selectItem(null);
      return;
    }
    if (candidates.length === 1) {
      S.selectItem(candidates[0]);
      return;
    }

    const bodyName = (id?: string) =>
      s.evalResult.bodies.find((b) => b.id === id)?.name ?? 'Body';
    const sketchName = (id?: string) =>
      s.doc.sketches.find((sk) => sk.id === id)?.name ?? 'Sketch';
    const entries = candidates.map((item, i) => {
      if (item.kind === 'edge') {
        const len = edge ? Math.hypot(
          edge.edge.b[0] - edge.edge.a[0],
          edge.edge.b[1] - edge.edge.a[1],
          edge.edge.b[2] - edge.edge.a[2],
        ) : 0;
        return {
          id: `edge_${i}`,
          label: 'Edge',
          hint: `${len.toFixed(1)} mm`,
          item,
        };
      }
      if (item.kind === 'face') {
        return { id: `face_${i}`, label: 'Face', hint: bodyName(item.bodyId), item };
      }
      if (item.kind === 'body') {
        return { id: `body_${i}`, label: 'Body', hint: bodyName(item.bodyId), item };
      }
      return {
        id: `region_${i}`,
        label: 'Profile',
        hint: sketchName(item.sketchId),
        item,
      };
    });

    // Show what the finger is actually on while the list is open.
    S.setHover(entries[0].item);
    S.store.set({ picker: { x: p.x, y: p.y, entries } });
  }

  private handleDoubleTap(p: PointerSample) {
    const s = S.store.state;
    if (s.mode === 'sketch') return;
    if (p.kind === 'touch') {
      const face = this.vp.pickFace(p.x, p.y);
      if (face) {
        this.vp.focusPoint(face.point);
        return;
      }
      this.vp.fitAll(s.evalResult.bodies);
      return;
    }
    const face = this.vp.pickFace(p.x, p.y);
    if (face) {
      S.selectItem({ kind: 'body', bodyId: face.bodyId });
      S.toast('Body selected');
    }
  }

  private handleHover(p: PointerSample | null) {
    if (this.stroke || this.drag) return;
    if (!p) {
      S.setHover(null);
      return;
    }
    if (this.hoverRaf) return;
    this.lastHover = { x: p.x, y: p.y };
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const h = this.lastHover;
      if (!h) return;
      if (S.store.state.mode !== 'select') {
        S.setHover(null);
        return;
      }
      const edge = this.vp.pickEdge(h.x, h.y);
      if (edge) {
        S.setHover({ kind: 'edge', bodyId: edge.bodyId, edgeKey: edge.edge.key });
        return;
      }
      const face = this.vp.pickFace(h.x, h.y);
      if (face) {
        S.setHover({ kind: 'face', bodyId: face.bodyId, faceIndex: face.faceIndex });
        return;
      }
      const region = this.pickRegion(h.x, h.y);
      S.setHover(region ?? null);
    });
  }

  /* ------------------------------- box select ------------------------------ */

  private beginBoxSelect(p: PointerSample) {
    if (S.store.state.mode !== 'select') return;
    const el = document.createElement('div');
    el.className = 'box-select';
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.width = '0px';
    el.style.height = '0px';
    document.body.appendChild(el);
    this.box = { start: { x: p.x, y: p.y }, el };
  }

  private updateBox(p: PointerSample) {
    if (!this.box) return;
    const { start, el } = this.box;
    el.style.left = `${Math.min(start.x, p.x)}px`;
    el.style.top = `${Math.min(start.y, p.y)}px`;
    el.style.width = `${Math.abs(p.x - start.x)}px`;
    el.style.height = `${Math.abs(p.y - start.y)}px`;
  }

  private endBox() {
    if (!this.box) return;
    const { start, el } = this.box;
    const rect = el.getBoundingClientRect();
    this.box = null;
    el.remove();
    if (rect.width < 8 || rect.height < 8) return;
    const canvasRect = this.vp.domElement.getBoundingClientRect();
    const selected: SelectionItem[] = [];
    for (const body of S.store.state.evalResult.bodies) {
      if (body.hidden) continue;
      const c = body.measure.centroid;
      const sp = this.vp.worldToScreen(c as Vec3);
      const sx = sp.x + canvasRect.left;
      const sy = sp.y + canvasRect.top;
      if (sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom) {
        selected.push({ kind: 'body', bodyId: body.id });
      }
    }
    if (selected.length) S.setSelection(selected);
  }

  /* --------------------------------- drag ops ------------------------------- */

  private beginExtrudeDrag(p: PointerSample, sk: Sketch, regionIndex: number | null) {
    const frame = frameOf(sk);
    const feature: ExtrudeFeature = {
      id: S.uid('ft'),
      name: featureName('extrude', 'Extrude'),
      kind: 'extrude',
      sketchId: sk.id,
      height: 10,
      operation: 'new',
      direction: 1,
      regionIndex,
    };
    this.drag = {
      kind: 'extrude',
      start: { x: p.x, y: p.y },
      anchor: frame.origin,
      axis: frame.n,
      feature,
      startValue: 0,
      moved: false,
    };
  }

  private beginPushPullDrag(p: PointerSample, item: SelectionItem, normal: Vec3, point: Vec3) {
    if (!item.bodyId) return;
    const feature: PushPullFeature = {
      id: S.uid('ft'),
      name: featureName('pushpull', 'Move Face'),
      kind: 'pushpull',
      bodyId: item.bodyId,
      faceRef: { point, normal },
      distance: 0,
    };
    this.drag = {
      kind: 'pushpull',
      start: { x: p.x, y: p.y },
      anchor: point,
      axis: normal,
      feature,
      startValue: 0,
      moved: false,
    };
  }

  private beginParamDrag(p: PointerSample) {
    const pending = S.store.state.pending;
    if (!pending) return;
    let axis: Vec3 | null = null;
    let anchor: Vec3 = [0, 0, 0];
    if (pending.feature.kind === 'extrude') {
      const sk = S.sketchById(pending.feature.sketchId);
      if (sk) {
        const frame = frameOf(sk);
        axis = frame.n;
        anchor = frame.origin;
      }
    } else if (pending.feature.kind === 'pushpull') {
      axis = pending.feature.faceRef.normal;
      anchor = pending.feature.faceRef.point;
    }
    this.drag = {
      kind: 'param',
      start: { x: p.x, y: p.y },
      anchor,
      axis,
      feature: null,
      startValue: pending.value,
      moved: false,
    };
  }

  private dragValue(dx: number, dy: number, startValue: number): number | null {
    const d = this.drag!;
    const height = this.vp.domElement.clientHeight || 800;
    const worldPerPx = (this.vp.radius * 0.8) / height;
    if (!d.axis) {
      // Screen-space mapping for scalar parameters (fillet / chamfer).
      return startValue - dy * Math.max(0.02, this.vp.radius / 900);
    }
    const a = this.vp.worldToScreen(d.anchor);
    const b = this.vp.worldToScreen(add3(d.anchor, d.axis));
    const ax = b.x - a.x;
    const ay = b.y - a.y;
    const len = Math.hypot(ax, ay);
    // When the axis points at the camera (e.g. extruding while looking straight
    // at the sketch plane) fall back to a vertical drag mapping.
    if (len < 8) return startValue - dy * worldPerPx * 2.2;
    return startValue + (dx * ax + dy * ay) / (len * len);
  }

  private dragMove(p: PointerSample) {
    const d = this.drag!;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    const value = this.dragValue(dx, dy, d.startValue);
    if (value === null) return;
    d.moved = true;

    const now = performance.now();
    if (now - this.lastPendingAt < 45) return;
    this.lastPendingAt = now;

    const existing = S.store.state.pending;
    if (!existing && d.feature) {
      const feature = JSON.parse(JSON.stringify(d.feature)) as Feature;
      const settled = this.settleFeature(feature, value);
      const pending = S.makePending(
        d.kind === 'extrude' ? 'extrude' : 'pushpull',
        settled.feature,
        settled.value,
        {
          title: d.kind === 'extrude' ? 'Extrude' : 'Move Face',
          step: 1,
          min: d.kind === 'extrude' ? 0.1 : undefined,
          hint: 'Drag to adjust · type an exact value',
        },
      );
      const anchorPoint =
        settled.feature.kind === 'pushpull'
          ? settled.feature.faceRef.point
          : (settled.feature as ExtrudeFeature).sketchId
            ? frameOf(S.sketchById((settled.feature as ExtrudeFeature).sketchId)!).origin
            : [0, 0, 0];
      const s = this.vp.worldToScreen(anchorPoint as Vec3);
      pending.anchor = { x: s.x, y: s.y };
      S.setPending(pending);
      return;
    }
    if (!existing) return;
    const feature = JSON.parse(JSON.stringify(existing.feature)) as Feature;
    const settled = this.settleFeature(feature, value);
    S.setPending({
      ...existing,
      value: settled.value,
      feature: settled.feature,
      preview: S.computePreview(settled.feature),
    });
  }

  private settleFeature(feature: Feature, raw: number): { feature: Feature; value: number } {
    const f = feature;
    switch (f.kind) {
      case 'extrude': {
        const dir: 1 | -1 = raw >= 0 ? 1 : -1;
        f.direction = dir;
        f.height = Math.max(0.2, Math.abs(raw));
        return { feature: f, value: f.height };
      }
      case 'pushpull':
        f.distance = raw;
        return { feature: f, value: raw };
      case 'fillet':
        f.radius = Math.max(0.1, Math.abs(raw));
        return { feature: f, value: f.radius };
      case 'chamfer':
        f.distance = Math.max(0.1, Math.abs(raw));
        return { feature: f, value: f.distance };
      case 'revolve':
        f.angle = Math.max(1, Math.min(360, Math.abs(raw)));
        return { feature: f, value: f.angle };
      default:
        return { feature: f, value: raw };
    }
  }

  /* ---------------------------------- sketch -------------------------------- */

  private sketchDown(p: PointerSample) {
    const sk = S.activeSketch();
    if (!sk) return;
    const frame = frameOf(sk);
    const raw = this.vp.screenToPlane(p.x, p.y, frame);
    if (!raw) return;
    const tool = S.store.state.sketchTool;

    if (tool === 'select' || tool === 'dimension') {
      const id = this.pickSketchEntity(sk, raw);
      S.setSelection(id ? [{ kind: 'sketchEntity', sketchId: sk.id, entityId: id }] : []);
      return;
    }

    const snapped = this.snap(sk, raw, null);
    let start = snapped.p;
    if (tool === 'polyline' && this.chain) start = this.chain;
    this.stroke = {
      tool,
      start,
      current: start,
      points: [start],
      arcMode: false,
      sign: 0,
      shakeCount: 0,
      midPoint: null,
    };
    this.updateDraft(sk, raw, start);
  }

  private sketchMove(p: PointerSample, e: PointerEvent) {
    const sk = S.activeSketch();
    const st = this.stroke;
    if (!sk || !st) return;
    const frame = frameOf(sk);
    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = events.length ? events : [e];
    let raw = this.vp.screenToPlane(p.x, p.y, frame);
    if (!raw) return;

    for (const ev of samples) {
      const rp = this.vp.screenToPlane(ev.clientX, ev.clientY, frame);
      if (!rp) continue;
      raw = rp;
      if (st.tool === 'auto' || st.tool === 'spline') {
        const last = st.points[st.points.length - 1];
        if (!last || dist2(last, rp) > 0.15) st.points.push(rp);
      }
    }

    const snapped = this.snap(sk, raw, st.start);
    st.current = snapped.p;
    if (st.tool !== 'auto' && st.tool !== 'spline') {
      st.points = [st.start, snapped.p];
    }

    // Automatic Line/Arc: a quick side-to-side wrist shake while drawing
    // switches the current segment to an arc.
    if ((st.tool === 'line' || st.tool === 'polyline') && S.store.state.autoLineArc) {
      const chord = norm2(sub2(st.current, st.start));
      if (chord[0] !== 0 || chord[1] !== 0) {
        const perp: Vec2 = [-chord[1], chord[0]];
        const s = dot2(sub2(raw, st.start), perp);
        if (Math.abs(s) > 1.2) {
          const sign = Math.sign(s);
          if (sign !== st.sign) {
            st.sign = sign;
            st.shakeCount++;
            if (st.shakeCount >= 3) st.arcMode = true;
          }
          if (st.arcMode && (!st.midPoint || Math.abs(s) > 2)) st.midPoint = raw;
        }
      }
    }
    this.updateDraft(sk, raw, snapped.p);
  }

  private snap(sk: Sketch, raw: Vec2, anchor: Vec2 | null) {
    const height = this.vp.domElement.clientHeight || 800;
    const worldPerPx = (this.vp.radius * 0.8) / height;
    const result = snapPoint(sk, raw, {
      gridSize: S.store.state.gridSize,
      snapEnabled: S.store.state.snapEnabled,
      threshold: worldPerPx * 12,
      anchor,
      anchorDir: null,
    });
    return result;
  }

  private updateDraft(sk: Sketch, raw: Vec2, snapped: Vec2) {
    const st = this.stroke;
    if (!st) return;
    const frame = frameOf(sk);
    const draft: DraftGeometry = {
      plane: frame,
      points: [st.start],
      snap: { p: snapped, label: this.strokeSnapLabel() },
    };
    const tool = st.tool;

    if (tool === 'line' || tool === 'polyline') {
      if (st.arcMode) {
        draft.polylines = [this.arcSamples(st.start, st.current, st.midPoint)];
      } else {
        draft.polylines = [[st.start, st.current]];
      }
    } else if (tool === 'rect') {
      const a = st.start;
      const b = st.current;
      draft.polylines = [
        [
          a,
          [b[0], a[1]],
          b,
          [a[0], b[1]],
          a,
        ],
      ];
    } else if (tool === 'circle') {
      draft.polylines = [circleSamples(st.start, Math.max(0.01, dist2(st.start, st.current)))];
    } else if (tool === 'arc') {
      draft.polylines = [this.arcSamples(st.start, st.current, this.defaultArcMid(st.start, st.current))];
    } else if (tool === 'spline') {
      draft.polylines = [st.points];
    } else if (tool === 'auto') {
      const rec = recognizeShape(st.points);
      if (rec) {
        draft.preview = { loops: [recognizedOutline(rec)] };
      } else {
        draft.polylines = [st.points];
      }
    }
    this.vp.setDraft(draft);
  }

  private strokeSnapLabel(): string {
    return '';
  }

  private defaultArcMid(a: Vec2, b: Vec2): Vec2 {
    const d = sub2(b, a);
    const perp = norm2([-d[1], d[0]]);
    const mid = lerp2(a, b, 0.5);
    const bulge = Math.hypot(d[0], d[1]) * 0.3;
    return [mid[0] + perp[0] * bulge, mid[1] + perp[1] * bulge];
  }

  private arcSamples(a: Vec2, b: Vec2, mid: Vec2 | null): Vec2[] {
    const m = mid ?? this.defaultArcMid(a, b);
    const pts = arcPolyline(a, b, m);
    return pts.length > 1 ? pts : [a, b];
  }

  private pickSketchEntity(sk: Sketch, p2: Vec2): string | null {
    const height = this.vp.domElement.clientHeight || 800;
    const worldPerPx = (this.vp.radius * 0.8) / height;
    const tol = worldPerPx * 14;
    let best: { id: string; d: number } | null = null;
    for (const e of sk.entities) {
      const d = distanceToEntity(sk, e, p2);
      if (d < tol && (!best || d < best.d)) best = { id: e.id, d };
    }
    return best?.id ?? null;
  }

  private commitStroke() {
    const st = this.stroke;
    const sketchId = S.store.state.activeSketchId;
    this.stroke = null;
    this.vp.setDraft(null);
    if (!st || !sketchId) return;
    if (dist2(st.start, st.current) < 1e-3 && st.tool !== 'auto' && st.tool !== 'spline') return;

    S.editSketch(sketchId, (draft) => {
      switch (st.tool) {
        case 'line':
        case 'polyline': {
          if (st.arcMode) {
            addArc(draft, st.start, st.current, st.midPoint ?? this.defaultArcMid(st.start, st.current));
          } else {
            const id = addLine(draft, st.start, st.current);
            autoAxisConstraint(draft, id, st.start, st.current);
            const len = dist2(st.start, st.current);
            if (len > 1e-3) addConstraint(draft, 'length', [id], len);
          }
          if (st.tool === 'polyline') this.chain = st.current;
          break;
        }
        case 'rect': {
          const r = addRectangle(draft, st.start, st.current);
          if (r.width > 1e-4) addConstraint(draft, 'length', [r.lines[0]], r.width);
          if (r.height > 1e-4) addConstraint(draft, 'length', [r.lines[1]], r.height);
          break;
        }
        case 'circle': {
          const r = Math.max(0.05, dist2(st.start, st.current));
          const id = addCircle(draft, st.start, r);
          addConstraint(draft, 'diameter', [id], r * 2);
          break;
        }
        case 'arc': {
          addArc(draft, st.start, st.current, this.defaultArcMid(st.start, st.current));
          break;
        }
        case 'spline': {
          if (st.points.length >= 2) addSpline(draft, st.points);
          break;
        }
        case 'auto': {
          const rec = recognizeShape(st.points);
          if (rec) applyRecognized(draft, rec);
          break;
        }
        default:
          break;
      }
    }, { label: 'sketch:stroke' });
  }
}

/* --------------------------------- helpers -------------------------------- */

const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];

export function circleSamples(c: Vec2, r: number, n = 64): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

export function arcPolyline(a: Vec2, b: Vec2, mid: Vec2, n = 40): Vec2[] {
  const d = 2 * (a[0] * (b[1] - mid[1]) + b[0] * (mid[1] - a[1]) + mid[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return [a, b];
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const m2 = mid[0] * mid[0] + mid[1] * mid[1];
  const cx = (a2 * (b[1] - mid[1]) + b2 * (mid[1] - a[1]) + m2 * (a[1] - b[1])) / d;
  const cy = (a2 * (mid[0] - b[0]) + b2 * (a[0] - mid[0]) + m2 * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  const a1 = Math.atan2(b[1] - cy, b[0] - cx);
  const am = Math.atan2(mid[1] - cy, mid[0] - cx);
  const norm = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= Math.PI * 2;
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + (sweep * i) / n;
    out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  return out;
}

export function recognizedOutline(rec: ReturnType<typeof recognizeShape>): Vec2[] {
  if (!rec) return [];
  switch (rec.kind) {
    case 'line':
      return [rec.a, rec.b];
    case 'rect':
      return [
        rec.a,
        [rec.b[0], rec.a[1]],
        rec.b,
        [rec.a[0], rec.b[1]],
        rec.a,
      ];
    case 'circle':
      return circleSamples(rec.c, rec.r);
    case 'arc':
      return arcPolyline(rec.a, rec.b, rec.mid);
    case 'spline':
      return rec.pts;
  }
}
