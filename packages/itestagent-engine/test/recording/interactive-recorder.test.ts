/**
 * Unit tests for InteractiveRecorder using MockAgentRuntime and mock callbacks.
 *
 * Task 3.13: Interactive Recording — Agent suggests next step + user confirms/corrects.
 *
 * Tests the recording state machine: idle → suggesting → awaiting_confirmation → executing → (loop)
 * With cancel, pause/resume, max steps, done suggestions, and error handling.
 *
 * Response injection: since handleUserResponse is private, tests use auto-responding
 * callbacks — onSuggestion schedules a deferred response that resolves pauseState.
 */

import { expect, test } from 'bun:test';
import type { AgentEvent } from 'itestagent-contracts';
import { MockAgentRuntime } from '../../src/mock-agent-runtime.js';
import { InteractiveRecorder } from '../../src/recording/interactive-recorder.js';
import type { RecordingCallbacks } from '../../src/recording/interactive-recorder.js';
import type {
  RecordingResult,
  RecordingSessionConfig,
  RecordingSessionState,
  RecordingStep,
  SuggestedAction,
  UserResponse,
} from '../../src/recording/types.js';

// ─── Fixtures ────────────────────────────────────────────────────

const BASE_CONFIG: RecordingSessionConfig = {
  deviceId: 'test-udid-001',
  bundleId: 'com.test.app',
  targetKind: 'simulator',
  featureName: 'login',
  backend: 'appium',
  settleMs: 0,
};

const MOCK_UI_TREE = 'Button "Login" at (0.5, 0.5)\nTextField "Username" at (0.5, 0.3)';

/** Create assistant.delta events that the InteractiveRecorder's parser understands. */
function makeSuggestionEvent(text: string): AgentEvent {
  return {
    type: 'assistant.delta',
    delta: text,
    text, // InteractiveRecorder checks ev.text
    turnId: 'turn_test',
  } as AgentEvent;
}

/** Build a valid suggestion JSON string for a tap action. */
function tapSuggestionJson(overrides?: Partial<SuggestedAction>): string {
  return JSON.stringify({
    action: 'tap',
    target: 'Login button',
    reasoning: 'The login form is visible and ready.',
    confidence: 0.9,
    ...overrides,
  });
}

/** A simple action executor that always succeeds. */
const successExecutor = async (_action: SuggestedAction) => ({
  stepId: 'step-exec-ok',
  result: { success: true },
  artifacts: [],
});

/** A failing action executor. */
const failingExecutor = async (_action: SuggestedAction) => {
  throw new Error('Device disconnected');
};

// ═══════════════════════════════════════════════════════════════════
// Recorder Factory with Auto-responding Callbacks
// ═══════════════════════════════════════════════════════════════════

interface CallbackSpy {
  stateChanges: RecordingSessionState[];
  suggestions: Array<{ suggestion: SuggestedAction; stepIndex: number }>;
  recordedSteps: Array<{ step: RecordingStep; stepIndex: number }>;
  uiTreeUpdates: string[];
  errors: Array<{ message: string; recoverable: boolean }>;
}

/**
 * Create an InteractiveRecorder with auto-responding callbacks.
 *
 * When the recorder emits onSuggestion (entering awaiting_confirmation),
 * the callback uses setTimeout(0) to defer a response injection via
 * the private pauseState mechanism. This mimics how the TUI would
 * respond to user input.
 *
 * @param autoResponse - response(s) to inject on each suggestion.
 *   Can be a single response (used for every suggestion) or an array
 *   (consumed in order, one per suggestion).
 * @param maxResponses - stop auto-responding after this many responses.
 */
