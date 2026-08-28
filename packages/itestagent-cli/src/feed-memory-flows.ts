/** B24: feed-memory flow resolution. */
export function resolveFeedMemoryFlows(input: { flows?: string[] } = {}): { flows: string[] } {
  return { flows: input.flows ?? [] };
}
