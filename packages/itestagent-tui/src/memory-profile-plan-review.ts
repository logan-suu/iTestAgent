/** B30: memory-profile plan review. */
export function resolveMemoryProfilePlanReview(input: { thresholdMB: number }): {
  thresholdMB: number;
} {
  return { thresholdMB: input.thresholdMB };
}
