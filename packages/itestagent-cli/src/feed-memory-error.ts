/** B24: feed-memory error helpers. */
export function formatFeedMemoryError(error: unknown): string {
  return `Feed-memory error: ${error instanceof Error ? error.message : String(error)}`;
}
