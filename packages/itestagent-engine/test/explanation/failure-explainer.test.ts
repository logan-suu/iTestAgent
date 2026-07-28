import { beforeEach, describe, expect, test } from 'bun:test';
import type { ArtifactRef, BaselineDelta, RunStatus, RunStep } from 'itestagent-contracts';
import {
  type ExplainContext,
  FailureExplainer,
  type PreviousRunInfo,
} from '../../src/explanation/index.js';

// ─── Helpers ─────────────────────────────────────────────────────

function baselineDelta(
  overrides: {
    launchDurationMs?: number;
    memoryPeakMB?: number;
    hangCount?: number;
    summary?: BaselineDelta['summary'];
  } = {},
): BaselineDelta {
  return {
    baselineId: 'bl-1',
    runId: 'run-001',
    comparedAt: '2026-07-28T10:00:00.000Z',
    targetKind: 'physical',
    deltas: {
      launchDurationMs: overrides.launchDurationMs,
      memoryPeakMB: overrides.memoryPeakMB,
      hangCount: overrides.hangCount,
    },
    summary: overrides.summary ?? 'unchanged',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function artifact(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    id: 'art-1',
    type: 'screenshot',
    path: 'artifacts/screenshot.png',
    redactionStatus: 'safe',
    ...overrides,
  };
}

function step(overrides: Partial<RunStep> & { stepId?: string } = {}): RunStep {
  return {
    stepId: overrides.stepId ?? 's1',
    backend: 'appium',
    action: 'tap',
    input: { x: 0.5, y: 0.5 },
    result: { success: true },
    artifacts: ['art-1'],
    startedAt: '2026-07-28T10:00:00.000Z',
    durationMs: 450,
    ...overrides,
  };
}

function failedStep(error: string): RunStep {
  return step({
    stepId: 's-fail',
    action: 'tap',
    result: { error },
  });
}

function previousRun(runId: string, status: RunStatus, scenario = 'login_smoke'): PreviousRunInfo {
  return { runId, status, scenario };
}

function makeContext(overrides: Partial<ExplainContext> = {}): ExplainContext {
  return {
    runId: 'run-001',
    status: 'failed',
    projectProfileRef: 'projects/abc/project-profile.json',
    steps: [],
    evidence: [],
    targetKind: 'physical',
    ...overrides,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────

describe('FailureExplainer', () => {
  let explainer: FailureExplainer;

  beforeEach(() => {
    explainer = new FailureExplainer();
  });

  // ─── Test 1: Crashlog evidence → product_regression (high) ──

  test('crashlog evidence → product_regression with high confidence', async () => {
    const ctx = makeContext({
      evidence: [artifact({ id: 'crash-1', type: 'crashlog', path: 'artifacts/crash.log' })],
      steps: [step()],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('product_regression');
    expect(result.confidence).toBe('high');
    expect(result.evidence).toContain('crash-1');
    expect(result.suggestedActions?.length).toBeGreaterThan(0);
  });

  // ─── Test 2: Crash in step error → product_regression (medium)

  test('crash in step error → product_regression with medium confidence', async () => {
    const ctx = makeContext({
      steps: [failedStep('SIGABRT: process terminated'), step()],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('product_regression');
    expect(result.confidence).toBe('medium');
  });

  // ─── Test 3: Device offline → device_issue (physical) ───────

  test('physical device timeout → device_issue with physical suggestions', async () => {
    const ctx = makeContext({
      targetKind: 'physical',
      steps: [failedStep('device offline: connection refused')],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('device_issue');
    expect(result.confidence).toBe('high');
    expect(result.suggestedActions?.some((a) => a.includes('USB'))).toBe(true);
  });

  // ─── Test 4: Device offline → device_issue (simulator) ──────

  test('simulator timeout → device_issue with simulator suggestions', async () => {
    const ctx = makeContext({
      targetKind: 'simulator',
      steps: [failedStep('timeout waiting for device')],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('device_issue');
    expect(result.confidence).toBe('high');
    expect(result.suggestedActions?.some((a) => a.includes('simctl'))).toBe(true);
  });

  // ─── Test 5: Performance regression ─────────────────────────

  test('baselineDelta launch +800ms → perf_regression with medium confidence', async () => {
    const ctx = makeContext({
      evidence: [artifact({ id: 'trace-1', type: 'trace', path: 'artifacts/trace.trace' })],
      baselineDelta: baselineDelta({
        launchDurationMs: 800,
        memoryPeakMB: 50,
        summary: 'regressed',
      }),
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('perf_regression');
    expect(result.confidence).toBe('medium');
    expect(result.summary).toContain('launch time');
    expect(result.evidence).toContain('trace-1');
  });

  // ─── Test 6: Performance below threshold → no regression ────

  test('baselineDelta launch +100ms (below threshold) → falls through', async () => {
    const ctx = makeContext({
      baselineDelta: baselineDelta({
        launchDurationMs: 100,
        memoryPeakMB: -50,
        summary: 'unchanged',
      }),
    });

    const result = await explainer.explain(ctx);
    expect(result.explanationType).toBe('inconclusive');
  });

  // ─── Test 7: Environment issue ──────────────────────────────

  test('code signing error → env_issue with high confidence', async () => {
    const ctx = makeContext({
      steps: [failedStep('code signing error: provisioning profile expired')],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('env_issue');
    expect(result.confidence).toBe('high');
    expect(result.suggestedActions?.some((a) => a.includes('doctor'))).toBe(true);
  });

  // ─── Test 8: Flaky detection ────────────────────────────────

  test('previous runs passed + failed patterns → flaky with medium confidence', async () => {
    const ctx = makeContext({
      previousRuns: [
        previousRun('run-1', 'passed'),
        previousRun('run-2', 'passed'),
        previousRun('run-3', 'failed'),
      ],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('flaky');
    expect(result.confidence).toBe('medium');
    expect(result.suggestedActions?.some((a) => a.includes('Re-run'))).toBe(true);
  });

  // ─── Test 9: Historical — all previous passed → regression ──

  test('all previous runs passed → product_regression with high confidence', async () => {
    const ctx = makeContext({
      previousRuns: [previousRun('run-1', 'passed'), previousRun('run-2', 'explored')],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('product_regression');
    expect(result.confidence).toBe('high');
    expect(result.summary).toContain('All');
  });

  // ─── Test 10: No evidence → inconclusive (R5: not fabricated)

  test('no matching rule → inconclusive with low confidence (R5 compliance)', async () => {
    const ctx = makeContext({
      steps: [step()],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('inconclusive');
    expect(result.confidence).toBe('low');
    expect(result.summary).toContain('R5');
  });

  // ─── Test 11: LLM fallback when configured ──────────────────

  test('llmExplain fallback is called when no rules match', async () => {
    const llmResult = {
      explanationType: 'script_issue' as const,
      summary: 'LLM-detected script issue',
      evidence: ['s1'],
      confidence: 'medium' as const,
      suggestedActions: ['Fix script'],
    };

    const llmExplainer = new FailureExplainer({
      llmExplain: async () => llmResult,
    });

    const result = await llmExplainer.explain(makeContext({ steps: [step()] }));

    expect(result.explanationType).toBe('script_issue');
    expect(result.summary).toBe('LLM-detected script issue');
  });

  // ─── Test 12: Memory regression ─────────────────────────────

  test('baselineDelta memory +200MB → perf_regression', async () => {
    const ctx = makeContext({
      baselineDelta: baselineDelta({
        launchDurationMs: 50,
        memoryPeakMB: 200,
        summary: 'regressed',
      }),
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('perf_regression');
    expect(result.summary).toContain('memory peak');
  });

  // ─── Test 13: Custom thresholds ─────────────────────────────

  test('custom perf thresholds respected', async () => {
    const strictExplainer = new FailureExplainer({
      perfRegressionThresholds: {
        launchTimeMs: 200,
      },
    });

    const ctx = makeContext({
      baselineDelta: baselineDelta({
        launchDurationMs: 300,
        memoryPeakMB: 0,
        summary: 'regressed',
      }),
    });

    const result = await strictExplainer.explain(ctx);
    expect(result.explanationType).toBe('perf_regression');
  });

  // ─── Test 14: Simulator env issue detected ──────────────────

  test('simctl error → env_issue with simulator hint', async () => {
    const ctx = makeContext({
      targetKind: 'simulator',
      steps: [failedStep('simctl error: simulator not found')],
    });

    const result = await explainer.explain(ctx);

    expect(result.explanationType).toBe('env_issue');
    expect(result.suggestedActions?.some((a) => a.includes('CoreSimulator'))).toBe(true);
  });
});
