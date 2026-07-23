/**
 * Schema validation tests for recording contracts.
 *
 * Task 3.13: Interactive Recording output schema (raw recording JSON).
 * Validates RecordingResultSchema, RequiredActionSchema, RecordingStepSchema.
 */

import { expect, test } from 'bun:test';
import {
  RecordingResultSchema,
  parseRecordingResult,
  safeParseRecordingResult,
} from '../src/recording.js';

// ─── Test Helpers ─────────────────────────────────────────────────

function firstStepOf(result: { steps: unknown[] }): Record<string, unknown> {
  const step = result.steps[0] as Record<string, unknown> | undefined;
  if (!step) throw new Error('Expected at least one step in result');
  return step;
}

// ─── Valid Fixture ───────────────────────────────────────────────

const VALID_RECORDING_RESULT = {
  sessionId: 'rec-lx4k2m-a3b9f1',
  featureName: 'login',
  backend: 'appium',
  device: {
    udid: '00008110-ABCDEF1234567890',
    targetKind: 'physical' as const,
  },
  app: {
    bundleId: 'com.example.app',
  },
  endState: 'completed' as const,
  steps: [
    {
      step: {
        stepId: 's1',
        backend: 'appium',
        action: 'launch',
        target: 'com.example.app',
        input: null,
        result: { success: true },
        artifacts: [],
        startedAt: '2026-07-23T10:00:00.000Z',
        durationMs: 1200,
      },
      originalSuggestion: {
        action: 'launch' as const,
        target: 'Launch the app',
        reasoning: 'Start the login recording',
        confidence: 0.95,
      },
      userModified: false,
      skipped: false,
    },
    {
      step: {
        stepId: 's2',
        backend: 'appium',
        action: 'tap',
        target: 'Login button',
        input: null,
        result: { success: true, screenAfter: 'home_screen' },
        artifacts: ['artifact_screenshot_1'],
        startedAt: '2026-07-23T10:00:02.000Z',
        durationMs: 450,
      },
      originalSuggestion: {
        action: 'tap' as const,
        target: 'Login button in the center of the screen',
        reasoning: 'The form is filled; tapping Login should submit.',
        confidence: 0.9,
        suggestedLocator: {
          strategy: 'accessibility_id',
          value: 'login_button',
        },
      },
      userModified: false,
      skipped: false,
    },
  ],
  startedAt: '2026-07-23T10:00:00.000Z',
  completedAt: '2026-07-23T10:00:05.000Z',
  confirmedCount: 2,
  skippedCount: 0,
  cancelled: false,
};

// ═══════════════════════════════════════════════════════════════════
// Valid Parsing
// ═══════════════════════════════════════════════════════════════════

test('parseRecordingResult parses valid recording result', () => {
  const result = parseRecordingResult(VALID_RECORDING_RESULT);
  expect(result.sessionId).toBe('rec-lx4k2m-a3b9f1');
  expect(result.featureName).toBe('login');
  expect(result.endState).toBe('completed');
  expect(result.steps).toHaveLength(2);
  expect(result.confirmedCount).toBe(2);
  expect(result.cancelled).toBe(false);
});

test('safeParseRecordingResult returns success for valid data', () => {
  const result = safeParseRecordingResult(VALID_RECORDING_RESULT);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.sessionId).toBe('rec-lx4k2m-a3b9f1');
  }
});

test('valid recording result with skipped steps passes', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Unnecessary button',
          reasoning: 'Skipped by user',
          confidence: 0.3,
        },
        userModified: false,
        skipped: true,
        skipReason: 'User skipped',
      },
    ],
    confirmedCount: 0,
    skippedCount: 1,
  };

  const result = parseRecordingResult(data);
  const first = result.steps[0];
  if (!first) throw new Error('Expected at least one step');
  expect(first.skipped).toBe(true);
  expect(first.step).toBeNull();
});

test('valid recording result with modified steps passes', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: {
          stepId: 's1',
          backend: 'appium',
          action: 'swipe',
          target: 'Scroll down',
          input: 'down',
          result: { success: true },
          artifacts: [],
          startedAt: '2026-07-23T10:00:00.000Z',
          durationMs: 300,
        },
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Original button',
          reasoning: 'Click the button',
          confidence: 0.5,
        },
        userModified: true,
        skipped: false,
        userComment: 'Changed to swipe',
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect(firstStepOf(result).userModified).toBe(true);
  expect(firstStepOf(result).userComment).toBe('Changed to swipe');
});

test('valid recording result with all endState values passes', () => {
  const validStates = [
    'idle',
    'suggesting',
    'awaiting_confirmation',
    'executing',
    'paused',
    'completed',
    'cancelled',
  ] as const;

  for (const endState of validStates) {
    const data = { ...VALID_RECORDING_RESULT, endState };
    const result = parseRecordingResult(data);
    expect(result.endState).toBe(endState);
  }
});

test('valid recording result with simulator targetKind passes', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    device: { udid: 'sim-udid', targetKind: 'simulator' as const },
  };

  const result = parseRecordingResult(data);
  expect(result.device.targetKind).toBe('simulator');
});

// ═══════════════════════════════════════════════════════════════════
// Missing Required Fields
// ═══════════════════════════════════════════════════════════════════

