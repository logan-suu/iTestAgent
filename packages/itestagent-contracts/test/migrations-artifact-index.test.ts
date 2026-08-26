import { describe, expect, it } from 'bun:test';
import { migrateArtifactIndexV1 } from '../src/migrations/artifact-index-v1.js';

describe('migrateArtifactIndexV1', () => {
  it('migrates a v1 artifact index to canonical', () => {
    expect(migrateArtifactIndexV1({ schemaVersion: '1.0', artifacts: [] }).ok).toBe(true);
  });
});
