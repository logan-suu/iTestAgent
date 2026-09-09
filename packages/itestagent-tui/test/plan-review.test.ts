import { describe, expect, it } from 'bun:test';
import { TestPlanSchema } from 'itestagent-contracts';
import { approvePlanReview } from '../src/plan-review.js';
import { formatPlanSections } from '../src/plan-review.js';

function reviewPlan() {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId: 'review-criteria',
    projectProfileRef: 'projects/fixture/project-profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'local_connected' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'device_backend',
      fallback: 'abort',
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
      features: ['Demo'],
      goal: 'Explore Demo',
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'explore_only' },
    },
    artifacts: {
      collect: [],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'local_auto', baselineDomain: 'physical', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

describe('success criteria display', () => {
  const criterion = (plan: ReturnType<typeof reviewPlan>) =>
    formatPlanSections(plan)
      .find((s) => s.id === 'execution')
      ?.fields.find((f) => f.key === 'assertions')?.value;
  it('warns about missing criteria instead of hiding the field', () => {
    const plan = reviewPlan();
    expect(criterion(plan)).toContain('No explicit success conditions recognized');
    expect(criterion(plan)).toContain('cannot pass or establish a successful baseline');
    plan.execution.assertions = [];
    expect(criterion(plan)).toContain('Modify the plan');
  });
  it('shows confirmed conditions without an exploration warning', () => {
    const plan = reviewPlan();
    plan.execution.assertions = [
      {
        id: 'visible',
        caseId: 'Demo',
        source: 'user',
        conditions: [
          {
            type: 'element_visible',
            target: 'Workload complete',
            description: 'Confirm Workload complete is visible.',
          },
        ],
      },
    ];
    expect(criterion(plan)).toBe('Confirm Workload complete is visible.');
  });
  it('does not describe native XCUITest assertions as exploration-only', () => {
    const plan = reviewPlan();
    plan.execution.resolvedPath = 'xcuitest';
    expect(criterion(plan)).toContain('selected XCUITest tests');
    expect(criterion(plan)).not.toContain('cannot pass');
  });
});

describe('approvePlanReview', () => {
  it('discloses physical sampling allowance without weakening the confirmed window', () => {
    const plan = reviewPlan();
    plan.performance.memoryObservation = { minimumDurationMs: 70_000, settleDurationMs: 10_000 };
    const value = formatPlanSections(plan)
      .find((s) => s.id === 'performance')
      ?.fields.find((f) => f.key === 'memoryObservation')?.value;
    expect(value).toContain('Minimum 70s of exported samples');
    expect(value).toContain('wait 10s after actions');
    expect(value).toContain('Physical capture reserves 30s sampling allowance');
    expect(value).toContain('incomplete coverage remains inconclusive');
    expect(value).toContain('no automatic repetition');
    expect(plan.performance.memoryObservation).toEqual({
      minimumDurationMs: 70_000,
      settleDurationMs: 10_000,
    });
  });
  it('returns the plan when approved', () => {
    expect(approvePlanReview({ planId: 'p1' }, true).approved).toBe(true);
  });
  it('rejects when declined', () => {
    expect(approvePlanReview({ planId: 'p1' }, false).approved).toBe(false);
  });
});
