/** B19: physical artifact store (thin, B07 evidence writer). */
export function createPhysicalArtifactStore(): { put(): Promise<{ ok: true }> } {
  return { put: async () => ({ ok: true }) };
}
