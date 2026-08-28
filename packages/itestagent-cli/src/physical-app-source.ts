/** B19: physical app source (injected identity, §6.2). */
export interface PhysicalAppSource {
  appBundleId: string;
}
export function resolveAppSource(input: { appBundleId: string }): PhysicalAppSource {
  return { appBundleId: input.appBundleId };
}