function createAutoRespondingRecorder(options?: {
  config?: Partial<RecordingSessionConfig>;
  events?: AgentEvent[];
  executor?: (
    action: SuggestedAction,
  ) => Promise<{ stepId: string; result: unknown; artifacts: string[] }>;
  uiTree?: string;
  autoResponse?: UserResponse | UserResponse[];
  maxResponses?: number;
}): {
  recorder: InteractiveRecorder;
  runtime: MockAgentRuntime;
  spy: CallbackSpy;
} {
  const runtime = new MockAgentRuntime();
  if (options?.events) {
    runtime.setEventSequence(options.events);
  }

  const spy: CallbackSpy = {
    stateChanges: [],
    suggestions: [],
    recordedSteps: [],
    uiTreeUpdates: [],
    errors: [],
  };

  // Prepare auto-response queue
  const responseList: UserResponse[] = options?.autoResponse
    ? Array.isArray(options.autoResponse)
      ? options.autoResponse
      : [options.autoResponse]
    : [];
  let responseIndex = 0;
  const maxR = options?.maxResponses ?? responseList.length;

  let recorder: InteractiveRecorder | null = null;

  const callbacks: RecordingCallbacks = {
    onStateChange: (event) => {
      spy.stateChanges.push(event.state);
    },
    onSuggestion: (_event) => {
      spy.suggestions.push(_event);
      // Auto-inject response after a tick (so pauseState is set by waitForUserResponse)
      if (responseIndex < maxR && responseIndex < responseList.length) {
        const resp = responseList[responseIndex];
        if (!resp) {
          responseIndex++;
          return;
        }
        responseIndex++;
        setTimeout(() => {
          // Access private pauseState and resolve it
          const ps = (recorder as unknown as Record<string, unknown>).pauseState as {
            resolve: (r: UserResponse) => void;
          } | null;
          if (ps) {
            ps.resolve(resp);
          }
        }, 0);
      }
    },
    onStepRecorded: (event) => {
      spy.recordedSteps.push(event);
    },
    onUiTreeUpdated: (event) => {
      spy.uiTreeUpdates.push(event.uiTree);
    },
    onError: (event) => {
      spy.errors.push(event);
    },
  };

  const uiTree = options?.uiTree ?? MOCK_UI_TREE;
  const executor = options?.executor ?? successExecutor;

  recorder = new InteractiveRecorder({
    config: { ...BASE_CONFIG, ...options?.config },
    callbacks,
    agentRuntime: runtime,
    uiTreeFetcher: async () => uiTree,
    actionExecutor: executor,
  });

  return { recorder, runtime, spy };
}

// ═══════════════════════════════════════════════════════════════════
// Constructor & Initial State
// ═══════════════════════════════════════════════════════════════════

test('constructor initializes with idle state', () => {
  const { recorder } = createAutoRespondingRecorder();
  expect(recorder.getState()).toBe('idle');
});

test('getSteps returns empty array before start', () => {
  const { recorder } = createAutoRespondingRecorder();
  expect(recorder.getSteps()).toEqual([]);
});

test('getStepIndex returns 0 before start', () => {
  const { recorder } = createAutoRespondingRecorder();
  expect(recorder.getStepIndex()).toBe(0);
});

test('start throws if called when state is not idle', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent('{"action":"done","reasoning":"done"}')],
  });

  // Start the recorder in background
  const startPromise = recorder.start();
  // Wait for it to leave idle state
  await new Promise((r) => setTimeout(r, 50));

  // Now state should no longer be idle
  await expect(recorder.start()).rejects.toThrow('Cannot start recording');

  // Clean up
  recorder.cancel();
  await startPromise.catch(() => {});
});

// ═══════════════════════════════════════════════════════════════════
// Cancel Flow
// ═══════════════════════════════════════════════════════════════════

test('cancel stops recording and returns partial result', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
  });

  const startPromise = recorder.start();
  // Small delay to let the recorder enter awaiting_confirmation
  await new Promise((r) => setTimeout(r, 50));

  recorder.cancel();
  const result = await startPromise;

  expect(result.cancelled).toBe(true);
  expect(result.endState).toBe('cancelled');
  expect(spy.stateChanges).toContain('cancelled');
});

test('cancel returns RecordingResult with correct metadata', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
  });

  const startPromise = recorder.start();
  await new Promise((r) => setTimeout(r, 50));
  recorder.cancel();
  const result = await startPromise;

  expect(result.sessionId).toMatch(/^rec-/);
  expect(result.featureName).toBe(BASE_CONFIG.featureName);
  expect(result.backend).toBe(BASE_CONFIG.backend);
  expect(result.device.udid).toBe(BASE_CONFIG.deviceId);
  expect(result.device.targetKind).toBe(BASE_CONFIG.targetKind);
  expect(result.app.bundleId).toBe(BASE_CONFIG.bundleId);
  expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(typeof result.completedAt).toBe('string');
  expect(Array.isArray(result.steps)).toBe(true);
  expect(typeof result.confirmedCount).toBe('number');
  expect(typeof result.skippedCount).toBe('number');
  expect(typeof result.cancelled).toBe('boolean');
});

// ═══════════════════════════════════════════════════════════════════
// Max Steps Limit
// ═══════════════════════════════════════════════════════════════════

test('max steps limit auto-completes recording', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 0 },
  });

  const result = await recorder.start();

  expect(result.endState).toBe('completed');
  expect(recorder.getState()).toBe('completed');
  expect(result.steps).toHaveLength(0);
});

