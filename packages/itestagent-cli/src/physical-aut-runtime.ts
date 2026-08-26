/** B19: AUT (app under test) runtime. */
export interface AutRuntime {
  running: boolean;
}
export function resolveAutRuntime(input: { running?: boolean } = {}): AutRuntime {
  return { running: input.running ?? false };
}
