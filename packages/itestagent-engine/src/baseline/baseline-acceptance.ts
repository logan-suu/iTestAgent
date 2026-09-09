import { createHash } from 'node:crypto';
import type { BaselineStore, RunBundleDocuments } from 'itestagent-contracts';
import { isSafeRunId } from 'itestagent-contracts';
import { computeProjectHash } from 'itestagent-project-analyzer';
import { createBaselineStore, createRunStore, createStoreCore } from 'itestagent-store';
import { type PermissionEngine, PermissionRequestError } from '../permission-engine.js';
import { BaselineManager } from './baseline-manager.js';
import { memoryBaselineCandidate } from './production-memory-baseline.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface BaselineAcceptanceDependencies {
  loadRunBundle(runId: string): Promise<RunBundleDocuments>;
  baselineStore: BaselineStore;
  projectProfileRef(): Promise<string>;
}
export interface BaselineAcceptanceInput {
  runId: string;
  permissionEngine: PermissionEngine;
  signal: AbortSignal;
  preview(text: string): void;
  requested(request: { callId: string; action: string; resource: string }): void;
  resolved(
    callId: string,
    effect: 'allow' | 'deny',
    reason?: 'timeout' | 'cancelled' | 'error',
  ): void;
}

/** Read-only preparation followed by a one-shot permission and a checked atomic write. */
export function createMemoryBaselineAcceptance(deps: BaselineAcceptanceDependencies) {
  return async (input: BaselineAcceptanceInput): Promise<void> => {
    if (!isSafeRunId(input.runId))
      throw new Error('baseline_run_invalid: specify a canonical run ID');
    const load = async () => {
      try {
        return await deps.loadRunBundle(input.runId);
      } catch {
        throw new Error('baseline_run_invalid: the complete run bundle could not be verified');
      }
    };
    input.signal.throwIfAborted();
    const bundle = await load();
    const plan = bundle.plan;
    if (plan.schemaVersion !== 'itestagent.test-plan.v3')
      throw new Error('baseline_route_unsupported: a TestPlan run is required');
    if (plan.projectProfileRef !== (await deps.projectProfileRef()))
      throw new Error('baseline_project_mismatch: select a run from this project revision');
    const { result } = bundle;
    const candidate = memoryBaselineCandidate({
      plan,
      device: { ...result.device, platform: 'ios' },
      metrics: result.metrics,
      status: result.status,
    });
    if (
      !candidate ||
      result.device.targetKind !== 'physical' ||
      result.execution.mode !== 'device_backend' ||
      result.metrics.memoryPeakUnit !== 'MiB' ||
      (plan.device.physical?.selector === 'by_udid' &&
        plan.device.physical.udid !== result.device.udid) ||
      ((plan.execution.metrics ?? []).includes('memory_peak') &&
        result.metrics.memoryPeakMB === undefined) ||
      ((plan.execution.metrics ?? []).includes('memory_leaks') &&
        !result.metrics.memoryLeaks &&
        !result.metrics.memoryRounds?.rounds.every((r) => r.memoryLeaks)) ||
      ((plan.execution.metrics ?? []).includes('memory_growth') &&
        !result.metrics.memoryRounds &&
        (!result.metrics.memoryGrowth ||
          result.metrics.memoryGrowth.coverage !== 'complete' ||
          result.metrics.memoryGrowth.durationMs <
            (plan.performance.memoryObservation?.minimumDurationMs ?? 0))) ||
      (plan.execution.metrics ?? []).some(
        (metric) =>
          !result.metrics.collection?.some(
            (outcome) => outcome.metric === metric && outcome.status === 'collected',
          ),
      )
    ) {
      throw new Error(
        'baseline_run_ineligible: a passed physical memory run with complete requested metrics is required',
      );
    }
    const manager = new BaselineManager({ baselineStore: deps.baselineStore });
    const key = manager.buildBaselineKeyFromContext(candidate.context);
    const existing = await deps.baselineStore.get(key);
    if (!existing || existing.key !== key || existing.targetKind !== 'physical')
      throw new Error('baseline_missing: no compatible existing baseline');
    if (!deps.baselineStore.compareAndSwap) throw new Error('baseline_atomic_unavailable');
    const reviewed = digest(bundle);
    const show = (value: number | undefined) =>
      value === undefined ? 'unavailable' : `${value.toFixed(6)} MiB (approximate)`;
    input.preview(
      [
        'Accept memory baseline — physical target',
        `Current source: ${isSafeRunId(existing.updatedFromRun) ? existing.updatedFromRun : 'unavailable'}`,
        `Selected source: ${input.runId}`,
        `Memory peak: ${show(existing.memoryPeakMB)} → ${show(candidate.summary.memoryPeakMB)}`,
        `Memory growth: ${show(existing.memoryGrowthMiB)} → ${show(candidate.summary.memoryGrowthMiB)}`,
        'This replaces the compatible baseline values. Historical run reports remain unchanged.',
      ].join('\n'),
    );
    input.signal.throwIfAborted();
    const callId = `baseline-${crypto.randomUUID()}`;
    const action = 'update_baseline';
    const resource = `baseline:physical:${digest(key)}:run:${input.runId}`;
    const abort = () => input.permissionEngine.cancel(callId, 'baseline acceptance cancelled');
    input.signal.addEventListener('abort', abort, { once: true });
    let effect: 'allow' | 'deny' = 'deny';
    let permissionSettled = false;
    let reason: 'timeout' | 'cancelled' | 'error' | undefined;
    try {
      input.signal.throwIfAborted();
      const decision = input.permissionEngine.requestPermission(callId, action, resource);
      // Attach a rejection handler before notifying a potentially throwing UI callback.
      void decision.catch(() => {});
      if (input.permissionEngine.check(action, resource) === 'ask')
        input.requested({ callId, action, resource });
      const permission = await decision;
      effect = permission.effect;
      permissionSettled = true;
      if (permission.effect !== 'allow') throw new Error('baseline_denied: baseline unchanged');
      input.signal.throwIfAborted();
      if (
        digest(await load()) !== reviewed ||
        plan.projectProfileRef !== (await deps.projectProfileRef())
      )
        throw new Error('baseline_run_changed: review the run again');
      input.signal.throwIfAborted();
      await manager.acceptNewBaseline(
        input.runId,
        key,
        true,
        candidate.summary,
        existing,
        input.signal,
      );
    } catch (error) {
      reason =
        error instanceof PermissionRequestError
          ? error.reason
          : input.signal.aborted
            ? 'cancelled'
            : permissionSettled
              ? undefined
              : 'error';
      throw error;
    } finally {
      input.signal.removeEventListener('abort', abort);
      input.permissionEngine.cancel(callId, 'baseline acceptance finished');
      input.resolved(callId, effect, reason);
    }
  };
}

/** Historical bundle validation needs no live device or persistent metadata database. */
export function createDefaultMemoryBaselineAcceptance(workspace: string) {
  return createMemoryBaselineAcceptance({
    baselineStore: createBaselineStore(),
    projectProfileRef: async () =>
      `~/.itestagent/projects/${await computeProjectHash(workspace)}/project-profile.json`,
    loadRunBundle: async (runId) => {
      const core = createStoreCore(':memory:');
      try {
        return await createRunStore(core.db).loadRunBundle(runId);
      } finally {
        core.sqlite.close();
      }
    },
  });
}
