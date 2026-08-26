/** B23: memory-profile production state. */
export function resolveMemoryProfileProduction(input: { built?: boolean } = {}): {
  built: boolean;
} {
  return { built: input.built ?? false };
}
