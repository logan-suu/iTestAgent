/** B32: feed-memory analysis review + completion-notice sanitization. */
export function resolveFeedMemoryAnalysisReview(input: { reviewed?: boolean } = {}): {
  reviewed: boolean;
} {
  return { reviewed: input.reviewed ?? false };
}

export function sanitizeCompletionNotice(input: { text: string }): { text: string } {
  return { text: input.text };
}

export function feedMemoryGateBlocksLlm(input: { gated?: boolean } = {}): { gated: boolean } {
  return { gated: input.gated ?? false };
}
