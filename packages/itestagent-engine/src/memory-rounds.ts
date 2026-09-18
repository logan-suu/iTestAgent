import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  type DeviceBackend,
  type MemoryRound,
  type MemoryRoundsPlan,
  MemoryRoundsPlanSchema,
  type PerformanceCaptureFactory,
  type PerformanceCaptureResult,
  PerformanceCaptureStartError,
  type RunStep,
  type TestPlan,
  TestPlanSchema,
} from 'itestagent-contracts';
import {
  type FlowStepV2,
  type FlowV2,
  collectStepEvidenceResult,
  inferRequiredCapabilities,
  replayFlow,
} from 'itestagent-flow';
import { AssertionEvaluator } from './assertion/assertion-evaluator.js';
import { normalizeBackendCapabilities } from './backend-selector.js';
import { redactSensitiveText } from './context-builder.js';
import { observationsFromUiTrees } from './exploration/assertion-observations.js';
import type { RealDeviceRunResult } from './exploration/real-run.js';
import { loadProductionFlow } from './flow-replay-production.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actions = new Set([
  'tap',
  'swipe',
  'typeText',
  'assertVisible',
  'assertNotVisible',
  'assertText',
  'wait',
  'comment',
]);

/** Only an explicitly confirmed, bounded in-app workload is repeatable. */
export function validateMemoryRoundFlow(flow: FlowV2): void {
  if (
    flow.status !== 'confirmed' ||
    !flow.supportedTargetKinds.includes('physical') ||
    flow.steps.length > 100 ||
    !flow.steps.some((s) => s.action.startsWith('assert'))
  )
    throw new Error(
      'memory_rounds.flow_ineligible: select a confirmed physical Flow with assertions',
    );
  if (flow.steps.some((s) => !actions.has(s.action) || s.valueRef || (s.durationMs ?? 0) > 60_000))
    throw new Error(
      'memory_rounds.flow_unsupported: lifecycle, external links, secret references and unbounded waits are not repeatable here',
    );
  if (flow.steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0) > 300_000)
    throw new Error('memory_rounds.workload_too_long');
  if (redactSensitiveText(JSON.stringify(flow.steps)) !== JSON.stringify(flow.steps))
    throw new Error('memory_rounds.inline_sensitive_data');
  const actual = inferRequiredCapabilities(flow.steps).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...flow.requiredCapabilities].sort()))
    throw new Error('memory_rounds.flow_capabilities_mismatch');
}

export async function prepareMemoryRounds(
  flowId: string,
  count: number,
  intervalMs: number,
  workspace: string,
  dataRoot?: string,
): Promise<MemoryRoundsPlan> {
  const loaded = await loadProductionFlow(flowId, { projectPath: workspace, dataRoot });
  validateMemoryRoundFlow(loaded.flow);
  return MemoryRoundsPlanSchema.parse({
    flowId,
    source: loaded.source,
    sha256: digest(loaded.data),
    count,
    intervalMs,
    processPolicy: 'same_process',
    steps: loaded.flow.steps.map((s, i) => redactSensitiveText(`${i + 1}. ${JSON.stringify(s)}`)),
  });
}

export async function loadReviewedMemoryFlow(
  config: MemoryRoundsPlan,
  workspace: string,
  dataRoot?: string,
): Promise<FlowV2> {
  const loaded = await loadProductionFlow(config.flowId, { projectPath: workspace, dataRoot });
  validateMemoryRoundFlow(loaded.flow);
  if (
    loaded.source !== config.source ||
    digest(loaded.data) !== config.sha256 ||
    JSON.stringify(config.steps) !==
      JSON.stringify(
        loaded.flow.steps.map((s, i) => redactSensitiveText(`${i + 1}. ${JSON.stringify(s)}`)),
      )
  )
    throw new Error('memory_rounds.flow_changed: review the Flow again');
  return loaded.flow;
}

export function memoryRoundCaseIds(flow: FlowV2, count: number): string[] {
  return Array.from({ length: count }, (_, i) => [
    ...new Set(flow.steps.map((s) => `round-${i + 1}:flow:${s.caseId ?? 'workload'}`)),
  ]).flat();
}

