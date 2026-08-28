/** B19: signing team identity (memory-only, R6). */
export interface SigningTeam {
  teamId?: string;
}
export function resolveSigningTeam(input: { teamId?: string } = {}): SigningTeam {
  return { teamId: input.teamId };
}
