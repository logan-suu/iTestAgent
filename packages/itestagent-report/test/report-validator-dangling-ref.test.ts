/**
 * report-validator-dangling-ref.test.ts — B09 dangling-reference validation
 * (promotion guide §11.3 "report validation", §10 "dangling ref 校验").
 *
 * The report trio must never ship a result.json whose artifactRefs point at
 * artifacts missing from artifact-index.json — that would break the
 * auditability contract. Validation is a pure function over the parsed
 * trio documents.
 */
import { describe, expect, it } from 'bun:test';
import { findDanglingArtifactRefs, findDuplicateArtifactIds } from '../src/report-validator.js';

describe('findDanglingArtifactRefs', () => {
  it('reports refs that do not resolve in the artifact index', () => {
    const issues = findDanglingArtifactRefs(
      ['art-1', 'art-2', 'art-missing'],
      [{ id: 'art-1' }, { id: 'art-2' }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('dangling_artifact_ref');
    expect(issues[0]?.message).toContain('art-missing');
  });

  it('returns no issues when every ref resolves', () => {
    const issues = findDanglingArtifactRefs(['art-1'], [{ id: 'art-1' }]);
    expect(issues).toEqual([]);
  });

  it('handles an empty artifact list by flagging every ref', () => {
    const issues = findDanglingArtifactRefs(['art-1', 'art-2'], []);
    expect(issues).toHaveLength(2);
  });
});

describe('findDuplicateArtifactIds', () => {
  it('flags duplicated ids in the artifact index', () => {
    const issues = findDuplicateArtifactIds([{ id: 'art-1' }, { id: 'art-1' }, { id: 'art-2' }]);
    expect(issues.map((issue) => issue.code)).toEqual(['duplicate_artifact_id']);
  });

  it('returns no issues for unique ids', () => {
    expect(findDuplicateArtifactIds([{ id: 'a' }, { id: 'b' }])).toEqual([]);
  });
});
