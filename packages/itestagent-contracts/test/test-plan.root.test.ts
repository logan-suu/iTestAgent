/**
 * test-plan.root.test.ts — B04 root TestPlan schema behavior + published
 * schema parity for the TestPlan slice (promotion batch B04, guide §11.3
 * "TestPlan/target execution", §11.4 "Schema mapping: TestPlan→B04").
 *
 * Replaces the root section of the former monolithic `test-plan.test.ts`.
 * Published-schema assertions live HERE (not in the shared
 * json-schema-parity.test.ts) because that file is a §11.4.5 shared-file
 * serialization point owned by B02/B03 — B04 must not touch it.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEST_PLAN_SCHEMA_VERSION,
  TestPlanSchema,
  parseTestPlan,
  safeParseTestPlan,
} from '../src/test-plan.js';
import { makeValidTestPlan } from './test-plan.fixture.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const PUBLISHED_PATH = join(REPO_ROOT, 'schemas', 'test-plan.schema.json');

// ─── Root schema behavior ────────────────────────────────────

describe('TestPlanSchema (root)', () => {
  it('accepts the canonical valid plan unchanged', () => {
    const parsed = TestPlanSchema.parse(makeValidTestPlan());
    expect(parsed.runId).toBe('run_20260720_001');
    expect(parsed.device.kind).toBe('physical');
  });

  it('locks the schemaVersion literal to the exported constant', () => {
    expect(TEST_PLAN_SCHEMA_VERSION).toBe('itestagent.test-plan.v2');
    const wrongVersion = makeValidTestPlan({
      schemaVersion: 'itestagent.test-plan.v1' as 'itestagent.test-plan.v2',
    });
    expect(TestPlanSchema.safeParse(wrongVersion).success).toBe(false);
  });

  it('rejects unknown top-level keys (strict root)', () => {
    const withExtra = makeValidTestPlan({});
    const mutated = { ...withExtra, scenarioPack: 'feed-memory' } as typeof withExtra & {
      scenarioPack: string;
    };
    // Scenario identity belongs in the scenarios subpath (guide §9 Stage 1),
    // never as a free-form root field.
    expect(TestPlanSchema.safeParse(mutated).success).toBe(false);
  });

  it('requires every S3 contract section (AGENTS.md §5 plan.yaml field list)', () => {
    const base = makeValidTestPlan();
    for (const key of [
      'schemaVersion',
      'runId',
      'projectProfileRef',
      'target',
      'device',
      'appSource',
      'backendPreference',
      'execution',
      'artifacts',
      'performance',
      'safety',
    ] as const) {
      const partial = { ...base } as Record<string, unknown>;
      delete partial[key];
      expect(TestPlanSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe('parseTestPlan / safeParseTestPlan', () => {
  it('round-trips a valid plan', () => {
    const plan = makeValidTestPlan();
    expect(parseTestPlan(plan)).toEqual(plan);
  });

  it('safeParse reports failure without throwing on invalid input', () => {
    const result = safeParseTestPlan({ schemaVersion: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// ─── Published schema parity (B04-owned section) ─────────────

interface JsonRecord {
  [key: string]: unknown;
}

function loadPublished(): JsonRecord {
  expect(existsSync(PUBLISHED_PATH)).toBe(true);
  return JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')) as JsonRecord;
}

describe('published schemas/test-plan.schema.json parity (B04)', () => {
  it('exists and pins JSON Schema metadata', () => {
    const published = loadPublished();
    expect(published.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(typeof published.$id).toBe('string');
    expect(typeof published.title).toBe('string');
  });

  it('keeps root properties and required aligned with the runtime shape', () => {
    const published = loadPublished();
    const properties = published.properties as JsonRecord;
    const required = published.required as string[];
    expect(Object.keys(properties).sort()).toEqual(
      [
        'schemaVersion',
        'runId',
        'projectProfileRef',
        'target',
        'device',
        'appSource',
        'backendPreference',
        'execution',
        'artifacts',
        'performance',
        'safety',
      ].sort(),
    );
    expect(required.sort()).toEqual(Object.keys(properties).sort());
    expect(published.additionalProperties).toBe(false);
  });

  it('exposes ExecutionPlan.xcuitest with the runtime shape (B04 addition)', () => {
    const published = loadPublished();
    const defs = published.$defs as JsonRecord;
    const executionPlan = defs.ExecutionPlan as JsonRecord;
    const props = executionPlan.properties as JsonRecord;

    // Runtime: optional strict object {scheme?, configuration?}.
    expect(props.xcuitest).toBeDefined();
    const xcuitest = props.xcuitest as JsonRecord;
    expect(xcuitest.additionalProperties).toBe(false);
    expect(Object.keys(xcuitest.properties as JsonRecord).sort()).toEqual(
      ['configuration', 'scheme'].sort(),
    );

    // Not required — backward compatible with v2 plans authored before B04.
    expect(executionPlan.required as string[]).not.toContain('xcuitest');
  });

  it('publishes the same schemaVersion literal as the runtime constant', () => {
    const published = loadPublished();
    const properties = published.properties as JsonRecord;
    const schemaVersion = properties.schemaVersion as JsonRecord;
    expect(schemaVersion.const).toBe(TEST_PLAN_SCHEMA_VERSION);
  });
});