export function waitForMemoryRound(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('memory_rounds.cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function needsPermission(step: FlowStepV2): boolean {
  if (!['tap', 'swipe', 'typeText'].includes(step.action)) return step.safetyGate === 'ask';
  const text = `${step.target ?? ''} ${step.locator?.value ?? ''}`;
  // Only clearly described navigation is low risk; unknown or sensitive semantics must ask.
  return (
    step.safetyGate === 'ask' ||
    /delete|remove|erase|pay|buy|purchase|account|security|password|token|permission|authorize|删除|支付|账号|授权/i.test(
      text,
    ) ||
    !/^(?:back|next|previous|home|search|scroll|返回|下一页|上一页|首页|搜索|滚动)(?:\s|$)/i.test(
      text.trim(),
    )
  );
}

export async function runMemoryRounds(input: {
  plan: TestPlan;
  flow: FlowV2;
  backend: DeviceBackend;
  deviceId: string;
  bundleId: string;
  stagingDir: string;
  capture: PerformanceCaptureFactory;
  authorize(action: string, resource: string, signal?: AbortSignal): Promise<boolean>;
  signal?: AbortSignal;
  progress(message: string): void;
}): Promise<{ result: RealDeviceRunResult; performance: PerformanceCaptureResult }> {
  const config = TestPlanSchema.parse(input.plan).performance.memoryRounds;
  if (!config) throw new Error('memory_rounds.configuration_missing');
  validateMemoryRoundFlow(input.flow);
  const metrics = (input.plan.execution.metrics ?? []).filter((m) => m !== 'test_duration');
  if (
    input.flow.requiredCapabilities.some(
      (c) => !normalizeBackendCapabilities(input.backend.capabilities).has(c),
    )
  )
    throw new Error('memory_rounds.backend_capabilities_missing');
  if (!input.backend.getAppProcessId) throw new Error('memory_rounds.process_identity_unsupported');
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort('memory_rounds.budget_exceeded'), 30 * 60_000);
  const steps: RunStep[] = [];
  const artifacts: PerformanceCaptureResult['artifacts'] = [];
  const deviceArtifacts: PerformanceCaptureResult['artifacts'] = [];
  const rows: MemoryRound[] = Array.from({ length: config.count }, (_, i) => ({
    round: i + 1,
    status: 'not_started',
    reasonCode: 'memory_rounds.not_started',
    stepIds: [],
    artifactIds: [],
  }));
  const cases: RealDeviceRunResult['assertion']['cases'] = [];
  const expectedPid = await input.backend
    .getAppProcessId({ deviceId: input.deviceId, bundleId: input.bundleId }, signal)
    .catch(() => undefined);
  const checkProcess = async (actionSignal = signal) => {
    actionSignal.throwIfAborted();
    const pid = await input.backend.getAppProcessId?.(
      { deviceId: input.deviceId, bundleId: input.bundleId },
      actionSignal,
    );
    if (!expectedPid || pid !== expectedPid) throw new Error('memory_rounds.process_changed');
  };
  try {
    for (const row of rows) {
      if (signal.aborted) break;
      const roundTimeout = setTimeout(
        () => controller.abort('memory_rounds.round_budget_exceeded'),
        540_000,
      );
      row.startedAt = new Date().toISOString();
      row.status = 'blocked';
      row.reasonCode = 'memory_rounds.process_unavailable';
      let recording: Awaited<ReturnType<PerformanceCaptureFactory>> | undefined;
      let captureResult: PerformanceCaptureResult | undefined;
      let captureSignal: AbortSignal | undefined;
      let actionSignal = signal;
      try {
        await checkProcess();
        input.progress(`Memory round ${row.round}/${config.count}: starting independent capture…`);
        recording = await input.capture({
          runId: `${input.plan.runId}-round-${row.round}`,
          deviceId: input.deviceId,
          targetKind: 'physical',
          executable: String(expectedPid),
          stagingDir: join(input.stagingDir, `round-${row.round}`),
          metrics,
          memoryObservation: input.plan.performance.memoryObservation,
          signal,
          onProgress: (text) => input.progress(`Round ${row.round}/${config.count}: ${text}`),
        });
        captureSignal = recording.signal;
        actionSignal = captureSignal ? AbortSignal.any([signal, captureSignal]) : signal;
        await checkProcess(actionSignal);
        const flow: FlowV2 = {
          ...input.flow,
          steps: input.flow.steps.map((s) => ({
            ...s,
            caseId: `round-${row.round}:flow:${s.caseId ?? 'workload'}`,
          })),
        };
        const replay = await replayFlow(flow, input.backend, {
          targetKind: 'physical',
          deviceId: input.deviceId,
          bundleId: input.bundleId,
          runId: `${input.plan.runId}-round-${row.round}`,
          evidenceDirectory: join(input.stagingDir, `round-${row.round}`, 'artifacts'),
          collectEvidence: false,
          signal: actionSignal,
          stopOnFailure: true,
          beforeStep: async (i, step) => {
            await checkProcess(actionSignal);
            if (step.safetyGate === 'deny') return;
            if (
              needsPermission(step) &&
              !(await input.authorize(
                'interact_sensitive_ui',
                `memory-round:${input.plan.runId}:${row.round}:${i + 1}:${config.sha256}:${step.action}:${redactSensitiveText(step.target ?? step.locator?.value ?? 'reviewed step')}`,
                actionSignal,
              ))
            )
              throw new Error('memory_rounds.permission_denied');
            await checkProcess(actionSignal);
          },
          // The engine guard above already requested fresh authorization, including explicit ask.
          onSafetyGate: async () => true,
        });
        for (const s of replay.steps) {
          if (!s.startedAt) continue;
          const step: RunStep = {
            stepId: s.stepId,
            sequence: steps.length + 1,
            backend: input.backend.name,
            targetKind: 'physical',
            caseId: s.caseId,
            action: s.action,
            input: { round: row.round, flowStep: s.stepIndex + 1 },
            result: { status: s.status },
            status:
              s.status === 'passed' ? 'completed' : s.status === 'failed' ? 'failed' : 'blocked',
            artifacts: s.evidence.map((a) => a.id),
            startedAt: s.startedAt,
            durationMs: Math.max(0, Math.round(s.durationMs)),
          };
          steps.push(step);
          row.stepIds.push(step.stepId);
          deviceArtifacts.push(...s.evidence);
          row.artifactIds.push(...s.evidence.map((a) => a.id));
        }
        // A failed backend action is infrastructure blockage, not a failed product assertion.
        if (replay.steps.some((s) => s.status === 'failed' && !s.action.startsWith('assert')))
          replay.overallStatus = 'blocked';
        if (
          replay.overallStatus === 'passed' &&
          (input.plan.execution.assertions?.length ?? 0) > 0
        ) {
          const assertions = input.plan.execution.assertions ?? [];
          await checkProcess(actionSignal);
          const goalStartedAt = new Date().toISOString();
          const tree = await input.backend.getUiTree({ deviceId: input.deviceId }, actionSignal);
          const evaluated = new AssertionEvaluator().evaluate({
            policy: input.plan.execution.assertion.policy,
            userAssertions: assertions.filter((a) => a.source === 'user'),
            profileAssertions: assertions.filter((a) => a.source === 'profile'),
            agentConfirmed: assertions.filter((a) => a.source === 'agent'),
            observations: observationsFromUiTrees(
              assertions,
              assertions.map((a) => ({ caseId: a.caseId, raw: tree.raw })),
            ),
          });
          if (evaluated.status !== 'passed')
            replay.overallStatus = evaluated.status === 'failed' ? 'failed' : 'blocked';
          for (const c of evaluated.cases) {
            const caseId = `round-${row.round}:goal:${c.caseId}`;
            cases.push({ ...c, caseId });
            const step: RunStep = {
              stepId: `${input.plan.runId}-round-${row.round}-goal-${steps.length + 1}`,
              sequence: steps.length + 1,
              backend: input.backend.name,
              targetKind: 'physical',
              caseId,
              action: 'evaluate_assertions',
              input: { round: row.round },
              result: { status: c.status },
              status:
                c.status === 'passed' ? 'completed' : c.status === 'failed' ? 'failed' : 'blocked',
              artifacts: [],
              startedAt: goalStartedAt,
              durationMs: Math.max(0, Date.now() - Date.parse(goalStartedAt)),
            };
            steps.push(step);
            row.stepIds.push(step.stepId);
          }
        }
        row.status = replay.cancelled ? 'cancelled' : replay.overallStatus;
        row.reasonCode = `memory_rounds.${row.status}`;
        const evidenceTypes = input.plan.artifacts.collect.filter(
          (t) => t === 'screenshot' || t === 'uitree',
        );
        if (evidenceTypes.length && !signal.aborted) {
          const startedAt = new Date().toISOString();
          const stepId = `${input.plan.runId}-round-${row.round}-checkpoint`;
          const evidence = await collectStepEvidenceResult(
            input.backend,
            input.deviceId,
            {
              stepId,
              evidenceDirectory: join(input.stagingDir, 'artifacts'),
            },
            actionSignal,
            evidenceTypes,
          );
          const complete = evidence.outcomes.every((o) => o.status === 'success');
          const step: RunStep = {
            stepId,
            sequence: steps.length + 1,
            backend: input.backend.name,
            targetKind: 'physical',
            action: 'collect_checkpoint',
            input: { round: row.round },
            result: { status: complete ? 'collected' : 'incomplete' },
            status: complete ? 'completed' : 'blocked',
            artifacts: evidence.artifacts.map((a) => a.id),
            startedAt,
            durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
          };
          steps.push(step);
          row.stepIds.push(stepId);
          deviceArtifacts.push(...evidence.artifacts);
          row.artifactIds.push(...step.artifacts);
          if (!complete && row.status === 'passed') {
            row.status = 'inconclusive';
            row.reasonCode = 'memory_rounds.evidence_incomplete';
          }
        }
        captureResult = await recording.finish();
        recording = undefined;
        await checkProcess();
      } catch (error) {
        if (error instanceof PerformanceCaptureStartError) captureResult = error.result;
        row.status = signal.aborted ? 'cancelled' : 'blocked';
        row.reasonCode = signal.aborted
          ? 'memory_rounds.cancelled'
          : 'memory_rounds.execution_stopped';
      } finally {
        if (recording) captureResult = await recording.finish().catch(() => undefined);
        if (captureResult) {
          const measured = captureResult.metrics;
          row.memoryPeakMB = measured.memoryPeakMB;
          row.memoryGrowth = measured.memoryGrowth;
          row.memoryLeaks = measured.memoryLeaks;
          row.collection = measured.collection;
          artifacts.push(...captureResult.artifacts);
          row.artifactIds.push(...captureResult.artifacts.map((a) => a.id));
          if (
            row.status === 'passed' &&
            (measured.memoryGrowth?.coverage !== 'complete' ||
              measured.memoryGrowth.durationMs <
                (input.plan.performance.memoryObservation?.minimumDurationMs ?? 1000) ||
              (metrics.includes('memory_peak') &&
                (measured.memoryPeakMB === undefined || measured.memoryPeakUnit !== 'MiB')) ||
              (metrics.includes('memory_leaks') && !measured.memoryLeaks) ||
              metrics.some(
                (m) =>
                  !measured.collection?.some((o) => o.metric === m && o.status === 'collected'),
              ))
          ) {
            row.status = 'inconclusive';
            row.reasonCode = 'memory_rounds.incomplete_metrics';
          }
        } else if (row.status === 'passed') {
          row.status = 'inconclusive';
          row.reasonCode = 'memory_rounds.capture_missing';
        }
        if (captureSignal?.aborted && !signal.aborted) {
          row.status = 'blocked';
          row.reasonCode = 'memory_rounds.capture_failed';
        }
        if (signal.aborted) {
          row.status = 'cancelled';
          row.reasonCode = 'memory_rounds.cancelled';
        }
        row.finishedAt = new Date().toISOString();
        clearTimeout(roundTimeout);
      }
      for (const caseId of [
        ...new Set(
          steps
            .filter(
              (s) => row.stepIds.includes(s.stepId) && s.caseId && !s.caseId.includes(':goal:'),
            )
            .map((s) => s.caseId as string),
        ),
      ]) {
        cases.push({
          caseId,
          status:
            row.status === 'inconclusive'
              ? 'passed'
              : row.status === 'blocked' || row.status === 'cancelled'
                ? 'inconclusive'
                : row.status,
          resolvedBy: 'user',
        });
      }
      if (row.status !== 'passed') break;
      if (row.round < config.count) {
        input.progress(
          `Memory round ${row.round}/${config.count} complete; waiting ${config.intervalMs / 1000}s before the next round (not sampled)…`,
        );
        try {
          await waitForMemoryRound(config.intervalMs, signal);
        } catch {
          break;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abort);
  }
  const complete = rows.every((r) => r.status === 'passed');
  const first = rows[0]?.memoryGrowth?.endMiB;
  const last = rows.at(-1)?.memoryGrowth?.endMiB;
  const peaks = rows.flatMap((r) => (r.memoryPeakMB === undefined ? [] : [r.memoryPeakMB]));
  const status = signal.aborted
    ? 'cancelled'
    : rows.some((r) => r.status === 'failed')
      ? 'failed'
      : rows.some((r) => r.status === 'blocked')
        ? 'blocked'
        : complete
          ? 'passed'
          : 'inconclusive';
  return {
    result: {
      runDir: input.stagingDir,
      steps,
      artifacts: deviceArtifacts,
      artifactCount: deviceArtifacts.length,
      artifactIndexPath: null,
      assertion: {
        status: status === 'blocked' || status === 'cancelled' ? 'inconclusive' : status,
        cases,
        summary: `Confirmed memory rounds: ${rows.filter((r) => r.status === 'passed').length}/${config.count} complete.`,
      },
    },
    performance: {
      artifacts,
      metrics: {
        memoryRounds: {
          policy: 'memory-rounds-v1',
          status,
          plannedCount: config.count,
          rounds: rows,
          ...(complete && first !== undefined && last !== undefined
            ? { endpointDeltaMiB: last - first }
            : {}),
        },
        ...(peaks.length
          ? { memoryPeakMB: Math.max(...peaks), memoryPeakUnit: 'MiB', approximate: true }
          : {}),
        collection: metrics.map((metric) => ({
          metric,
          status: complete
            ? 'collected'
            : signal.aborted
              ? 'cancelled'
              : status === 'blocked'
                ? 'failed'
                : 'not_exportable',
          reasonCode: complete ? 'memory_rounds.collected' : 'memory_rounds.incomplete',
        })),
      },
    },
  };
}
