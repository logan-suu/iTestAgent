/**
 * Evidence verifier — B16 module split (promotion guide §11.3 "engine
 * analysis/intents").
 *
 * Pure function over evidence references vs the artifact index: a run whose
 * evidence points at missing artifacts silently breaks auditability, so the
 * engine flags it before reporting.
 */

export interface EvidenceVerifierInput {
  artifactRefs: readonly string[];
  artifactIds: readonly string[];
}

export interface EvidenceVerifierIssue {
  code: 'dangling_evidence_ref';
  message: string;
}

/** Returns an issue for every evidence ref missing from the artifact index. */
export function verifyEvidenceRefs(input: EvidenceVerifierInput): EvidenceVerifierIssue[] {
  const known = new Set(input.artifactIds);
  return input.artifactRefs
    .filter((ref) => !known.has(ref))
    .map((ref) => ({
      code: 'dangling_evidence_ref' as const,
      message: `evidence ref "${ref}" not in artifact index`,
    }));
}
