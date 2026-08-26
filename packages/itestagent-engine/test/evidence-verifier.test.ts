import { describe, expect, it } from 'bun:test';
import { verifyEvidenceRefs } from '../src/analysis/evidence-verifier.js';

describe('verifyEvidenceRefs', () => {
  it('flags refs that do not resolve in the artifact index', () => {
    const issues = verifyEvidenceRefs({ artifactRefs: ['a', 'missing'], artifactIds: ['a'] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('dangling_evidence_ref');
  });
  it('returns no issues when every ref resolves', () => {
    expect(verifyEvidenceRefs({ artifactRefs: ['a'], artifactIds: ['a'] })).toEqual([]);
  });
});
