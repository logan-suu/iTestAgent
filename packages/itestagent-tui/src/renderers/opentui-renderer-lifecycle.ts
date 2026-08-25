/**
 * Lifecycle concerns for the OpenTUI renderer, split out of
 * src/renderers/opentui-renderer.tsx (B27).
 *
 * The lifecycle owns:
 *   - the state ref cell that renderer.update() pushes through,
 *   - the last-seen state so a terminal resize can force a re-layout,
 *   - attach/detach of the stdout 'resize' listener ("live resize"),
 *   - draft-bar echo semantics for input/submit events.
 *
 * On resize the lifecycle re-pushes a SHALLOW CLONE of the last state: Solid
 * signals skip updates for identical references, so the clone is what makes
 * the re-render (and therefore the new column layout) actually happen.
 */

import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';

/** Ref cell the Solid App assigns its state setter to. */
export type OpenTuiStateRef = { current: ((state: TuiShellState) => void) | null };

/** Minimal emitter surface needed for resize listening. */
export interface ResizeSource {
  on(event: 'resize', cb: () => void): unknown;
  off?(event: 'resize', cb: () => void): unknown;
}

export function createOpenTuiStateRef(): OpenTuiStateRef {
  return { current: null };
}

/**
 * Draft-bar effect for an event: input events echo their text into the
 * draft, submit clears it, everything else leaves the draft untouched.
 */
export function draftForEvent(event: TuiShellEvent): string | null {
  if (event.type === 'input') return event.text;
  if (event.type === 'submit') return '';
  return null;
}

/** Listen for stream resize events; returns a detach function. */
export function attachLiveResize(source: ResizeSource, notify: () => void): () => void {
  source.on('resize', notify);
  return () => {
    source.off?.('resize', notify);
  };
}

export interface OpenTuiLifecycle {
  /** Ref the Solid App assigns its setState into (via props). */
  readonly ref: OpenTuiStateRef;
  /** Last state pushed via update() (null before the first update). */
  lastState(): TuiShellState | null;
  /** Push a new state through the ref and remember it for resizes. */
  update(state: TuiShellState): void;
  /** Force a re-render by re-pushing a clone of the last state. */
  notifyResize(): void;
  /** Attach the live-resize listener to a stream; returns detach. */
  bind(stream: ResizeSource): () => void;
}

export function createOpenTuiLifecycle(): OpenTuiLifecycle {
  const ref = createOpenTuiStateRef();
  let last: TuiShellState | null = null;

  const notifyResize = () => {
    if (!last || !ref.current) return;
    // Shallow clone → new identity → Solid signal actually re-renders.
    ref.current({ ...last });
  };

  return {
    ref,
    lastState: () => last,
    update(state) {
      last = state;
      ref.current?.(state);
    },
    notifyResize,
    bind: (stream) => attachLiveResize(stream, notifyResize),
  };
}
