/** B24: feed-memory profile. */
export function resolveFeedMemoryProfile(input: { name?: string } = {}): { name: string } {
  return { name: input.name ?? 'default' };
}
