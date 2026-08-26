/** B32: feed-memory plan formatting + routing. */
export function formatFeedMemoryPlan(input: { planId: string }): { planId: string } {
  return { planId: input.planId };
}

export function routeFeedMemoryTui(input: { lane?: string } = {}): { lane: string } {
  return { lane: input.lane ?? 'feed-memory' };
}
