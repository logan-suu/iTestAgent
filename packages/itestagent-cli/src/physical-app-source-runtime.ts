/** B19: app source runtime facts. */
export interface AppSourceRuntime {
  installed: boolean;
}
export function resolveAppSourceRuntime(input: { installed?: boolean } = {}): AppSourceRuntime {
  return { installed: input.installed ?? false };
}
