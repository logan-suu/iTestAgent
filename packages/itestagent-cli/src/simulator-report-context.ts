/** B20: simulator report context (B09 sanitizer/validator integration). */
export function resolveSimulatorReportContext(input: { runId: string }): { runId: string } {
  return { runId: input.runId };
}
