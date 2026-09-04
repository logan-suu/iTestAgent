import { describe, expect, it } from 'bun:test';
import {
  type RunResult,
  RunResultSchema,
  type TestCaseResult,
  type TestPlan,
  TestPlanSchema,
} from 'itestagent-contracts';
import { productionPermissionActions } from '../src/production-run-executor.js';
import { RerunValidationError, applyRerunFlakiness, createRerunPlan } from '../src/rerun.js';

function plan(path: 'xcuitest' | 'device_backend' = 'xcuitest'): TestPlan {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId: 'run-parent',
    projectProfileRef:
      'projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/project-profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: 'SIM-1' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: path,
      fallback: path === 'xcuitest' ? 'abort' : 'device_backend',
      resolvedPath: path,
      selectionReason:
        path === 'xcuitest' ? 'explicit_preference' : 'confirmed_no_xcuitest_candidate',
      features: [
        'DemoUITests/LoginTests/testFailure',
        'DemoUITests/LoginTests/testPass',
        'DemoUITests/LoginTests/testExplore',
      ],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      ...(path === 'xcuitest' ? { xcuitest: { scheme: 'Demo', targets: ['DemoUITests'] } } : {}),
    },
    artifacts: {
      collect: ['xcresult'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: 'simulator', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

function result(
  runId: string,
  cases: Array<Pick<TestCaseResult, 'caseId' | 'status'>>,
  parentRunId?: string,
): RunResult {
  return RunResultSchema.parse({
    schemaVersion: '3.0',
    runId,
    ...(parentRunId ? { parentRunId } : {}),
    status: cases.some((item) => item.status === 'failed') ? 'failed' : 'passed',
    projectProfileRef: plan().projectProfileRef,
    device: {
      udid: 'SIM-1',
      name: 'Simulator',
      model: 'iPhone',
      osVersion: '18',
      targetKind: 'simulator',
    },
    execution: {
      mode: 'device_backend',
      totalSteps: cases.length,
      completedSteps: cases.length,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 10,
      startTime: '2026-09-03T00:00:00.000Z',
      endTime: '2026-09-03T00:00:00.010Z',
      targetKind: 'simulator',
      backendUsed: 'appium',
      deviceId: 'SIM-1',
    },
    cases: cases.map((item) => ({
      ...item,
      name: item.caseId,
      steps: [],
      durationMs: 1,
      artifacts: [],
    })),
    metrics: {},
    environment: {
      targetKind: 'simulator',
      representativeOfPhysicalDevice: false,
      comparisonScope: 'simulator_only',
    },
    artifactRefs: [],
  });
}

describe('rerun plan compilation', () => {
  it('selects only failed and flaky cases without mutating the parent plan', () => {
    const parentPlan = plan();
    const snapshot = structuredClone(parentPlan);
    const child = createRerunPlan({
      parentPlan,
      parentResult: result('run-parent', [
        { caseId: 'DemoUITests/LoginTests/testFailure', status: 'failed' },
        { caseId: 'DemoUITests/LoginTests/testPass', status: 'passed' },
        { caseId: 'DemoUITests/LoginTests/testExplore', status: 'explored' },
        { caseId: 'DemoUITests/LoginTests/testFlaky', status: 'flaky' },
      ]),
      mode: 'failed_only',
      runId: 'run-child',
    });

    expect(child.rerun).toEqual({
      parentRunId: 'run-parent',
      mode: 'failed_only',
      selectedCaseIds: ['DemoUITests/LoginTests/testFailure', 'DemoUITests/LoginTests/testFlaky'],
    });
    expect(parentPlan).toEqual(snapshot);
  });

  it('blocks failed-only before creating a child when no case is eligible', () => {
    expect(() =>
      createRerunPlan({
        parentPlan: plan(),
        parentResult: result('run-parent', [
          { caseId: 'DemoUITests/LoginTests/testPass', status: 'passed' },
          { caseId: 'DemoUITests/LoginTests/testExplore', status: 'explored' },
        ]),
        mode: 'failed_only',
      }),
    ).toThrow(RerunValidationError);
  });

  it('rejects XCUITest case IDs that cannot be passed to -only-testing', () => {
    expect(() =>
      createRerunPlan({
        parentPlan: plan('xcuitest'),
        parentResult: result('run-parent', [{ caseId: 'human readable case', status: 'failed' }]),
        mode: 'failed_only',
      }),
    ).toThrow('rerun_xcuitest_identifier_unavailable');
  });

  it('rejects legacy two-segment XCUITest identifiers', () => {
    expect(() =>
      createRerunPlan({
        parentPlan: plan('xcuitest'),
        parentResult: result('run-parent', [
          { caseId: 'DemoUITests/testFailure', status: 'failed' },
        ]),
        mode: 'failed_only',
      }),
    ).toThrow('rerun_xcuitest_identifier_unavailable');
  });

  it('rejects DeviceBackend exploration before creating a child plan', () => {
    expect(() =>
      createRerunPlan({
        parentPlan: plan('device_backend'),
        parentResult: result('run-parent', [{ caseId: 'checkout', status: 'failed' }]),
        mode: 'failed_only',
      }),
    ).toThrow('rerun_case_not_reproducible');
  });
});

describe('rerun production permission scope', () => {
  it('requests only side effects the selected route will actually perform', () => {
    expect(productionPermissionActions(plan('xcuitest'))).toEqual([
      'execute_project_build',
      'replace_device_app',
    ]);
    expect(productionPermissionActions(plan('device_backend'))).toEqual([]);
    expect(productionPermissionActions(plan('device_backend'), true)).toEqual(['prepare_wda']);
  });
});

describe('rerun flaky reconciliation', () => {
  it('marks a passing child case flaky only from its direct comparable parent', () => {
    const parent = result('run-parent', [{ caseId: 'login', status: 'failed' }]);
    const child = result('run-child', [{ caseId: 'login', status: 'passed' }], 'run-parent');
    const adjusted = applyRerunFlakiness({ parent, child });

    expect(adjusted.status).toBe('flaky');
    expect(adjusted.cases[0]?.status).toBe('flaky');
    expect(adjusted.explanation).toMatchObject({ explanationType: 'flaky', confidence: 'high' });
    expect(adjusted.explanation?.evidence[0]).toContain('failed->run-child:login:passed');
  });

  it('does not convert repeated failure into flaky', () => {
    const adjusted = applyRerunFlakiness({
      parent: result('run-parent', [{ caseId: 'login', status: 'failed' }]),
      child: result('run-child', [{ caseId: 'login', status: 'failed' }], 'run-parent'),
    });
    expect(adjusted.status).toBe('failed');
    expect(adjusted.cases[0]?.status).toBe('failed');
  });

  it('keeps the run failed when another selected case still fails', () => {
    const adjusted = applyRerunFlakiness({
      parent: result('run-parent', [
        { caseId: 'login', status: 'failed' },
        { caseId: 'checkout', status: 'failed' },
      ]),
      child: result(
        'run-child',
        [
          { caseId: 'login', status: 'passed' },
          { caseId: 'checkout', status: 'failed' },
        ],
        'run-parent',
      ),
    });
    expect(adjusted.status).toBe('failed');
    expect(adjusted.cases.map((item) => item.status)).toEqual(['flaky', 'failed']);
    expect(adjusted.explanation?.evidence[0]).toContain('login:failed->run-child:login:passed');
  });

  it('does not infer flaky from a different parent case', () => {
    const adjusted = applyRerunFlakiness({
      parent: result('run-parent', [{ caseId: 'login', status: 'failed' }]),
      child: result('run-child', [{ caseId: 'checkout', status: 'passed' }], 'run-parent'),
    });
    expect(adjusted.status).toBe('passed');
    expect(adjusted.cases[0]?.status).toBe('passed');
  });

  it('rejects non-parent lineage and target-kind mismatches', () => {
    const parent = result('run-parent', [{ caseId: 'login', status: 'failed' }]);
    expect(() =>
      applyRerunFlakiness({
        parent,
        child: result('run-child', [{ caseId: 'login', status: 'passed' }], 'another-run'),
      }),
    ).toThrow('rerun_lineage_mismatch');

    const child = result('run-child', [{ caseId: 'login', status: 'passed' }], 'run-parent');
    const physicalParent = RunResultSchema.parse({
      ...parent,
      device: { ...parent.device, targetKind: 'physical' },
      execution: { ...parent.execution, targetKind: 'physical' },
      environment: {
        targetKind: 'physical',
        representativeOfPhysicalDevice: true,
        comparisonScope: 'physical_only',
      },
    });
    expect(() => applyRerunFlakiness({ parent: physicalParent, child })).toThrow(
      'rerun_target_mismatch',
    );
  });
});
