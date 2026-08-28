/** B37: config v1 → canonical migration (pure function, §10). */
import type { MigrationResult } from './types.js';

export function migrateConfigV1(raw: unknown): MigrationResult<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, issues: [{ code: 'not_object', message: 'config v1 must be an object' }] };
  }
  const record = raw as Record<string, unknown>;
  const version = record.schemaVersion;
  if (version !== undefined && version !== '1.0') {
    return {
      ok: false,
      issues: [
        { code: 'unsupported_version', message: `unsupported config version ${String(version)}` },
      ],
    };
  }
  return { ok: true, value: { ...record, schemaVersion: '1.0' } };
}
