import { describe, expect, it } from 'bun:test';
import { migrateConfigV1 } from '../src/migrations/config-v1.js';

describe('migrateConfigV1', () => {
  it('accepts a config with a missing schemaVersion (treated as 1.0)', () => {
    expect(migrateConfigV1({ apiKeyRef: 'k' }).ok).toBe(true);
  });
  it('rejects an unsupported version', () => {
    expect(migrateConfigV1({ schemaVersion: '9.9' }).ok).toBe(false);
  });
  it('rejects non-object input', () => {
    expect(migrateConfigV1('nope').ok).toBe(false);
  });
});
