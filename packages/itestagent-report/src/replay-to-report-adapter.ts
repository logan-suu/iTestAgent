/**
 * Replay → report adapter — B09 module split (promotion guide §11.3 "report
 * validation").
 *
 * Feeds flow-replay outcomes into the report pipeline without importing the
 * flow package (backend-to-backend isolation). The overall status is carried
 * through VERBATIM — a blocked replay is never silently converted into a
 * passing report (R5) — and failed steps are extracted with their errors for
 * the failure section.
 */

export interface ReplayReportStep {
  stepIndex: number;
  action: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  durationMs: number;
  error?: string;
}

export interface ReplayReportInput {
  flowId: string;
  overallStatus: 'passed' | 'failed' | 'blocked';
  steps: readonly ReplayReportStep[];
}

export interface ReplayToReportResult {
  flowId: string;
  /** Overall status carried through verbatim (never guessed). */
  status: 'passed' | 'failed' | 'blocked';
  /** Failed steps with their errors, for the report failure section. */
  failedSteps: Array<{ stepIndex: number; action: string; error: string }>;
}

/** Adapts a replay outcome into report-friendly shape. */
export function adaptReplayForReport(replay: ReplayReportInput): ReplayToReportResult {
  return {
    flowId: replay.flowId,
    status: replay.overallStatus,
    failedSteps: replay.steps
      .filter((step) => step.status === 'failed' && step.error !== undefined)
      .map((step) => ({ stepIndex: step.stepIndex, action: step.action, error: step.error ?? '' })),
  };
}
