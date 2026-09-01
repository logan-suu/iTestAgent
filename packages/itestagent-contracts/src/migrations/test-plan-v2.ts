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

const LEGACY_PERMISSION_ACTIONS: Readonly<Record<string, string>> = {
  clear_data: 'clear_app_data',
  reinstall: 'replace_device_app',
  write_project: 'write_project_file',
  store_credential: 'store_credential',
  update_baseline: 'update_baseline',
  save_flow: 'save_flow',
  overwrite_flow: 'overwrite_flow',
  generate_draft: 'generate_draft_test',
};

function migrateSafety(record: JsonRecord): MigrationResult<JsonRecord> {
  const safety = asRecord(record.safety);
  if (!safety) return issue('missing_safety', 'legacy TestPlan.safety must be an object');
  if (!Array.isArray(safety.highRiskActions)) {
    return issue(
      'invalid_high_risk_actions',
      'legacy TestPlan.safety.highRiskActions must be an array',
    );
  }
  const migrated: string[] = [];
  for (const action of safety.highRiskActions) {
    if (typeof action !== 'string' || !LEGACY_PERMISSION_ACTIONS[action]) {
      return issue(
        'unknown_high_risk_action',
        `legacy TestPlan contains an unknown high-risk action: ${String(action)}`,
      );
    }
    const canonical = LEGACY_PERMISSION_ACTIONS[action];
    if (canonical && !migrated.includes(canonical)) migrated.push(canonical);
  }
  return { ok: true, value: { ...safety, highRiskActions: migrated } };
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
  const safety = migrateSafety(record);
  if (!safety.ok) return safety;

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
      safety: safety.value,
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
