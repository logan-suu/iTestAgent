/**
 * Flow Compiler Tests — RecordingResult → FlowV2 transformation.
 *
 * Task 3.15: Compiler pipeline validation.
 * US-8.2 AC2: Confirmed steps solidified into replayable Flow.
 * US-9.2 AC3: Flow contains flowId/source/status/steps.
 */
import { describe, expect, it } from 'bun:test';
import type { RecordingResult, RecordingStep, SuggestedAction } from 'itestagent-contracts';
import { compileFlow } from '../src/compiler.js';

// ─── Test Fixtures ────────────────────────────────────────────────

type StepOverrides = Partial<NonNullable<RecordingStep['step']>>;

function makeStepFixture(overrides: StepOverrides = {}): NonNullable<RecordingStep['step']> {
  return {
    stepId: 's1',
    backend: 'appium',
    action: 'tap',
    target: 'Login button',
    input: {},
    result: { ok: true },
    artifacts: [],
    startedAt: new Date().toISOString(),
    durationMs: 120,
    ...overrides,
  };
}

function makeSuggestedAction(overrides: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    action: 'tap',
    target: 'Login button',
    reasoning: 'Navigate to login flow',
    confidence: 0.9,
    ...overrides,
  };
}

function makeRecordingStep(overrides: Partial<RecordingStep> = {}): RecordingStep {
  return {
    step: makeStepFixture(),
    originalSuggestion: makeSuggestedAction(),
    userModified: false,
    skipped: false,
    ...overrides,
  };
}

function makeRecordingResult(overrides: Partial<RecordingResult> = {}): RecordingResult {
  return {
    sessionId: 'rec-test-001',
    featureName: 'Login Smoke Test',
    backend: 'appium',
    device: { udid: '00008110-XXXXXXXXXXXXXXXX', targetKind: 'physical' },
    app: { bundleId: 'com.example.app' },
    endState: 'completed',
    steps: [
      makeRecordingStep({
        step: makeStepFixture({ stepId: 's1', action: 'launchApp', target: 'com.example.app' }),
        originalSuggestion: makeSuggestedAction({
          action: 'launch',
          bundleId: 'com.example.app',
          target: 'Launch app',
        }),
      }),
      makeRecordingStep({
        step: makeStepFixture({ stepId: 's2', action: 'tap', target: 'Login' }),
        originalSuggestion: makeSuggestedAction({
          action: 'tap',
          target: 'Login',
          suggestedLocator: { strategy: 'label', value: 'Login' },
        }),
      }),
      makeRecordingStep({
        step: makeStepFixture({ stepId: 's3', action: 'input', target: 'Email' }),
        originalSuggestion: makeSuggestedAction({
          action: 'input',
          target: 'Email',
          text: 'test@example.com',
        }),
      }),
    ],
    startedAt: '2026-07-23T10:00:00.000Z',
    completedAt: '2026-07-23T10:05:00.000Z',
    confirmedCount: 3,
    skippedCount: 0,
    cancelled: false,
    ...overrides,
  };
}

// ─── Basic Compilation ────────────────────────────────────────────

