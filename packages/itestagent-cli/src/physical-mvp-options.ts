/** B19: MVP run options. */
export interface MvpOptions {
  collectEvidence: boolean;
}
export function resolveMvpOptions(input: { collectEvidence?: boolean } = {}): MvpOptions {
  return { collectEvidence: input.collectEvidence ?? true };
}
