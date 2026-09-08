import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
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
import { createBaselineStore, createRunStore, createStoreCore, initStore } from 'itestagent-store';
import { analyzeMemoryGrowth } from '../../itestagent-backends/performance-xctrace-analyzer/src/memory-growth.js';
import { AssertionEvaluator } from '../src/assertion/assertion-evaluator.js';
import { BaselineManager } from '../src/baseline/baseline-manager.js';
import { persistConfirmedRun } from '../src/confirmed-run-bundle.js';
import type { ConfirmedExecutionDispatchResult } from '../src/dual-execution-dispatcher.js';
import type { RealDeviceRunResult } from '../src/exploration/real-run.js';
import { createProductionPhysicalPreflight } from '../src/production-physical-preflight.js';
import { executeProductionTestPlan } from '../src/production-run-executor.js';
import { createRerunPlan } from '../src/rerun.js';
import {
  extractExplicitUserAssertions,
  parseTestPlanYaml,
  testPlanToYaml,
} from '../src/test-plan-compiler.js';

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
  test.each([true, false, undefined])(
    'unquoted conditions require observations before a successful baseline (visible=%s)',
    async (visible) => {
      const { root, store } = await storage();
      const baselineStore = createBaselineStore(root);
      const confirmed = plan('unquoted-baseline');
      confirmed.device = { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } };
      confirmed.performance = {
        baseline: 'local_auto',
        baselineDomain: 'physical',
        thresholdRequired: false,
      };
      confirmed.execution.metrics = ['memory_peak'];
      confirmed.execution.assertions = extractExplicitUserAssertions(
        '确认 Workload complete 可见',
        caseId,
      );
      const reloaded = parseTestPlanYaml(testPlanToYaml(confirmed));
      const assertion = new AssertionEvaluator().evaluate({
        policy: reloaded.execution.assertion.policy,
        userAssertions: reloaded.execution.assertions,
        observations: {
          [caseId]: visible === undefined ? {} : { 'Workload complete_visible': visible },
        },
      });
      const result = { ...deviceResult(root, assertion.status), assertion };
      await persistConfirmedRun({
        store,
        baselineStore,
        plan: reloaded,
        device: { ...device, targetKind: 'physical' },
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: { status: 'completed', path: 'device_backend', fallbackHistory: [], result },
        performance: {
          artifacts: [],
          metrics: { memoryPeakMB: 10, memoryPeakUnit: 'MiB', approximate: true },
        },
      });
      const bundle = await store.loadRunBundle(confirmed.runId);
      expect(bundle.result.status).toBe(
        visible === true ? 'passed' : visible === false ? 'failed' : 'inconclusive',
      );
      expect(await baselineStore.list()).toHaveLength(visible === true ? 1 : 0);
    },
  );
  test('partial memory facts cannot override incomplete coverage or create a baseline', async () => {
    const { root, store } = await storage();
    const baselineStore = createBaselineStore(root);
    const confirmed = plan('memory-partial-window');
    confirmed.device = { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } };
    confirmed.performance = {
      baseline: 'local_auto',
      baselineDomain: 'physical',
      thresholdRequired: false,
    };
    confirmed.execution.metrics = ['memory_growth'];
    const growth = analyzeMemoryGrowth([
      { timestampMs: 0, footprintMiB: 10 },
      { timestampMs: 7000, footprintMiB: 12 },
    ]);
    if (!growth) throw new Error('Expected fixture growth');
    const committed = await persistConfirmedRun({
      store,
      baselineStore,
      plan: confirmed,
      device: { ...device, targetKind: 'physical' },
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'completed',
        path: 'device_backend',
        fallbackHistory: [],
        result: deviceResult(root, 'passed'),
      },
      performance: {
        artifacts: [],
        metrics: {
          memoryGrowth: { ...growth, coverage: 'partial', recordingDurationMs: 30000 },
          collection: [
            {
              metric: 'memory_growth',
              status: 'not_exportable',
              reasonCode: 'xctrace.memory_window_incomplete',
            },
          ],
        },
      },
    });
    expect(committed.runStatus).toBe('inconclusive');
    expect((await store.loadRunResult(confirmed.runId)).metrics.memoryGrowth?.samples).toHaveLength(
      2,
    );
    expect(await baselineStore.list()).toHaveLength(0);
    expect(await Bun.file(join(committed.runDir, 'summary.md')).text()).toContain(
      'Partial: samples do not span',
    );
  });
  test('positive leak diagnostics survive canonical reload and are visible in the report', async () => {
    const { root, store } = await storage();
    const confirmed = plan('positive-leak-diagnostics');
    confirmed.execution.metrics = ['memory_leaks'];
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'completed',
        path: 'device_backend',
        fallbackHistory: [],
        result: deviceResult(root, 'passed'),
      },
      performance: {
        artifacts: [],
        metrics: {
          memoryLeaks: {
            source: 'xctrace-leaks-detail',
            status: 'detected',
            scope: 'observed_allocations',
            allocationCount: 20,
            totalBytes: 5242880,
          },
        },
      },
    });
    const bundle = await store.loadRunBundle(confirmed.runId);
    expect(bundle.result.metrics.memoryLeaks?.allocationCount).toBe(20);
    expect(bundle.result.metrics.collection?.[0]?.status).toBe('collected');
    const summary = await Bun.file(join(committed.runDir, 'summary.md')).text();
    expect(summary).toContain('Detected: 20 allocations, 5242880 bytes');
    expect(summary).toContain('not all retain cycles');
  });

  test('growth facts reach the canonical report while missing leak evidence remains inconclusive', async () => {
    const { root, store } = await storage();
    const confirmed = plan('memory-growth-leaks');
    confirmed.execution.metrics = ['memory_growth', 'memory_leaks'];
    const growth = analyzeMemoryGrowth([
      { timestampMs: 0, footprintMiB: 10 },
      { timestampMs: 30000, footprintMiB: 12 },
    ]);
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'completed',
        path: 'device_backend',
        fallbackHistory: [],
        result: deviceResult(root, 'passed'),
      },
      performance: {
        artifacts: [],
        metrics: {
          memoryGrowth: growth,
          collection: [
            {
              metric: 'memory_leaks',
              status: 'not_exportable',
              reasonCode: 'xctrace.leaks_diagnostic_not_exportable',
            },
          ],
        },
      },
    });
    const bundle = await store.loadRunBundle(confirmed.runId);
    expect(bundle.result.metrics.memoryGrowth?.deltaMiB).toBe(2);
    expect(bundle.result.metrics.memoryGrowth?.samples).toHaveLength(2);
    expect(committed.runStatus).toBe('inconclusive');
    expect(bundle.result.cases[0]?.status).toBe('passed');
    const summary = await Bun.file(join(committed.runDir, 'summary.md')).text();
    expect(summary).toContain('Memory Growth (approximate)');
    expect(summary).toContain('No zero-leak conclusion');
  });

  test('committed physical memory runs establish then compare a baseline without overwriting it', async () => {
    const { root, store } = await storage();
    const baselineStore = createBaselineStore(root);
    const target: DeviceInfo = { ...device, targetKind: 'physical' };
    for (const [runId, peak] of [
      ['baseline-memory-first', 10],
      ['baseline-memory-second', 12],
    ] as const) {
      const confirmed = plan(runId);
      confirmed.device = { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } };
      confirmed.performance = {
        baseline: 'local_auto',
        baselineDomain: 'physical',
        thresholdRequired: false,
      };
      confirmed.execution.metrics = ['memory_peak'];
      if (runId === 'baseline-memory-first') {
        const hash = (value: unknown) =>
          createHash('sha256').update(JSON.stringify(value)).digest('hex');
        await new BaselineManager({ baselineStore }).establishBaseline(
          { memoryPeakMB: 999 },
          {
            projectId: hash(confirmed.projectProfileRef),
            targetKind: 'physical',
            deviceModel: hash({ udid: target.udid, model: target.model }),
            iosVersion: target.osVersion as string,
            scenario: hash({
              version: 'memory-observation-v1',
              execution: confirmed.execution,
              observation: confirmed.performance.memoryObservation,
              peakUnit: 'MiB',
              appSource: confirmed.appSource,
            }),
            runId: 'legacy-policy-baseline',
          },
        );
      }
      await persistConfirmedRun({
        store,
        baselineStore,
        plan: confirmed,
        device: target,
        resultBundlePath: join(root, 'missing.xcresult'),
        dispatch: {
          status: 'completed',
          path: 'device_backend',
          fallbackHistory: [],
          result: deviceResult(root, 'passed'),
        },
        performance: {
          artifacts: [],
          metrics: { memoryPeakMB: peak, memoryPeakUnit: 'MiB', approximate: true },
        },
      });
    }
    const records = await baselineStore.list();
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.updatedFromRun === 'baseline-memory-first')?.memoryPeakMB).toBe(
      10,
    );
    expect(records.find((r) => r.updatedFromRun === 'legacy-policy-baseline')?.memoryPeakMB).toBe(
      999,
    );
    const second = await store.loadRunResult('baseline-memory-second');
    expect(second.baselineDelta?.deltas.memoryPeakMB).toBe(2);
    expect(second.metrics.memoryPeakUnit).toBe('MiB');
    const summary = await Bun.file(
      join(root, 'runs', 'baseline-memory-second', 'summary.md'),
    ).text();
    expect(summary).toContain('12 MiB');
    expect(summary).toContain('+2MiB');
    expect(second.status).toBe('passed');
  });
  test('missing requested metrics make UI success inconclusive and appear in the report', async () => {
    const { root, store } = await storage();
    const confirmed = plan('missing-performance');
    confirmed.execution.metrics = ['memory_peak', 'crash'];
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'completed',
        path: 'device_backend',
        fallbackHistory: [],
        result: deviceResult(root, 'passed'),
      },
    });
    const bundle = await store.loadRunBundle(confirmed.runId);
    expect(committed.runStatus).toBe('inconclusive');
    expect(bundle.result.cases[0]?.status).toBe('passed');
    expect(bundle.result.metrics.crashDetected).toBeUndefined();
    expect(bundle.result.metrics.collection?.map((outcome) => outcome.status)).toEqual([
      'not_exportable',
      'not_exportable',
    ]);
    expect(await Bun.file(join(committed.runDir, 'summary.md')).text()).toContain(
      'Missing data is not evidence',
    );
  });

  test('verified performance facts survive canonical persistence', async () => {
    const { root, store } = await storage();
    const confirmed = plan('collected-performance');
    confirmed.execution.metrics = ['memory_peak'];
    const tracePath = join(root, 'fixture.trace');
    mkdirSync(tracePath);
    await Bun.write(join(tracePath, 'fixture.data'), 'synthetic trace evidence');
    const committed = await persistConfirmedRun({
      store,
      plan: confirmed,
      device,
      resultBundlePath: join(root, 'missing.xcresult'),
      dispatch: {
        status: 'completed',
        path: 'device_backend',
        fallbackHistory: [],
        result: deviceResult(root, 'passed'),
      },
      performance: {
        artifacts: [
          {
            id: 'fixture-trace',
            type: 'trace',
            path: tracePath,
            redactionStatus: 'raw-local-only',
            backend: 'xctrace',
          },
        ],
        metrics: { memoryPeakMB: 42, approximate: true },
      },
    });
    const bundle = await store.loadRunBundle(confirmed.runId);
    expect(committed.runStatus).toBe('passed');
    expect(bundle.result.metrics.memoryPeakMB).toBe(42);
    expect(bundle.result.metrics.collection?.[0]?.status).toBe('collected');
    const savedTrace = bundle.artifactIndex.artifacts.find(
      (artifact) => artifact.id === 'fixture-trace',
    );
    expect(savedTrace?.redactionStatus).toBe('raw-local-only');
    expect(savedTrace?.path.startsWith('artifacts/')).toBe(true);
  });
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
  for (const cancel of [false, true]) {
    test(`performance capture stops before cleanup and persistence (cancel=${cancel})`, async () => {
      const { root, store } = await storage();
      const confirmed = plan(`physical-performance-${cancel}`);
      confirmed.device = { kind: 'physical', physical: { selector: 'by_udid', udid: 'FIXTURE' } };
      confirmed.performance.baselineDomain = 'physical';
      confirmed.execution.metrics = ['memory_peak'];
      const target: DeviceInfo = { ...device, udid: 'FIXTURE', targetKind: 'physical' };
      const controller = new AbortController();
      const order: string[] = [];
      let suggestions = 0;
      const backend = {
        launchApp: async () => ({ success: true }),
        getUiTree: async () => ({
          raw: '<XCUIElementTypeApplication><XCUIElementTypeStaticText name="Ready" label="Ready" /></XCUIElementTypeApplication>',
          format: 'xml',
          capturedAt: timestamp,
        }),
      } as unknown as DeviceBackend;
      const result = await executeProductionTestPlan({
        plan: confirmed,
        device: target,
        workspace: root,
        bundleId: 'com.example.Demo',
        store,
        storeRoot: root,
        signal: controller.signal,
        authorize: async () => true,
        suggest: async () =>
          suggestions++ === 0 ? { action: 'wait', target: 'Ready', waitMs: 1 } : 'done',
        createPerformanceCapture: async (captureInput) => {
          expect(captureInput.signal).toBe(controller.signal);
          expect(captureInput.executable).toBe('Demo');
          expect(order).toEqual(['preflight']);
          order.push('recording');
          return {
            finish: async () => {
              order.push('finalized');
              if (cancel) controller.abort();
              return {
                artifacts: [],
                metrics: cancel ? {} : { memoryPeakMB: 12, approximate: true },
              };
            },
          };
        },
        production: {
          analyzeWorkspace: async () => {
            throw new Error('No replanning');
          },
          deviceDiscovery: {} as never,
          createDeviceBackend: () => backend,
          physicalPreflight: async () => {
            order.push('preflight');
            return {
              status: 'ready',
              stage: 'ready',
              artifact: {
                sourceKind: 'build',
                sourcePath: join(root, 'Demo.app'),
                appPath: join(root, 'Demo.app'),
                bundleId: 'com.example.Demo',
                executable: 'Demo',
                supportedPlatforms: ['iPhoneOS'],
                architectures: ['arm64'],
                signingValid: true,
              },
              wda: {
                route: 'route_b_wda_manager_managed',
                stage: 'ready',
                ready: true,
                targetDeviceUdid: target.udid,
                targetWdaBundleId: 'fixture.wda',
                waitedMs: 1,
              },
            };
          },
          closeDeviceBackend: async () => {
            order.push('closed');
            return { status: 'closed', reusable: true, issues: [] };
          },
        },
      });
      expect(order).toEqual(['preflight', 'recording', 'finalized', 'closed']);
      expect(result.runStatus).toBe(cancel ? 'cancelled' : 'passed');
      expect(existsSync(join(root, 'runs', confirmed.runId, 'staging'))).toBe(false);
      const bundle = await store.loadRunBundle(confirmed.runId);
      expect(bundle.result.metrics.collection?.[0]?.status).toBe(
        cancel ? 'cancelled' : 'collected',
      );
    });
  }
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
