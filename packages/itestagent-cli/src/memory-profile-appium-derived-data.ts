/** B23: memory-profile Appium derived-data resolution. */
export function resolveAppiumDerivedData(input: { path?: string } = {}): { path: string } {
  return { path: input.path ?? '/tmp/itestagent-derived' };
}
