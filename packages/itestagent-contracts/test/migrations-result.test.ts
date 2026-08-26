import { describe, expect, it } from 'bun:test';
import { migrateResultV1 } from '../src/migrations/result-v1.js';

describe('migrateResultV1', () => {
  it('migrates a v1 result to canonical', () => {
    const result = migrateResultV1({ schemaVersion: '1.0', runId: 'r1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.schemaVersion).toBe('2.0');
  });
});
