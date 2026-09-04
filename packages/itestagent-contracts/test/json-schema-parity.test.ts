/**
 * json-schema-parity.test.ts — G1 runtime/published schema parity for the
 * contracts schema pairs (promotion guide §11.4 "Schema mapping", §16 G1).
 *
 * Covered pairs (each published JSON Schema in `schemas/` must stay
 * equivalent to its runtime Zod schema exported by
 * `packages/itestagent-contracts`, per `scripts/schema-pair-registry.ts`):
 *
 *   - config.schema.json        ↔ ItestAgentConfigSchema   (B02)
 *   - result.schema.json        ↔ RunResultSchema          (B03)
 *   - artifact-index.schema.json ↔ ArtifactIndexSchema     (B03)
 *
 * For every pair this test locks:
 *
 *   - published file exists, parses as JSON, and is a draft-07 JSON Schema
 *     with $id/title/description metadata;
 *   - top-level properties match the runtime Zod shape exactly;
 *   - required keys match what is actually required at runtime input;
 *   - per-section structure matches the Zod definitions exactly (types,
 *     enums, defaults, strict objects).
 *
 * Equivalence semantics note: the B03 runtime schemas are plain (stripping)
 * Zod objects — unknown keys are dropped on parse, not rejected. Their
 * published schemas therefore do NOT set additionalProperties:false; both
 * sides ACCEPT documents with unknown keys (accept/reject equivalence).
 *
 * SHARED-FILE SERIALIZATION POINT (guide §11.4.5): B02 authored the config
 * section and B03 extended it with the result/artifact-index sections after
 * the B02 commit/tag; batches must never write this file in parallel.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArtifactIndexSchema } from '../src/artifact-index-contract.js';
import {
  DEFAULT_CONFIG,
  DeviceConfigSchema,
  ItestAgentConfigSchema,
  ModelConfigSchema,
  TuiConfigSchema,
} from '../src/config.js';
import {
  ArtifactTypeSchema,
  RedactionStatusSchema,
  TargetKindSchema,
} from '../src/device-artifacts.js';
import { BaselineDeltaSchema } from '../src/performance-backend.js';
import {
  ExecutionSummarySchema,
  FailureExplanationSchema,
  PerformanceMetricsSchema,
  RunResultSchema,
  RunStatusSchema,
  TestCaseResultSchema,
} from '../src/run-result-contracts.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const PUBLISHED_PATH = join(REPO_ROOT, 'schemas', 'config.schema.json');
const RESULT_PUBLISHED_PATH = join(REPO_ROOT, 'schemas', 'result.schema.json');
const ARTIFACT_INDEX_PUBLISHED_PATH = join(REPO_ROOT, 'schemas', 'artifact-index.schema.json');

/** Minimal string-keyed view of parsed JSON used by the assertions below. */
type JsonRecord = Record<string, unknown>;

function loadPublishedSchema(): JsonRecord {
  return loadPublishedSchemaAt(PUBLISHED_PATH);
}

/** Loads and parses any published schema by absolute path (fails if missing). */
function loadPublishedSchemaAt(publishedPath: string): JsonRecord {
  expect(existsSync(publishedPath)).toBe(true);
  const raw = readFileSync(publishedPath, 'utf8');
  return JSON.parse(raw) as JsonRecord;
}

/**
 * Optionality probe view. Zod v4 deprecates `.isOptional()` and documents
 * `safeParse(undefined).success` as the canonical check.
 */
interface FieldLike {
  safeParse(value: unknown): { success: boolean };
}

/** Required keys of a plain Zod object shape (works for mixed shapes). */
function requiredKeysOf(shape: Record<string, FieldLike | undefined>): string[] {
  return Object.keys(shape).filter((key) => !shape[key]?.safeParse(undefined).success);
}

