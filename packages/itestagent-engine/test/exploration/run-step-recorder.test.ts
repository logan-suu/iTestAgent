/**
 * Unit tests for RunStepRecorder — exploration step recording lifecycle.
 *
 * Covers: start→complete, start→fail, artifact linking, serialization,
 * counter management, edge cases (non-existent stepId), locator preservation.
 */
import { expect, test } from 'bun:test';
import { RunStepRecorder } from '../../src/exploration/run-step-recorder.js';
import type { LocatorResult } from '../../src/exploration/types.js';

// ─── Helpers ────────────────────────────────────────────────

/** Create a high-confidence LocatorResult for testing. */
function makeLocator(overrides?: Partial<LocatorResult>): LocatorResult {
  return {
    found: true,
    strategy: 'accessibility_id',
    confidence: 'high',
    attemptedStrategies: ['accessibility_id'],
    element: {
      name: 'loginButton',
      type: 'XCUIElementTypeButton',
      x: 0.5,
      y: 0.5,
      width: 0.3,
      height: 0.06,
      enabled: true,
    },
    ...overrides,
  };
}

/** Create a degraded (low-confidence) LocatorResult for testing. */
function makeDegradedLocator(): LocatorResult {
  return {
    found: true,
    strategy: 'coordinate',
    confidence: 'low',
    degradation:
      'Element not found by accessibility_id, label, label_contains, or xpath; fell back to coordinate',
    attemptedStrategies: ['accessibility_id', 'label', 'label_contains', 'xpath', 'coordinate'],
  };
}

/** Wait a small amount of real time so durationMs > 0 is reliably true. */
function shortSleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

// ─── Constructor ────────────────────────────────────────────

test('constructor accepts backend name and stores it', () => {
  const recorder = new RunStepRecorder('appium-wda');
  const stepId = recorder.startStep('tap', 'Login Button');
  recorder.completeStep(stepId, { ok: true });
  const steps = recorder.getSteps();
  expect(steps).toHaveLength(1);
  expect(steps[0]?.backend).toBe('appium-wda');
});

// ─── startStep ──────────────────────────────────────────────

test('startStep returns a string stepId starting with s', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Login Button');
  expect(typeof stepId).toBe('string');
  expect(stepId.startsWith('s')).toBeTrue();
});

test('stepCounter increments (s1, s2, s3)', () => {
  const recorder = new RunStepRecorder('test-backend');
  expect(recorder.startStep('tap', 'First')).toBe('s1');
  expect(recorder.startStep('swipe', 'Second')).toBe('s2');
  expect(recorder.startStep('input', 'Third')).toBe('s3');
});

// ─── completeStep ───────────────────────────────────────────

test('completeStep produces a RunStep entry with correct action, target, backend, durationMs > 0', async () => {
  const recorder = new RunStepRecorder('appium');
  const stepId = recorder.startStep('input', 'Username Field');
  await shortSleep();
  recorder.completeStep(stepId, { ok: true, text: 'admin' });

  const steps = recorder.getSteps();
  expect(steps).toHaveLength(1);

  const step = steps[0] as NonNullable<(typeof steps)[number]>;
  expect(step.stepId).toBe(stepId);
  expect(step.backend).toBe('appium');
  expect(step.action).toBe('input');
  expect(step.target).toBe('Username Field');
  expect(step.durationMs).toBeGreaterThan(0);
  expect(typeof step.startedAt).toBe('string');
  expect(step.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
});

test('completeStep with result stores the result value', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Submit');
  recorder.completeStep(stepId, { ok: true, screenshotPath: '/tmp/shot.png' });
  const steps = recorder.getSteps();
  expect(steps[0]?.result).toEqual({ ok: true, screenshotPath: '/tmp/shot.png' });
});

test('completeStep with default result stores fallback { ok: true } when result is undefined', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Submit');
  recorder.completeStep(stepId, undefined);
  const steps = recorder.getSteps();
  expect(steps[0]?.result).toEqual({ ok: true });
});

