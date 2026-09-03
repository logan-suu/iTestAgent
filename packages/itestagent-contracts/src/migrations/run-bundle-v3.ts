import { type ArtifactIndex, ArtifactIndexSchema } from '../artifact-index-contract.js';
import { type RunResult, RunResultSchema, migrateV1ToV2 } from '../run-result-contracts.js';
import type { CompatibilityReadResult } from './types.js';

function recordOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

export function readPersistedRunResult(raw: unknown): CompatibilityReadResult<RunResult> {
  const record = recordOf(raw);
  if (!record) {
    return {
      ok: false,
      kind: 'issue',
      issues: [{ code: 'not_object', message: 'result must be an object' }],
    };
  }
  if (record.schemaVersion === '3.0') {
    const parsed = RunResultSchema.safeParse(record);
    return parsed.success
      ? { ok: true, kind: 'canonical', value: parsed.data }
      : {
          ok: false,
          kind: 'issue',
          issues: [{ code: 'invalid_canonical_result', message: parsed.error.message }],
        };
  }
  if (record.schemaVersion === '1.0' || record.schemaVersion === '2.0') {
    const value = record.schemaVersion === '1.0' ? migrateV1ToV2(record) : structuredClone(record);
    return {
      ok: true,
      kind: 'legacy',
      value,
      limitations: [
        'Legacy result does not prove required execution.mode or canonical v3 status semantics.',
      ],
    };
  }
  return {
    ok: false,
    kind: 'issue',
    issues: [{ code: 'unsupported_version', message: 'unsupported result schemaVersion' }],
  };
}

export function readPersistedArtifactIndex(raw: unknown): CompatibilityReadResult<ArtifactIndex> {
  const record = recordOf(raw);
  if (!record) {
    return {
      ok: false,
      kind: 'issue',
      issues: [{ code: 'not_object', message: 'artifact-index must be an object' }],
    };
  }
  if (record.schemaVersion === '2.0') {
    const parsed = ArtifactIndexSchema.safeParse(record);
    return parsed.success
      ? { ok: true, kind: 'canonical', value: parsed.data }
      : {
          ok: false,
          kind: 'issue',
          issues: [{ code: 'invalid_canonical_artifact_index', message: parsed.error.message }],
        };
  }
  if (record.schemaVersion === '1.0') {
    return {
      ok: true,
      kind: 'legacy',
      value: structuredClone(record),
      limitations: ['Legacy artifact index has no evidence collectionOutcomes.'],
    };
  }
  return {
    ok: false,
    kind: 'issue',
    issues: [{ code: 'unsupported_version', message: 'unsupported artifact-index schemaVersion' }],
  };
}
