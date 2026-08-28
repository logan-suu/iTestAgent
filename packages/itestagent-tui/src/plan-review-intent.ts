/** B30: plan-review intent classification. */
export function resolvePlanReviewIntent(input: { targetKind: string }): { lane: string } {
  return { lane: input.targetKind };
}
