/**
 * run-result-duplicate-rejection.test.ts — B03 cross-field rejection tests
 * (promotion guide §11.4 "result+artifact-index→B03", §16 G1).
 *
 * Proves the duplicate/binding rules that NEITHER the per-document Zod
 * object schemas NOR draft-07 JSON Schema can express. They live in
 * json-schema-cross-field.ts and are enforced on top of the parsed
 * documents:
 *
 *   - duplicate artifact ids inside one ArtifactIndex are rejected;
 *   - duplicate caseIds inside RunResult.cases are rejected;
 *   - duplicate entries in RunResult.artifactRefs are rejected;
 *   - an ArtifactIndex whose runId differs from the paired RunResult is
 *     rejected (cross-document runId binding);
 *   - artifactRefs that resolve to no index entry are rejected;
 *   - a fully consistent pair passes, and parseValidatedRunResultPair
 *     returns both parsed documents.
 */
import { expect, test } from 'bun:test';
import type { ArtifactIndex } from '../src/artifact-index-contract.js';
import {
  CrossFieldValidationError,
  assertValidRunResultArtifactIndexPair,
  findDuplicateArtifactIds,
  findDuplicateArtifactRefs,
  findDuplicateCaseIds,
  findUnresolvedArtifactRefs,
  parseValidatedRunResultPair,
  validateRunResultArtifactIndexPair,
} from '../src/json-schema-cross-field.js';
import type { RunResult } from '../src/run-result-contracts.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid RunResult fixture (all required fields, nothing optional). */
function resultFixture(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: '3.0',
    runId: 'run-20260825-001',
    status: 'failed',
    projectProfileRef: '~/.itestagent/projects/abc/project-profile.json',
    device: {
      udid: '00008110-ABCDEF1234567890',
      name: 'iPhone 15 Pro',
      model: 'iPhone15,2',
      osVersion: '18.2',
      targetKind: 'physical',
    },
    execution: {
      mode: 'device_backend',
      totalSteps: 2,
      completedSteps: 1,
      failedSteps: 1,
      skippedSteps: 0,
      durationMs: 5000,
      startTime: '2026-08-25T10:00:00.000Z',
      endTime: '2026-08-25T10:00:05.000Z',
      targetKind: 'physical',
      backendUsed: 'appium',
      deviceId: '00008110-ABCDEF1234567890',
    },
    cases: [
      {
        caseId: 'tc-login-001',
        name: 'Login with valid credentials',
        status: 'passed',
        steps: ['step-1'],
        durationMs: 2000,
        artifacts: ['art-shot-1'],
      },
      {
        caseId: 'tc-login-002',
        name: 'Login with invalid password',
        status: 'failed',
        steps: ['step-2'],
        durationMs: 800,
        error: 'Assertion failed: expected error toast',
        artifacts: [],
      },
    ],
    metrics: {},
    environment: {
      targetKind: 'physical',
      representativeOfPhysicalDevice: true,
      comparisonScope: 'physical_only',
    },
    artifactRefs: ['art-shot-1', 'art-log-1'],
    ...overrides,
  };
}

/** Minimal valid ArtifactIndex fixture covering every ref used above. */
function indexFixture(overrides: Partial<ArtifactIndex> = {}): ArtifactIndex {
  return {
    schemaVersion: '2.0',
    runId: 'run-20260825-001',
    artifacts: [
      {
        id: 'art-shot-1',
        type: 'screenshot',
        path: 'artifacts/step-1.png',
        redactionStatus: 'safe',
      },
      {
        id: 'art-log-1',
        type: 'log',
        path: 'artifacts/syslog.txt',
        redactionStatus: 'redacted',
      },
    ],
    collectionOutcomes: [
      {
        type: 'screenshot',
        status: 'collected',
        reasonCode: 'collected',
        artifactId: 'art-shot-1',
      },
      { type: 'log', status: 'collected', reasonCode: 'collected', artifactId: 'art-log-1' },
    ],
    ...overrides,
  };
}

/** Appends a second entry with the SAME id as the first (duplicate builder). */
function withDuplicateFirstArtifactId(index: ArtifactIndex): ArtifactIndex {
  const first = index.artifacts[0];
  if (!first) throw new Error('fixture must contain at least one artifact');
  index.artifacts.push({ ...first });
  return index;
}

/** Appends a second case with the SAME caseId as the first (duplicate builder). */
function withDuplicateFirstCaseId(result: RunResult): RunResult {
  const first = result.cases[0];
  if (!first) throw new Error('fixture must contain at least one case');
  result.cases.push({ ...first });
  return result;
}

// ─── Duplicate detection helpers ─────────────────────────────────────────────

test('findDuplicateArtifactIds reports duplicated ids once per extra occurrence', () => {
  expect(findDuplicateArtifactIds(withDuplicateFirstArtifactId(indexFixture()))).toEqual([
    'art-shot-1',
  ]);
});

test('findDuplicateCaseIds reports duplicated caseIds', () => {
  expect(findDuplicateCaseIds(withDuplicateFirstCaseId(resultFixture()))).toEqual(['tc-login-001']);
});

