/**
 * replay-to-report-adapter.test.ts — B09 replay→report adaptation coverage
 * (promotion guide §11.3 "report validation").
 *
 * Locks the adapter that feeds flow-replay outcomes into the report pipeline:
 * the overall status is carried through VERBATIM — a blocked replay is never
 * silently converted into a passing report (R5) — and failed steps are
 * extracted with their errors for the failure section.
 */
import { describe, expect, it } from 'bun:test';
import { adaptReplayForReport } from '../src/replay-to-report-adapter.js';

function makeReplay() {
  return {
    flowId: 'flow_fixture_b09',
    overallStatus: 'failed' as const,
    steps: [
      { stepIndex: 0, action: 'launchApp', status: 'passed' as const, durationMs: 120 },
      {
        stepIndex: 1,
        action: 'tap',
        status: 'failed' as const,
        durationMs: 300,
        error: 'Locator resolution failed',
      },
      { stepIndex: 2, action: 'wait', status: 'skipped' as const, durationMs: 50 },
      { stepIndex: 3, action: 'screenshot', status: 'blocked' as const, durationMs: 0 },
    ],
  };
}

describe('adaptReplayForReport', () => {
  it('carries flowId and overall status through verbatim', () => {
    const adapted = adaptReplayForReport(makeReplay());
    expect(adapted.flowId).toBe('flow_fixture_b09');
    expect(adapted.status).toBe('failed');
  });

  it('extracts only failed steps, carrying their errors', () => {
    const adapted = adaptReplayForReport(makeReplay());
    expect(adapted.failedSteps).toHaveLength(1);
    expect(adapted.failedSteps[0]?.stepIndex).toBe(1);
    expect(adapted.failedSteps[0]?.action).toBe('tap');
    expect(adapted.failedSteps[0]?.error).toContain('Locator');
  });

  it('keeps a blocked overall status as blocked (never converted to passed)', () => {
    const replay = { ...makeReplay(), overallStatus: 'blocked' as const };
    expect(adaptReplayForReport(replay).status).toBe('blocked');
  });

  it('reports zero failed steps for an all-pass replay', async () => {
    const replay = {
      flowId: 'flow_ok',
      overallStatus: 'passed' as const,
      steps: [{ stepIndex: 0, action: 'comment', status: 'passed' as const, durationMs: 0 }],
    };
    const adapted = adaptReplayForReport(replay);
    await Promise.resolve();
    expect(adapted.failedSteps).toEqual([]);
    expect(adapted.status).toBe('passed');
  });
});
