import { createHash } from 'node:crypto';
import { MEMORY_CAPTURE_POLICY, memoryRoundsMetricIssues } from 'itestagent-contracts';
import type {
  BaselineStore,
  DeviceInfo,
  PerformanceMetrics,
  RunStatus,
  TestPlan,
  TraceSummary,
} from 'itestagent-contracts';
import { BaselineManager } from './baseline-manager.js';

/** No identifiers or free-form goals become baseline filenames. */
export function memoryBaselineCandidate(input: {
  plan: TestPlan;
  device: DeviceInfo;
  metrics: PerformanceMetrics;
  status: RunStatus;
}) {
  const { plan, device, metrics, status } = input;
  if (
    plan.performance.baseline !== 'local_auto' ||
    device.targetKind !== 'physical' ||
    metrics.memoryPeakSource === 'native-footprint' ||
    metrics.memoryGrowth?.source === 'native-footprint' ||
    metrics.memoryLeaks?.source === 'native-leaks' ||
    !device.osVersion ||
    !device.model ||
    plan.performance.baselineDomain !== device.targetKind ||
    status !== 'passed' ||
    metrics.crashDetected === true ||
    memoryRoundsMetricIssues(plan, metrics).length > 0 ||
    (plan.performance.memoryRounds &&
      (metrics.memoryRounds?.endpointDeltaMiB === undefined ||
        metrics.memoryRounds.plannedCount !== plan.performance.memoryRounds.count ||
        metrics.memoryRounds.rounds.some((r) => r.status !== 'passed'))) ||
    metrics.collection?.some((o) => o.status !== 'collected') ||
    (!metrics.memoryGrowth && metrics.memoryPeakMB === undefined)
  )
    return;
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const context = {
    projectId: hash(plan.projectProfileRef),
    targetKind: device.targetKind,
    deviceModel: hash({ udid: device.udid, model: device.model }),
    iosVersion: device.osVersion.replace(/[^a-zA-Z0-9._-]/g, '_'),
    scenario: hash({
      version: MEMORY_CAPTURE_POLICY.id,
      execution: plan.execution,
      observation: plan.performance.memoryObservation,
      ...(plan.performance.memoryRounds
        ? { rounds: plan.performance.memoryRounds, roundPolicy: 'memory-rounds-v1' }
        : {}),
      peakUnit: metrics.memoryPeakUnit ?? 'MB',
      appSource: plan.appSource,
    }),
    runId: plan.runId,
  };
  const summary: TraceSummary = {
    memoryPeakMB: metrics.memoryPeakMB,
    memoryGrowthMiB: metrics.memoryRounds?.endpointDeltaMiB ?? metrics.memoryGrowth?.deltaMiB,
    approximate: true,
  };
  return { context, summary };
}

export async function prepareMemoryBaseline(input: {
  store: BaselineStore;
  plan: TestPlan;
  device: DeviceInfo;
  metrics: PerformanceMetrics;
  status: RunStatus;
}) {
  const candidate = memoryBaselineCandidate(input);
  if (!candidate) return;
  const { context, summary } = candidate;
  const { store } = input;
  const manager = new BaselineManager({ baselineStore: store });
  const key = manager.buildBaselineKeyFromContext(context);
  const existing = await store.get(key);
  if (existing)
    return {
      delta: await manager.compareWithBaseline(summary, context),
      afterCommit: async () => {},
    };
  return {
    delta: undefined,
    // Only a committed successful run may become the baseline. Never replace an existing one.
    afterCommit: async () => {
      await manager.establishBaseline(summary, context, true);
    },
  };
}
