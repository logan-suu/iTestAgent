/** Legacy TestPlan v1/v2 → canonical v3 migration (ADR-022/ADR-029). */
import type { MigrationIssue, MigrationResult } from './types.js';

type JsonRecord = Record<string, unknown>;

function issue(code: string, message: string): MigrationResult<JsonRecord> {
  return { ok: false, issues: [{ code, message }] };
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function inferResolvedExecution(
  execution: JsonRecord,
):
  | { resolvedPath: 'xcuitest' | 'device_backend'; selectionReason: 'explicit_preference' }
  | MigrationIssue {
  const prefer = execution.prefer;
  const scheme = asRecord(execution.xcuitest)?.scheme;

  if (prefer === 'device_backend') {
    return { resolvedPath: 'device_backend', selectionReason: 'explicit_preference' };
  }
  if (prefer === 'xcuitest' && typeof scheme === 'string' && scheme.length > 0) {
    return { resolvedPath: 'xcuitest', selectionReason: 'explicit_preference' };
  }

  return {
    code: 'execution_route_ambiguous',
    message:
      'legacy TestPlan does not contain enough evidence to resolve its execution route; re-plan and confirm the route',
  };
}

function migrateLegacyTestPlan(
  raw: unknown,
  expectedVersion: 'itestagent.test-plan.v1' | 'itestagent.test-plan.v2',
): MigrationResult<JsonRecord> {
  const record = asRecord(raw);
  if (!record) return issue('not_object', 'legacy test plan must be an object');
  if (record.schemaVersion !== expectedVersion) {
    return issue(
      'unsupported_version',
      `test-plan migration expects schemaVersion ${expectedVersion}`,
    );
  }

  const execution = asRecord(record.execution);
  if (!execution) return issue('missing_execution', 'legacy TestPlan.execution must be an object');
  const resolution = inferResolvedExecution(execution);
  if ('code' in resolution) return { ok: false, issues: [resolution] };

  const { xcuitest: _legacyXcuitest, ...executionWithoutXcuitest } = execution;
  const migratedExecution: JsonRecord = {
    ...(resolution.resolvedPath === 'device_backend' ? executionWithoutXcuitest : execution),
    ...resolution,
    fallback: resolution.resolvedPath === 'xcuitest' ? 'abort' : execution.fallback,
  };

  return {
    ok: true,
    value: {
      ...record,
      schemaVersion: 'itestagent.test-plan.v3',
      execution: migratedExecution,
    },
  };
}

export function migrateTestPlanV1(raw: unknown): MigrationResult<JsonRecord> {
  return migrateLegacyTestPlan(raw, 'itestagent.test-plan.v1');
}

export function migrateTestPlanV2(raw: unknown): MigrationResult<JsonRecord> {
  return migrateLegacyTestPlan(raw, 'itestagent.test-plan.v2');
}

/** Compatibility reader dispatch for persisted TestPlan documents. */
export function migrateTestPlanToV3(raw: unknown): MigrationResult<JsonRecord> {
  const record = asRecord(raw);
  if (!record) return issue('not_object', 'test plan must be an object');
  if (record.schemaVersion === 'itestagent.test-plan.v3') {
    return { ok: true, value: { ...record } };
  }
  if (record.schemaVersion === 'itestagent.test-plan.v2') return migrateTestPlanV2(record);
  if (record.schemaVersion === 'itestagent.test-plan.v1') return migrateTestPlanV1(record);
  return issue('unsupported_version', 'unsupported TestPlan schemaVersion');
}
