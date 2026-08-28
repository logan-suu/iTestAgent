/**
 * report-trio-atomicity.test.ts — B09 trio consistency contract (promotion
 * guide §11.3 "report validation"; AGENTS.md §5: 报告固定三件套
 * summary.md + result.json + artifact-index.json).
 *
 * The three documents are generated together and must reference each other
 * consistently: a result.json shipped with dangling artifactRefs (or an
 * artifact-index carrying duplicate ids) would silently break auditability.
 * This suite wires the B09 validator into that cross-document contract.
 */
import { describe, expect, it } from 'bun:test';
import { findDanglingArtifactRefs, findDuplicateArtifactIds } from '../src/report-validator.js';

describe('report trio consistency contract', () => {
  it('accepts a coherent trio: every result artifactRef resolves and ids are unique', () => {
    const artifactIndex = [{ id: 'art-shot-1' }, { id: 'art-tree-1' }, { id: 'art-log-1' }];
    const resultRefs = ['art-shot-1', 'art-tree-1', 'art-log-1'];

    expect(findDanglingArtifactRefs(resultRefs, artifactIndex)).toEqual([]);
    expect(findDuplicateArtifactIds(artifactIndex)).toEqual([]);
  });

  it('rejects a trio whose result references a missing artifact', () => {
    const artifactIndex = [{ id: 'art-shot-1' }];
    const resultRefs = ['art-shot-1', 'art-video-missing'];

    const dangling = findDanglingArtifactRefs(resultRefs, artifactIndex);
    expect(dangling.map((issue) => issue.code)).toEqual(['dangling_artifact_ref']);
  });

  it('rejects a trio whose artifact index contains duplicate ids', () => {
    const artifactIndex = [{ id: 'art-shot-1' }, { id: 'art-shot-1' }];
    expect(findDuplicateArtifactIds(artifactIndex).map((issue) => issue.code)).toEqual([
      'duplicate_artifact_id',
    ]);
  });
});