/** Asserts draft-07 $schema/$id/title/description metadata on a published schema. */
function expectDraft07Metadata(published: JsonRecord, idFragment: string): void {
  expect(published.$schema).toBe('http://json-schema.org/draft-07/schema#');
  expect(typeof published.$id).toBe('string');
  expect(published.$id).toContain(idFragment);
  expect(typeof published.title).toBe('string');
  expect((published.title as string).length).toBeGreaterThan(0);
  expect(typeof published.description).toBe('string');
  expect((published.description as string).length).toBeGreaterThan(0);
}

/**
 * Resolves the INPUT-side object shape of the root config schema. Zod v4
 * wraps `.strict().transform(...)` in a pipe: the object shape lives on the
 * pipe's `.in` side (the plain `.shape` accessor no longer exists there).
 */
function rootInputShape(): Record<string, unknown> {
  const schema = ItestAgentConfigSchema as unknown as {
    in?: { shape?: Record<string, unknown> };
    shape?: Record<string, unknown>;
  };
  const shape = schema.in?.shape ?? schema.shape;
  if (!shape) throw new Error('cannot resolve input shape of ItestAgentConfigSchema');
  return shape;
}

/**
 * Computes the set of top-level keys that are REQUIRED at runtime input:
 * a key is required iff omitting it makes validation fail. Keys with a Zod
 * `.default()` or `.optional()` accept absence, so they are not required.
 */
function runtimeRequiredKeys(): string[] {
  const shape = rootInputShape();
  return Object.keys(shape).filter((key) => {
    const probe: Record<string, unknown> = {};
    for (const other of Object.keys(shape)) {
      if (other !== key) probe[other] = undefined;
    }
    return !ItestAgentConfigSchema.safeParse(probe).success;
  });
}

// ─── Published file is a well-formed draft-07 JSON Schema ───────────────────

test('published config schema exists and parses as valid JSON', () => {
  const published = loadPublishedSchema();
  expect(typeof published).toBe('object');
  expect(published).not.toBeNull();
});

test('published config schema carries draft-07 $schema, $id, title and description', () => {
  const published = loadPublishedSchema();
  expect(published.$schema).toBe('http://json-schema.org/draft-07/schema#');
  expect(typeof published.$id).toBe('string');
  expect(published.$id).toContain('config.schema.json');
  expect(typeof published.title).toBe('string');
  expect((published.title as string).length).toBeGreaterThan(0);
  expect(typeof published.description).toBe('string');
  expect((published.description as string).length).toBeGreaterThan(0);
});

// ─── Top-level parity with the runtime Zod shape ─────────────────────────────

test('published schema is an object type whose properties match the runtime Zod shape exactly', () => {
  const published = loadPublishedSchema();
  expect(published.type).toBe('object');
  const props = published.properties as JsonRecord;
  expect(props).toBeDefined();
  expect(Object.keys(props).sort()).toEqual(Object.keys(rootInputShape()).sort());
});

test('published required keys match the runtime-required top-level keys', () => {
  const published = loadPublishedSchema();
  const publishedRequired = Array.isArray(published.required)
    ? (published.required as string[])
    : [];
  expect([...publishedRequired].sort()).toEqual(runtimeRequiredKeys().sort());
});

test('root object rejects unknown keys like the strict Zod schema', () => {
  const published = loadPublishedSchema();
  expect(published.additionalProperties).toBe(false);
});

// ─── Per-section parity ──────────────────────────────────────────────────────

test('schemaVersion property matches the runtime default', () => {
  const published = loadPublishedSchema();
  const schemaVersion = (published.properties as JsonRecord).schemaVersion as JsonRecord;
  expect(schemaVersion.type).toBe('string');
  expect(schemaVersion.default).toBe('1.0');
  // The published default must equal what the runtime parser produces.
  expect(DEFAULT_CONFIG.schemaVersion).toBe(schemaVersion.default as string);
});

