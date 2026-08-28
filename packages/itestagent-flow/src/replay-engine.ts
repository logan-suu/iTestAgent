/**
 * Replay engine — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Moved verbatim from the former replay.ts monolith.
 *
 * Architecture:
 *   - checkTargetCompatibility(): ADR-011 targetKind validation
 *   - replayFlow(): main execution loop mapping FlowStepV2 → DeviceBackend calls
 *
 * R5: No silent degradation — aborted/cross-target runs are accounted as
 *     skipped/blocked explicitly.
 * R7: safetyGate ask/deny requires callback confirmation (wired in
 *     replay-step's dispatcher).
 */
import type { DeviceBackend, TargetKind } from 'itestagent-contracts';
import {
  type ReplayResult,
  type ReplayStepResult,
  createEmptySummary,
  skippedStep,
} from './replay-result.js';
import { executeStep } from './replay-step.js';
import type { ReplayOptions, TargetCompatibilityResult } from './replay-types.js';
import type { FlowV2 } from './schema.js';

/**
 * Check whether a flow can be replayed on the requested targetKind.
 *
 * ADR-011 §8: Flow must be replayed on the same targetKind.
 * Cross-target replay returns blocked with reason.
 *
 * @param flow - The FlowV2 to check
 * @param targetKind - The requested target kind
 * @returns Compatibility result
 */
export function checkTargetCompatibility(
  flow: FlowV2,
  targetKind: TargetKind,
): TargetCompatibilityResult {
  const supported = flow.supportedTargetKinds;

  if (supported.includes(targetKind)) {
    return { ok: true, requested: targetKind, supported };
  }

  return {
    ok: false,
    reason:
      `Flow "${flow.flowId}" was recorded for ${supported.join('/')} but targetKind "${targetKind}" is not in supportedTargetKinds. ` +
      `Cross-target replay is blocked per ADR-011. Re-record on ${targetKind} or use a matching device.`,
    requested: targetKind,
    supported,
  };
}

/**
 * Replay a FlowV2 against a DeviceBackend.
 *
 * US-9.2 AC2: Core replay execution.
 *
 * Steps:
 *   1. Iterate through flow.steps
 *   2. For each step: safetyGate check → executeStep → collect evidence → record result
 *   3. Return ReplayResult with per-step status and aggregate summary
 *
 * @param flow - The validated FlowV2 to replay
 * @param backend - A DeviceBackend implementation (AppiumDeviceBackend, MockDeviceBackend, etc.)
 * @param options - Replay options (deviceId, bundleId, signal, callbacks)
 * @returns Structured ReplayResult
 */
export async function replayFlow(
  flow: FlowV2,
  backend: DeviceBackend,
  options: ReplayOptions,
): Promise<ReplayResult> {
  const {
    deviceId,
    bundleId,
    signal,
    onStepStart,
    onSafetyGate,
    collectEvidence: collectEvidenceFlag = true,
  } = options;

  const startedAt = new Date().toISOString();
  const steps: ReplayStepResult[] = [];
  const summary = createEmptySummary(flow.steps.length);

  // Determine targetKind from the backend capabilities or options
  // We infer targetKind from the backend's capabilities or from the flow itself
  const targetKind: TargetKind = flow.supportedTargetKinds[0] ?? 'physical';

  for (let i = 0; i < flow.steps.length; i++) {
    if (signal?.aborted) {
      for (let j = i; j < flow.steps.length; j++) {
        const s = flow.steps[j];
        if (!s) continue;
        steps.push(skippedStep(j, s.action, s.target, 'Replay aborted'));
        summary.skipped++;
      }
      break;
    }

    const step = flow.steps[i];
    if (!step) continue;

    onStepStart?.(i, step);

    const result = await executeStep(
      step,
      i,
      backend,
      deviceId,
      bundleId,
      signal,
      collectEvidenceFlag,
      onSafetyGate,
    );

    steps.push(result);

    // Update summary
    switch (result.status) {
      case 'passed':
        summary.passed++;
        break;
      case 'failed':
        summary.failed++;
        break;
      case 'skipped':
        summary.skipped++;
        break;
      case 'blocked':
        summary.blocked++;
        break;
    }
  }

  const completedAt = new Date().toISOString();

  // Determine overall status
  let overallStatus: ReplayResult['overallStatus'];
  if (summary.total === 0) {
    overallStatus = 'passed';
  } else if (summary.blocked === summary.total) {
    overallStatus = 'blocked';
  } else if (summary.failed > 0) {
    overallStatus = 'failed';
  } else {
    overallStatus = 'passed';
  }

  return {
    flowId: flow.flowId,
    targetKind,
    deviceId,
    startedAt,
    completedAt,
    steps,
    summary,
    overallStatus,
  };
}
