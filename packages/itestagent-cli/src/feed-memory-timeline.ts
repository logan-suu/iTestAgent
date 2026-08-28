/** B24: feed-memory timeline helpers. */
export function appendFeedMemoryTimeline(entry: string, timeline: string[] = []): string[] {
  return [...timeline, entry];
}
