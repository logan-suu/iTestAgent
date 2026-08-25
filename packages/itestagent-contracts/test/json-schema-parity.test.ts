/**
 * json-schema-parity.test.ts — G1 runtime/published schema parity for the
 * config pair (promotion guide §11.4 "Schema mapping: config->B02", §16 G1).
 *
 * The published JSON Schema at `schemas/config.schema.json` must stay
 * equivalent to the runtime Zod schema `ItestAgentConfigSchema` exported by
 * `packages/itestagent-contracts` (registered in
 * `scripts/schema-pair-registry.ts`). This test locks:
 *
 *   - published file exists, parses as JSON, and is a draft-07 JSON Schema
 *     with $id/title/description metadata;
 *   - top-level properties match the runtime Zod shape exactly;
 *   - required keys match what is actually required at runtime input;
 *   - per-section structure matches the Zod definitions exactly (types,
 *     enums, defaults, strict objects).
 *
 * SHARED-FILE SERIALIZATION POINT (guide §11.4.5): B03 extends this file with
 * the result/artifact-index pairs and MUST rebase after the B02 commit/tag;
 * B02 and B03 must never write it in parallel.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  DeviceConfigSchema,
  ItestAgentConfigSchema,
  ModelConfigSchema,
  TuiConfigSchema,
} from '../src/config.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const PUBLISHED_PATH = join(REPO_ROOT, 'schemas', 'config.schema.json');

/** Minimal string-keyed view of parsed JSON used by the assertions below. */
type JsonRecord = Record<string, unknown>;

function loadPublishedSchema(): JsonRecord {
  expect(existsSync(PUBLISHED_PATH)).toBe(true);
  const raw = readFileSync(PUBLISHED_PATH, 'utf8');
  return JSON.parse(raw) as JsonRecord;
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
  expect((framework.enum as string[]).slice().sort()).toEqual(['ink', 'opentui']);
  expect(framework.default).toBe('opentui');
  expect(DEFAULT_CONFIG.tui.framework).toBe(framework.default as 'opentui' | 'ink');
});
