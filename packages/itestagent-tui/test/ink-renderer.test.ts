import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactElement } from 'react';
import {
  APP_PROP_KEYS,
  INITIAL_STATE,
  type MockStateRef,
  STATE_WITH_MESSAGES,
  makeDispatchRecorder,
} from './fixtures/ink-renderer-characterization.js';

interface CapturedRender {
  element: ReactElement | null;
  unmountCalls: number;
  resolveExit: (() => void) | null;
}

const captured: CapturedRender = { element: null, unmountCalls: 0, resolveExit: null };

mock.module('ink', () => ({
  Box: (): null => null,
  Text: (): null => null,
  useApp: () => ({ exit: () => captured.resolveExit?.() }),
  useInput: (): void => {},
  render: (element: ReactElement) => {
    captured.element = element;
    const exited = new Promise<void>((resolve) => {
      captured.resolveExit = resolve;
    });
    return {
      waitUntilExit: () => exited,
      unmount: () => {
        captured.unmountCalls += 1;
      },
    };
  },
}));

let createInkRenderer: typeof import('../src/renderers/ink-renderer.js').createInkRenderer;

interface InkAppProps {
  initialState: unknown;
  dispatch: unknown;
  stateRef: MockStateRef;
}

function capturedAppProps(): InkAppProps {
  if (!captured.element) throw new Error('ink render() was not invoked');
  return captured.element.props as unknown as InkAppProps;
}

beforeEach(async () => {
  captured.element = null;
  captured.unmountCalls = 0;
  captured.resolveExit = null;
  createInkRenderer = (await import('../src/renderers/ink-renderer.js')).createInkRenderer;
});

describe('createInkRenderer', () => {
  it('returns distinct TuiRenderer instances', () => {
    const first = createInkRenderer();
    const second = createInkRenderer();
    expect(first).not.toBe(second);
    expect(typeof first.start).toBe('function');
    expect(typeof first.update).toBe('function');
  });

  it('waits for Ink lifecycle exit and then unmounts exactly once', async () => {
    const renderer = createInkRenderer();
    let settled = false;
    const started = renderer
      .start(INITIAL_STATE, () => {})
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    captured.resolveExit?.();
    await started;
    expect(captured.unmountCalls).toBe(1);
  });

  it('passes the initial state, dispatcher, and mutable state ref to the app', async () => {
    const renderer = createInkRenderer();
    const recorder = makeDispatchRecorder();
    const started = renderer.start(INITIAL_STATE, recorder.dispatch);
    const props = capturedAppProps();
    expect(Object.keys(props).sort()).toEqual([...APP_PROP_KEYS].sort());
    expect(props.initialState).toEqual(INITIAL_STATE);
    expect(props.dispatch).toBe(recorder.dispatch);
    expect(props.stateRef.current).toBeNull();
    captured.resolveExit?.();
    await started;
  });

  it('forwards updates through the app state ref and is safe before start', async () => {
    const renderer = createInkRenderer();
    expect(() => renderer.update(STATE_WITH_MESSAGES)).not.toThrow();

    const started = renderer.start(INITIAL_STATE, () => {});
    const received: unknown[] = [];
    capturedAppProps().stateRef.current = (state) => received.push(state);
    renderer.update(STATE_WITH_MESSAGES);
    renderer.update(INITIAL_STATE);
    expect(received).toEqual([STATE_WITH_MESSAGES, INITIAL_STATE]);
    captured.resolveExit?.();
    await started;
  });
});
