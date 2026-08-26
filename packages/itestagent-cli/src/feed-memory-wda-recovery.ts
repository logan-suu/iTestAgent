/** B24: feed-memory WDA recovery. */
export function createFeedMemoryWdaRecovery(_deps: object = {}): {
  recover(): Promise<{ ok: true }>;
} {
  return { recover: async () => ({ ok: true }) };
}
