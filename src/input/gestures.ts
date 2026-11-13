// Gesture recognition state machine. It classifies raw pointer events into
// modelling, selection and camera intents. Deliberately independent of the CAD
// kernel and the renderer.
//
// Rules encoded here:
//  - Apple Pencil (pointerType 'pen') is the modelling instrument. While a pen
//    is on the surface, single touch contacts are treated as palm noise.
//  - Fingers navigate: 1 finger drag orbits, 2 fingers pan/pinch/twist.
//  - 3-finger horizontal swipe is undo/redo.
//  - A pen gesture can never turn into a camera gesture and vice versa.

export type PointerKind = 'pen' | 'touch' | 'mouse';

export interface PointerSample {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  startX: number;
  startY: number;
  pressure: number;
  time: number;
  moved: boolean;
}

export interface GestureHandlers {
  onPrimaryDown(p: PointerSample, e: PointerEvent): void;
  onPrimaryMove(p: PointerSample, e: PointerEvent): void;
  onPrimaryUp(p: PointerSample, e: PointerEvent): void;
  onTap(p: PointerSample): void;
  onDoubleTap(p: PointerSample): void;
  onLongPress(p: PointerSample): void;
  onHover(p: PointerSample | null): void;
  onFingerDragStart(p: PointerSample): void;
  onFingerDrag(p: PointerSample, dx: number, dy: number): void;
  onFingerDragEnd(p: PointerSample): void;
  onTwoFinger(dx: number, dy: number, scale: number, rotation: number): void;
  onTwoFingerEnd(): void;
  onThreeFingerSwipe(dir: 'left' | 'right'): void;
  onZoom(factor: number): void;
  isPenActive(): boolean;
}

type Mode = 'idle' | 'primary' | 'touchPending' | 'touchDrag' | 'two' | 'three' | 'mouseNav';

const TAP_MOVE = 9;
const TAP_TIME = 320;
const DOUBLE_TAP_TIME = 340;
const LONG_PRESS_TIME = 520;

export class GestureEngine {
  private el: HTMLElement | null = null;
  private pointers = new Map<number, PointerSample>();
  private primary: PointerSample | null = null;
  private mode: Mode = 'idle';
  private longPressTimer: number | null = null;
  private lastTap: { time: number; x: number; y: number; kind: PointerKind } | null = null;
  private touchStartDist = 0;
  private touchStartAngle = 0;
  private touchCentroid = { x: 0, y: 0 };
  private threeStart = { x: 0, y: 0 };
  private threeSwipe = false;
  private navButton = 0;
  private suppressUntil = 0;

  constructor(private handlers: GestureHandlers) {}

  attach(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
  }

  detach() {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    this.el = null;
  }

  penActive(): boolean {
    return this.primary?.kind === 'pen';
  }

  private onContext = (e: Event) => e.preventDefault();

  private clearLongPress() {
    if (this.longPressTimer) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onDown = (e: PointerEvent) => {
    const kind: PointerKind =
      e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
    const sample: PointerSample = {
      id: e.pointerId,
      kind,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      pressure: e.pressure || 0.5,
      time: performance.now(),
      moved: false,
    };
    this.pointers.set(sample.id, sample);

    if (kind === 'mouse') {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.mode = 'mouseNav';
        this.navButton = e.button === 1 ? 2 : 1; // 2 = orbit, 1 = pan
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        this.mode = 'mouseNav';
        this.navButton = 3; // pan
        e.preventDefault();
        return;
      }
    }

    if (kind === 'pen' || (kind === 'mouse' && e.button === 0)) {
      this.clearLongPress();
      this.mode = 'primary';
      this.primary = sample;
      this.capture(e.pointerId);
      this.handlers.onPrimaryDown(sample, e);
      e.preventDefault();
      return;
    }

    if (kind === 'touch') {
      const touches = [...this.pointers.values()].filter((p) => p.kind === 'touch');
      if (touches.length >= 3) {
        this.mode = 'three';
        this.threeStart = this.centroidOf(touches);
        this.threeSwipe = false;
        this.clearLongPress();
        return;
      }
      if (touches.length === 2) {
        this.mode = 'two';
        this.clearLongPress();
        if (this.pointers.size - 1 === 1) this.handlers.onFingerDragEnd(this.primary ?? sample);
        this.touchCentroid = this.centroidOf(touches);
        this.touchStartDist = this.distOf(touches);
        this.touchStartAngle = this.angleOf(touches);
        return;
      }
      if (this.handlers.isPenActive()) {
        // Palm contact while drawing: deliberately ignored.
        return;
      }
      this.mode = 'touchPending';
      this.primary = sample;
      this.clearLongPress();
      this.longPressTimer = window.setTimeout(() => {
        if (this.mode === 'touchPending' && this.primary && !this.primary.moved) {
          this.mode = 'touchDrag';
          this.handlers.onLongPress(this.primary);
        }
      }, LONG_PRESS_TIME);
      this.capture(e.pointerId);
      e.preventDefault();
    }
  };

  private capture(id: number) {
    try {
      this.el?.setPointerCapture(id);
    } catch {
      // Capture is best-effort (synthetic events and some Safari paths).
    }
  }

