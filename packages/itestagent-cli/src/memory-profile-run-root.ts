/** B23: memory-profile run root resolution. */
export function resolveMemoryProfileRunRoot(input: { root?: string } = {}): { root: string } {
  return { root: input.root ?? '~/.itestagent/runs' };
}
