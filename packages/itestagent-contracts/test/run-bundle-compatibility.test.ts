import { describe, expect, test } from 'bun:test';
import {
  readPersistedArtifactIndex,
  readPersistedRunResult,
} from '../src/migrations/run-bundle-v3.js';

describe('run bundle compatibility readers', () => {
  test('rejects malformed legacy documents instead of classifying them as readable', () => {
    expect(readPersistedRunResult({ schemaVersion: '2.0' })).toMatchObject({
      ok: false,
      kind: 'issue',
      issues: [{ code: 'invalid_legacy_result' }],
    });
    expect(readPersistedArtifactIndex({ schemaVersion: '1.0' })).toMatchObject({
      ok: false,
      kind: 'issue',
      issues: [{ code: 'invalid_legacy_artifact_index' }],
    });
  });

  test('rejects unknown versions with a typed compatibility issue', () => {
    expect(readPersistedRunResult({ schemaVersion: '99.0' })).toMatchObject({
      ok: false,
      kind: 'issue',
      issues: [{ code: 'unsupported_version' }],
    });
    expect(readPersistedArtifactIndex({ schemaVersion: '99.0' })).toMatchObject({
      ok: false,
      kind: 'issue',
      issues: [{ code: 'unsupported_version' }],
    });
  });
});
