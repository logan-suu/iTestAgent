/** B23: memory-profile Appium wiring. */
export function resolveAppiumPort(input: { port?: number } = {}): { port: number } {
  return { port: input.port ?? 4723 };
}
