import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestCaseResult, type TestPlan, TestPlanSchema } from 'itestagent-contracts';
import {
  createDualExecutionDispatcher,
  createRerunPlan,
  executeProductionTestPlan,
  persistConfirmedRun,
  persistRunBundle,
} from 'itestagent-engine';
import { createRunStore, createStoreCore, initStore } from 'itestagent-store';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-t69-'));
  roots.push(root);
  initStore(root);
  const core = createStoreCore(join(root, 'db', 'itestagent.db'));
  await core.driver.migrate();
  return { root, core, store: createRunStore(core.db, root) };
}

function xcuitestPlan(runId: string): TestPlan {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId,
    projectProfileRef:
      'projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/project-profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: 'SIM-1' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'xcuitest',
      fallback: 'abort',
      resolvedPath: 'xcuitest',
      selectionReason: 'explicit_preference',
      features: ['DemoUITests/LoginTests/testFailure', 'DemoUITests/LoginTests/testPass'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      xcuitest: { scheme: 'Demo', testPlan: 'Smoke', targets: ['DemoUITests'] },
    },
    artifacts: {
      collect: [],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: 'simulator', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

function testCase(caseId: string, status: TestCaseResult['status']): TestCaseResult {
  return { caseId, name: caseId, status, steps: [], durationMs: 1, artifacts: [] };
}

function devicePlan(runId: string): TestPlan {
  const base = xcuitestPlan(runId);
  return TestPlanSchema.parse({
    ...base,
    execution: {
      ...base.execution,
      prefer: 'device_backend',
      fallback: 'device_backend',
      resolvedPath: 'device_backend',
      selectionReason: 'confirmed_no_xcuitest_candidate',
      features: ['checkout-failure', 'checkout-pass'],
      xcuitest: undefined,
    },
  });
}

describe('T6.9 evidence-driven explain and failed-only rerun dispatch', () => {
  test('commits parent-child lineage, filters XCUITest, and derives flaky from direct evidence', async () => {
    const { root, store } = await setup();
    const parentPlan = xcuitestPlan('run-parent');
    await persistRunBundle({
      store,
      plan: parentPlan,
      report: {
        runId: parentPlan.runId,
        status: 'failed',
        projectProfileRef: parentPlan.projectProfileRef,
        device: {
          udid: 'SIM-1',
          name: 'Simulator',
          model: 'iPhone',
          osVersion: '18',
          targetKind: 'simulator',
        },
        execution: {
          mode: 'xcuitest',
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 1,
          startTime: '2026-09-03T00:00:00.000Z',
          endTime: '2026-09-03T00:00:00.001Z',
          targetKind: 'simulator',
          backendUsed: 'xcodebuild',
          deviceId: 'SIM-1',
        },
        cases: [
          testCase('DemoUITests/LoginTests/testFailure', 'failed'),
          testCase('DemoUITests/LoginTests/testPass', 'passed'),
        ],
        metrics: {},
        environment: {
          targetKind: 'simulator',
          representativeOfPhysicalDevice: false,
          comparisonScope: 'simulator_only',
        },
        artifactRefs: [],
        allArtifacts: [],
        collectionOutcomes: [],
        steps: [],
      },
    });

    const parent = await store.loadRunBundle(parentPlan.runId);
    const childPlan = createRerunPlan({
      parentPlan,
      parentResult: parent.result,
      mode: 'failed_only',
      runId: 'run-child',
    });
    let only: string[] | undefined;
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: true }),
      runXcuitest: async (input) => {
        only = input.only;
        return {
          exitCode: 0,
          durationMs: 1,
          parsed: {
            cases: [testCase('DemoUITests/LoginTests/testFailure', 'passed')],
            execution: {
              startTime: '2026-09-03T00:01:00.000Z',
              endTime: '2026-09-03T00:01:00.001Z',
              totalTests: 1,
              passed: 1,
              failed: 0,
              skipped: 0,
              targetNames: ['DemoUITests'],
            },
            metrics: {},
            attachments: [],
          },
          executionFacts: [],
        };
      },
      runDeviceBackend: async () => {
        throw new Error('must not switch semantic routes');
      },
    });
    const dispatch = await dispatcher.dispatch({
      plan: childPlan,
      confirmed: true,
      workspace: '/workspace/Demo',
      destination: { targetKind: 'simulator', udid: 'SIM-1' },
      resultBundlePath: join(root, 'missing.xcresult'),
    });
    await persistConfirmedRun({
      store,
      plan: childPlan,
      parentResult: parent.result,
      device: {
        udid: 'SIM-1',
        platform: 'ios',
        name: 'Simulator',
        model: 'iPhone',
        osVersion: '18',
        targetKind: 'simulator',
      },
      dispatch,
      resultBundlePath: join(root, 'missing.xcresult'),
    });

    expect(only).toEqual(['DemoUITests/LoginTests/testFailure']);
    expect(childPlan.execution.xcuitest?.targets).toEqual(['DemoUITests']);
    const child = await store.loadRunBundle(childPlan.runId);
    expect(child.result).toMatchObject({
      runId: 'run-child',
      parentRunId: 'run-parent',
      status: 'flaky',
      cases: [{ caseId: 'DemoUITests/LoginTests/testFailure', status: 'flaky' }],
      explanation: { explanationType: 'flaky', confidence: 'high' },
    });
    expect(child.steps.steps).toEqual([]);
    expect(child.artifactIndex.collectionOutcomes).toEqual([
      {
        type: 'xcresult',
        status: 'failed',
        reasonCode: 'xcodebuild.result_bundle_missing',
      },
    ]);
    expect((await store.findById(childPlan.runId))?.parentRunId).toBe('run-parent');

    const explain = Bun.spawnSync({
      cmd: [
        'bun',
        join(import.meta.dir, '../../../packages/itestagent-cli/src/cli.ts'),
        'explain',
        childPlan.runId,
        '--json',
      ],
      env: { ...process.env, ITESTAGENT_HOME: root },
    });
    expect(explain.exitCode).toBe(0);
    expect(JSON.parse(explain.stdout.toString())).toMatchObject({
      runId: 'run-child',
      status: 'flaky',
      explanation: { explanationType: 'flaky', confidence: 'high' },
    });

    const recoveryCore = createStoreCore(join(root, 'db', 'recovery.db'));
    await recoveryCore.driver.migrate();
    const recoveryStore = createRunStore(recoveryCore.db, root);
    const recovery = await recoveryStore.reconcile();
    expect(recovery.recovered).toContain(childPlan.runId);
    expect((await recoveryStore.findById(childPlan.runId))?.parentRunId).toBe('run-parent');
  });

  test('latest resolves the newest valid bundle and skips a newer corrupted directory', async () => {
    const { root, store } = await setup();
    const plan = xcuitestPlan('run-valid');
    await persistRunBundle({
      store,
      plan,
      report: {
        runId: plan.runId,
        status: 'passed',
        projectProfileRef: plan.projectProfileRef,
        device: {
          udid: 'SIM-1',
          name: 'Simulator',
          model: 'iPhone',
          osVersion: '18',
          targetKind: 'simulator',
        },
        execution: {
          mode: 'xcuitest',
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 1,
          startTime: '2026-09-03T00:00:00.000Z',
          endTime: '2026-09-03T00:00:00.001Z',
          targetKind: 'simulator',
          backendUsed: 'xcodebuild',
          deviceId: 'SIM-1',
        },
        cases: [testCase('DemoUITests/LoginTests/testPass', 'passed')],
        metrics: {},
        environment: {
          targetKind: 'simulator',
          representativeOfPhysicalDevice: false,
          comparisonScope: 'simulator_only',
        },
        artifactRefs: [],
        allArtifacts: [],
        collectionOutcomes: [],
        steps: [],
      },
    });
    const corrupt = join(root, 'runs', 'run-corrupt');
    await mkdir(corrupt, { recursive: true });
    await writeFile(join(corrupt, 'result.json'), '{"newer":true}');

    expect((await store.findLatestValidBundle())?.result.runId).toBe('run-valid');
  });

  test('rejects unsafe bundle identifiers at the store boundary', async () => {
    const { store } = await setup();
    expect(store.loadRunBundle('../outside')).rejects.toThrow('unsafe runId');
  });

  test('limits DeviceBackend dynamic execution and committed cases to selectedCaseIds', async () => {
    const { root, store } = await setup();
    const parentPlan = devicePlan('device-parent');
    await persistRunBundle({
      store,
      plan: parentPlan,
      report: {
        runId: parentPlan.runId,
        status: 'failed',
        projectProfileRef: parentPlan.projectProfileRef,
        device: {
          udid: 'SIM-1',
          name: 'Simulator',
          model: 'iPhone',
          osVersion: '18',
          targetKind: 'simulator',
        },
        execution: {
          mode: 'device_backend',
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 1,
          startTime: '2026-09-03T00:00:00.000Z',
          endTime: '2026-09-03T00:00:00.001Z',
          targetKind: 'simulator',
          backendUsed: 'appium',
          deviceId: 'SIM-1',
        },
        cases: [testCase('checkout-failure', 'failed'), testCase('checkout-pass', 'passed')],
        metrics: {},
        environment: {
          targetKind: 'simulator',
          representativeOfPhysicalDevice: false,
          comparisonScope: 'simulator_only',
        },
        artifactRefs: [],
        allArtifacts: [],
        collectionOutcomes: [],
        steps: [],
      },
    });
    const parent = await store.loadRunBundle(parentPlan.runId);
    const childPlan = createRerunPlan({
      parentPlan,
      parentResult: parent.result,
      mode: 'failed_only',
      runId: 'device-child',
    });
    const suggestedCases: string[] = [];
    let closedBackends = 0;
    await executeProductionTestPlan({
      plan: childPlan,
      parentResult: parent.result,
      workspace: '/workspace/Demo',
      device: {
        udid: 'SIM-1',
        platform: 'ios',
        name: 'Simulator',
        model: 'iPhone',
        osVersion: '18',
        targetKind: 'simulator',
        state: 'booted',
      },
      bundleId: 'com.example.Demo',
      store,
      storeRoot: root,
      authorize: async () => true,
      suggest: async ({ caseId }) => {
        suggestedCases.push(caseId);
        return 'done';
      },
      production: {
        analyzeWorkspace: async () => {
          throw new Error('project analysis is outside execution');
        },
        deviceDiscovery: {} as never,
        createDeviceBackend: () =>
          ({
            launchApp: async () => ({ success: true }),
            getUiTree: async () => ({
              raw: '<App><Button name="Checkout" /></App>',
              format: 'xml',
              capturedAt: '2026-09-03T00:00:00.000Z',
            }),
          }) as never,
        closeDeviceBackend: async () => {
          closedBackends += 1;
        },
      },
    });

    expect(suggestedCases).toEqual(['checkout-failure']);
    expect(closedBackends).toBe(1);
    const child = await store.loadRunBundle(childPlan.runId);
    expect(child.result.parentRunId).toBe(parentPlan.runId);
    expect(child.result.cases.map((item) => item.caseId)).toEqual(['checkout-failure']);
  });
});