test('model section matches ModelConfigSchema exactly', () => {
  const published = loadPublishedSchema();
  const model = (published.properties as JsonRecord).model as JsonRecord;
  expect(model.type).toBe('object');
  // ModelConfigSchema is .strict().
  expect(model.additionalProperties).toBe(false);
  expect(Object.keys(model.properties as JsonRecord).sort()).toEqual(
    Object.keys(ModelConfigSchema.shape).sort(),
  );
  const modelProps = model.properties as JsonRecord;

  const provider = modelProps.provider as JsonRecord;
  expect(provider.type).toBe('string');
  expect(provider.default).toBe('openai');
  expect(DEFAULT_CONFIG.model.provider).toBe(provider.default as string);

  // Optional plain strings carry no defaults at runtime.
  for (const key of ['baseURL', 'apiKeyRef', 'model'] as const) {
    const prop = modelProps[key] as JsonRecord;
    expect(prop.type).toBe('string');
    expect(prop.default).toBeUndefined();
  }
});

test('device section matches DeviceConfigSchema exactly', () => {
  const published = loadPublishedSchema();
  const device = (published.properties as JsonRecord).device as JsonRecord;
  expect(device.type).toBe('object');
  // DeviceConfigSchema is .strict().
  expect(device.additionalProperties).toBe(false);
  expect(Object.keys(device.properties as JsonRecord).sort()).toEqual(
    Object.keys(DeviceConfigSchema.shape).sort(),
  );
  const deviceProps = device.properties as JsonRecord;

  // allowCrossTargetFallback lives INSIDE device (DeviceConfigSchema), with
  // the runtime default false.
  const fallback = deviceProps.allowCrossTargetFallback as JsonRecord;
  expect(fallback).toBeDefined();
  expect(fallback.type).toBe('boolean');
  expect(fallback.default).toBe(false);
  expect(DEFAULT_CONFIG.device.allowCrossTargetFallback).toBe(fallback.default as boolean);

  // allowCrossTargetFallback must NOT be hoisted to the root object.
  expect((published.properties as JsonRecord).allowCrossTargetFallback).toBeUndefined();

  // preferredBackends mirrors the non-strict inner Zod object: enum arrays,
  // no defaults (the runtime leaves them undefined when omitted).
  const preferred = deviceProps.preferredBackends as JsonRecord;
  expect(preferred.type).toBe('object');
  const preferredProps = preferred.properties as JsonRecord;
  expect(Object.keys(preferredProps).sort()).toEqual(['physical', 'simulator']);

  const physical = preferredProps.physical as JsonRecord;
  expect(physical.type).toBe('array');
  expect(((physical.items as JsonRecord).enum as string[]).sort()).toEqual(
    ['appium', 'mobile-mcp', 'mock'].sort(),
  );
  expect(physical.default).toBeUndefined();

  const simulator = preferredProps.simulator as JsonRecord;
  expect(simulator.type).toBe('array');
  expect(((simulator.items as JsonRecord).enum as string[]).sort()).toEqual(
    ['appium', 'mock'].sort(),
  );
  expect(simulator.default).toBeUndefined();

  // The inner preferredBackends Zod object has no .strict(): the published
  // schema must not forbid additional keys there.
  expect(preferred.additionalProperties).not.toBe(false);
});

test('tui section matches TuiConfigSchema exactly', () => {
  const published = loadPublishedSchema();
  const tui = (published.properties as JsonRecord).tui as JsonRecord;
  expect(tui.type).toBe('object');
  // TuiConfigSchema is .strict().
  expect(tui.additionalProperties).toBe(false);
  const framework = (tui.properties as JsonRecord).framework as JsonRecord;
  expect(framework.type).toBe('string');
  expect((framework.enum as string[]).slice().sort()).toEqual(['ansi', 'auto', 'ink', 'opentui']);
  expect(framework.default).toBe('auto');
  expect(DEFAULT_CONFIG.tui.framework).toBe(framework.default as 'auto');
});

// ─── B03: result.schema.json ↔ RunResultSchema parity ────────────────────────