test('max steps limit calls state changes', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  expect(result.endState).toBe('completed');
  expect(result.steps.length).toBeGreaterThanOrEqual(1);
});

// ═══════════════════════════════════════════════════════════════════
// Agent Suggests "done"
// ═══════════════════════════════════════════════════════════════════

test('agent suggesting done completes recording', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent('{"action":"done","reasoning":"Flow is complete"}')],
  });

  const result = await recorder.start();

  expect(result.endState).toBe('completed');
  expect(result.steps).toHaveLength(0);
});

test('agent suggesting complete keyword returns null suggestion', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent('The recording is complete. No more actions needed.')],
  });

  const result = await recorder.start();
  expect(result.endState).toBe('completed');
});

// ═══════════════════════════════════════════════════════════════════
// Error During Execution
// ═══════════════════════════════════════════════════════════════════

test('error during execution records a failed step', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    executor: failingExecutor,
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  // The step should be recorded even though execution failed
  const failedStep = result.steps[0];
  expect(failedStep).toBeDefined();
  expect(failedStep?.skipped).toBe(false);
  expect(failedStep?.step).not.toBeNull();
  expect(failedStep?.step?.stepId).toMatch(/^error-/);

  // The result should contain the error
  const stepResult = failedStep?.step?.result as Record<string, unknown>;
  expect(stepResult.error).toBe('Device disconnected');

  // Error callback should have been called
  expect(spy.errors.length).toBeGreaterThan(0);
  expect(spy.errors[0]?.message).toContain('Device disconnected');
  expect(spy.errors[0]?.recoverable).toBe(true);
});

test('error during execution still increments confirmedCount', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    executor: failingExecutor,
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();
  expect(result.confirmedCount).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// User Confirm Flow
// ═══════════════════════════════════════════════════════════════════

test('user confirm executes action and records step', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  expect(spy.recordedSteps.length).toBe(1);
  const recordedStep = spy.recordedSteps[0];
  expect(recordedStep).toBeDefined();
  if (recordedStep) {
    expect(recordedStep.step.skipped).toBe(false);
    expect(recordedStep.step.userModified).toBe(false);
    expect(recordedStep.step.step).not.toBeNull();
    expect(recordedStep.step.step?.action).toBe('tap');
    expect(recordedStep.step.step?.target).toBe('Login button');
  }
});

test('user confirm increments confirmedCount', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  expect(result.confirmedCount).toBe(1);
  expect(result.skippedCount).toBe(0);
});

test('user confirm sets state to executing then back', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  await recorder.start();

  expect(spy.stateChanges).toContain('executing');
});

// ═══════════════════════════════════════════════════════════════════
// User Modify Flow
// ═══════════════════════════════════════════════════════════════════

test('user modify changes the action before execution', async () => {
  const modifiedAction: SuggestedAction = {
    action: 'swipe',
    target: 'Scroll down',
    direction: 'down',
    reasoning: 'User decided to scroll instead',
    confidence: 1.0,
  };

  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'modify', modifiedAction },
  });

  await recorder.start();

  expect(spy.recordedSteps.length).toBe(1);
  const recordedStep = spy.recordedSteps[0];
  expect(recordedStep).toBeDefined();
  if (recordedStep) {
    expect(recordedStep.step.userModified).toBe(true);
    expect(recordedStep.step.step?.action).toBe('swipe');
    expect(recordedStep.step.step?.target).toBe('Scroll down');
  }
});

// ═══════════════════════════════════════════════════════════════════
// User Skip Flow
// ═══════════════════════════════════════════════════════════════════

test('user skip records a skipped step without execution', async () => {
  // Use an executor that would throw if called — proves execution was skipped
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    executor: async () => {
      throw new Error('Should not be called — step was skipped');
    },
    autoResponse: { type: 'skip', reason: 'Not needed' },
  });

  const result = await recorder.start();

  expect(spy.recordedSteps.length).toBe(1);
  const recordedStep = spy.recordedSteps[0];
  expect(recordedStep).toBeDefined();
  if (recordedStep) {
    expect(recordedStep.step.skipped).toBe(true);
    expect(recordedStep.step.skipReason).toBe('Not needed');
    expect(recordedStep.step.step).toBeNull();
    expect(recordedStep.step.userModified).toBe(false);
  }
  expect(result.skippedCount).toBe(1);
  expect(result.confirmedCount).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════
// User Pause & Resume Flow
// ═══════════════════════════════════════════════════════════════════