test('completeStep with null result stores fallback { ok: true }', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Submit');
  recorder.completeStep(stepId, null);
  const steps = recorder.getSteps();
  expect(steps[0]?.result).toEqual({ ok: true });
});

// ─── failStep ───────────────────────────────────────────────

test('failStep produces a RunStep with error field and degradation: true', async () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Hidden Button');
  await shortSleep();
  recorder.failStep(stepId, 'Element not found after 3 retries');

  const steps = recorder.getSteps();
  expect(steps).toHaveLength(1);

  const step = steps[0] as NonNullable<(typeof steps)[number]>;
  expect(step.stepId).toBe(stepId);
  expect(step.durationMs).toBeGreaterThan(0);

  const result = step.result as Record<string, unknown>;
  expect(result.error).toBe('Element not found after 3 retries');
  expect(result.degradation).toBeTrue();
  expect(result.ac4_note).toBeString();
});

test('failStep does not include artifacts from completeStep artifacts param', () => {
  // failStep only uses record.artifacts (added via addArtifact), not the
  // completeStep artifacts param (which doesn't exist on failStep).
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Missing Element');
  recorder.failStep(stepId, 'Not found');
  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual([]);
});

// ─── getSteps / stepCount / activeCount ─────────────────────

test('getSteps returns only completed/failed steps (not active ones)', () => {
  const recorder = new RunStepRecorder('test-backend');

  recorder.startStep('tap', 'Step A'); // active — not completed
  const idB = recorder.startStep('swipe', 'Step B');
  recorder.completeStep(idB, { ok: true });

  const steps = recorder.getSteps();
  expect(steps).toHaveLength(1);
  expect(steps[0]?.stepId).toBe('s2');
  expect(steps[0]?.action).toBe('swipe');
});

test('stepCount reflects completed steps', () => {
  const recorder = new RunStepRecorder('test-backend');

  const id1 = recorder.startStep('tap', 'One');
  recorder.completeStep(id1, { ok: true });
  expect(recorder.stepCount).toBe(1);

  const id2 = recorder.startStep('tap', 'Two');
  recorder.completeStep(id2, { ok: true });
  expect(recorder.stepCount).toBe(2);
});

test('activeCount reflects in-progress steps', () => {
  const recorder = new RunStepRecorder('test-backend');

  expect(recorder.activeCount).toBe(0);

  recorder.startStep('tap', 'Alpha');
  expect(recorder.activeCount).toBe(1);

  recorder.startStep('swipe', 'Beta');
  expect(recorder.activeCount).toBe(2);
});

test('activeCount decreases after completeStep', () => {
  const recorder = new RunStepRecorder('test-backend');
  const id = recorder.startStep('tap', 'Thing');
  expect(recorder.activeCount).toBe(1);
  recorder.completeStep(id, { ok: true });
  expect(recorder.activeCount).toBe(0);
});

test('activeCount decreases after failStep', () => {
  const recorder = new RunStepRecorder('test-backend');
  const id = recorder.startStep('tap', 'Thing');
  expect(recorder.activeCount).toBe(1);
  recorder.failStep(id, 'Failed');
  expect(recorder.activeCount).toBe(0);
});

test('stepCount and activeCount are independent', () => {
  const recorder = new RunStepRecorder('test-backend');

  recorder.startStep('tap', 'Active'); // s1 active
  const id2 = recorder.startStep('swipe', 'Done'); // s2 will be done
  recorder.completeStep(id2, { ok: true });

  expect(recorder.stepCount).toBe(1); // only s2 completed
  expect(recorder.activeCount).toBe(1); // s1 still active
});

// ─── addArtifact ─────────────────────────────────────────────

test('addArtifact links artifact IDs to steps', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('screenshot', 'Home Screen');

  recorder.addArtifact(stepId, 'art-screenshot-001');
  recorder.addArtifact(stepId, 'art-screenshot-002');
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual(['art-screenshot-001', 'art-screenshot-002']);
});

test('addArtifact to completed step has no effect', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('screenshot', 'Home');
  recorder.completeStep(stepId, { ok: true });

  // This should not throw and should not affect the recorded step
  recorder.addArtifact(stepId, 'art-late');
  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual([]);
});