  private centroidOf(ps: PointerSample[]) {
    let x = 0;
    let y = 0;
    for (const p of ps) {
      x += p.x;
      y += p.y;
    }
    return { x: x / ps.length, y: y / ps.length };
  }
  private distOf(ps: PointerSample[]) {
    if (ps.length < 2) return 0;
    return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }
  private angleOf(ps: PointerSample[]) {
    if (ps.length < 2) return 0;
    return Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x);
  }

  private onMove = (e: PointerEvent) => {
    const sample = this.pointers.get(e.pointerId);
    if (sample) {
      sample.x = e.clientX;
      sample.y = e.clientY;
      sample.pressure = e.pressure || sample.pressure;
      if (Math.hypot(sample.x - sample.startX, sample.y - sample.startY) > TAP_MOVE) {
        sample.moved = true;
      }
    }

    if (this.mode === 'primary' && this.primary && e.pointerId === this.primary.id) {
      this.handlers.onPrimaryMove(this.primary, e);
      e.preventDefault();
      return;
    }

    if (this.mode === 'mouseNav' && sample) {
      const dx = e.movementX;
      const dy = e.movementY;
      if (this.navButton === 2) this.handlers.onTwoFinger(dx * 1.1, dy * 1.1, 1, 0);
      else this.handlers.onTwoFinger(dx, dy, 1, 0);
      return;
    }

    if (this.mode === 'two') {
      const touches = [...this.pointers.values()].filter((p) => p.kind === 'touch');
      if (touches.length >= 2) {
        const c = this.centroidOf(touches);
        const d = this.distOf(touches);
        const a = this.angleOf(touches);
        const dx = c.x - this.touchCentroid.x;
        const dy = c.y - this.touchCentroid.y;
        const scale = this.touchStartDist > 8 ? this.touchStartDist / Math.max(8, d) : 1;
        let rot = a - this.touchStartAngle;
        while (rot > Math.PI) rot -= Math.PI * 2;
        while (rot < -Math.PI) rot += Math.PI * 2;
        this.touchCentroid = c;
        this.touchStartDist = d;
        this.touchStartAngle = a;
        this.handlers.onTwoFinger(dx, dy, scale, -rot);
        e.preventDefault();
      }
      return;
    }

    if (this.mode === 'three') {
      const touches = [...this.pointers.values()].filter((p) => p.kind === 'touch');
      const c = this.centroidOf(touches);
      const dx = c.x - this.threeStart.x;
      if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(c.y - this.threeStart.y) * 1.4) {
        this.threeSwipe = true;
        this.threeSwipeLeft = dx < 0;
      }
      return;
    }

    if (this.mode === 'touchPending' && this.primary && sample && e.pointerId === this.primary.id) {
      if (this.primary.moved) {
        this.clearLongPress();
        this.mode = 'touchDrag';
        this.lastPan = { x: this.primary.x, y: this.primary.y };
        this.handlers.onFingerDragStart(this.primary);
      }
      return;
    }

    if (this.mode === 'touchDrag' && this.primary && sample && e.pointerId === this.primary.id) {
      const dx = e.clientX - this.lastPan.x;
      const dy = e.clientY - this.lastPan.y;
      this.lastPan = { x: e.clientX, y: e.clientY };
      this.handlers.onFingerDrag(this.primary, dx, dy);
      e.preventDefault();
      return;
    }

    if (sample && sample.kind !== 'touch' && e.buttons === 0) {
      this.handlers.onHover(sample);
    }
  };

  private lastPan = { x: 0, y: 0 };

  private onUp = (e: PointerEvent) => {
    const sample = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.clearLongPress();

    if (this.mode === 'primary' && this.primary && e.pointerId === this.primary.id) {
      const p = this.primary;
      this.handlers.onPrimaryUp(p, e);
      if (!p.moved && performance.now() - p.time < TAP_TIME) this.handlers.onTap(p);
      this.primary = null;
      this.mode = 'idle';
      this.suppressUntil = performance.now() + 40;
      return;
    }

    if (this.mode === 'mouseNav') {
      this.mode = 'idle';
      return;
    }

    if (this.mode === 'two' || this.mode === 'three') {
      const touches = [...this.pointers.values()].filter((p) => p.kind === 'touch');
      if (touches.length === 0) {
        if (this.mode === 'three' && this.threeSwipe) {
          this.handlers.onThreeFingerSwipe(this.threeSwipeLeft ? 'left' : 'right');
        }
        if (this.mode === 'two') this.handlers.onTwoFingerEnd();
        this.mode = 'idle';
        this.primary = null;
        this.threeSwipe = false;
        this.threeSwipeLeft = false;
      }
      return;
    }

    if (this.mode === 'touchDrag' && this.primary && e.pointerId === this.primary.id) {
      this.handlers.onFingerDragEnd(this.primary);
      this.primary = null;
      this.mode = 'idle';
      return;
    }

    if (this.mode === 'touchPending' && this.primary && e.pointerId === this.primary.id) {
      const p = this.primary;
      const now = performance.now();
      const isTap = !p.moved && now - p.time < TAP_TIME;
      if (isTap && now > this.suppressUntil) {
        const last = this.lastTap;
        if (
          last &&
          now - last.time < DOUBLE_TAP_TIME &&
          Math.hypot(p.x - last.x, p.y - last.y) < 28
        ) {
          this.handlers.onDoubleTap(p);
          this.lastTap = null;
        } else {
          this.handlers.onTap(p);
          this.lastTap = { time: now, x: p.x, y: p.y, kind: p.kind };
        }
      }
      this.primary = null;
      this.mode = 'idle';
    }
  };

  private threeSwipeLeft = false;

  private onLeave = () => {
    this.handlers.onHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp((e.deltaY > 0 ? 1 : -1) * Math.min(0.25, Math.abs(e.deltaY) / 320));
    this.handlers.onZoom(factor);
  };
}
