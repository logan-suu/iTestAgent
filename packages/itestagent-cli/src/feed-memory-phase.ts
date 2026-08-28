/** B24: feed-memory phase resolution. */
export function resolveFeedMemoryPhase(input: { phase?: string } = {}): { phase: string } {
  return { phase: input.phase ?? 'preparation' };
}
