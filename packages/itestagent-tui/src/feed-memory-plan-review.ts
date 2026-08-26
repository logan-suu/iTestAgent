/** B32: feed-memory plan review (B30 family integration). */
export function resolveFeedMemoryPlanReview(input: { planId?: string } = {}): { planId: string } {
  return { planId: input.planId ?? 'feed-memory-plan' };
}
