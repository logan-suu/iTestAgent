/** B19: provisioning profile coverage. */
export interface ProfileCoverage {
  covered: boolean;
}
export function resolveProfileCoverage(input: { covered?: boolean } = {}): ProfileCoverage {
  return { covered: input.covered ?? false };
}
