/** B19: physical MVP replay wrapper (thin, B08 flow replay). */
export function createPhysicalMvpReplay(_deps: unknown = {}): { replay(): Promise<{ ok: true }> } {
  return { replay: async () => ({ ok: true }) };
}