test('published result schema exists and carries draft-07 metadata', () => {
  expectDraft07Metadata(loadPublishedSchemaAt(RESULT_PUBLISHED_PATH), 'result.schema.json');
});

test('published result schema properties match RunResultSchema.shape exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  expect(published.type).toBe('object');
  const props = published.properties as JsonRecord;
  expect(props).toBeDefined();
  expect(Object.keys(props).sort()).toEqual(Object.keys(RunResultSchema.shape).sort());
});

test('published result required keys match the runtime-required top-level keys', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const publishedRequired = Array.isArray(published.required)
    ? (published.required as string[])
    : [];
  expect([...publishedRequired].sort()).toEqual(requiredKeysOf(RunResultSchema.shape).sort());
});

test('published result status mirrors the 9-value RunStatusSchema enum', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const status = (published.properties as JsonRecord).status as JsonRecord;
  expect(status.type).toBe('string');
  expect((status.enum as string[]).slice().sort()).toEqual([...RunStatusSchema.options].sort());
  expect(status.enum as string[]).toContain('infra_failed');
  expect(status.enum as string[]).toContain('cancelled');
});

test('published device section matches the inline device block exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const device = (published.properties as JsonRecord).device as JsonRecord;
  expect(device.type).toBe('object');
  const deviceSchema = RunResultSchema.shape.device;
  expect(Object.keys(device.properties as JsonRecord).sort()).toEqual(
    Object.keys(deviceSchema.shape).sort(),
  );
  expect((device.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(deviceSchema.shape).sort(),
  );
  const targetKind = (device.properties as JsonRecord).targetKind as JsonRecord;
  expect((targetKind.enum as string[]).slice().sort()).toEqual(
    [...TargetKindSchema.options].sort(),
  );
});

test('published execution section matches ExecutionSummarySchema exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const execution = (published.properties as JsonRecord).execution as JsonRecord;
  expect(execution.type).toBe('object');
  expect(Object.keys(execution.properties as JsonRecord).sort()).toEqual(
    Object.keys(ExecutionSummarySchema.shape).sort(),
  );
  expect((execution.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(ExecutionSummarySchema.shape).sort(),
  );
  const execProps = execution.properties as JsonRecord;
  for (const key of [
    'totalSteps',
    'completedSteps',
    'failedSteps',
    'skippedSteps',
    'durationMs',
  ] as const) {
    const prop = execProps[key] as JsonRecord;
    expect(prop.type).toBe('integer');
    expect(prop.minimum).toBe(0);
  }
  const mode = execProps.mode as JsonRecord;
  expect((mode.enum as string[]).slice().sort()).toEqual(['device_backend', 'xcuitest']);
  // Runtime z.string() carries no date-time format — none may be invented.
  const startTime = execProps.startTime as JsonRecord;
  const endTime = execProps.endTime as JsonRecord;
  for (const prop of [startTime, endTime]) {
    expect(prop.type).toBe('string');
    expect(prop.format).toBeUndefined();
  }
});

test('published cases items match TestCaseResultSchema exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const cases = (published.properties as JsonRecord).cases as JsonRecord;
  expect(cases.type).toBe('array');
  const items = cases.items as JsonRecord;
  expect(items.type).toBe('object');
  expect(Object.keys(items.properties as JsonRecord).sort()).toEqual(
    Object.keys(TestCaseResultSchema.shape).sort(),
  );
  expect((items.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(TestCaseResultSchema.shape).sort(),
  );
  const caseProps = items.properties as JsonRecord;
  const durationMs = caseProps.durationMs as JsonRecord;
  const error = caseProps.error as JsonRecord;
  expect(durationMs.type).toBe('integer');
  expect(durationMs.minimum).toBe(0);
  expect(error.type).toBe('string');
});

