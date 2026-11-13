import type { Viewport } from './Viewport';

/** Shared handle so floating UI (chips, bars) can project world positions. */
export const viewportRef: { current: Viewport | null } = { current: null };
