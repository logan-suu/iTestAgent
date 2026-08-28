/** B23: memory-profile runtime build state. */
export function resolveRuntimeBuild(input: { built?: boolean } = {}): { built: boolean } {
  return { built: input.built ?? false };
}
