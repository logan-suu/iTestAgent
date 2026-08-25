/**
 * Tests for src/renderers/opentui-renderer-lifecycle.ts — live resize support.
 *
 * B27 splits the OpenTUI renderer's non-JSX lifecycle concerns out of
 * opentui-renderer.tsx. The lifecycle owns:
 *   - the state ref cell that renderer.update() pushes through,
 *   - the last-seen state so a terminal resize can force a re-layout,
 *   - attach/detach of the stdout 'resize' listener ("live resize").
 *
 * On resize the lifecycle re-pushes a SHALLOW CLONE of the last state: Solid
 * signals skip updates for identical references, so the clone is what makes
 * the re-render (and therefore the new column layout) actually happen.
 */

import { describe, expect, it } from 'bun:test';
import {
  type ResizeSource,
  attachLiveResize,
  createOpenTuiLifecycle,
  createOpenTuiStateRef,
  draftForEvent,
} from '../src/renderers/opentui-renderer-lifecycle.js';
import { createInitialState } from '../src/tui-shell.js';

// ── fake stream ───────────────────────────────────────────────────────

function makeFakeStream(): ResizeSource & {
  emit: (event: string) => void;
  listenerCount: () => number;
} {
  const handlers = new Map<string, Set<() => void>>();
  return {
    on: (event, cb) => {
      const set = handlers.get(event) ?? new Set<() => void>();
      set.add(cb);
      handlers.set(event, set);
    },
    off: (event, cb) => {
      handlers.get(event)?.delete(cb);
    },
    emit: (event) => {
      for (const cb of handlers.get(event) ?? []) cb();
    },
    listenerCount: () => handlers.get('resize')?.size ?? 0,
  };
}

// ── state ref ─────────────────────────────────────────────────────────

describe('createOpenTuiStateRef', () => {
  it('starts empty so update() before start() is a safe no-op', () => {
    const ref = createOpenTuiStateRef();
    expect(ref.current).toBeNull();
  });

  it('returns independent refs per call', () => {
    expect(createOpenTuiStateRef()).not.toBe(createOpenTuiStateRef());
  });
});

// ── draft echo semantics ──────────────────────────────────────────────

describe('draftForEvent', () => {
  it('echoes input text into the draft bar', () => {
    expect(draftForEvent({ type: 'input', text: 'hello' })).toBe('hello');
  });

  it('clears the draft bar on submit', () => {
    expect(draftForEvent({ type: 'submit' })).toBe('');
  });

  it('leaves the draft untouched for every other event kind', () => {
    expect(draftForEvent({ type: 'quit' })).toBeNull();
    expect(draftForEvent({ type: 'system_message', text: 'x' })).toBeNull();
    expect(draftForEvent({ type: 'candidate_toggle' })).toBeNull();
  });
});

// ── lifecycle update/notify contract ─────────────────────────────────

describe('createOpenTuiLifecycle — update()', () => {
  it('forwards each update through the ref once assigned', () => {
    const lifecycle = createOpenTuiLifecycle();
    const received: unknown[] = [];
    lifecycle.ref.current = (s) => received.push(s);

    const a = createInitialState('/ws');
    const b = createInitialState('/ws');
    lifecycle.update(a);
    lifecycle.update(b);

    expect(received).toEqual([a, b]);
  });

  it('is a safe no-op while the ref is unassigned (pre-start)', () => {
    const lifecycle = createOpenTuiLifecycle();
    expect(() => lifecycle.update(createInitialState('/ws'))).not.toThrow();
  });

  it('remembers the last state for resize refreshes', () => {
    const lifecycle = createOpenTuiLifecycle();
    const last = createInitialState('/ws');
    lifecycle.update(last);
    expect(lifecycle.lastState()).toBe(last);
  });
});

describe('createOpenTuiLifecycle — live resize', () => {
  it('re-pushes a shallow CLONE of the last state when notified', () => {
    const lifecycle = createOpenTuiLifecycle();
    const received: unknown[] = [];
    lifecycle.ref.current = (s) => received.push(s);

    const state = createInitialState('/ws');
    lifecycle.update(state);
    received.length = 0;

    lifecycle.notifyResize();

    expect(received).toHaveLength(1);
    // Equal content, different identity — required to defeat signal equality.
    expect(received[0]).not.toBe(state);
    expect(received[0]).toEqual(state);
  });

  it('does nothing on resize before any state was seen', () => {
    const lifecycle = createOpenTuiLifecycle();
    const received: unknown[] = [];
    lifecycle.ref.current = (s) => received.push(s);
    lifecycle.notifyResize();
    expect(received).toHaveLength(0);
  });

  it('does nothing on resize while the ref is unassigned', () => {
    const lifecycle = createOpenTuiLifecycle();
    lifecycle.update(createInitialState('/ws'));
    expect(() => lifecycle.notifyResize()).not.toThrow();
  });

  it('bind() triggers notifyResize on stream resize events and detach() stops it', () => {
    const lifecycle = createOpenTuiLifecycle();
    let pushes = 0;
    lifecycle.ref.current = () => {
      pushes += 1;
    };
    lifecycle.update(createInitialState('/ws'));

    const stream = makeFakeStream();
    const detach = lifecycle.bind(stream);
    expect(stream.listenerCount()).toBe(1);

    stream.emit('resize');
    expect(pushes).toBe(2); // initial update + resize clone

    detach();
    expect(stream.listenerCount()).toBe(0);

    stream.emit('resize');
    expect(pushes).toBe(2); // no further pushes after detach
  });
});

// ── standalone attach helper ──────────────────────────────────────────

describe('attachLiveResize', () => {
  it('invokes the callback on resize and detaches cleanly', () => {
    const stream = makeFakeStream();
    let calls = 0;
    const detach = attachLiveResize(stream, () => {
      calls += 1;
    });

    stream.emit('resize');
    stream.emit('resize');
    expect(calls).toBe(2);

    detach();
    stream.emit('resize');
    expect(calls).toBe(2);
  });

  it('tolerates streams without an off() method (detach is still safe)', () => {
    const stream = makeFakeStream();
    const withoutOff: ResizeSource = { on: stream.on };
    let calls = 0;
    const detach = attachLiveResize(withoutOff, () => {
      calls += 1;
    });
    stream.emit('resize');
    expect(calls).toBe(1);
    expect(() => detach()).not.toThrow();
  });
});
