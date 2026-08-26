/** B24: feed-memory runtime deps. */
export function resolveFeedMemoryRuntimeDeps(input: { deps?: string[] } = {}): { deps: string[] } {
  return { deps: input.deps ?? [] };
}
