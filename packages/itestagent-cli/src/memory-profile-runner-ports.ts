/** B23: memory-profile runner port resolution. */
export function resolveRunnerPorts(input: { port?: number } = {}): { port: number } {
  return { port: input.port ?? 4723 };
}
