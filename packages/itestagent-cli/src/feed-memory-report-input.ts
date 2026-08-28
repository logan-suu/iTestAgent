/** B24: feed-memory report input (B09 adapter integration). */
export function toFeedMemoryReportInput(input: { runId: string }): { runId: string } {
  return { runId: input.runId };
}
