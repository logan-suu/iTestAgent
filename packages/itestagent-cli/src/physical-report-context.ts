/** B19: physical report context (B09 sanitizer/validator integration). */
export interface PhysicalReportContext {
  runId: string;
}
export function resolveReportContext(input: { runId: string }): PhysicalReportContext {
  return { runId: input.runId };
}
