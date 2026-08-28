/**
 * Replay step dispatcher — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Owns the per-step control flow moved verbatim from the
 * former replay.ts monolith:
 *
 *   safetyGate (R7) → no-backend fast paths (comment/wait) → abort check →
 *   group dispatch → post-step evidence collection → error mapping.
 *
 * Group dispatch:
 *   - interaction actions (app lifecycle / touch / text / navigation) end
 *     with the monolith's post-step evidence collection, signalled back via
 *     the INTERACTION_CONTINUE sentinel;
 *   - observation and assertion actions return their terminal results
 *     directly (matching the monolith's early returns).
 *
 * R5: unknown actions block explicitly. R6: handler-thrown secret-reference
 * errors map to failed steps through the shared catch.
 */
import type { DeviceBackend } from 'itestagent-contracts';
import { isAssertionAction, runAssertionAction } from './replay-assertion.js';
import { collectStepEvidence } from './replay-evidence-writer.js';
import {
  INTERACTION_CONTINUE,
  isInteractionAction,
  runInteractionAction,
} from './replay-interaction.js';
import { isObservationAction, runObservationAction } from './replay-observation.js';
import {
  type ReplayStepResult,
  blockedStep,
  failedStep,
  passedStep,
  skippedStep,
} from './replay-result.js';
import type { ReplayOptions, StepHandlerContext } from './replay-types.js';
import type { FlowStepV2 } from './schema.js';

type DispatchResult = ReplayStepResult | typeof INTERACTION_CONTINUE;

function dispatchAction(
  action: string,
  step: FlowStepV2,
  stepIndex: number,
  target: string | undefined,
  ctx: StepHandlerContext,
  startTime: number,
): DispatchResult | Promise<DispatchResult> {
  if (isInteractionAction(action)) {
    return runInteractionAction(action, step, stepIndex, target, ctx);
  }
  if (isObservationAction(action)) {
    return runObservationAction(action, step, stepIndex, target, ctx, startTime);
  }
  if (isAssertionAction(action)) {
    return runAssertionAction(action, step, stepIndex, target, ctx, startTime);
  }
  return blockedStep(
    stepIndex,
    action,
    target,
    `Unknown action "${action}" — not supported for replay`,
  );
}

/**
 * Execute a single FlowStepV2 against the DeviceBackend.
 * Returns a ReplayStepResult with status and evidence.
 */
export async function executeStep(
  step: FlowStepV2,
  stepIndex: number,
  backend: DeviceBackend,
  deviceId: string,
  bundleId: string | undefined,
  signal: AbortSignal | undefined,
  collectEvidenceFlag: boolean,
  onSafetyGate: ReplayOptions['onSafetyGate'],
): Promise<ReplayStepResult> {
  const action = step.action;
  const target = step.target;

  // ── SafetyGate check (R7) ─────────────────────────────────────
  if (step.safetyGate === 'deny') {
    return skippedStep(
      stepIndex,
      action,
      target,
      `Step skipped: safetyGate is "deny" (irreversible operation)`,
    );
  }

  if (step.safetyGate === 'ask') {
    if (!onSafetyGate) {
      return skippedStep(
        stepIndex,
        action,
        target,
        `Step skipped: safetyGate is "ask" but no onSafetyGate callback provided`,
      );
    }
    const approved = await onSafetyGate(step);
    if (!approved) {
      return skippedStep(
        stepIndex,
        action,
        target,
        'Step skipped: user denied safetyGate confirmation',
      );
    }
  }

  // ── No-backend actions ────────────────────────────────────────
  if (action === 'comment') {
    return passedStep(stepIndex, action, target, 0, [], step.comment);
  }

  if (action === 'wait') {
    const ms = step.durationMs ?? 1000;
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, ms));
    return passedStep(stepIndex, action, target, Date.now() - start, [], `Waited ${ms}ms`);
  }

  // ── Backend actions ───────────────────────────────────────────
  const startTime = Date.now();
  const ctx: StepHandlerContext = { backend, deviceId, bundleId, signal };

  try {
    // Check abort signal
    if (signal?.aborted) {
      return skippedStep(stepIndex, action, target, 'Replay aborted before step execution');
    }

    const dispatched = await dispatchAction(action, step, stepIndex, target, ctx, startTime);
    if (dispatched !== INTERACTION_CONTINUE) return dispatched;

    // ── Post-step evidence collection ───────────────────────────
    const evidence = collectEvidenceFlag
      ? await collectStepEvidence(backend, deviceId, stepIndex, signal)
      : [];

    const duration = Date.now() - startTime;
    return passedStep(stepIndex, action, target, duration, evidence);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;

    // Try to collect evidence even on failure
    const evidence = collectEvidenceFlag
      ? await collectStepEvidence(backend, deviceId, stepIndex, signal)
      : [];

    return failedStep(stepIndex, action, target, duration, errorMessage, evidence);
  }
}