test('parseRecordingResult throws on missing sessionId', () => {
  const { sessionId, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing featureName', () => {
  const { featureName, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing backend', () => {
  const { backend, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing device', () => {
  const { device, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing app', () => {
  const { app, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing endState', () => {
  const { endState, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing steps', () => {
  const { steps, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing startedAt', () => {
  const { startedAt, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing confirmedCount', () => {
  const { confirmedCount, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing skippedCount', () => {
  const { skippedCount, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing cancelled', () => {
  const { cancelled, ...data } = VALID_RECORDING_RESULT;
  expect(() => parseRecordingResult(data)).toThrow();
});

// ═══════════════════════════════════════════════════════════════════
// Invalid Action Type
// ═══════════════════════════════════════════════════════════════════

test('parseRecordingResult throws on invalid action type in suggested action', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'click' as string, // Invalid — not in enum
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0.5,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  expect(() => parseRecordingResult(data)).toThrow();
});

test('safeParseRecordingResult returns error for invalid action type', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'invalid_action' as string,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0.5,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  const result = safeParseRecordingResult(data);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBeDefined();
  }
});

// ═══════════════════════════════════════════════════════════════════
// Confidence Out of Range
// ═══════════════════════════════════════════════════════════════════

test('parseRecordingResult throws on confidence < 0', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: -0.1,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on confidence > 1', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 1.5,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  expect(() => parseRecordingResult(data)).toThrow();
});

test('confidence of exactly 0 passes validation', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect((firstStepOf(result).originalSuggestion as Record<string, unknown>).confidence).toBe(0);
});

test('confidence of exactly 1 passes validation', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 1,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect((firstStepOf(result).originalSuggestion as Record<string, unknown>).confidence).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// safeParseRecordingResult Returns Correct Shape
// ═══════════════════════════════════════════════════════════════════

test('safeParseRecordingResult returns success: true with data on valid input', () => {
  const result = safeParseRecordingResult(VALID_RECORDING_RESULT);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.sessionId).toBe('rec-lx4k2m-a3b9f1');
    expect(result.data.steps).toHaveLength(2);
  }
});

test('safeParseRecordingResult returns success: false with error on invalid input', () => {
  const result = safeParseRecordingResult({});

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBeDefined();
    expect(result.error.issues.length).toBeGreaterThan(0);
  }
});

test('safeParseRecordingResult does not throw on invalid input', () => {
  // This should NOT throw, just return { success: false }
  const result = safeParseRecordingResult(null);
  expect(result.success).toBe(false);

  const result2 = safeParseRecordingResult(undefined);
  expect(result2.success).toBe(false);

  const result3 = safeParseRecordingResult('not an object');
  expect(result3.success).toBe(false);
});

// ═══════════════════════════════════════════════════════════════════
// Invalid Field Types
// ═══════════════════════════════════════════════════════════════════

test('parseRecordingResult throws on non-string sessionId', () => {
  const data = { ...VALID_RECORDING_RESULT, sessionId: 12345 };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on non-array steps', () => {
  const data = { ...VALID_RECORDING_RESULT, steps: 'not-an-array' };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on non-integer confirmedCount', () => {
  const data = { ...VALID_RECORDING_RESULT, confirmedCount: 1.5 };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on negative confirmedCount', () => {
  const data = { ...VALID_RECORDING_RESULT, confirmedCount: -1 };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on invalid endState', () => {
  const data = { ...VALID_RECORDING_RESULT, endState: 'running' };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on invalid targetKind', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    device: { udid: 'test', targetKind: 'virtual' },
  };
  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on missing reasoning in suggestion', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          confidence: 0.5,
          // missing reasoning
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  expect(() => parseRecordingResult(data)).toThrow();
});

test('parseRecordingResult throws on empty reasoning in suggestion', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: '',
          confidence: 0.5,
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  expect(() => parseRecordingResult(data)).toThrow();
});

// ═══════════════════════════════════════════════════════════════════
// Optional Fields
// ═══════════════════════════════════════════════════════════════════

test('completedAt is optional', () => {
  const { completedAt, ...data } = VALID_RECORDING_RESULT;
  const result = parseRecordingResult(data);
  expect(result.completedAt).toBeUndefined();
});

test('suggestedLocator in SuggestedAction is optional', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0.5,
          // no suggestedLocator
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect(
    (firstStepOf(result).originalSuggestion as Record<string, unknown>).suggestedLocator,
  ).toBeUndefined();
});

test('suggestedLocator with strategy and value passes', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0.5,
          suggestedLocator: {
            strategy: 'label',
            value: 'Submit',
          },
        },
        userModified: false,
        skipped: true,
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect(
    (firstStepOf(result).originalSuggestion as Record<string, unknown>).suggestedLocator,
  ).toEqual({
    strategy: 'label',
    value: 'Submit',
  });
});

test('skipReason and userComment are optional on RecordingStep', () => {
  const data = {
    ...VALID_RECORDING_RESULT,
    steps: [
      {
        step: null,
        originalSuggestion: {
          action: 'tap' as const,
          target: 'Button',
          reasoning: 'Click it',
          confidence: 0.5,
        },
        userModified: false,
        skipped: true,
        // no skipReason, no userComment
      },
    ],
  };

  const result = parseRecordingResult(data);
  expect(firstStepOf(result).skipReason).toBeUndefined();
  expect(firstStepOf(result).userComment).toBeUndefined();
});
