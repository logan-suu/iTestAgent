import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AssertionEvaluateOutput,
  DeviceBackend,
  DeviceInfo,
  TestPlan,
} from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import { createRunStore, createStoreCore, initStore } from 'itestagent-store';
import { persistConfirmedRun } from '../src/confirmed-run-bundle.js';
import type { ConfirmedExecutionDispatchResult } from '../src/dual-execution-dispatcher.js';
import type { RealDeviceRunResult } from '../src/exploration/real-run.js';
import { createProductionPhysicalPreflight } from '../src/production-physical-preflight.js';
import { executeProductionTestPlan } from '../src/production-run-executor.js';
import { createRerunPlan } from '../src/rerun.js';

const roots: string[] = [];
const databases: Array<ReturnType<typeof createStoreCore>['sqlite']> = [];
const caseId = 'DemoUITests/ValidationTests/testVisible';
const timestamp = '2026-09-07T00:00:00.000Z';
const device: DeviceInfo = {
  udid: 'FIXTURE-COMMITTED-STATUS',
  name: 'Fixture Simulator',
  model: 'iPhone',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'simulator',
  state: 'booted',
};

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function storage() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-committed-status-'));
  roots.push(root);
  initStore(root);
  const core = createStoreCore(join(root, 'db', 'itestagent.db'));
  databases.push(core.sqlite);
  await core.driver.migrate();
  return { root, store: createRunStore(core.db, root) };
}

