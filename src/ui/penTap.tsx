import { ReactNode, useRef } from 'react';

/**
 * Apple Pencil taps on iPadOS do not always produce the synthetic `click` that a
 * button relies on, especially inside scrollable overlays, so the feature tree
 * listens to the pen's own pointer stream and fires on `pointerup` when the tip
 * barely moved. The `click` that may still follow the same gesture is swallowed
 * once, so a single pen tap never runs an action twice.
 */

const SLOP = 12;
const MAX_MS = 900;
const CLICK_WINDOW = 700;

export interface PenTapHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
}

export function usePenTap(onActivate: () => void): PenTapHandlers {
  const start = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const handledAt = useRef(-1e9);

  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'pen') return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    },
    onPointerUp: (e) => {
      const st = start.current;
      if (!st || e.pointerType !== 'pen' || e.pointerId !== st.id) return;
      start.current = null;
      const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
      if (moved > SLOP || performance.now() - st.t > MAX_MS) return;
      handledAt.current = performance.now();
      e.stopPropagation();
      e.preventDefault();
      onActivate();
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onClick: (e) => {
      if (performance.now() - handledAt.current < CLICK_WINDOW) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onActivate();
    },
  };
}

/** An inline hit target inside a row, for icons that must not trigger the row. */
export function PenSpan({
  className,
  title,
  onPress,
  children,
}: {
  className?: string;
  title?: string;
  onPress: (e: React.MouseEvent) => void;
  children?: ReactNode;
}) {
  const pen = usePenTap(() => onPress({} as React.MouseEvent));
  return (
    <span
      className={className}
      title={title}
      role="button"
      onPointerDown={(e) => {
        e.stopPropagation();
        pen.onPointerDown(e);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        pen.onPointerUp(e);
      }}
      onPointerCancel={pen.onPointerCancel}
      onClick={(e) => {
        e.stopPropagation();
        pen.onClick(e);
      }}
    >
      {children}
    </span>
  );
}

/** A button that answers to mouse, finger and Apple Pencil alike. */
export function PenButton({
  className,
  title,
  style,
  disabled,
  onPress,
  children,
}: {
  className?: string;
  title?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const pen = usePenTap(onPress);
  return (
    <button
      className={className}
      style={style}
      title={title}
      disabled={disabled}
      tabIndex={-1}
      {...pen}
    >
      {children}
    </button>
  );
}
