/**
 * Replay observation handlers — B08 module split (promotion guide §11.3
 * "Flow replay/redaction", §6.1 "UI tree redaction"). Moved verbatim from
 * the former replay.ts monolith's executeStep switch, with one functional
 * addition: getUiTree now scrubs sensitive `value` attributes through the
 * ui-tree-redactor before reporting, and marks the artifact `redacted` when
 * something was masked (R6 defense-in-depth for evidence artifacts).
 *
 * Observation actions return their terminal ReplayStepResult directly —
 * they never fall through to post-step evidence collection.
 */
import type {
  ArtifactRef,
  LogCollectInput,
  RecordingInput,
  ScreenshotInput,
} from 'itestagent-contracts';
import { type ReplayStepResult, blockedStep, passedStep, skippedStep } from './replay-result.js';
import type { StepHandlerContext } from './replay-types.js';
import type { FlowStepV2 } from './schema.js';
import { redactUiTreeXml } from './ui-tree-redactor.js';

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
      const ref = await backend.screenshot({ deviceId } as ScreenshotInput, signal);
      const duration = Date.now() - startTime;
      return passedStep(stepIndex, action, target, duration, [ref], 'Screenshot captured');
    }

    case 'getUiTree': {
      const tree = await backend.getUiTree({ deviceId }, signal);
      // B08: scrub sensitive values before the snapshot becomes evidence.
      const { xml: redactedXml, redactionCount } = redactUiTreeXml(tree.raw);
      const ref: ArtifactRef = {
        id: `uiTree_step${stepIndex}_${Date.now()}`,
        type: 'uitree',
        path: '',
        redactionStatus: redactionCount > 0 ? 'redacted' : 'safe',
      };
      const duration = Date.now() - startTime;
      return passedStep(
        stepIndex,
        action,
        target,
        duration,
        [ref],
        `UI tree captured (${redactedXml.length} chars)${redactionCount > 0 ? `; ${redactionCount} value(s) redacted` : ''}`,
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
      return skippedStep(
        stepIndex,
        action,
        target,
        'stopRecording requires a recording handle from a prior startRecording step. ' +
          'Ensure startRecording is called first and the handle is passed via the replay session.',
      );
    }

    case 'collectLogs': {
      try {
        const ref = await backend.collectLogs(
          { deviceId, type: 'syslog' } as LogCollectInput,
          signal,
        );
        const duration = Date.now() - startTime;
        return passedStep(stepIndex, action, target, duration, [ref], 'Logs collected');
      } catch {
        return blockedStep(
          stepIndex,
          action,
          target,
          'collectLogs not supported by this backend (not_exportable)',
        );
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
