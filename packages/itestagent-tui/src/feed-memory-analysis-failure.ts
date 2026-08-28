/** B32: feed-memory analysis failure facts. */
export function resolveFeedMemoryAnalysisFailure(input: { failed?: boolean } = {}): {
  failed: boolean;
} {
  return { failed: input.failed ?? false };
}
