/** B24: feed-memory sampling config. */
export function resolveFeedMemorySampling(input: { intervalMs?: number } = {}): {
  intervalMs: number;
} {
  return { intervalMs: input.intervalMs ?? 1000 };
}
