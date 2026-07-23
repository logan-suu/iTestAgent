/**
 * Recording review pure function tests.
 *
 * US-8.2 AC1-AC3: Interactive Recording — display helpers for status,
 * action labels, step summaries, progress, and keyboard hints.
 *
 * These are framework-independent pure functions consumed by
 * both the TuiShell reducer and the RecordingPanel renderer.
 * No OpenTUI or SolidJS imports — pure logic only.
 */
import { describe, expect, it } from 'bun:test';
import {
  canUserRespond,
  formatActionLabel,
  formatRecordingProgress,
  formatRecordingStatus,
  formatSuggestions,
  getRecordingKeyHints,
  isRecordingActive,
  isRecordingEnded,
  summarizeStep,
} from '../src/recording-review.js';

// ─── formatRecordingStatus ──────────────────────────────────

describe('formatRecordingStatus', () => {
  it('returns "Initializing..." for idle', () => {
    expect(formatRecordingStatus('idle')).toBe('Initializing...');
  });

  it('returns "Agent is thinking..." for suggesting', () => {
    expect(formatRecordingStatus('suggesting')).toBe('Agent is thinking...');
  });

  it('returns "Awaiting your input" for awaiting_confirmation', () => {
    expect(formatRecordingStatus('awaiting_confirmation')).toBe('Awaiting your input');
  });

  it('returns "Executing..." for executing', () => {
    expect(formatRecordingStatus('executing')).toBe('Executing...');
  });

  it('returns "⏸ Paused" for paused', () => {
    expect(formatRecordingStatus('paused')).toBe('⏸ Paused');
  });

  it('returns "Recording complete" for completed', () => {
    expect(formatRecordingStatus('completed')).toBe('Recording complete');
  });

  it('returns "Recording cancelled" for cancelled', () => {
    expect(formatRecordingStatus('cancelled')).toBe('Recording cancelled');
  });

  it('returns the raw state string for unknown states', () => {
    expect(formatRecordingStatus('unknown_state')).toBe('unknown_state');
  });
});

// ─── isRecordingActive ──────────────────────────────────────

describe('isRecordingActive', () => {
  it('returns true for suggesting', () => {
    expect(isRecordingActive('suggesting')).toBe(true);
  });

  it('returns true for awaiting_confirmation', () => {
    expect(isRecordingActive('awaiting_confirmation')).toBe(true);
  });

  it('returns true for executing', () => {
    expect(isRecordingActive('executing')).toBe(true);
  });

  it('returns false for idle', () => {
    expect(isRecordingActive('idle')).toBe(false);
  });

  it('returns false for paused', () => {
    expect(isRecordingActive('paused')).toBe(false);
  });

  it('returns false for completed', () => {
    expect(isRecordingActive('completed')).toBe(false);
  });

  it('returns false for cancelled', () => {
    expect(isRecordingActive('cancelled')).toBe(false);
  });
});

// ─── canUserRespond ─────────────────────────────────────────

describe('canUserRespond', () => {
  it('returns true only for awaiting_confirmation', () => {
    expect(canUserRespond('awaiting_confirmation')).toBe(true);
  });

  it('returns false for suggesting', () => {
    expect(canUserRespond('suggesting')).toBe(false);
  });

  it('returns false for executing', () => {
    expect(canUserRespond('executing')).toBe(false);
  });

  it('returns false for idle', () => {
    expect(canUserRespond('idle')).toBe(false);
  });

  it('returns false for paused', () => {
    expect(canUserRespond('paused')).toBe(false);
  });
});

// ─── isRecordingEnded ───────────────────────────────────────

describe('isRecordingEnded', () => {
  it('returns true for completed', () => {
    expect(isRecordingEnded('completed')).toBe(true);
  });

  it('returns true for cancelled', () => {
    expect(isRecordingEnded('cancelled')).toBe(true);
  });

  it('returns false for suggesting', () => {
    expect(isRecordingEnded('suggesting')).toBe(false);
  });

  it('returns false for awaiting_confirmation', () => {
    expect(isRecordingEnded('awaiting_confirmation')).toBe(false);
  });

  it('returns false for executing', () => {
    expect(isRecordingEnded('executing')).toBe(false);
  });
});

// ─── formatActionLabel ──────────────────────────────────────

describe('formatActionLabel', () => {
  it('returns "Tap" for tap', () => {
    expect(formatActionLabel('tap')).toBe('Tap');
  });

  it('returns "Swipe" for swipe', () => {
    expect(formatActionLabel('swipe')).toBe('Swipe');
  });

  it('returns "Type" for input', () => {
    expect(formatActionLabel('input')).toBe('Type');
  });

  it('returns "Screenshot" for screenshot', () => {
    expect(formatActionLabel('screenshot')).toBe('Screenshot');
  });

  it('returns "Wait" for wait', () => {
    expect(formatActionLabel('wait')).toBe('Wait');
  });

  it('returns "Launch" for launch', () => {
    expect(formatActionLabel('launch')).toBe('Launch');
  });

  it('returns the raw string for unknown action types', () => {
    expect(formatActionLabel('unknown_action')).toBe('unknown_action');
  });
});

// ─── summarizeStep ──────────────────────────────────────────