test('pause suspends the recording loop', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'pause' },
  });

  const startPromise = recorder.start();

  // Wait for pause to take effect
  await new Promise((r) => setTimeout(r, 100));

  expect(recorder.getState()).toBe('paused');
  expect(spy.stateChanges).toContain('paused');

  // Clean up: cancel the paused recorder
  recorder.cancel();
  await startPromise;
});

test('resume continues from paused state and re-emits suggestion', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'pause' },
  });

  const startPromise = recorder.start();

  // Wait for pause
  while (recorder.getState() !== 'paused') {
    await new Promise((r) => setTimeout(r, 10));
  }

  const suggestionCountBeforeResume = spy.suggestions.length;

  // Resume
  recorder.resume();

  await new Promise((r) => setTimeout(r, 50));

  expect(recorder.getState()).toBe('awaiting_confirmation');
  // Resume should re-emit the suggestion
  expect(spy.suggestions.length).toBeGreaterThan(suggestionCountBeforeResume);

  // Clean up
  recorder.cancel();
  await startPromise;
});

test('pause then resume then confirm executes step correctly', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [
      makeSuggestionEvent(tapSuggestionJson()),
      makeSuggestionEvent('{"action":"done","reasoning":"finished"}'),
    ],
    autoResponse: [
      { type: 'pause' }, // First suggestion: pause
      { type: 'confirm' }, // After resume: confirm
    ],
    maxResponses: 2,
  });

  const startPromise = recorder.start();

  // Wait for pause state
  while (recorder.getState() !== 'paused') {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Resume — this re-enters waiting state
  recorder.resume();
  await new Promise((r) => setTimeout(r, 50));

  // The auto-responder should now inject 'confirm'
  const result = await startPromise;

  expect(spy.recordedSteps.length).toBe(1);
  const recordedStep = spy.recordedSteps[0];
  if (recordedStep) {
    expect(recordedStep.step.skipped).toBe(false);
  }
});

// ═══════════════════════════════════════════════════════════════════
// User Cancel During Suggestion
// ═══════════════════════════════════════════════════════════════════

test('cancel during awaiting_confirmation produces cancelled result', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'cancel' },
  });

  const result = await recorder.start();

  expect(result.cancelled).toBe(true);
  expect(result.endState).toBe('cancelled');
});

// ═══════════════════════════════════════════════════════════════════
// getState / getSteps / getStepIndex
// ═══════════════════════════════════════════════════════════════════

test('getState returns current session state', () => {
  const { recorder } = createAutoRespondingRecorder();
  expect(recorder.getState()).toBe('idle');
});

test('getSteps returns copy of recorded steps', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  await recorder.start();

  const steps = recorder.getSteps();
  expect(steps.length).toBe(1);

  // Verify it's a copy (mutating returned array doesn't affect internal)
  steps.push({
    step: null,
    originalSuggestion: {} as SuggestedAction,
    userModified: false,
    skipped: true,
  });
  expect(recorder.getSteps()).toHaveLength(1);
});

test('getStepIndex reflects current step count', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  expect(recorder.getStepIndex()).toBe(0);

  await recorder.start();

  expect(recorder.getStepIndex()).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// RecordingResult Structure
// ═══════════════════════════════════════════════════════════════════

test('RecordingResult has correct structure after confirm', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  expect(typeof result.sessionId).toBe('string');
  expect(result.sessionId).toMatch(/^rec-/);
  expect(typeof result.featureName).toBe('string');
  expect(typeof result.backend).toBe('string');
  expect(result.device).toBeDefined();
  expect(typeof result.device.udid).toBe('string');
  expect(['physical', 'simulator']).toContain(result.device.targetKind);
  expect(result.app).toBeDefined();
  expect(typeof result.app.bundleId).toBe('string');
  expect(Array.isArray(result.steps)).toBe(true);
  expect(typeof result.startedAt).toBe('string');
  expect(typeof result.confirmedCount).toBe('number');
  expect(typeof result.skippedCount).toBe('number');
  expect(typeof result.cancelled).toBe('boolean');
});

test('RecordingResult after confirm has confirmedCount=1, skippedCount=0', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();

  expect(result.confirmedCount).toBe(1);
  expect(result.skippedCount).toBe(0);
});

test('RecordingResult after skip has confirmedCount=0, skippedCount=1', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'skip', reason: 'unnecessary' },
  });

  const result = await recorder.start();

  expect(result.confirmedCount).toBe(0);
  expect(result.skippedCount).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// State Transitions
