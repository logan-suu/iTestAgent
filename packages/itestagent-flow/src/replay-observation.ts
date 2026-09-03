/**
 * Replay observation handlers — B08 module split (promotion guide §11.3
 * "Flow replay/redaction", §6.1 "UI tree redaction"). Moved verbatim from
 * the former replay.ts monolith's executeStep switch. Raw screenshots and
 * UI trees remain local, point to actual files, and are marked raw-local-only
 * per ADR-032.
 *
 * Observation actions return their terminal ReplayStepResult directly —
 * they never fall through to post-step evidence collection.
 */
import type { LogCollectInput, RecordingInput, ScreenshotInput } from 'itestagent-contracts';
import { persistRawUiTree, validateRawArtifact } from './replay-evidence-writer.js';
import { type ReplayStepResult, blockedStep, passedStep, skippedStep } from './replay-result.js';
import type { StepHandlerContext } from './replay-types.js';
import type { FlowStepV2 } from './schema.js';

const ACTION_SET = new Set([
  'screenshot',
  'getUiTree',
  'startRecording',
  'stopRecording',
  'collectLogs',
]);

/** Whether an action belongs to the observation group. */
export function isObservationAction(action: string): boolean {
  return ACTION_SET.has(action);
}

/**
 * Executes one observation action against the device.
 * Always returns a terminal ReplayStepResult.
 */
export async function runObservationAction(
  action: string,
  step: FlowStepV2,
  stepIndex: number,
  target: string | undefined,
  ctx: StepHandlerContext,
  startTime: number,
): Promise<ReplayStepResult> {
  const { backend, deviceId, signal } = ctx;

  switch (action) {
    case 'screenshot': {
      const ref = validateRawArtifact(
        await backend.screenshot({ deviceId } as ScreenshotInput, signal),
        {
          evidenceDirectory: ctx.evidenceDirectory,
          stepId: ctx.stepId ?? `step-${stepIndex + 1}`,
          caseId: ctx.caseId,
        },
      );
      const duration = Date.now() - startTime;
      return passedStep(stepIndex, action, target, duration, [ref], 'Screenshot captured');
    }

    case 'getUiTree': {
      const tree = await backend.getUiTree({ deviceId }, signal);
      const ref = await persistRawUiTree(tree, {
        evidenceDirectory: ctx.evidenceDirectory,
        stepId: ctx.stepId ?? `step-${stepIndex + 1}`,
        caseId: ctx.caseId,
      });
      const duration = Date.now() - startTime;
      return passedStep(
        stepIndex,
        action,
        target,
        duration,
        [ref],
        `Raw UI tree captured locally (${tree.raw.length} chars)`,
      );
    }

    case 'startRecording': {
      const recording = await backend.startRecording(
        { deviceId, type: 'video' } as RecordingInput,
        signal,
      );
      const duration = Date.now() - startTime;
      return passedStep(
        stepIndex,
        action,
        target,
        duration,
        [],
        `Recording started: ${recording.handleId}`,
      );
    }

    case 'stopRecording': {
      // Note: RecordingHandle from startRecording is stored externally by the replay caller.
      // This is a stub — actual recording handle must be tracked by the caller.
      return {
        ...skippedStep(
          stepIndex,
          action,
          target,
          'stopRecording requires a recording handle from a prior startRecording step. ' +
            'Ensure startRecording is called first and the handle is passed via the replay session.',
        ),
        evidenceOutcomes: [{ type: 'video', status: 'unsupported' }],
      };
    }

    case 'collectLogs': {
      try {
        const ref = validateRawArtifact(
          await backend.collectLogs({ deviceId, type: 'syslog' } as LogCollectInput, signal),
          {
            evidenceDirectory: ctx.evidenceDirectory,
            stepId: ctx.stepId ?? `step-${stepIndex + 1}`,
            caseId: ctx.caseId,
          },
        );
        const duration = Date.now() - startTime;
        return passedStep(stepIndex, action, target, duration, [ref], 'Logs collected');
      } catch (error) {
        return {
          ...blockedStep(
            stepIndex,
            action,
            target,
            `collectLogs failed or is unsupported: ${error instanceof Error ? error.message : String(error)}`,
          ),
          evidenceOutcomes: [
            {
              type: 'log',
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }

    default:
      return blockedStep(
        stepIndex,
        action,
        target,
        `Unknown observation action "${action}" — not supported for replay`,
      );
  }
}
