import { afterEach, expect, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MemoryRoundsPlanSchema,
  MemoryRoundsResultSchema,
  type PerformanceCaptureFactory,
  type PerformanceMetrics,
  TestPlanSchema,
  parseValidatedRunBundle,
} from 'itestagent-contracts';
import { MockDeviceBackend } from 'itestagent-device-mock';
import { type FlowV2, inferRequiredCapabilities, saveFlow } from 'itestagent-flow';
import { memoryBaselineCandidate } from '../../../packages/itestagent-engine/src/baseline/production-memory-baseline.js';
import { persistConfirmedRun } from '../../../packages/itestagent-engine/src/confirmed-run-bundle.js';
import {
  loadReviewedMemoryFlow,
  prepareMemoryRounds,
  runMemoryRounds,
  validateMemoryRoundFlow,
  waitForMemoryRound,
} from '../../../packages/itestagent-engine/src/memory-rounds.js';
import { baselineFixture } from './helpers/baseline-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const config = {
  flowId: 'confirmed-workload',
  source: 'global' as const,
  sha256: 'a'.repeat(64),
  steps: ['tap', 'assertVisible'],
  count: 3,
  intervalMs: 0,
  processPolicy: 'same_process' as const,
};
const flow: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: config.flowId,
  source: 'user-authored',
  status: 'confirmed',
  supportedTargetKinds: ['physical'],
  requiredCapabilities: ['coordinateTap', 'uiTree'],
  lastValidatedTargets: [],
  steps: [
    {
      action: 'tap',
      target: 'Allocate workload',
      locator: { strategy: 'coordinate', value: '0.5,0.5' },
      safetyGate: 'allow',
    },
    { action: 'assertVisible', locator: { strategy: 'label', value: 'Ready' } },
  ],
};
const tree = {
  format: 'xml' as const,
  raw: '<XCUIElementTypeApplication><XCUIElementTypeStaticText name="Ready" label="Ready" visible="true" x="10" y="10" width="100" height="40" /></XCUIElementTypeApplication>',
  capturedAt: new Date().toISOString(),
};
const device = {
  udid: 'FIXTURE',
  name: 'Fixture phone',
  model: 'Fixture',
  osVersion: '26.0',
  platform: 'ios' as const,
  targetKind: 'physical' as const,
};
function measured(round: number): PerformanceMetrics {
  return {
    approximate: true,
    memoryPeakMB: 20 + round,
    memoryPeakUnit: 'MiB',
    memoryGrowth: {
      source: 'activity-monitor-process-live',
      approximate: true,
      scope: 'observed_interval',
      coverage: 'complete',
      samples: [
        { timestampMs: 0, footprintMiB: 10 + round },
        { timestampMs: 1000, footprintMiB: 20 + round },
      ],
      sampleCount: 2,
      startMiB: 10 + round,
      endMiB: 20 + round,
      peakMiB: 20 + round,
      deltaMiB: 10,
      durationMs: 1000,
      rateMiBPerMinute: 600,
      direction: 'increased',
    },
    collection: ['memory_peak', 'memory_growth'].map((metric) => ({
      metric: metric as 'memory_peak' | 'memory_growth',
      status: 'collected',
      reasonCode: 'fixture.collected',
    })),
  };
}
async function setup() {
  const fixture = await baselineFixture();
  cleanups.push(fixture.cleanup);
  const plan = TestPlanSchema.parse({
    ...fixture.plan,
    runId: `run-rounds-${crypto.randomUUID()}`,
    performance: { ...fixture.plan.performance, memoryRounds: config },
  });
  let taps = 0;
  let captures = 0;
  let finishes = 0;
  const resources: string[] = [];
  const events: string[] = [];
  const backend = Object.assign(new MockDeviceBackend({ uiTree: tree }), {
    getAppProcessId: async () => 42,
  });
  backend.tap = async () => {
    taps++;
    events.push('tap');
    return { success: true };
  };
  const capture: PerformanceCaptureFactory = async (input) => {
    captures++;
    events.push('capture');
    expect(input.executable).toBe('42');
    const n = captures;
    return {
      finish: async () => {
        finishes++;
        events.push('finish');
        return { metrics: measured(n), artifacts: [] };
      },
    };
  };
  const input = {
    plan,
    flow: structuredClone(flow),
    backend,
    deviceId: 'FIXTURE',
    bundleId: 'com.example.fixture',
    stagingDir: join(fixture.root, 'staging'),
    capture,
    authorize: async (action: string, resource: string) => {
      expect(action).toBe('interact_sensitive_ui');
      resources.push(resource);
      return true;
    },
    progress: (_: string) => {},
  };
  return {
    ...fixture,
    input,
    resources,
    events,
    counts: () => ({ taps, captures, finishes }),
    persist: async (output: Awaited<ReturnType<typeof runMemoryRounds>>) => {
      await persistConfirmedRun({
        store: fixture.store,
        baselineStore: fixture.baselineStore,
        plan,
        device,
        resultBundlePath: join(fixture.root, 'unused.xcresult'),
        dispatch: {
          status: 'completed',
          path: 'device_backend',
          fallbackHistory: [],
          result: output.result,
        },
        performance: output.performance,
      });
      return fixture.store.loadRunBundle(plan.runId);
    },
  };
}

