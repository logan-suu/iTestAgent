/** B32: feed-memory analysis deps. */
export function resolveFeedMemoryAnalysisDeps(input: { deps?: string[] } = {}): { deps: string[] } {
  return { deps: input.deps ?? [] };
}
