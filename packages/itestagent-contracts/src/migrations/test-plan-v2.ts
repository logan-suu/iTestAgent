/** B37: test-plan v2 → canonical migration (pure function, §10). */
import type { MigrationResult } from './types.js';

export function migrateTestPlanV2(raw: unknown): MigrationResult<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      issues: [{ code: 'not_object', message: 'test-plan v2 must be an object' }],
    };
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 'itestagent.test-plan.v2') {
    return {
      ok: false,
      issues: [
        { code: 'unsupported_version', message: 'test-plan migration expects schemaVersion v2' },
      ],
    };
  }
  return { ok: true, value: { ...record } };
}
