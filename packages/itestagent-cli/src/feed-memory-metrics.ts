/** B24: feed-memory metrics surface. */
export function collectFeedMemoryMetrics(input: { metrics?: string[] } = {}): {
  metrics: string[];
} {
  return { metrics: input.metrics ?? [] };
}
