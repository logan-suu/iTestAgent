/**
 * Characterization tests for the Ink fallback renderer
 * (src/renderers/ink-renderer.tsx).
 *
 * createInkRenderer() returns a TuiRenderer whose:
 *   - start(initialState, dispatch) renders the App component through ink's
 *     render() and registers process.once('SIGINT'|'SIGTERM') cleanup
 *     handlers that unmount and resolve;
 *   - update(state) forwards state through an internal stateRef that is only
 *     assigned once React's effect runs inside a real render.
 *
 * This suite locks the CURRENT behavior of that surface with ink mocked out,
 * so no real terminal is needed: render() is intercepted to capture the
 * React element and its props, and the registered signal handlers are invoked
 * directly (never via process.emit, which could disturb the test runner).
 *
 * All fixtures live in ./fixtures/ink-renderer-characterization.ts.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactElement } from 'react';
import {
  APP_PROP_KEYS,
  CLEANUP_SIGNALS,
  INITIAL_STATE,
  type MockStateRef,
  STATE_WITH_MESSAGES,
  makeDispatchRecorder,
  makeMockStateRef,
} from './fixtures/ink-renderer-characterization.js';

// ── ink mock (registered before the dynamic import below) ─────────────

interface CapturedRender {
  element: ReactElement | null;
  unmountCalls: number;
}

const capturedRender: CapturedRender = { element: null, unmountCalls: 0 };

mock.module('ink', () => ({
  // Box/Text are only referenced while rendering App — never executed here.
  Box: (): null => null,
  Text: (): null => null,
  useInput: (): void => {},
  render: (element: ReactElement) => {
    capturedRender.element = element;
    return {
      unmount: () => {
        capturedRender.unmountCalls += 1;
      },
    };
  },
}));

// ── Harness ───────────────────────────────────────────────────────────

let createInkRenderer: typeof import('../src/renderers/ink-renderer.js').createInkRenderer;

interface InkAppProps {
  initialState: unknown;
  dispatch: unknown;
  stateRef: MockStateRef;
}

type SignalHandler = (...args: unknown[]) => void;

function capturedAppProps(): InkAppProps {
  const element = capturedRender.element;
  if (!element) throw new Error('ink render() was not invoked — call start() first');
  return element.props as unknown as InkAppProps;
}

function snapshotListeners(signal: NodeJS.Signals): SignalHandler[] {
  return [...process.listeners(signal)] as SignalHandler[];
}

/** Handlers registered for `signal` after `baseline` was taken. */
function handlersAddedSince(signal: NodeJS.Signals, baseline: SignalHandler[]): SignalHandler[] {
  const known = new Set(baseline);
  return snapshotListeners(signal).filter((handler) => !known.has(handler));
}

beforeEach(async () => {
  capturedRender.element = null;
  capturedRender.unmountCalls = 0;
  const mod = await import('../src/renderers/ink-renderer.js');
  createInkRenderer = mod.createInkRenderer;
});

// ── Interface surface ─────────────────────────────────────────────────

describe('createInkRenderer', () => {
  it('returns an object implementing the TuiRenderer interface', () => {
    const renderer = createInkRenderer();
    expect(renderer).toBeDefined();
    expect(typeof renderer.start).toBe('function');
    expect(typeof renderer.update).toBe('function');
  });

  it('creates distinct renderer instances', () => {
    const r1 = createInkRenderer();
    const r2 = createInkRenderer();
    expect(r1).not.toBe(r2);
  });

  it('start returns a promise that stays pending until a cleanup signal fires', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();
    const sigintBaseline = snapshotListeners('SIGINT');

    let settled = false;
    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch).then(() => {
      settled = true;
    });

    expect(startPromise).toBeInstanceOf(Promise);
    // Drain microtasks: nothing resolves start() on its own.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(settled).toBe(false);

    const [sigintHandler] = handlersAddedSince('SIGINT', sigintBaseline);
    expect(sigintHandler).toBeDefined();
    if (sigintHandler) sigintHandler();

    await startPromise;
    expect(settled).toBe(true);
  });
});

// ── start(): render + signal wiring ───────────────────────────────────

