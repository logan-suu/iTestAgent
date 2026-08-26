/** B24: feed-memory progress logging. */
export function appendFeedMemoryProgress(entry: string, log: string[] = []): string[] {
  return [...log, entry];
}
