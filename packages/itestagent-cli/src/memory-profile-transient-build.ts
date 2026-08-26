/** B23: memory-profile transient build state. */
export function resolveTransientBuild(input: { built?: boolean } = {}): { built: boolean } {
  return { built: input.built ?? false };
}
