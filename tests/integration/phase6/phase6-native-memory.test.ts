import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DeviceBackend,
  MemoryGrowthSchema,
  type PerformanceCaptureFactory,
  PerformanceCaptureStartError,
  type RunResult,
  RunResultSchema,
  TestPlanSchema,
  parseValidatedRunBundle,
} from 'itestagent-contracts';
import { memoryRoundsMetricIssues } from '../../../packages/itestagent-contracts/src/memory-rounds-validation.js';
import { memoryBaselineCandidate } from '../../../packages/itestagent-engine/src/baseline/production-memory-baseline.js';
import { executeProductionTestPlan } from '../../../packages/itestagent-engine/src/production-run-executor.js';
import { baselineFixture } from './helpers/baseline-fixture.js';

const physicalDevice = {
  udid: 'FIXTURE',
  name: 'Fixture',
  model: 'Fixture',
  osVersion: '26.0',
  platform: 'ios' as const,
  targetKind: 'physical' as const,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const s = await baselineFixture();
  cleanups.push(s.cleanup);
  const device = { ...physicalDevice, targetKind: 'simulator' as const, state: 'booted' as const };
  const plan = TestPlanSchema.parse({
    ...s.plan,
    runId: `native-${crypto.randomUUID()}`,
    device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: device.udid } },
    performance: { ...s.plan.performance, baseline: 'skip', baselineDomain: 'simulator' },
    execution: { ...s.plan.execution, metrics: ['memory_leaks'] },
  });
  return { ...s, device, plan };
}
for (const mode of ['zero', 'not_ready', 'mid_failure'] as const)
  test(`Simulator native production execution: ${mode}`, async () => {
    const s = await setup();
    let suggested = 0;
    let closed = 0;
    let launched = 0;
    const abort = new AbortController();
    const backend = {
      launchApp: async () => {
        launched++;
        return { success: true };
      },
      getAppProcessId: async () => 321,
      getUiTree: async () => ({
        raw: '<XCUIElementTypeApplication><XCUIElementTypeStaticText name="Ready" label="Ready" /></XCUIElementTypeApplication>',
        format: 'xml',
        capturedAt: new Date().toISOString(),
      }),
    } as unknown as DeviceBackend;
    const factory: PerformanceCaptureFactory = async (input) => {
      expect(input.targetKind).toBe('simulator');
      expect(input.bundleId).toBe('com.example.fixture');
      expect(input.executable).toBe('321');
      expect(launched).toBe(1);
      const path = join(input.stagingDir, 'native-audit.jsonl');
      mkdirSync(input.stagingDir, { recursive: true });
      writeFileSync(path, '{"fixture":"raw audit"}\n');
      const artifacts = [
        {
          id: 'native-audit',
          type: 'log' as const,
          path,
          backend: 'native-memory',
          redactionStatus: 'raw-local-only' as const,
        },
      ];
      const failed = {
        artifacts,
        metrics: {
          collection: [
            {
              metric: 'memory_leaks' as const,
              status: 'failed' as const,
              reasonCode: 'native_memory.fixture_failure',
            },
          ],
        },
      };
      if (mode === 'not_ready') throw new PerformanceCaptureStartError(failed);
      return {
        signal: abort.signal,
        finish: async () =>
          mode === 'mid_failure'
            ? failed
            : {
                artifacts,
                metrics: {
                  memoryLeaks: {
                    source: 'native-leaks',
                    scope: 'scan_snapshot',
                    status: 'not_detected',
                    allocationCount: 0,
                    totalBytes: 0,
                    startedAt: '2026-09-09T00:00:00Z',
                    finishedAt: '2026-09-09T00:00:01Z',
                    exitCode: 0,
                    completionVerified: true,
                    targetBound: true,
                    artifactId: 'native-audit',
                  },
                  collection: [
                    {
                      metric: 'memory_leaks',
                      status: 'collected',
                      reasonCode: 'native_memory.observed_value',
                    },
                  ],
                },
              },
      };
    };
    const result = await executeProductionTestPlan({
      plan: s.plan,
      device: s.device,
      workspace: s.root,
      bundleId: 'com.example.fixture',
      store: s.store,
      storeRoot: s.root,
      authorize: async () => true,
      createPerformanceCapture: factory,
      suggest: async ({ signal }) => {
        suggested++;
        expect(signal).not.toBeUndefined();
        if (mode === 'mid_failure') {
          abort.abort();
          signal?.throwIfAborted();
        }
        return suggested === 1 ? { action: 'wait', target: 'Ready', waitMs: 1 } : 'done';
      },
      production: {
        analyzeWorkspace: async () => {
          throw new Error('No replanning');
        },
        deviceDiscovery: {} as never,
        createDeviceBackend: () => backend,
        closeDeviceBackend: async () => {
          closed++;
          return { status: 'closed', reusable: true, issues: [] };
        },
      },
    });
    const read = (name: string) => JSON.parse(readFileSync(join(result.runDir, name), 'utf8'));
    const document = read('result.json') as RunResult;
    expect(closed).toBe(1);
    expect(document.metrics.memoryLeaks?.status).toBe(mode === 'zero' ? 'not_detected' : undefined);
    expect(document.environment.comparisonScope).toBe('simulator_only');
    expect(document.baselineDelta).toBeUndefined();
    expect(
      read('artifact-index.json').artifacts.find((a: { id: string }) => a.id === 'native-audit')
        ?.sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
    if (mode === 'zero') {
      expect(result.runStatus).toBe('passed');
      expect(suggested).toBeGreaterThan(0);
      expect(readFileSync(join(result.runDir, 'summary.md'), 'utf8')).toContain(
        'Not detected in this completed scan',
      );
      const planText = readFileSync(join(result.runDir, 'plan.yaml'), 'utf8');
      const { parseTestPlanYaml } = await import(
        '../../../packages/itestagent-engine/src/test-plan-compiler.js'
      );
      expect(() =>
        parseValidatedRunBundle({
          plan: parseTestPlanYaml(planText),
          steps: read('steps.json'),
          result: document,
          artifactIndex: read('artifact-index.json'),
        }),
      ).not.toThrow();
      expect(
        RunResultSchema.safeParse({
          ...document,
          environment: { ...document.environment, targetKind: 'physical' },
        }).success,
      ).toBe(false);
      const index = read('artifact-index.json');
      index.artifacts = [];
      expect(() =>
        parseValidatedRunBundle({
          plan: parseTestPlanYaml(planText),
          steps: read('steps.json'),
          result: document,
          artifactIndex: index,
        }),
      ).toThrow();
    } else {
      expect(result.runStatus).not.toBe('passed');
      expect(document.metrics.collection?.[0]?.status).toBe('failed');
      if (mode === 'not_ready') expect(suggested).toBe(0);
    }
  });

test('native source requires sample durations and cannot enter physical baselines', async () => {
  const s = await baselineFixture();
  cleanups.push(s.cleanup);
  const previous = JSON.parse(
    readFileSync(join(s.root, 'runs', s.plan.runId, 'result.json'), 'utf8'),
  );
  const growth = {
    ...previous.metrics.memoryGrowth,
    source: 'native-footprint',
    sampleTimestamp: 'host_command_completed',
  };
  expect(MemoryGrowthSchema.safeParse(growth).success).toBe(false);
  const nativeGrowth = {
    ...growth,
    samples: growth.samples.map((sample: Record<string, unknown>) => ({
      ...sample,
      measurementDurationMs: 2,
    })),
  };
  const nativeResult = {
    ...previous,
    device: { ...previous.device, targetKind: 'simulator' },
    execution: { ...previous.execution, targetKind: 'simulator' },
    environment: {
      ...previous.environment,
      targetKind: 'simulator',
      comparisonScope: 'simulator_only',
      representativeOfPhysicalDevice: false,
    },
    metrics: {
      ...previous.metrics,
      memoryGrowth: nativeGrowth,
      memoryPeakSource: 'native-footprint',
      memoryPeakUnit: 'MiB',
    },
  };
  nativeResult.baselineDelta = undefined;
  const roundPlan = TestPlanSchema.parse({
    ...s.plan,
    performance: {
      ...s.plan.performance,
      memoryRounds: {
        flowId: 'fixture',
        source: 'global',
        sha256: 'a'.repeat(64),
        steps: ['fixture'],
        count: 2,
        intervalMs: 0,
        processPolicy: 'same_process',
      },
    },
  });
  expect(
    memoryRoundsMetricIssues(roundPlan, {
      memoryRounds: {
        policy: 'memory-rounds-v1',
        status: 'inconclusive',
        plannedCount: 2,
        rounds: [
          {
            round: 1,
            status: 'inconclusive',
            reasonCode: 'fixture',
            startedAt: '2026-09-09T00:00:00Z',
            finishedAt: '2026-09-09T00:00:01Z',
            stepIds: [],
            artifactIds: [],
            memoryGrowth: nativeGrowth,
          },
          { round: 2, status: 'not_started', reasonCode: 'fixture', stepIds: [], artifactIds: [] },
        ],
      },
    }),
  ).toContain('memory_rounds.native_source_unsupported');

  expect(RunResultSchema.safeParse(nativeResult).success).toBe(true);
  expect(
    RunResultSchema.safeParse({
      ...nativeResult,
      metrics: { ...nativeResult.metrics, memoryPeakSource: 'activity-monitor-process-live' },
    }).success,
  ).toBe(false);
  const metrics = {
    memoryPeakMB: 10,
    memoryPeakUnit: 'MiB' as const,
    memoryPeakSource: 'native-footprint' as const,
  };
  expect(
    memoryBaselineCandidate({ plan: s.plan, device: physicalDevice, metrics, status: 'passed' }),
  ).toBeUndefined();
});