test('round configuration is explicit, bounded and physical DeviceBackend only', async () => {
  expect(MemoryRoundsPlanSchema.parse(config).count).toBe(3);
  for (const count of [0, 1, 11, 2.5])
    expect(MemoryRoundsPlanSchema.safeParse({ ...config, count }).success).toBe(false);
  expect(MemoryRoundsPlanSchema.safeParse({ ...config, intervalMs: 60001 }).success).toBe(false);
  const s = await setup();
  expect(
    TestPlanSchema.safeParse({
      ...s.input.plan,
      execution: { ...s.input.plan.execution, resolvedPath: 'xcuitest' },
    }).success,
  ).toBe(false);
  expect(
    TestPlanSchema.safeParse({
      ...s.input.plan,
      performance: { ...s.input.plan.performance, memoryObservation: undefined },
    }).success,
  ).toBe(false);
});

test('review pins semantic content and source; drafts and lifecycle workloads are rejected', async () => {
  const s = await setup();
  await saveFlow(flow, { dataRoot: s.root, saveConfirmed: true });
  const reviewed = await prepareMemoryRounds(flow.flowId, 3, 1000, s.root, s.root);
  expect(reviewed.steps[0]).toContain('Allocate workload');
  expect((await loadReviewedMemoryFlow(reviewed, s.root, s.root)).steps).toEqual(flow.steps);
  await saveFlow(
    { ...flow, notes: 'Changed after review' },
    { dataRoot: s.root, saveConfirmed: true, overwriteConfirmed: true },
  );
  await expect(loadReviewedMemoryFlow(reviewed, s.root, s.root)).rejects.toThrow('flow_changed');
  expect(() => validateMemoryRoundFlow({ ...flow, status: 'draft' })).toThrow('ineligible');
  expect(() =>
    validateMemoryRoundFlow({ ...flow, steps: [...flow.steps, { action: 'launchApp' }] }),
  ).toThrow('unsupported');
});

