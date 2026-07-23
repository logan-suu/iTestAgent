/**
 * TuiShell recording mode reducer tests.
 *
 * US-8.2 AC1-AC3: Interactive Recording — Agent suggests action,
 * user confirms/modifies/skips/pauses/cancels.
 * Pattern follows tui-shell-plan.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
  tuiShellReducer,
} from '../src/tui-shell.js';

// ─── Test helpers ───────────────────────────────────────────

function enterRecording(state: TuiShellState, featureName: string): TuiShellState {
  return tuiShellReducer(state, { type: 'enter_recording', featureName });
}

// ─── enter_recording ────────────────────────────────────────

describe('enter_recording event', () => {
  it('switches mode to recording_review', () => {
    const state = createInitialState('/test');
    const next = enterRecording(state, 'Login flow');
    expect(next.mode).toBe('recording_review');
  });

  it('initializes recording state with feature name', () => {
    const state = createInitialState('/test');
    const next = enterRecording(state, 'Login flow');
    expect(next.recordingFeatureName).toBe('Login flow');
    expect(next.recordingState).toBe('idle');
  });

  it('resets step counters and confirmed steps', () => {
    const state = createInitialState('/test');
    const next = enterRecording(state, 'Checkout');
    expect(next.recordingStepIndex).toBe(0);
    expect(next.recordingTotalSteps).toBe(0);
    expect(next.recordingConfirmedSteps).toEqual([]);
  });

  it('clears any prior suggestion and modification state', () => {
    const state = createInitialState('/test');
    const next = enterRecording(state, 'Search');
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
    expect(next.recordingModifyMode).toBe(false);
    expect(next.recordingModifyDraft).toBe('');
    expect(next.recordingPaused).toBe(false);
    expect(next.recordingCompleted).toBe(false);
  });
});

// ─── recording_suggestion ───────────────────────────────────

describe('recording_suggestion event', () => {
  it('transitions to awaiting_confirmation', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'loginButton', action: 'tap' },
      reasoning: 'This is the primary button on the login screen',
    });
    expect(next.recordingState).toBe('awaiting_confirmation');
  });

  it('stores the suggested action and reasoning', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const action = { target: 'loginButton', action: 'tap', confidence: 0.95 };
    const next = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action,
      reasoning: 'Primary CTA on login screen',
    });
    expect(next.recordingSuggestedAction).toEqual(action);
    expect(next.recordingSuggestionReasoning).toBe('Primary CTA on login screen');
  });
});

// ─── recording_confirm ──────────────────────────────────────

describe('recording_confirm event', () => {
  it('transitions to executing and clears suggestion', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'usernameField', action: 'input', text: 'test@example.com' },
      reasoning: 'Fill username field with test data',
    });
    const next = tuiShellReducer(withSuggestion, { type: 'recording_confirm' });
    expect(next.recordingState).toBe('executing');
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
  });
});

// ─── recording_modify_start ─────────────────────────────────

describe('recording_modify_start event', () => {
  it('enters modify mode with empty draft', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, { type: 'recording_modify_start' });
    expect(next.recordingModifyMode).toBe(true);
    expect(next.recordingModifyDraft).toBe('');
  });
});

// ─── recording_modify_input ─────────────────────────────────

describe('recording_modify_input event', () => {
  it('updates the modify draft text', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const modifying = tuiShellReducer(recording, { type: 'recording_modify_start' });
    const next = tuiShellReducer(modifying, {
      type: 'recording_modify_input',
      text: 'Change target to signupButton',
    });
    expect(next.recordingModifyDraft).toBe('Change target to signupButton');
  });
});

// ─── recording_modify_submit ────────────────────────────────

describe('recording_modify_submit event', () => {
  it('transitions to executing and exits modify mode', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'loginButton', action: 'tap' },
      reasoning: 'Tap login',
    });
    const modifying = tuiShellReducer(withSuggestion, { type: 'recording_modify_start' });
    const typed = tuiShellReducer(modifying, {
      type: 'recording_modify_input',
      text: 'Tap signup instead',
    });
    const next = tuiShellReducer(typed, { type: 'recording_modify_submit' });
    expect(next.recordingState).toBe('executing');
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
    expect(next.recordingModifyMode).toBe(false);
    expect(next.recordingModifyDraft).toBe('');
  });
});

// ─── recording_modify_cancel ────────────────────────────────

describe('recording_modify_cancel event', () => {
  it('exits modify mode without changing state', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const modifying = tuiShellReducer(recording, { type: 'recording_modify_start' });
    const typed = tuiShellReducer(modifying, {
      type: 'recording_modify_input',
      text: 'discard this edit',
    });
    const next = tuiShellReducer(typed, { type: 'recording_modify_cancel' });
    expect(next.recordingModifyMode).toBe(false);
    expect(next.recordingModifyDraft).toBe('');
    // original state should be preserved (still awaiting_confirmation from enter + suggestion flow)
    // In this test we entered modify from idle state, so state remains idle unchanged
  });
});

// ─── recording_skip ─────────────────────────────────────────

describe('recording_skip event', () => {
  it('clears suggestion and increments totalSteps', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'popupClose', action: 'tap' },
      reasoning: 'Close the promotional popup',
    });
    const next = tuiShellReducer(withSuggestion, { type: 'recording_skip' });
    expect(next.recordingState).toBe('suggesting');
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
    expect(next.recordingTotalSteps).toBe(1);
  });
});

// ─── recording_pause ────────────────────────────────────────

describe('recording_pause event', () => {
  it('sets recordingPaused to true', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'nextButton', action: 'tap' },
      reasoning: 'Proceed to next screen',
    });
    const next = tuiShellReducer(withSuggestion, { type: 'recording_pause' });
    expect(next.recordingState).toBe('paused');
    expect(next.recordingPaused).toBe(true);
  });
});

// ─── recording_resume ───────────────────────────────────────

describe('recording_resume event', () => {
  it('clears recordingPaused', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'nextButton', action: 'tap' },
      reasoning: 'Proceed',
    });
    const paused = tuiShellReducer(withSuggestion, { type: 'recording_pause' });
    const next = tuiShellReducer(paused, { type: 'recording_resume' });
    expect(next.recordingState).toBe('awaiting_confirmation');
    expect(next.recordingPaused).toBe(false);
  });
});

// ─── recording_cancel ───────────────────────────────────────

describe('recording_cancel event', () => {
  it('exits recording mode back to chat', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, { type: 'recording_cancel' });
    expect(next.mode).toBe('chat');
    expect(next.recordingState).toBe('cancelled');
    expect(next.recordingPaused).toBe(false);
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
  });
});

// ─── recording_state_changed ────────────────────────────────

describe('recording_state_changed event', () => {
  it('updates recordingCompleted when recording ends (completed)', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, {
      type: 'recording_state_changed',
      state: 'completed',
    });
    expect(next.recordingState).toBe('completed');
    expect(next.recordingCompleted).toBe(true);
  });

  it('updates recordingCompleted when recording ends (cancelled)', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, {
      type: 'recording_state_changed',
      state: 'cancelled',
    });
    expect(next.recordingState).toBe('cancelled');
    expect(next.recordingCompleted).toBe(true);
  });

  it('does not set recordingCompleted for non-terminal states', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, {
      type: 'recording_state_changed',
      state: 'executing',
    });
    expect(next.recordingState).toBe('executing');
    expect(next.recordingCompleted).toBe(false);
  });

  it('syncs recordingPaused with paused state', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, {
      type: 'recording_state_changed',
      state: 'paused',
    });
    expect(next.recordingPaused).toBe(true);
  });
});

// ─── recording_step_recorded ─────────────────────────────────

describe('recording_step_recorded event', () => {
  it('increments stepIndex and totalSteps', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const next = tuiShellReducer(recording, { type: 'recording_step_recorded' });
    expect(next.recordingState).toBe('suggesting');
    expect(next.recordingStepIndex).toBe(1);
    expect(next.recordingTotalSteps).toBe(1);
  });

  it('accumulates over multiple recorded steps', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    let current = recording;
    current = tuiShellReducer(current, { type: 'recording_step_recorded' });
    current = tuiShellReducer(current, { type: 'recording_step_recorded' });
    current = tuiShellReducer(current, { type: 'recording_step_recorded' });
    expect(current.recordingStepIndex).toBe(3);
    expect(current.recordingTotalSteps).toBe(3);
    expect(current.recordingState).toBe('suggesting');
  });
});

// ─── exit_recording ─────────────────────────────────────────

describe('exit_recording event', () => {
  it('resets all recording state and returns to chat mode', () => {
    const state = createInitialState('/test');
    const recording = enterRecording(state, 'Login');
    const withSuggestion = tuiShellReducer(recording, {
      type: 'recording_suggestion',
      action: { target: 'username', action: 'input' },
      reasoning: 'Enter username',
    });
    const next = tuiShellReducer(withSuggestion, { type: 'exit_recording' });
    expect(next.mode).toBe('chat');
    expect(next.recordingState).toBe('idle');
    expect(next.recordingFeatureName).toBe('');
    expect(next.recordingSuggestedAction).toBeNull();
    expect(next.recordingSuggestionReasoning).toBe('');
    expect(next.recordingModifyMode).toBe(false);
    expect(next.recordingModifyDraft).toBe('');
  });
});

// ─── Default state ──────────────────────────────────────────

describe('default recording state fields', () => {
  it('createInitialState has idle recording state and empty feature name', () => {
    const state = createInitialState('/test');
    expect(state.mode).toBe('chat');
    expect(state.recordingState).toBe('idle');
    expect(state.recordingFeatureName).toBe('');
    expect(state.recordingStepIndex).toBe(0);
    expect(state.recordingTotalSteps).toBe(0);
    expect(state.recordingConfirmedSteps).toEqual([]);
    expect(state.recordingSuggestedAction).toBeNull();
    expect(state.recordingSuggestionReasoning).toBe('');
    expect(state.recordingModifyMode).toBe(false);
    expect(state.recordingModifyDraft).toBe('');
    expect(state.recordingPaused).toBe(false);
    expect(state.recordingCompleted).toBe(false);
  });
});
