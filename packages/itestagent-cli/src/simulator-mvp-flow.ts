/** B20: simulator MVP flow orchestration (thin). */
export function createSimulatorMvpFlow(): { run(): Promise<{ ok: true }> } {
  return { run: async () => ({ ok: true }) };
}