test('three actual replays have separate capture, fresh permissions, persisted references and isolated baseline', async () => {
  const s = await setup();
  const output = await runMemoryRounds(s.input);
  expect(s.counts()).toEqual({ taps: 3, captures: 3, finishes: 3 });
  expect(s.events).toEqual([
    'capture',
    'tap',
    'finish',
    'capture',
    'tap',
    'finish',
    'capture',
    'tap',
    'finish',
  ]);
  expect(new Set(s.resources).size).toBe(3);
  expect(output.performance.metrics.memoryGrowth).toBeUndefined();
  expect(output.performance.metrics.memoryRounds?.endpointDeltaMiB).toBe(2);
  expect(output.performance.metrics.memoryPeakMB).toBe(23);
  const bundle = await s.persist(output);
  expect(bundle.result.status).toBe('passed');
  expect(bundle.steps.steps).toHaveLength(9);
  expect(bundle.result.cases).toHaveLength(6);
  expect(bundle.result.metrics.memoryRounds?.rounds.map((r) => r.stepIds.length)).toEqual([
    3, 3, 3,
  ]);
  expect((await s.baselineStore.list()).length).toBe(2);
  const report = await readFile(join(s.root, 'runs', s.input.plan.runId, 'summary.md'), 'utf8');
  expect(report).toContain('Round Endpoint Change');
  expect(report).toContain('never summed');
  const broken = structuredClone(bundle);
  const row = broken.result.metrics.memoryRounds?.rounds[1];
  const firstStep = bundle.steps.steps[0];
  if (!row || !firstStep) throw new Error('Missing fixture round');
  row.stepIds[0] = firstStep.stepId;
  expect(() => parseValidatedRunBundle(broken)).toThrow('owning round');
  const missingPlan = structuredClone(bundle);
  if (missingPlan.plan.schemaVersion === 'itestagent.test-plan.v3')
    missingPlan.plan.performance.memoryRounds = undefined;
  expect(() => parseValidatedRunBundle(missingPlan)).toThrow('configuration');
});

test('denial stops before action and does not invent steps or cases for later rounds', async () => {
  const s = await setup();
  s.input.authorize = async () => false;
  const output = await runMemoryRounds(s.input);
  expect(s.counts()).toEqual({ taps: 0, captures: 1, finishes: 1 });
  expect(output.result.steps).toHaveLength(0);
  expect(output.result.assertion.cases).toHaveLength(0);
  expect(output.performance.metrics.memoryRounds?.rounds.map((r) => r.status)).toEqual([
    'blocked',
    'not_started',
    'not_started',
  ]);
  expect((await s.persist(output)).result.status).toBe('blocked');
});

test('failed Flow assertion stops later rounds while preserving the attempted steps', async () => {
  const s = await setup();
  s.input.backend.setConfig({ uiTree: { ...tree, raw: '<XCUIElementTypeApplication />' } });
  const output = await runMemoryRounds(s.input);
  expect(s.counts()).toEqual({ taps: 1, captures: 1, finishes: 1 });
  expect((await s.persist(output)).result.status).toBe('failed');
  expect(output.result.steps).toHaveLength(2);
});

test('process change during capture stops actions and closes only the active recording', async () => {
  const s = await setup();
  let checks = 0;
  s.input.backend.getAppProcessId = async () => (++checks >= 3 ? 43 : 42);
  const output = await runMemoryRounds(s.input);
  expect(s.counts()).toEqual({ taps: 0, captures: 1, finishes: 1 });
  expect((await s.persist(output)).result.status).toBe('blocked');
});

test('short coverage cannot continue rounds or become baseline eligible', async () => {
  const s = await setup();
  const original = s.input.capture;
  s.input.capture = async (input) => {
    const c = await original(input);
    return {
      finish: async () => {
        const result = await c.finish();
        if (!result.metrics.memoryGrowth) throw new Error('Missing fixture growth');
        result.metrics.memoryGrowth.coverage = 'partial';
        return result;
      },
    };
  };
  const output = await runMemoryRounds(s.input);
  expect(s.counts().captures).toBe(1);
  const bundle = await s.persist(output);
  expect(bundle.result.status).toBe('inconclusive');
  expect(
    memoryBaselineCandidate({
      plan: s.input.plan,
      device,
      metrics: bundle.result.metrics,
      status: 'passed',
    }),
  ).toBeUndefined();
});