describe('compileFlow', () => {
  it('compiles a complete recording to FlowV2', () => {
    const flow = compileFlow(makeRecordingResult());

    expect(flow.schemaVersion).toBe('itestagent.flow.v2');
    expect(flow.flowId).toBe('login-smoke-test');
    expect(flow.source).toBe('agent-recorded');
    expect(flow.status).toBe('draft');
    expect(flow.supportedTargetKinds).toEqual(['physical']);
    expect(flow.requiredCapabilities.length).toBeGreaterThan(0);
    expect(flow.lastValidatedTargets.length).toBe(1);
    expect(flow.lastValidatedTargets[0]?.kind).toBe('physical');
    expect(flow.lastValidatedTargets[0]?.udid).toBe('00008110-XXXXXXXXXXXXXXXX');
    expect(flow.steps.length).toBe(3);
  });

  it('sets status to draft even for completed recordings (R7)', () => {
    const flow = compileFlow(makeRecordingResult({ endState: 'completed' }));
    expect(flow.status).toBe('draft');
  });

  it('generates kebab-case flowId from featureName', () => {
    const flow = compileFlow(makeRecordingResult({ featureName: 'User Registration & Login' }));
    expect(flow.flowId).toBe('user-registration-login');
  });

  it('handles special characters in featureName', () => {
    const flow = compileFlow(makeRecordingResult({ featureName: 'Login (Smoke) V2.0' }));
    expect(flow.flowId).toBe('login-smoke-v20');
  });

  it('includes recording context in notes', () => {
    const recording = makeRecordingResult();
    const flow = compileFlow(recording);
    expect(flow.notes).toContain(recording.sessionId);
    expect(flow.notes).toContain(recording.backend);
    expect(flow.notes).toContain(recording.app.bundleId);
  });

  // ─── Target Kind ───────────────────────────────────────────────

  it('records simulator target kind', () => {
    const flow = compileFlow(
      makeRecordingResult({
        device: { udid: 'F3BF1718-247D-4CB2-AAAF-F7738514B14D', targetKind: 'simulator' },
      }),
    );
    expect(flow.supportedTargetKinds).toEqual(['simulator']);
    expect(flow.lastValidatedTargets[0]?.kind).toBe('simulator');
  });

  // ─── Step Filtering ────────────────────────────────────────────

  it('filters out skipped steps', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'tap', target: 'A' }),
          }),
          makeRecordingStep({ skipped: true, step: null }),
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's3', action: 'tap', target: 'C' }),
          }),
        ],
      }),
    );
    expect(flow.steps.length).toBe(2);
  });

  it('throws when all steps are skipped', () => {
    const recording = makeRecordingResult({
      steps: [
        makeRecordingStep({ skipped: true, step: null }),
        makeRecordingStep({ skipped: true, step: null }),
      ],
      confirmedCount: 0,
      skippedCount: 2,
    });
    expect(() => compileFlow(recording)).toThrow('no executable steps remain');
  });

  // ─── Action Normalization ──────────────────────────────────────

  it('normalizes tap action', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'tap', target: 'X' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('tap');
  });

  it('normalizes mobile: tap action', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'mobile: tap', target: 'X' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('tap');
  });

  it('normalizes swipe action', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'swipe', target: 'list' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('swipe');
  });

  it('normalizes input to typeText', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'input', target: 'email' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('typeText');
  });

  it('normalizes launch to launchApp', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'launch', target: 'com.example.app' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('launchApp');
  });

  it('converts unknown action to comment step', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'flyToMoon', target: 'some target' }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.action).toBe('comment');
    expect(flow.steps[0]?.comment).toContain('[unmapped: flyToMoon]');
  });

  // ─── Locator Normalization ─────────────────────────────────────

  it('normalizes Appium locator strategy', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'tap', target: 'Login' }),
            originalSuggestion: makeSuggestedAction({
              action: 'tap',
              target: 'Login',
              suggestedLocator: { strategy: 'accessibility id', value: 'login_btn' },
            }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.locator).toEqual({ strategy: 'identifier', value: 'login_btn' });
  });

  it('preserves label locator', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'tap', target: 'Login' }),
            originalSuggestion: makeSuggestedAction({
              action: 'tap',
              target: 'Login',
              suggestedLocator: { strategy: 'label', value: 'Login' },
            }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.locator).toEqual({ strategy: 'label', value: 'Login' });
  });

  // ─── SuggestedAction Fields ────────────────────────────────────

  it('preserves text values from SuggestedAction', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'input', target: 'email' }),
            originalSuggestion: makeSuggestedAction({
              action: 'input',
              target: 'email',
              text: 'hello@test.com',
            }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.value).toBe('hello@test.com');
  });

  it('preserves direction from SuggestedAction', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'swipe', target: 'list' }),
            originalSuggestion: makeSuggestedAction({
              action: 'swipe',
              target: 'list',
              direction: 'down',
            }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.direction).toBe('down');
  });

  // ─── Safety Gate ───────────────────────────────────────────────

  it('preserves safetyGate from RunStep', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({
              stepId: 's1',
              action: 'launchApp',
              target: 'com.example.app',
              safetyGate: 'ask',
            }),
          }),
        ],
      }),
    );
    expect(flow.steps[0]?.safetyGate).toBe('ask');
  });

  // ─── Cancelled Recording ───────────────────────────────────────

  it('compiles cancelled recording as draft', () => {
    const flow = compileFlow(makeRecordingResult({ endState: 'cancelled', cancelled: true }));
    expect(flow.status).toBe('draft');
    expect(flow.notes).toContain('cancelled');
  });

  // ─── Modified Steps ────────────────────────────────────────────

  it('includes modified step count when user modified steps', () => {
    const flow = compileFlow(
      makeRecordingResult({
        steps: [
          makeRecordingStep({
            step: makeStepFixture({ stepId: 's1', action: 'tap', target: 'Login' }),
            userModified: true,
          }),
        ],
      }),
    );
    expect(flow.notes).toContain('1 steps user-modified');
  });

  it('handles empty feature name gracefully', () => {
    const flow = compileFlow(makeRecordingResult({ featureName: '' }));
    expect(flow.flowId).toBe('untitled-flow');
  });
});