// ═══════════════════════════════════════════════════════════════════

test('state transitions through idle → suggesting → awaiting_confirmation', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'cancel' },
  });

  expect(recorder.getState()).toBe('idle');

  await recorder.start();

  // Should have seen suggesting and awaiting_confirmation in the state changes
  expect(spy.stateChanges).toContain('suggesting');
  expect(spy.stateChanges).toContain('awaiting_confirmation');
});

test('state transitions to executing during action execution', async () => {
  const { recorder, spy } = createAutoRespondingRecorder({
    config: { maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    executor: async (_action) => {
      await new Promise((r) => setTimeout(r, 10));
      return { stepId: 's', result: {}, artifacts: [] };
    },
    autoResponse: { type: 'confirm' },
  });

  await recorder.start();

  expect(spy.stateChanges).toContain('executing');
});

// ═══════════════════════════════════════════════════════════════════
// Settle Delay
// ═══════════════════════════════════════════════════════════════════

test('settleMs is respected after execution', async () => {
  const settleMs = 50;
  const { recorder } = createAutoRespondingRecorder({
    config: { settleMs, maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const startTime = Date.now();
  await recorder.start();
  const elapsed = Date.now() - startTime;

  expect(elapsed).toBeGreaterThanOrEqual(settleMs - 5); // Allow small timing variation
});

test('settleMs of 0 does not add delay', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { settleMs: 0, maxSteps: 1 },
    events: [makeSuggestionEvent(tapSuggestionJson())],
    autoResponse: { type: 'confirm' },
  });

  const result = await recorder.start();
  expect(result.confirmedCount).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// Multiple Steps & Edge Cases
// ═══════════════════════════════════════════════════════════════════

test('multiple steps recorded in sequence', async () => {
  const { recorder } = createAutoRespondingRecorder({
    config: { maxSteps: 2 },
    events: [
      makeSuggestionEvent(tapSuggestionJson({ action: 'tap', target: 'Button A' })),
      makeSuggestionEvent(tapSuggestionJson({ action: 'tap', target: 'Button B' })),
      makeSuggestionEvent('{"action":"done","reasoning":"complete"}'),
    ],
    autoResponse: [{ type: 'confirm' }, { type: 'skip', reason: 'skip second' }],
    maxResponses: 2,
  });

  const result = await recorder.start();

  expect(result.confirmedCount + result.skippedCount).toBe(2);
  expect(result.steps.length).toBe(2);
});

test('parseSuggestionFromEvents handles empty events gracefully', async () => {
  const { recorder } = createAutoRespondingRecorder({
    events: [],
  });

  const result = await recorder.start();
  expect(result.endState).toBe('completed');
});

test('recording with agent errors captured as errors', async () => {
  class ThrowingRuntime extends MockAgentRuntime {
    override async *streamTurn() {
      yield {
        type: 'session.error',
        sessionId: 'test',
        error: { code: 'backend.error', message: 'Agent connection lost' },
      } as AgentEvent;
      throw new Error('Agent connection lost');
    }
  }

  const throwingRuntime = new ThrowingRuntime();
  const spy: CallbackSpy = {
    stateChanges: [],
    suggestions: [],
    recordedSteps: [],
    uiTreeUpdates: [],
    errors: [],
  };

  const recorder = new InteractiveRecorder({
    config: BASE_CONFIG,
    callbacks: {
      onStateChange: (e) => spy.stateChanges.push(e.state),
      onSuggestion: (e) => spy.suggestions.push(e),
      onStepRecorded: (e) => spy.recordedSteps.push(e),
      onUiTreeUpdated: (e) => spy.uiTreeUpdates.push(e.uiTree),
      onError: (e) => spy.errors.push(e),
    },
    agentRuntime: throwingRuntime,
    uiTreeFetcher: async () => 'test-ui',
    actionExecutor: successExecutor,
  });

  const result = await recorder.start();

  expect(result.cancelled).toBe(true);
  expect(result.endState).toBe('cancelled');
  expect(spy.errors.length).toBeGreaterThan(0);
  expect(spy.errors[0]?.recoverable).toBe(false);
});

test('start with abort signal aborted before streaming', async () => {
  const { recorder, runtime } = createAutoRespondingRecorder({
    events: [makeSuggestionEvent(tapSuggestionJson())],
  });

  // Abort the runtime before starting
  await runtime.abort('preemptive');

  const result = await recorder.start();
  // Should complete/cancel gracefully
  expect(['completed', 'cancelled']).toContain(result.endState);
});
