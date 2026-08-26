/** B19: app source probes. */
export interface AppSourceProbeResult {
  appPresent: boolean;
}
export function probeAppSource(input: { appPresent: boolean }): AppSourceProbeResult {
  return { appPresent: input.appPresent };
}