test('addArtifact to non-existent stepId does not throw', () => {
  const recorder = new RunStepRecorder('test-backend');
  expect(() => recorder.addArtifact('s999', 'art-ghost')).not.toThrow();
});

// ─── completeStep with artifacts array ──────────────────────

test('completeStep with artifacts array merges with manually added artifacts', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('screenshot', 'Settings');

  recorder.addArtifact(stepId, 'art-manual-001');
  recorder.completeStep(stepId, { ok: true }, ['art-auto-001', 'art-auto-002']);

  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual(['art-manual-001', 'art-auto-001', 'art-auto-002']);
});

test('completeStep with empty artifacts array keeps manually added artifacts', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Button');
  recorder.addArtifact(stepId, 'art-manual');
  recorder.completeStep(stepId, { ok: true }, []);

  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual(['art-manual']);
});

test('completeStep with default artifacts parameter keeps manually added artifacts', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Button');
  recorder.addArtifact(stepId, 'art-manual');
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  expect(steps[0]?.artifacts).toEqual(['art-manual']);
});

// ─── Locator information ────────────────────────────────────

test('locator information is preserved in input field', () => {
  const recorder = new RunStepRecorder('test-backend');
  const locator = makeLocator();
  const stepId = recorder.startStep('tap', 'Login Button', locator);
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  const input = steps[0]?.input as Record<string, unknown>;
  expect(input.target).toBe('Login Button');

  const inputLocator = input.locator as Record<string, unknown>;
  expect(inputLocator.strategy).toBe('accessibility_id');
  expect(inputLocator.confidence).toBe('high');
  expect(inputLocator.degradation).toBeUndefined();
});

test('locator with degradation is preserved in input field', () => {
  const recorder = new RunStepRecorder('test-backend');
  const locator = makeDegradedLocator();
  const stepId = recorder.startStep('tap', 'Maybe Here', locator);
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  const input = steps[0]?.input as Record<string, unknown>;
  const inputLocator = input.locator as Record<string, unknown>;
  expect(inputLocator.strategy).toBe('coordinate');
  expect(inputLocator.confidence).toBe('low');
  expect(inputLocator.degradation).toBeString();
});

test('locator information is preserved in failStep input field', () => {
  const recorder = new RunStepRecorder('test-backend');
  const locator = makeLocator();
  const stepId = recorder.startStep('tap', 'Missing Button', locator);
  recorder.failStep(stepId, 'Timeout waiting for element');

  const steps = recorder.getSteps();
  const input = steps[0]?.input as Record<string, unknown>;
  expect(input.target).toBe('Missing Button');

  const inputLocator = input.locator as Record<string, unknown>;
  expect(inputLocator.strategy).toBe('accessibility_id');
});

test('step without locator has input with target and undefined locator', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Simple Tap');
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  const input = steps[0]?.input as Record<string, unknown>;
  expect(input.target).toBe('Simple Tap');
  expect(input.locator).toBeUndefined();
});

// ─── toJSON ──────────────────────────────────────────────────

test('toJSON returns valid JSON string', () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Login');
  recorder.completeStep(stepId, { ok: true });

  const json = recorder.toJSON();
  expect(typeof json).toBe('string');

  const parsed = JSON.parse(json);
  expect(Array.isArray(parsed)).toBeTrue();
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.stepId).toBe('s1');
  expect(parsed[0]?.backend).toBe('test-backend');
});

test('toJSON on empty recorder returns valid empty array JSON', () => {
  const recorder = new RunStepRecorder('test-backend');
  const json = recorder.toJSON();
  expect(json).toBe('[]');
});

test('toJSON includes all steps', () => {
  const recorder = new RunStepRecorder('test-backend');
  const id1 = recorder.startStep('tap', 'One');
  recorder.completeStep(id1, { ok: true });
  const id2 = recorder.startStep('swipe', 'Two');
  recorder.completeStep(id2, { ok: true });
  const id3 = recorder.startStep('input', 'Three');
  recorder.failStep(id3, 'Error');

  const parsed = JSON.parse(recorder.toJSON());
  expect(parsed).toHaveLength(3);
  expect(parsed.map((s: { stepId: string }) => s.stepId)).toEqual(['s1', 's2', 's3']);
});

