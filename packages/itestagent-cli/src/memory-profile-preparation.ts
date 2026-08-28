/** B23: memory-profile preparation helpers. */
export function prepareMemoryProfileRun(input: { ready: boolean }): { ready: boolean } {
  return { ready: input.ready };
}