test('cancellation during unsampled gap does not invent a started next round', async () => {
  const s = await setup();
  const controller = new AbortController();
  const output = await runMemoryRounds({
    ...s.input,
    signal: controller.signal,
    progress: (message) => {
      if (message.includes('not sampled')) controller.abort();
    },
  });
  expect(s.counts().captures).toBe(1);
  expect(output.performance.metrics.memoryRounds?.status).toBe('cancelled');
  expect(output.performance.metrics.memoryRounds?.rounds[1]?.startedAt).toBeUndefined();
  expect((await s.persist(output)).result.status).toBe('cancelled');
});

test('Flow wait cancellation is prompt, closes capture, and records only attempted steps', async () => {
  const s = await setup();
  const controller = new AbortController();
  s.input.flow.steps.splice(1, 0, { action: 'wait', durationMs: 60_000 });
  s.input.flow.requiredCapabilities = inferRequiredCapabilities(s.input.flow.steps);
  s.input.backend.tap = async () => {
    setTimeout(() => controller.abort(), 10);
    return { success: true };
  };
  const start = Date.now();
  const output = await runMemoryRounds({ ...s.input, signal: controller.signal });
  expect(Date.now() - start).toBeLessThan(1000);
  expect(s.counts().finishes).toBe(1);
  expect(output.result.steps.map((s) => s.action)).toEqual(['tap', 'wait']);
  expect((await s.persist(output)).result.status).toBe('cancelled');
});

test('round schema rejects fabricated not-started facts and incomplete successful rows', () => {
  const rounds = [1, 2].map((round) => ({
    round,
    status: 'not_started',
    reasonCode: 'memory_rounds.not_started',
    stepIds: [],
    artifactIds: [],
  }));
  const result = { policy: 'memory-rounds-v1', status: 'cancelled', plannedCount: 2, rounds };
  expect(MemoryRoundsResultSchema.safeParse(result).success).toBe(true);
  expect(
    MemoryRoundsResultSchema.safeParse({
      ...result,
      rounds: [{ ...rounds[0], stepIds: ['fake'] }, rounds[1]],
    }).success,
  ).toBe(false);
  expect(MemoryRoundsResultSchema.safeParse({ ...result, status: 'passed' }).success).toBe(false);
  const signal = AbortSignal.abort();
  expect(() => waitForMemoryRound(60_000, signal)).toThrow();
});

test('production executor uses one preflight/backend lifecycle and no exploration suggestion', async () => {
  const { executeProductionTestPlan } = await import(
    '../../../packages/itestagent-engine/src/production-run-executor.js'
  );
  const s = await setup();
  await saveFlow(flow, { dataRoot: s.root, saveConfirmed: true });
  s.input.plan.performance.memoryRounds = await prepareMemoryRounds(
    flow.flowId,
    3,
    0,
    s.root,
    s.root,
  );
  let preflights = 0;
  let closed = 0;
  const dispatch = await executeProductionTestPlan({
    plan: s.input.plan,
    workspace: s.root,
    device,
    bundleId: s.input.bundleId,
    store: s.store,
    storeRoot: s.root,
    createPerformanceCapture: s.input.capture,
    authorize: async () => true,
    suggest: async () => {
      throw new Error('Exploration must not run');
    },
    production: {
      analyzeWorkspace: async () => {
        throw new Error('Profile already confirmed');
      },
      deviceDiscovery: {
        discover: async () => {
          throw new Error('Device already selected');
        },
      },
      createDeviceBackend: () => s.input.backend,
      closeDeviceBackend: async () => {
        closed++;
        return { status: 'closed', reusable: true, issues: [] };
      },
      physicalPreflight: async () => {
        preflights++;
        return {
          status: 'ready',
          stage: 'ready',
          artifact: {
            sourceKind: 'build',
            sourcePath: s.root,
            appPath: s.root,
            bundleId: s.input.bundleId,
            executable: 'Fixture',
            supportedPlatforms: ['iPhoneOS'],
            architectures: ['arm64'],
            signingValid: true,
          },
          wda: {
            route: 'route_b_wda_manager_managed',
            stage: 'ready',
            ready: true,
            targetDeviceUdid: device.udid,
            targetWdaBundleId: 'fixture.wda',
            waitedMs: 0,
          },
        };
      },
    },
  });
  expect(dispatch.runStatus).toBe('passed');
  expect(preflights).toBe(1);
  expect(closed).toBe(1);
  expect(s.counts()).toEqual({ taps: 3, captures: 3, finishes: 3 });
});

