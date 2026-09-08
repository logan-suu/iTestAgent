import { createHash } from 'node:crypto';
import type {
  BaselineStore,
  DeviceInfo,
  PerformanceMetrics,
  RunStatus,
  TestPlan,
} from 'itestagent-contracts';
import { BaselineManager } from './baseline-manager.js';

/** No identifiers or free-form goals become baseline filenames. */
export async function prepareMemoryBaseline(input: {
  store: BaselineStore;
  plan: TestPlan;
  device: DeviceInfo;
  metrics: PerformanceMetrics;
  status: RunStatus;
}) {
  const { plan, device, metrics, status, store } = input;
  if (
    plan.performance.baseline !== 'local_auto' ||
    device.targetKind !== 'physical' ||
    !device.osVersion ||
    !device.model ||
    plan.performance.baselineDomain !== device.targetKind ||
    status !== 'passed' ||
    metrics.crashDetected === true ||
    metrics.collection?.some((o) => o.status !== 'collected') ||
    (!metrics.memoryGrowth && metrics.memoryPeakMB === undefined)
  )
    return;
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const manager = new BaselineManager({ baselineStore: store });
  const context = {
    projectId: hash(plan.projectProfileRef),
    targetKind: device.targetKind,
    deviceModel: hash({ udid: device.udid, model: device.model }),
    iosVersion: device.osVersion.replace(/[^a-zA-Z0-9._-]/g, '_'),
    scenario: hash({
      version: 'memory-observation-v1',
      execution: plan.execution,
      observation: plan.performance.memoryObservation,
      peakUnit: metrics.memoryPeakUnit ?? 'MB',
      appSource: plan.appSource,
    }),
    runId: plan.runId,
  };
  const summary = {
    memoryPeakMB: metrics.memoryPeakMB,
    memoryGrowthMiB: metrics.memoryGrowth?.deltaMiB,
    approximate: true,
  };
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
      if (!(await store.get(key))) await manager.establishBaseline(summary, context);
    },
  };
}