describe('start() — render and cleanup wiring', () => {
  it('renders exactly one App element carrying initialState, dispatch, and stateRef', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();
    const sigintBaseline = snapshotListeners('SIGINT');

    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch);

    const props = capturedAppProps();
    expect(Object.keys(props).sort()).toEqual([...APP_PROP_KEYS].sort());
    expect(props.initialState).toEqual(INITIAL_STATE);
    expect(props.dispatch).toBe(recorder.dispatch);
    // The internal ref starts empty; only a real React effect assigns it.
    expect(props.stateRef.current).toBeNull();

    const [sigintHandler] = handlersAddedSince('SIGINT', sigintBaseline);
    if (sigintHandler) sigintHandler();
    await startPromise;

    expect(capturedRender.unmountCalls).toBe(1);
  });

  it('registers one-shot SIGINT and SIGTERM handlers that unmount and resolve', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();

    const sigintBaseline = snapshotListeners('SIGINT');
    const sigtermBaseline = snapshotListeners('SIGTERM');

    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch);

    const sigintAdded = handlersAddedSince('SIGINT', sigintBaseline);
    const sigtermAdded = handlersAddedSince('SIGTERM', sigtermBaseline);
    expect(sigintAdded).toHaveLength(1);
    expect(sigtermAdded).toHaveLength(1);

    // Invoke the SIGTERM handler directly (never process.emit — the test
    // runner owns real signals). The once-handler removes itself on fire.
    const sigtermHandler = sigtermAdded[0];
    expect(sigtermHandler).toBeDefined();
    if (sigtermHandler) sigtermHandler();

    await startPromise;
    expect(capturedRender.unmountCalls).toBe(1);
  });

  it('resolves start() when SIGINT fires and unmounts exactly once', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();

    const sigintBaseline = snapshotListeners('SIGINT');
    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch);

    const sigintAdded = handlersAddedSince('SIGINT', sigintBaseline);
    const sigintHandler = sigintAdded[0];
    expect(sigintHandler).toBeDefined();
    if (sigintHandler) sigintHandler();

    await startPromise;

    // The source registers with process.once(); direct invocation under Bun
    // fires the handler without removing it, so removal itself is not
    // asserted here — only the observable unmount-once + resolve contract.
    expect(capturedRender.unmountCalls).toBe(1);
  });
});

// ── update(): stateRef pass-through ───────────────────────────────────

describe('update() — stateRef pass-through', () => {
  it('is a safe no-op before start() (stateRef unassigned)', () => {
    const renderer = createInkRenderer();
    expect(() => renderer.update(STATE_WITH_MESSAGES)).not.toThrow();
  });

  it('forwards the exact state object through the internal stateRef', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();
    const sigintBaseline = snapshotListeners('SIGINT');

    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch);
    const stateRef = capturedAppProps().stateRef;

    const received: unknown[] = [];
    stateRef.current = (state) => {
      received.push(state);
    };

    renderer.update(STATE_WITH_MESSAGES);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(STATE_WITH_MESSAGES);

    const [sigintHandler] = handlersAddedSince('SIGINT', sigintBaseline);
    if (sigintHandler) sigintHandler();
    await startPromise;
  });

  it('keeps forwarding repeated updates without touching ink render state', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();
    const sigintBaseline = snapshotListeners('SIGINT');

    const startPromise = renderer.start(INITIAL_STATE, recorder.dispatch);
    const stateRef = capturedAppProps().stateRef;

    let calls = 0;
    stateRef.current = () => {
      calls += 1;
    };

    renderer.update(INITIAL_STATE);
    renderer.update(STATE_WITH_MESSAGES);
    renderer.update(STATE_WITH_MESSAGES);

    expect(calls).toBe(3);
    // update() never touches ink's render()/unmount lifecycle.
    expect(capturedRender.unmountCalls).toBe(0);

    const [sigintHandler] = handlersAddedSince('SIGINT', sigintBaseline);
    if (sigintHandler) sigintHandler();
    await startPromise;
  });
});

// ── Cleanup signal contract ───────────────────────────────────────────

describe('cleanup signal contract', () => {
  it('declares exactly SIGINT and SIGTERM as cleanup triggers', () => {
    expect([...CLEANUP_SIGNALS]).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('makeMockStateRef mirrors the pre-start ref shape (current: null)', () => {
    const ref = makeMockStateRef();
    expect(ref.current).toBeNull();
  });
});