test('published metrics section matches PerformanceMetricsSchema with all-optional fields', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const metrics = (published.properties as JsonRecord).metrics as JsonRecord;
  expect(metrics.type).toBe('object');
  expect(metrics.additionalProperties).not.toBe(false);
  expect(metrics.required).toBeUndefined();
  expect(Object.keys(metrics.properties as JsonRecord).sort()).toEqual(
    Object.keys(PerformanceMetricsSchema.shape).sort(),
  );
  const metricProps = metrics.properties as JsonRecord;
  for (const key of ['launchDurationMs', 'hangCount'] as const) {
    const prop = metricProps[key] as JsonRecord;
    expect(prop.type).toBe('integer');
    expect(prop.minimum).toBe(0);
  }
  for (const key of ['memoryPeakMB', 'fpsApproximate'] as const) {
    const prop = metricProps[key] as JsonRecord;
    expect(prop.type).toBe('number');
    expect(prop.minimum).toBe(0);
  }
  expect((metricProps.crashDetected as JsonRecord).type).toBe('boolean');
  expect((metricProps.approximate as JsonRecord).type).toBe('boolean');
  expect((metricProps.rawTracePath as JsonRecord).type).toBe('string');
  const hitches = metricProps.hitchesSummary as JsonRecord;
  expect(hitches.type).toBe('string');
  expect((hitches.enum as string[]).slice().sort()).toEqual([
    'high',
    'inconclusive',
    'low',
    'medium',
  ]);
});

test('published environment section matches the inline environment block exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const environment = (published.properties as JsonRecord).environment as JsonRecord;
  expect(environment.type).toBe('object');
  const envSchema = RunResultSchema.shape.environment;
  expect(Object.keys(environment.properties as JsonRecord).sort()).toEqual(
    Object.keys(envSchema.shape).sort(),
  );
  expect((environment.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(envSchema.shape).sort(),
  );
  const envProps = environment.properties as JsonRecord;
  const comparisonScope = envProps.comparisonScope as JsonRecord;
  expect((comparisonScope.enum as string[]).slice().sort()).toEqual([
    'physical_only',
    'simulator_only',
  ]);
  expect((envProps.representativeOfPhysicalDevice as JsonRecord).type).toBe('boolean');
});

test('published baselineDelta section matches BaselineDeltaSchema exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const baselineDelta = (published.properties as JsonRecord).baselineDelta as JsonRecord;
  expect(baselineDelta.type).toBe('object');
  expect(Object.keys(baselineDelta.properties as JsonRecord).sort()).toEqual(
    Object.keys(BaselineDeltaSchema.shape).sort(),
  );
  expect((baselineDelta.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(BaselineDeltaSchema.shape).sort(),
  );
  const deltas = (baselineDelta.properties as JsonRecord).deltas as JsonRecord;
  expect(deltas.type).toBe('object');
  expect(deltas.required).toBeUndefined();
  expect(Object.keys(deltas.properties as JsonRecord).sort()).toEqual(
    Object.keys(BaselineDeltaSchema.shape.deltas.shape).sort(),
  );
  // Deltas are signed numbers (negative = improvement) — no minimum.
  const launchDelta = (deltas.properties as JsonRecord).launchDurationMs as JsonRecord;
  expect(launchDelta.type).toBe('number');
  expect(launchDelta.minimum).toBeUndefined();
  const summary = (baselineDelta.properties as JsonRecord).summary as JsonRecord;
  expect((summary.enum as string[]).slice().sort()).toEqual([
    'improved',
    'inconclusive',
    'regressed',
    'unchanged',
  ]);
});

test('published explanation section matches FailureExplanationSchema exactly', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const explanation = (published.properties as JsonRecord).explanation as JsonRecord;
  expect(explanation.type).toBe('object');
  expect(Object.keys(explanation.properties as JsonRecord).sort()).toEqual(
    Object.keys(FailureExplanationSchema.shape).sort(),
  );
  expect((explanation.required as string[]).slice().sort()).toEqual(
    requiredKeysOf(FailureExplanationSchema.shape).sort(),
  );
  const explProps = explanation.properties as JsonRecord;
  const explanationType = explProps.explanationType as JsonRecord;
  expect(explanationType.type).toBe('string');
  expect((explanationType.enum as string[]).slice().sort()).toEqual(
    FailureExplanationSchema.shape.explanationType.options.slice().sort(),
  );
  const confidence = explProps.confidence as JsonRecord;
  expect((confidence.enum as string[]).slice().sort()).toEqual(['high', 'low', 'medium']);
  const evidence = explProps.evidence as JsonRecord;
  expect(evidence.type).toBe('array');
  expect((evidence.items as JsonRecord).type).toBe('string');
});