function plan(runId: string, path: 'device_backend' | 'xcuitest' = 'device_backend'): TestPlan {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId,
    projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
    target: { type: 'current_workspace' },
    device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: device.udid } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: path,
      fallback: 'abort',
      resolvedPath: path,
      selectionReason: 'explicit_preference',
      features: [caseId],
      goal: 'Confirm that Ready is visible.',
      assertions: [
        {
          id: 'ready-visible',
          caseId,
          source: 'user',
          conditions: [{ type: 'element_visible', target: 'Ready', description: 'Ready visible' }],
        },
      ],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      ...(path === 'xcuitest' ? { xcuitest: { scheme: 'Demo', targets: ['DemoUITests'] } } : {}),
    },
    artifacts: {
      collect: [],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: 'simulator', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

function deviceResult(
  root: string,
  status: AssertionEvaluateOutput['status'],
): RealDeviceRunResult {
  return {
    runDir: root,
    steps: [],
    assertion: {
      status,
      cases: [{ caseId, status, resolvedBy: 'user' }],
      summary: `Fixture assertion: ${status}`,
    },
    artifacts: [],
    artifactIndexPath: null,
    artifactCount: 0,
  };
}

function xcuitestDispatch(status: 'passed' | 'failed'): ConfirmedExecutionDispatchResult {
  return {
    status: status === 'passed' ? 'completed' : 'failed',
    path: 'xcuitest',
    fallbackHistory: [],
    result: {
      exitCode: status === 'passed' ? 0 : 65,
      durationMs: 1,
      parsed: {
        cases: [{ caseId, name: caseId, status, steps: [], durationMs: 1, artifacts: [] }],
        execution: {
          startTime: timestamp,
          endTime: timestamp,
          totalTests: 1,
          passed: status === 'passed' ? 1 : 0,
          failed: status === 'failed' ? 1 : 0,
          skipped: 0,
          targetNames: ['DemoUITests'],
        },
        metrics: {},
        attachments: [],
      },
    },
  };
}

describe('committed canonical run status', () => {
  for (const assertionStatus of [
    'passed',
    'failed',
    'explored',
    'inconclusive',
    'needs_assertion',
  ] as const) {
    test(`returns ${assertionStatus} despite completed DeviceBackend dispatch`, async () => {
      const { root, store } = await storage();
      const confirmed = plan(`device-${assertionStatus}`);
      const committed = await persistConfirmedRun({
        store,
        plan: confirmed,
        device,
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: {
          status: 'completed',
          path: 'device_backend',
          fallbackHistory: [],
          result: deviceResult(root, assertionStatus),
        },
      });
      expect(committed.runStatus).toBe(assertionStatus);
      expect(committed.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
      expect(existsSync(join(committed.runDir, 'result.json'))).toBe(true);
    });
  }

  for (const dispatchStatus of ['failed', 'cancelled', 'completed'] as const) {
    test(`does not return passed after ${dispatchStatus} with failed cleanup`, async () => {
      const { root, store } = await storage();
      const confirmed = plan(`cleanup-${dispatchStatus}`);
      const committed = await persistConfirmedRun({
        store,
        plan: confirmed,
        device,
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: {
          status: dispatchStatus,
          path: 'device_backend',
          fallbackHistory: [],
          result: deviceResult(root, 'passed'),
          cleanupOutcome: { status: 'failed', reusable: false, issues: ['Fixture cleanup failed'] },
        },
      });
      expect(committed.runStatus).toBe(
        dispatchStatus === 'cancelled' ? 'cancelled' : 'infra_failed',
      );
      expect(committed.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
    });
  }

  for (const status of ['passed', 'failed'] as const) {
    test(`returns XCUITest canonical ${status}`, async () => {
      const { root, store } = await storage();
      const confirmed = plan(`xcuitest-${status}`, 'xcuitest');
      const committed = await persistConfirmedRun({
        store,
        plan: confirmed,
        device,
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: xcuitestDispatch(status),
      });
      expect(committed.runStatus).toBe(status);
      expect(committed.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
    });
  }

  test('returns cancelled for XCUITest even when its parsed cases passed', async () => {
    const { root, store } = await storage();
    const confirmed = plan('xcuitest-cancelled', 'xcuitest');
    const dispatch = xcuitestDispatch('passed');
    if (dispatch.status === 'blocked') throw new Error('Expected an executed XCUITest fixture');
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: { ...dispatch, status: 'cancelled' },
    });
    expect(committed.runStatus).toBe('cancelled');
    expect(committed.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
  });

  test('returns infra_failed for XCUITest without a parsed result', async () => {
    const { root, store } = await storage();
    const confirmed = plan('xcuitest-infra-failed', 'xcuitest');
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'failed',
        path: 'xcuitest',
        fallbackHistory: [],
        result: { exitCode: 65, durationMs: 1, parsed: null },
      },
    });
    expect(committed.runStatus).toBe('infra_failed');
    expect(committed.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
  });

  test('returns flaky after rerun adjustment instead of the passed child assertion', async () => {
    const { root, store } = await storage();
    const parentPlan = plan('flaky-parent', 'xcuitest');
    await persistConfirmedRun({
      store,
      plan: parentPlan,
      device,
      dispatch: xcuitestDispatch('failed'),
      resultBundlePath: join(root, 'parent-missing.xcresult'),
    });
    const parentResult = await store.loadRunResult(parentPlan.runId);
    const childPlan = createRerunPlan({
      parentPlan,
      parentResult,
      mode: 'failed_only',
      runId: 'flaky-child',
    });
    const committed = await persistConfirmedRun({
      store,
      plan: childPlan,
      parentResult,
      device,
      dispatch: xcuitestDispatch('passed'),
      resultBundlePath: join(root, 'child-missing.xcresult'),
    });
    const bundle = await store.loadRunBundle(childPlan.runId);
    expect(committed.runStatus).toBe('flaky');
    expect(committed.runStatus).toBe(bundle.result.status);
    expect(bundle.result.cases[0]?.status).toBe('flaky');
  });

  test('does not return a committed status when saving the report rejects', async () => {
    const { root, store } = await storage();
    const confirmed = plan('failed-save');
    const error = new Error('Fixture storage unavailable');
    await expect(
      persistConfirmedRun({
        store: {
          ...store,
          beginRun: async (input) => {
            const writer = await store.beginRun(input);
            writer.commit = async () => {
              throw error;
            };
            return writer;
          },
        },
        plan: confirmed,
        device,
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: {
          status: 'completed',
          path: 'device_backend',
          fallbackHistory: [],
          result: deviceResult(root, 'passed'),
        },
      }),
    ).rejects.toBe(error);
    expect(existsSync(join(store.getRunDir(confirmed.runId), 'result.json'))).toBe(false);
  });
});

describe('production executor committed status propagation', () => {
  test('commits cancelled and closes the backend when AUT preparation is aborted', async () => {
    const { root, store } = await storage();
    const confirmed = plan('preparation-cancelled');
    confirmed.device = { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } };
    confirmed.performance.baselineDomain = 'physical';
    const controller = new AbortController();
    let closes = 0;
    let deviceSideEffects = 0;
    const backend = {} as DeviceBackend;
    const result = await executeProductionTestPlan({
      plan: confirmed,
      device: { ...device, targetKind: 'physical' },
      workspace: root,
      bundleId: 'com.example.Demo',
      scheme: 'Demo',
      store,
      storeRoot: root,
      signal: controller.signal,
      suggest: async () => {
        throw new Error('No model request after cancellation');
      },
      authorize: async () => true,
      production: {
        analyzeWorkspace: async () => {
          throw new Error('No replanning during execution');
        },
        deviceDiscovery: {} as never,
        createDeviceBackend: () => backend,
        closeDeviceBackend: async () => {
          closes++;
          return { status: 'closed', reusable: false, issues: [] };
        },
        physicalPreflight: createProductionPhysicalPreflight({
          findProjectFile: () => ({ type: 'xcode_project', path: join(root, 'Demo.xcodeproj') }),
          resolveAppSource: () => ({
            kind: 'build_required',
            workspacePath: root,
            projectType: 'xcodeproj',
          }),
          runCommand: async (_cmd, _args, options) => {
            expect(options?.signal).toBe(controller.signal);
            controller.abort();
            return { exitCode: 143, stdout: '', stderr: '' };
          },
          createDevicectlOps: () => {
            deviceSideEffects++;
            throw new Error('No device side effects');
          },
        }),
      },
    });
    expect(result.status).toBe('cancelled');
    expect(result.runStatus).toBe('cancelled');
    expect((await store.loadRunBundle(confirmed.runId)).result.status).toBe('cancelled');
    expect(closes).toBe(1);
    expect(deviceSideEffects).toBe(0);
  });
  test('rejects blank goals at execution entry before permissions or side effects', async () => {
    const { root, store } = await storage();
    for (const goal of [undefined, '', ' \t\n']) {
      const confirmed = plan('blank-goal');
      confirmed.execution.goal = goal;
      let authorizationRequested = false;
      await expect(
        executeProductionTestPlan({
          plan: confirmed,
          device,
          workspace: root,
          bundleId: 'com.example.Demo',
          store,
          storeRoot: root,
          suggest: async () => {
            throw new Error('Unexpected model request');
          },
          authorize: async () => {
            authorizationRequested = true;
            return true;
          },
        }),
      ).rejects.toThrow('execution_goal_missing');
      expect(authorizationRequested).toBe(false);
      expect(existsSync(join(root, 'runs', confirmed.runId))).toBe(false);
    }
  });
  test('forwards blocked status from the early permission-denied commit', async () => {
    const { root, store } = await storage();
    const confirmed = plan('permission-blocked', 'xcuitest');
    const result = await executeProductionTestPlan({
      plan: confirmed,
      device,
      workspace: root,
      bundleId: 'com.example.Demo',
      store,
      storeRoot: root,
      suggest: async () => {
        throw new Error('Blocked execution must not request a model action');
      },
      authorize: async () => false,
    });
    expect(result.status).toBe('blocked');
    expect(result.runStatus).toBe('blocked');
    expect(result.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
  });

  for (const visible of [true, false]) {
    test(`forwards ${visible ? 'passed' : 'failed'} assertions independently of completed dispatch`, async () => {
      const { root, store } = await storage();
      const confirmed = plan(`executed-${visible ? 'passed' : 'failed'}`);
      let suggestions = 0;
      const backend = {
        launchApp: async () => ({ success: true }),
        getUiTree: async () => ({
          raw: visible
            ? '<XCUIElementTypeApplication><XCUIElementTypeStaticText name="Ready" label="Ready" /></XCUIElementTypeApplication>'
            : '<XCUIElementTypeApplication />',
          format: 'xml',
          capturedAt: timestamp,
        }),
        screenshot: async () => {
          throw new Error('No screenshot action is requested');
        },
      } as unknown as DeviceBackend;
      const result = await executeProductionTestPlan({
        plan: confirmed,
        device,
        workspace: root,
        bundleId: 'com.example.Demo',
        store,
        storeRoot: root,
        suggest: async () =>
          suggestions++ === 0 ? { action: 'wait', target: 'Ready', waitMs: 1 } : 'done',
        authorize: async () => true,
        production: {
          analyzeWorkspace: async () => {
            throw new Error('Execution must not replan');
          },
          deviceDiscovery: {} as never,
          createDeviceBackend: () => backend,
          closeDeviceBackend: async () => ({ status: 'closed', reusable: true, issues: [] }),
        },
      });
      expect(result.status).toBe('completed');
      expect(result.runStatus).toBe(visible ? 'passed' : 'failed');
      expect(result.runStatus).toBe((await store.loadRunBundle(confirmed.runId)).result.status);
    });
  }
});