test('checkpoint UI evidence is local, per-round and linked through canonical persistence', async () => {
  const s = await setup();
  s.input.plan.artifacts.collect = ['uitree'];
  const output = await runMemoryRounds(s.input);
  const bundle = await s.persist(output);
  expect(bundle.artifactIndex.artifacts).toHaveLength(3);
  expect(bundle.artifactIndex.artifacts.every((a) => a.redactionStatus === 'raw-local-only')).toBe(
    true,
  );
  expect(bundle.result.metrics.memoryRounds?.rounds.every((r) => r.artifactIds.length === 1)).toBe(
    true,
  );
});

test('round deadline cancels a pending action permission and finalizes capture before returning', async () => {
  const s = await setup();
  const timer = globalThis.setTimeout;
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => timer(callback, ms === 540_000 ? 1 : ms, ...args)) as typeof setTimeout);
  let cancelled = false;
  try {
    const output = await runMemoryRounds({
      ...s.input,
      authorize: async (_action, _resource, signal) => {
        if (!signal) throw new Error('Missing execution signal');
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(new Error('Permission cancelled'));
            },
            { once: true },
          ),
        );
        return true;
      },
    });
    expect(cancelled).toBe(true);
    expect(s.counts()).toEqual({ taps: 0, captures: 1, finishes: 1 });
    expect(output.performance.metrics.memoryRounds?.status).toBe('cancelled');
  } finally {
    timeout.mockRestore();
  }
});

for (const when of ['before_actions', 'during_wait', 'start_error'] as const) {
  test(`capture failure stops confirmed rounds without becoming user cancellation: ${when}`, async () => {
    const s = await setup();
    const captureController = new AbortController();
    let starts = 0;
    const failure = {
      metrics: {
        collection: [
          {
            metric: 'memory_growth' as const,
            status: 'failed' as const,
            reasonCode: 'performance.recording_incomplete',
          },
        ],
      },
      artifacts: [],
    };
    s.input.capture = async () => {
      starts++;
      if (when === 'start_error') {
        const { PerformanceCaptureStartError } = await import('itestagent-contracts');
        throw new PerformanceCaptureStartError(failure);
      }
      if (when === 'before_actions') captureController.abort();
      return { signal: captureController.signal, finish: async () => failure };
    };
    if (when === 'during_wait') {
      s.input.flow.steps.splice(1, 0, { action: 'wait', durationMs: 60_000 });
      const tap = s.input.backend.tap;
      s.input.backend.tap = async (...args) => {
        const result = await tap(...args);
        setTimeout(() => captureController.abort(), 15);
        return result;
      };
    }
    const output = await runMemoryRounds(s.input);
    expect(starts).toBe(1);
    expect(s.counts().taps).toBe(when === 'during_wait' ? 1 : 0);
    expect(output.performance.metrics.memoryRounds?.status).toBe('blocked');
    expect(output.performance.metrics.memoryRounds?.rounds.map((r) => r.status)).toEqual([
      'blocked',
      'not_started',
      'not_started',
    ]);
    expect(output.performance.metrics.collection?.[0]?.status).toBe('failed');
    const bundle = await s.persist(output);
    expect(bundle.result.status).not.toBe('passed');
    expect(bundle.result.status).not.toBe('cancelled');
    expect(bundle.result.baselineDelta).toBeUndefined();
  });
}