test('published artifactRefs is an array of strings', () => {
  const published = loadPublishedSchemaAt(RESULT_PUBLISHED_PATH);
  const artifactRefs = (published.properties as JsonRecord).artifactRefs as JsonRecord;
  expect(artifactRefs.type).toBe('array');
  expect((artifactRefs.items as JsonRecord).type).toBe('string');
});

// ─── B03: artifact-index.schema.json ↔ ArtifactIndexSchema parity ────────────

test('published artifact-index schema exists and carries draft-07 metadata', () => {
  expectDraft07Metadata(
    loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH),
    'artifact-index.schema.json',
  );
});

test('published artifact-index properties match ArtifactIndexSchema.shape exactly', () => {
  const published = loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH);
  expect(published.type).toBe('object');
  const props = published.properties as JsonRecord;
  expect(props).toBeDefined();
  expect(Object.keys(props).sort()).toEqual(Object.keys(ArtifactIndexSchema.shape).sort());
  const publishedRequired = Array.isArray(published.required)
    ? (published.required as string[])
    : [];
  expect([...publishedRequired].sort()).toEqual(requiredKeysOf(ArtifactIndexSchema.shape).sort());
});

test('published artifact entries match the runtime entry shape exactly', () => {
  const published = loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH);
  const artifacts = (published.properties as JsonRecord).artifacts as JsonRecord;
  expect(artifacts.type).toBe('array');
  const items = artifacts.items as JsonRecord;
  expect(items.type).toBe('object');
  const entryShape = ArtifactIndexSchema.shape.artifacts.element.shape;
  expect(Object.keys(items.properties as JsonRecord).sort()).toEqual(
    Object.keys(entryShape).sort(),
  );
  expect((items.required as string[]).slice().sort()).toEqual(requiredKeysOf(entryShape).sort());
});

test('published artifact type enum has exactly the 10 runtime values including syslog', () => {
  const published = loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH);
  const artifacts = (published.properties as JsonRecord).artifacts as JsonRecord;
  const type = ((artifacts.items as JsonRecord).properties as JsonRecord).type as JsonRecord;
  expect(type.type).toBe('string');
  expect(type.enum as string[]).toHaveLength(10);
  expect((type.enum as string[]).slice().sort()).toEqual([...ArtifactTypeSchema.options].sort());
  expect(type.enum as string[]).toContain('syslog');
});

test('published redactionStatus enum mirrors RedactionStatusSchema', () => {
  const published = loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH);
  const artifacts = (published.properties as JsonRecord).artifacts as JsonRecord;
  const redactionStatus = ((artifacts.items as JsonRecord).properties as JsonRecord)
    .redactionStatus as JsonRecord;
  expect(redactionStatus.type).toBe('string');
  expect((redactionStatus.enum as string[]).slice().sort()).toEqual(
    [...RedactionStatusSchema.options].sort(),
  );
});

test('published sizeBytes is a non-negative integer', () => {
  const published = loadPublishedSchemaAt(ARTIFACT_INDEX_PUBLISHED_PATH);
  const artifacts = (published.properties as JsonRecord).artifacts as JsonRecord;
  const sizeBytes = ((artifacts.items as JsonRecord).properties as JsonRecord)
    .sizeBytes as JsonRecord;
  expect(sizeBytes.type).toBe('integer');
  expect(sizeBytes.minimum).toBe(0);
});