describe('summarizeStep', () => {
  it('returns empty string for empty input', () => {
    expect(summarizeStep(null)).toBe('');
    expect(summarizeStep(undefined)).toBe('');
  });

  it('formats a confirmed step with action and target', () => {
    const step = {
      step: { action: 'tap', target: 'loginButton' },
    };
    expect(summarizeStep(step)).toBe('✓ Tap: loginButton');
  });

  it('formats a skipped step with original suggestion', () => {
    const step = {
      skipped: true,
      originalSuggestion: { action: 'tap', target: 'popupClose' },
    };
    expect(summarizeStep(step)).toBe('⊘ Skipped: popupClose');
  });

  it('formats a modified step with [modified] marker', () => {
    const step = {
      userModified: true,
      step: { action: 'input', target: 'usernameField' },
      originalSuggestion: { action: 'tap', target: 'usernameLabel' },
    };
    expect(summarizeStep(step)).toBe('✓ Type: usernameField [modified]');
  });

  it('formats a confirmed step falling back to originalSuggestion for action', () => {
    const step = {
      originalSuggestion: { action: 'swipe', target: 'list' },
    };
    expect(summarizeStep(step)).toBe('✓ Swipe: list');
  });

  it('uses "?" for unknown action type', () => {
    const step = {
      step: { target: 'someElement' },
      originalSuggestion: { target: 'someElement' },
    };
    expect(summarizeStep(step)).toBe('✓ ?: someElement');
  });
});

// ─── formatSuggestions ──────────────────────────────────────

describe('formatSuggestions', () => {
  it('returns empty array for null action', () => {
    expect(formatSuggestions(null)).toEqual([]);
  });

  it('returns empty array for undefined action', () => {
    expect(formatSuggestions(undefined)).toEqual([]);
  });

  it('extracts target field', () => {
    const result = formatSuggestions({ target: 'loginButton' });
    expect(result).toContain('Target: loginButton');
  });

  it('extracts text field', () => {
    const result = formatSuggestions({ text: 'hello world' });
    expect(result).toContain('Text: hello world');
  });

  it('extracts direction field', () => {
    const result = formatSuggestions({ direction: 'up' });
    expect(result).toContain('Direction: up');
  });

  it('extracts waitMs field with ms suffix', () => {
    const result = formatSuggestions({ waitMs: 2000 });
    expect(result).toContain('Wait: 2000ms');
  });

  it('extracts bundleId field', () => {
    const result = formatSuggestions({ bundleId: 'com.example.app' });
    expect(result).toContain('App: com.example.app');
  });

  it('extracts confidence field as percentage', () => {
    const result = formatSuggestions({ confidence: 0.85 });
    expect(result).toContain('Confidence: 85%');
  });

  it('extracts all fields from a complete action object', () => {
    const action = {
      target: 'usernameField',
      text: 'test@example.com',
      direction: 'down',
      waitMs: 500,
      bundleId: 'com.example.app',
      confidence: 0.92,
    };
    const result = formatSuggestions(action);
    expect(result).toContain('Target: usernameField');
    expect(result).toContain('Text: test@example.com');
    expect(result).toContain('Direction: down');
    expect(result).toContain('Wait: 500ms');
    expect(result).toContain('App: com.example.app');
    expect(result).toContain('Confidence: 92%');
  });

  it('skips confidence when not a number', () => {
    const result = formatSuggestions({ confidence: 'high' });
    expect(result).not.toContain('Confidence:');
  });
});

// ─── formatRecordingProgress ────────────────────────────────

describe('formatRecordingProgress', () => {
  it('builds correct progress string with step index and total', () => {
    const result = formatRecordingProgress(2, 5, 'Login flow');
    expect(result).toBe('Recording "Login flow" — Step 3 (5 recorded)');
  });

  it('uses stepIndex=0 correctly (Step 1)', () => {
    const result = formatRecordingProgress(0, 0, 'Checkout');
    expect(result).toBe('Recording "Checkout" — Step 1 (0 recorded)');
  });
});

// ─── getRecordingKeyHints ───────────────────────────────────

describe('getRecordingKeyHints', () => {
  it('returns confirm/modify/skip/pause/cancel hints for awaiting_confirmation', () => {
    const hints = getRecordingKeyHints('awaiting_confirmation');
    expect(hints).toHaveLength(5);
    expect(hints).toContain('Enter: Confirm');
    expect(hints).toContain('m: Modify');
    expect(hints).toContain('s: Skip');
    expect(hints).toContain('p: Pause');
    expect(hints).toContain('q: Cancel');
  });

  it('returns resume/cancel hints for paused', () => {
    const hints = getRecordingKeyHints('paused');
    expect(hints).toHaveLength(2);
    expect(hints).toContain('r: Resume');
    expect(hints).toContain('q: Cancel');
  });

  it('returns exit hint for completed', () => {
    const hints = getRecordingKeyHints('completed');
    expect(hints).toHaveLength(1);
    expect(hints).toContain('q: Exit');
  });

  it('returns exit hint for cancelled', () => {
    const hints = getRecordingKeyHints('cancelled');
    expect(hints).toHaveLength(1);
    expect(hints).toContain('q: Exit');
  });

  it('returns empty array for unknown state', () => {
    expect(getRecordingKeyHints('idle')).toEqual([]);
    expect(getRecordingKeyHints('suggesting')).toEqual([]);
    expect(getRecordingKeyHints('executing')).toEqual([]);
    expect(getRecordingKeyHints('unknown')).toEqual([]);
  });
});
