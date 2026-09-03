/**
 * artifact-index-contract.test.ts — B03 focused-module slice tests for the
 * ArtifactIndex contract (promotion guide §11.4 "result+artifact-index→B03",
 * §16 G1).
 *
 * Locks the CURRENT behavior of ArtifactIndexSchema after its verbatim move
 * from data-contracts.ts into artifact-index-contracts.ts:
 *
 *   - valid indexes parse and every documented artifact type is accepted;
 *   - required entry fields (id/type/path/redactionStatus) reject absence;
 *   - field-level constraints hold (type/redactionStatus enums, non-negative
 *     integer sizeBytes);
 *   - unknown keys are STRIPPED, not rejected (Zod strip semantics — the
 *     published schemas/artifact-index.schema.json mirrors this accept
 *     behavior by not forbidding additional properties);
 *   - JSON round-trip stability;
 *   - the focused module and the data-contracts compatibility shim expose
 *     the SAME schema object (single source of truth after the split).
 */
import { expect, test } from 'bun:test';
import {
  type ArtifactIndex,
  ArtifactIndexSchema,
  parseArtifactIndex,
} from '../src/artifact-index-contract.js';
import * as dataContracts from '../src/data-contracts.js';

/** Minimal valid artifact entry builder — only the required fields. */
function entry(
  overrides: Partial<ArtifactIndex['artifacts'][number]> = {},
): Record<string, unknown> {
  return {
    id: 'art-1',
    type: 'screenshot',
    path: 'artifacts/shot.png',
    redactionStatus: 'safe',
    ...overrides,
  };
}

// ─── Valid documents ─────────────────────────────────────────────────────────

test('parses a complete artifact index with all optional fields', () => {
  const parsed = ArtifactIndexSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-idx-001',
    artifacts: [
      entry({
        mimeType: 'image/png',
        sizeBytes: 245760,
        sha256: 'abc123def456',
        relatedStep: 'step-1',
        backend: 'appium',
      }),
    ],
    collectionOutcomes: [],
  });
  expect(parsed.schemaVersion).toBe('2.0');
  expect(parsed.runId).toBe('run-idx-001');
  expect(parsed.artifacts).toHaveLength(1);
  const first = parsed.artifacts[0];
  expect(first).toBeDefined();
  if (first) {
    expect(first.mimeType).toBe('image/png');
    expect(first.sizeBytes).toBe(245760);
    expect(first.sha256).toBe('abc123def456');
    expect(first.relatedStep).toBe('step-1');
    expect(first.backend).toBe('appium');
    expect(first.redactionStatus).toBe('safe');
  }
});

test('accepts every one of the 10 documented artifact types', () => {
  const types = [
    'screenshot',
    'video',
    'uitree',
    'log',
    'syslog',
    'crashlog',
    'trace',
    'xcresult',
    'json',
    'text',
  ] as const;
  const parsed = ArtifactIndexSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-types-001',
    artifacts: types.map((type, i) => entry({ id: `art-${i}`, type })),
    collectionOutcomes: [],
  });
  expect(parsed.artifacts).toHaveLength(types.length);
  for (const [i, type] of types.entries()) {
    const art = parsed.artifacts[i];
    expect(art?.type).toBe(type);
  }
});

test('accepts every documented redactionStatus value', () => {
  for (const redactionStatus of ['raw-local-only', 'redacted', 'safe'] as const) {
    const parsed = ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId: 'run-redact-001',
      artifacts: [entry({ redactionStatus })],
      collectionOutcomes: [],
    });
    const first = parsed.artifacts[0];
    expect(first?.redactionStatus).toBe(redactionStatus);
  }
});

test('sizeBytes accepts zero (non-negative boundary)', () => {
  const parsed = ArtifactIndexSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-zero-001',
    artifacts: [entry({ sizeBytes: 0 })],
    collectionOutcomes: [],
  });
  expect(parsed.artifacts[0]?.sizeBytes).toBe(0);
});

// ─── Rejections ──────────────────────────────────────────────────────────────

test('rejects an artifact type outside the documented enum', () => {
  const bad = { ...entry(), type: 'archive' };
  expect(() =>
    ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId: 'run-bad-type',
      artifacts: [bad],
      collectionOutcomes: [],
    }),
  ).toThrow();
});

test('rejects an invalid redactionStatus value', () => {
  const bad = { ...entry(), redactionStatus: 'public' };
  expect(() =>
    ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId: 'run-bad-redaction',
      artifacts: [bad],
      collectionOutcomes: [],
    }),
  ).toThrow();
});

test('rejects entries missing any required field (id/type/path/redactionStatus)', () => {
  for (const omit of ['id', 'type', 'path', 'redactionStatus'] as const) {
    const bad = entry();
    delete bad[omit];
    expect(() =>
      ArtifactIndexSchema.parse({
        schemaVersion: '2.0',
        runId: 'run-missing-field',
        artifacts: [bad],
        collectionOutcomes: [],
      }),
    ).toThrow();
  }
});

test('rejects negative sizeBytes', () => {
  expect(() =>
    ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId: 'run-neg-size',
      artifacts: [entry({ sizeBytes: -1 })],
      collectionOutcomes: [],
    }),
  ).toThrow();
});

test('rejects non-integer sizeBytes', () => {
  expect(() =>
    ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId: 'run-frac-size',
      artifacts: [entry({ sizeBytes: 12.5 })],
      collectionOutcomes: [],
    }),
  ).toThrow();
});

test('rejects a missing top-level runId', () => {
  expect(() =>
    ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      artifacts: [entry()],
      collectionOutcomes: [],
    }),
  ).toThrow();
});

// ─── Strip semantics + round-trip ────────────────────────────────────────────

test('unknown keys are stripped, not rejected (Zod strip semantics)', () => {
  const parsed = ArtifactIndexSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-strip-001',
    futureTopLevel: 'kept-out',
    artifacts: [{ ...entry(), futureField: 'kept-out' }],
    collectionOutcomes: [],
  });
  expect((parsed as unknown as Record<string, unknown>).futureTopLevel).toBeUndefined();
  expect((parsed.artifacts[0] as unknown as Record<string, unknown>).futureField).toBeUndefined();
});

test('JSON round-trip: parse → stringify → parse is stable', () => {
  const original = {
    schemaVersion: '2.0',
    runId: 'run-rt-003',
    artifacts: [
      entry({ id: 'art-a', type: 'trace', redactionStatus: 'raw-local-only' }),
      entry({ id: 'art-b', type: 'log', sizeBytes: 1024, redactionStatus: 'redacted' }),
    ],
    collectionOutcomes: [],
  };
  const once = parseArtifactIndex(original);
  const twice = parseArtifactIndex(JSON.parse(JSON.stringify(once)));
  expect(twice).toEqual(once);
});

// ─── Split consistency ───────────────────────────────────────────────────────

test('data-contracts shim re-exports the SAME schema object (single source of truth)', () => {
  expect(dataContracts.ArtifactIndexSchema).toBe(ArtifactIndexSchema);
  expect(dataContracts.parseArtifactIndex).toBe(parseArtifactIndex);
});