test('findDuplicateArtifactRefs reports duplicated refs in first-seen order', () => {
  const result = resultFixture({ artifactRefs: ['art-a', 'art-a', 'art-b', 'art-b'] });
  expect(findDuplicateArtifactRefs(result)).toEqual(['art-a', 'art-b']);
});

test('helpers return empty arrays for duplicate-free documents', () => {
  expect(findDuplicateArtifactIds(indexFixture())).toEqual([]);
  expect(findDuplicateCaseIds(resultFixture())).toEqual([]);
  expect(findDuplicateArtifactRefs(resultFixture())).toEqual([]);
});

// ─── Pair validation ─────────────────────────────────────────────────────────

test('a fully consistent pair validates clean', () => {
  expect(validateRunResultArtifactIndexPair(resultFixture(), indexFixture())).toEqual([]);
});

test('duplicate artifact ids in the index are rejected', () => {
  const index = withDuplicateFirstArtifactId(indexFixture());
  const issues = validateRunResultArtifactIndexPair(resultFixture(), index);
  expect(issues.length).toBeGreaterThan(0);
  expect(issues.some((issue) => issue.path.startsWith('artifacts['))).toBe(true);
  expect(() => assertValidRunResultArtifactIndexPair(resultFixture(), index)).toThrow(
    CrossFieldValidationError,
  );
});

test('duplicate caseIds in the result are rejected', () => {
  const result = withDuplicateFirstCaseId(resultFixture());
  const issues = validateRunResultArtifactIndexPair(result, indexFixture());
  expect(issues.some((issue) => issue.path.startsWith('cases['))).toBe(true);
  expect(() => assertValidRunResultArtifactIndexPair(result, indexFixture())).toThrow(
    CrossFieldValidationError,
  );
});

test('duplicate artifactRefs entries are rejected', () => {
  const result = resultFixture({
    artifactRefs: ['art-shot-1', 'art-shot-1', 'art-log-1'],
  });
  const issues = validateRunResultArtifactIndexPair(result, indexFixture());
  expect(issues.some((issue) => issue.path.startsWith('artifactRefs['))).toBe(true);
});

test('an index bound to a DIFFERENT run is rejected (cross-document runId binding)', () => {
  const otherRunIndex = indexFixture({ runId: 'run-20260825-999' });
  const issues = validateRunResultArtifactIndexPair(resultFixture(), otherRunIndex);
  expect(issues.some((issue) => issue.path === 'runId')).toBe(true);
  expect(() => assertValidRunResultArtifactIndexPair(resultFixture(), otherRunIndex)).toThrow(
    CrossFieldValidationError,
  );
});

test('artifactRefs that resolve to no index entry are rejected', () => {
  const onlyShot = indexFixture().artifacts[0];
  if (!onlyShot) throw new Error('fixture must contain at least one artifact');
  const sparseIndex = indexFixture({ artifacts: [onlyShot] });
  expect(findUnresolvedArtifactRefs(resultFixture(), sparseIndex)).toEqual(['art-log-1']);
  const issues = validateRunResultArtifactIndexPair(resultFixture(), sparseIndex);
  expect(issues.some((issue) => issue.path.startsWith('artifactRefs['))).toBe(true);
});

test('CrossFieldValidationError carries the offending issues', () => {
  const otherRunIndex = indexFixture({ runId: 'run-other' });
  try {
    assertValidRunResultArtifactIndexPair(resultFixture(), otherRunIndex);
    throw new Error('expected CrossFieldValidationError');
  } catch (error) {
    expect(error).toBeInstanceOf(CrossFieldValidationError);
    if (error instanceof CrossFieldValidationError) {
      expect(error.issues.length).toBeGreaterThan(0);
      expect(error.message).toContain('runId');
    }
  }
});

// ─── Combined parse + pair validation ────────────────────────────────────────

test('parseValidatedRunResultPair returns both parsed documents for a valid pair', () => {
  const rawResult = JSON.parse(JSON.stringify(resultFixture())) as unknown;
  const rawIndex = JSON.parse(JSON.stringify(indexFixture())) as unknown;
  const pair = parseValidatedRunResultPair(rawResult, rawIndex);
  expect(pair.result.runId).toBe('run-20260825-001');
  expect(pair.artifactIndex.runId).toBe('run-20260825-001');
  expect(pair.result.cases).toHaveLength(2);
  expect(pair.artifactIndex.artifacts).toHaveLength(2);
});

test('parseValidatedRunResultPair rejects structurally invalid documents', () => {
  // Invalid RunStatus — must throw before cross-field checks run.
  const rawResult = JSON.parse(
    JSON.stringify({ ...resultFixture(), status: 'success' }),
  ) as unknown;
  const rawIndex = JSON.parse(JSON.stringify(indexFixture())) as unknown;
  expect(() => parseValidatedRunResultPair(rawResult, rawIndex)).toThrow();
});

test('parseValidatedRunResultPair rejects a valid-looking pair with mismatched runIds', () => {
  const rawResult = JSON.parse(JSON.stringify(resultFixture())) as unknown;
  const rawIndex = JSON.parse(JSON.stringify(indexFixture({ runId: 'run-mismatch' }))) as unknown;
  expect(() => parseValidatedRunResultPair(rawResult, rawIndex)).toThrow(CrossFieldValidationError);
});
