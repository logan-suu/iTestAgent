/** B23: memory-profile debug signing (memory-only, R6). */
export function resolveDebugSigning(input: { enabled?: boolean } = {}): { enabled: boolean } {
  return { enabled: input.enabled ?? false };
}
