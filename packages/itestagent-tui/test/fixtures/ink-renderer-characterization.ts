/**
 * Characterization fixtures for the Ink fallback renderer
 * (src/renderers/ink-renderer.tsx).
 *
 * createInkRenderer() exposes { start, update }:
 *   - start(initialState, dispatch) renders <App/> via ink's render() and
 *     registers process.once('SIGINT'|'SIGTERM') cleanup handlers;
 *   - update(state) forwards the state through the internal stateRef to the
 *     App's setState (assigned by a React effect during real rendering).
 *
 * These fixtures provide deterministic states and recorder helpers so tests
 * can drive the exported interface with ink mocked out. Expected values only.
 */

import type { TuiShellEvent, TuiShellState } from '../../src/tui-shell.js';

// ── State fixtures ────────────────────────────────────────────────────

/**
 * Literal snapshot of `createInitialState('/test/ws')` — every field of
 * TuiShellState in its factory-default form, frozen against mutation.
 */
export const INITIAL_STATE: Readonly<TuiShellState> = Object.freeze({
  workspace: '/test/ws',
  deviceStatus: 'no_device',
  mode: 'chat',
  messages: [],
  inputDraft: '',
  running: true,
  candidates: [],
  candidateIndex: 0,
  candidateEditMode: false,
  candidateEditDraft: '',
  currentIntent: null,
  plan: null,
  planSectionIndex: 0,
  planModifyMode: false,
  planModifyDraft: '',
  planConfirmed: false,
  recordingState: 'idle',
  recordingFeatureName: '',
  recordingStepIndex: 0,
  recordingTotalSteps: 0,
  recordingConfirmedSteps: [],
  recordingSuggestedAction: null,
  recordingSuggestionReasoning: '',
  recordingModifyMode: false,
  recordingModifyDraft: '',
  recordingPaused: false,
  recordingCompleted: false,
  credentialRequests: [],
  credentialIndex: 0,
  credentialInputDraft: '',
  credentialResponses: new Map(),
  credentialCompleted: false,
  credentialRememberToggled: false,
  assertionSuggestions: [],
  assertionConfirmed: [],
  assertionIndex: 0,
  setupStep: 0,
  setupProvider: '',
  setupBaseUrl: '',
  setupModel: '',
  setupError: '',
});

/** One message of each type, fixed ids/timestamps for determinism. */
export const SAMPLE_MESSAGES = [
  { id: 'm1', type: 'user', text: 'run the smoke test', timestamp: 1 },
  { id: 'm2', type: 'assistant', text: 'Starting analysis…', timestamp: 2 },
  { id: 'm3', type: 'system', text: '🔧 screenshot on mock...', timestamp: 3 },
  { id: 'm4', type: 'error', text: 'device disconnected', timestamp: 4 },
] as const;

export const STATE_WITH_MESSAGES: Readonly<TuiShellState> = Object.freeze({
  ...INITIAL_STATE,
  messages: SAMPLE_MESSAGES,
});

// ── Contract locks ────────────────────────────────────────────────────

/** Prop keys createInkRenderer passes to React.createElement(App, …). */
export const APP_PROP_KEYS = ['initialState', 'dispatch', 'stateRef'] as const;

/** Signals whose once-handlers start() registers as cleanup triggers. */
export const CLEANUP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

// ── Recorder helpers ──────────────────────────────────────────────────

export interface DispatchRecorder {
  readonly dispatch: (event: TuiShellEvent) => void;
  readonly events: TuiShellEvent[];
}

/** Dispatch spy that records every TuiShellEvent it receives. */
export function makeDispatchRecorder(): DispatchRecorder {
  const events: TuiShellEvent[] = [];
  return {
    events,
    dispatch: (event) => {
      events.push(event);
    },
  };
}

/**
 * Shape of the internal stateRef captured from rendered App props:
 * `{ current: ((s: TuiShellState) => void) | null }`, null until start().
 */
export interface MockStateRef {
  current: ((state: TuiShellState) => void) | null;
}

export function makeMockStateRef(): MockStateRef {
  return { current: null };
}
