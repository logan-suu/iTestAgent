/**
 * Plan review pure function unit tests.
 *
 * US-5.2 AC1-AC3: TestPlan display, section navigation, duration estimation.
 * Pattern follows candidate-review.test.ts — framework-independent, no renderer.
 */
import { describe, expect, it } from 'bun:test';
import type { TestPlan } from 'itestagent-contracts';
import {
  formatEstimatedDuration,
  formatExecutionPath,
  formatPlanSections,
  navigatePlanSection,
} from '../src/plan-review.js';

// ─── Test helpers ───────────────────────────────────────────

function makeTestPlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    schemaVersion: 'itestagent.test-plan.v1' as const,
    runId: 'run-001',
    projectProfileRef: '~/.itestagent/projects/abc123/project-profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'local_connected' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'auto',
      fallback: 'device_backend',
      features: ['login', 'checkout', 'search'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      metrics: ['launch_time', 'memory_peak', 'crash', 'hitches'],
    },
    artifacts: {
      collect: ['screenshot', 'video', 'crashlog', 'xcresult', 'trace'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'local_auto', baselineDomain: 'physical', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: ['clear_data', 'reinstall'] },
    ...overrides,
  };
}

// ─── formatPlanSections ─────────────────────────────────────

describe('formatPlanSections', () => {
  it('includes all 7 sections', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    expect(sections).toHaveLength(7);
    expect(sections.map((s) => s.id)).toEqual([
      'overview',
      'device',
      'execution',
      'features',
      'metrics',
      'performance',
      'safety',
    ]);
  });

  it('overview section contains target and backend info', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const overview = sections[0];
    expect(overview?.title).toBe('Overview');
    const keys = overview?.fields.map((f) => f.key) ?? [];
    expect(keys).toContain('target');
    expect(keys).toContain('appSource');
    expect(keys).toContain('deviceBackend');
  });

  it('device section shows target kind and selector', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const device = sections[1];
    expect(device?.id).toBe('device');
    const kindField = device?.fields.find((f) => f.key === 'kind');
    expect(kindField?.value).toBe('physical');
  });

  it('device section shows simulator kind when plan is simulator', () => {
    const plan = makeTestPlan({
      device: { kind: 'simulator', simulator: { selector: 'booted' } },
    });
    const sections = formatPlanSections(plan);
    const device = sections[1];
    const kindField = device?.fields.find((f) => f.key === 'kind');
    expect(kindField?.value).toBe('simulator');
  });

  it('execution section shows prefer, fallback, and assertion', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const exec = sections[2];
    expect(exec?.id).toBe('execution');
    const keys = exec?.fields.map((f) => f.key) ?? [];
    expect(keys).toContain('prefer');
    expect(keys).toContain('fallback');
    expect(keys).toContain('assertion');
  });

  it('features section lists all feature names', () => {
    const plan = makeTestPlan({
      execution: { ...makeTestPlan().execution, features: ['login', 'checkout', 'search'] },
    });
    const sections = formatPlanSections(plan);
    const features = sections[3];
    expect(features?.id).toBe('features');
    expect(features?.fields[0]?.value).toContain('login');
    expect(features?.fields[0]?.value).toContain('checkout');
    expect(features?.fields[0]?.value).toContain('search');
  });

  it('features section shows empty label when no features', () => {
    const plan = makeTestPlan({
      execution: { ...makeTestPlan().execution, features: [] },
    });
    const sections = formatPlanSections(plan);
    const features = sections[3];
    expect(features?.fields[0]?.value).toBe('(none)');
  });

  it('features show flows when present', () => {
    const plan = makeTestPlan({
      execution: { ...makeTestPlan().execution, flows: ['flow-login', 'flow-search'] },
    });
    const sections = formatPlanSections(plan);
    const features = sections[3];
    const flowField = features?.fields.find((f) => f.key === 'flows');
    expect(flowField?.value).toContain('flow-login');
    expect(flowField?.value).toContain('flow-search');
  });

  it('metrics section lists collected metrics', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const metrics = sections[4];
    expect(metrics?.id).toBe('metrics');
    const metricField = metrics?.fields.find((f) => f.key === 'metrics');
    expect(metricField?.value).toContain('launch_time');
    expect(metricField?.value).toContain('hitches');
  });

  it('performance section shows baseline and domain', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const perf = sections[5];
    expect(perf?.id).toBe('performance');
    const keys = perf?.fields.map((f) => f.key) ?? [];
    expect(keys).toContain('baseline');
    expect(keys).toContain('baselineDomain');
  });

  it('safety section shows default mode and high risk actions', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const safety = sections[6];
    expect(safety?.id).toBe('safety');
    const modeField = safety?.fields.find((f) => f.key === 'defaultMode');
    expect(modeField?.value).toBe('ask');
  });

  it('overview section includes estimated duration', () => {
    const plan = makeTestPlan();
    const sections = formatPlanSections(plan);
    const overview = sections[0];
    const durField = overview?.fields.find((f) => f.key === 'estimatedDuration');
    expect(durField).toBeDefined();
    expect(durField?.value).toContain('min');
  });
});

// ─── navigatePlanSection ────────────────────────────────────

describe('navigatePlanSection', () => {
  it('moves to next section', () => {
    expect(navigatePlanSection(0, 'down', 7)).toBe(1);
    expect(navigatePlanSection(3, 'down', 7)).toBe(4);
  });

  it('moves to previous section', () => {
    expect(navigatePlanSection(2, 'up', 7)).toBe(1);
    expect(navigatePlanSection(5, 'up', 7)).toBe(4);
  });

  it('wraps around from last to first', () => {
    expect(navigatePlanSection(6, 'down', 7)).toBe(0);
  });

  it('wraps around from first to last', () => {
    expect(navigatePlanSection(0, 'up', 7)).toBe(6);
  });

  it('handles single section', () => {
    expect(navigatePlanSection(0, 'down', 1)).toBe(0);
    expect(navigatePlanSection(0, 'up', 1)).toBe(0);
  });
});

// ─── formatExecutionPath ────────────────────────────────────

describe('formatExecutionPath', () => {
  it('shows XCUITest preferred with device fallback', () => {
    const result = formatExecutionPath('auto', 'device_backend');
    expect(result).toContain('auto');
    expect(result).toContain('device_backend');
  });

  it('shows XCUITest-only with abort fallback', () => {
    const result = formatExecutionPath('xcuitest', 'abort');
    expect(result).toContain('xcuitest');
    expect(result).toContain('abort');
  });

  it('shows exploration-only path', () => {
    const result = formatExecutionPath('device_backend', 'abort');
    expect(result).toContain('device_backend');
  });
});

// ─── formatEstimatedDuration ────────────────────────────────

describe('formatEstimatedDuration', () => {
  it('returns base time for zero features', () => {
    const result = formatEstimatedDuration([]);
    expect(result).toContain('min');
  });

  it('scales with feature count', () => {
    const small = formatEstimatedDuration(['login']);
    const large = formatEstimatedDuration(['login', 'checkout', 'search', 'detail', 'payment']);
    const extractMin = (s: string) => Number.parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
    expect(extractMin(large)).toBeGreaterThan(extractMin(small));
  });

  it('includes a unit label', () => {
    const result = formatEstimatedDuration(['login']);
    expect(result).toMatch(/min|hour/);
  });
});
