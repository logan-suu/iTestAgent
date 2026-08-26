/** B37: artifact-index v1 → canonical migration (pure function, §10). */
import type { MigrationResult } from './types.js';

export function migrateArtifactIndexV1(raw: unknown): MigrationResult<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      issues: [{ code: 'not_object', message: 'artifact-index v1 must be an object' }],
    };
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== '1.0') {
    return {
      ok: false,
      issues: [
        {
          code: 'unsupported_version',
          message: 'artifact-index migration expects schemaVersion 1.0',
        },
      ],
    };
  }
  return { ok: true, value: { ...record, schemaVersion: '1.0' } };
}