// ─── reset ───────────────────────────────────────────────────

test('reset clears all steps, active steps, and resets counter', () => {
  const recorder = new RunStepRecorder('test-backend');

  const id1 = recorder.startStep('tap', 'One');
  recorder.completeStep(id1, { ok: true });
  recorder.startStep('tap', 'Two'); // active
  expect(recorder.stepCount).toBe(1);
  expect(recorder.activeCount).toBe(1);

  recorder.reset();

  expect(recorder.stepCount).toBe(0);
  expect(recorder.activeCount).toBe(0);
  expect(recorder.toJSON()).toBe('[]');

  // Counter should restart from s1
  const newId = recorder.startStep('tap', 'Fresh');
  expect(newId).toBe('s1');
});

test('reset allows fresh recording cycle', () => {
  const recorder = new RunStepRecorder('test-backend');

  recorder.startStep('tap', 'Old');
  recorder.reset();

  const stepId = recorder.startStep('swipe', 'New');
  recorder.completeStep(stepId, { ok: true });
  const steps = recorder.getSteps();
  expect(steps).toHaveLength(1);
  expect(steps[0]?.stepId).toBe('s1');
  expect(steps[0]?.action).toBe('swipe');
});

// ─── Edge cases: non-existent stepId ────────────────────────

test('failStep with non-existent stepId does not throw', () => {
  const recorder = new RunStepRecorder('test-backend');
  expect(() => recorder.failStep('s999', 'Something went wrong')).not.toThrow();
});

test('completeStep with non-existent stepId does not throw', () => {
  const recorder = new RunStepRecorder('test-backend');
  expect(() => recorder.completeStep('s999', { ok: true })).not.toThrow();
});

test('failStep with non-existent stepId does not create a step entry', () => {
  const recorder = new RunStepRecorder('test-backend');
  recorder.failStep('s999', 'failure');
  expect(recorder.stepCount).toBe(0);
});

test('completeStep with non-existent stepId does not create a step entry', () => {
  const recorder = new RunStepRecorder('test-backend');
  recorder.completeStep('s999', { ok: true });
  expect(recorder.stepCount).toBe(0);
});

// ─── Mixed lifecycle ─────────────────────────────────────────

test('mixed complete and fail steps both appear in getSteps', () => {
  const recorder = new RunStepRecorder('test-backend');

  const id1 = recorder.startStep('tap', 'Success');
  recorder.completeStep(id1, { ok: true });

  const id2 = recorder.startStep('swipe', 'Failure');
  recorder.failStep(id2, 'Swipe missed');

  const id3 = recorder.startStep('input', 'Active'); // still active

  const steps = recorder.getSteps();
  expect(steps).toHaveLength(2);
  expect(steps[0]?.stepId).toBe('s1');
  expect(steps[0]?.result).toEqual({ ok: true });
  expect(steps[1]?.stepId).toBe('s2');
  expect((steps[1]?.result as Record<string, unknown>).error).toBe('Swipe missed');
});

test('multiple startStep without complete/fail keeps them active', () => {
  const recorder = new RunStepRecorder('test-backend');
  recorder.startStep('tap', 'A');
  recorder.startStep('tap', 'B');
  recorder.startStep('tap', 'C');

  expect(recorder.activeCount).toBe(3);
  expect(recorder.stepCount).toBe(0);
  expect(recorder.getSteps()).toHaveLength(0);
});

// ─── durationMs precision ───────────────────────────────────

test('durationMs is a non-negative integer', async () => {
  const recorder = new RunStepRecorder('test-backend');
  const stepId = recorder.startStep('tap', 'Precision Check');
  await shortSleep();
  recorder.completeStep(stepId, { ok: true });

  const steps = recorder.getSteps();
  expect(Number.isInteger(steps[0]?.durationMs)).toBeTrue();
  expect(steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
});
