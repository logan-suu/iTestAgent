/** B24: feed-memory run identity. */
export function resolveFeedMemoryRunIdentity(input: { runId?: string } = {}): { runId: string } {
  return { runId: input.runId ?? 'feed-memory-run' };
}
