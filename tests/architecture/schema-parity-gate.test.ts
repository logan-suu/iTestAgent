/**
 * schema-parity-gate.test.ts
 *
 * B00 architecture gate — G1 MECHANISM verification (promotion guide §12.1,
 * §16 G1). B00 is the audit-infrastructure batch; this gate does not author any
 * runtime schema or parity test itself. It verifies the mechanism that later
 * batches build on:
 *
 *   - registry completeness: every published JSON schema in schemas/ has a
 *     runtime/published pair registered in `scripts/schema-pair-registry.ts`;
 *   - runtime-symbol export: for the pairs present in B00 (the 4 contracts
 *     schemas), the runtime Zod symbol is exported by its runtime package;
 *   - parity-path shape: every registered parityTest path is well-formed
 *     (under the runtime package's test/parity/, ends with .test.ts, basename
 *     matches the schema name).
 *
 * The parity test FILES are authored in later batches, NOT B00 (promotion guide
 * §11.4 schema mapping / §11.3 batch list):
 *   - config.schema.json          -> B02 (contracts config)
 *   - result + artifact-index     -> B03 (result/artifact/cross-field)
 *   - test-plan.schema.json       -> B04 (TestPlan/target execution)
 *   - flow.schema.json            -> B08 (Flow replay/redaction)
 *   - project-profile.schema.json -> B10 (project analyzer)
 *
 * Consequently this gate never asserts that parity files already exist. On the
 * 73c99fb baseline the flow runtime symbol (FlowV2Schema) IS exported by
 * itestagent-flow, while project-profile's ProjectProfileSchema is NOT exported
 * (it was reverted; B10 re-adds it together with its parity test).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SCHEMAS_DIR = join(REPO_ROOT, 'schemas');

interface SchemaPair {
  published: string;
  runtimePackage: string;
  runtimeSymbol: string;
  parityTest: string;
}

/** Loads the schema-pair registry (authored in the GREEN phase). */
async function loadRegistry(): Promise<SchemaPair[]> {
  const mod = (await import('../../scripts/schema-pair-registry')) as {
    registeredPairs?: SchemaPair[];
  };
  return mod.registeredPairs ?? [];
}

/** Discovers published JSON schemas in schemas/ (e.g. "config.schema.json"). */
function publishedSchemas(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();
}

/** Checks that a symbol is exported by a workspace package's entry module. */
async function packageExportsSymbol(packageDir: string, symbol: string): Promise<boolean> {
  const indexPath = join(packageDir, 'src', 'index.ts');
  if (!existsSync(indexPath)) return false;
  try {
    const mod = (await import(indexPath)) as Record<string, unknown>;
    return symbol in mod;
  } catch {
    return false;
  }
}

describe('runtime/published schema registry (guide §16 G1)', () => {
  test('scripts/schema-pair-registry.ts exists and exposes registered schema pairs', async () => {
    // RED phase: the registry module is authored in the GREEN phase, so the
    // dynamic import throws and this test fails (expected).
    const pairs = await loadRegistry();
    expect(pairs.length).toBeGreaterThan(0);
  });

  test('every published schema in schemas/ is registered', async () => {
    const pairs = await loadRegistry();
    const registered = new Set(pairs.map((p) => p.published));
    const missing = publishedSchemas().filter((s) => !registered.has(s));
    expect(missing).toEqual([]);
  });

  test('every registered runtime symbol is exported by its runtime package', async () => {
    // B00 scope: only the contracts pairs must export their runtime symbols
    // today (guide §11.4: config->B02, result+artifact-index->B03,
    // TestPlan->B04). The flow and project-profile pairs are future-batch
    // pairs (flow->B08, project-profile->B10, guide §11.3): their symbols are
    // either exported now or explicitly documented as future — accept either
    // state so B00 does not depend on B10 work.
    const pairs = await loadRegistry();
    const B00_RUNTIME_PAIRS = new Set([
      'config.schema.json',
      'result.schema.json',
      'artifact-index.schema.json',
      'test-plan.schema.json',
    ]);
    // flow's FlowV2Schema IS already exported by itestagent-flow; only
    // project-profile's ProjectProfileSchema is pending — it was reverted at
    // the baseline and B10 re-adds it together with its parity test.
    const KNOWN_FUTURE_SYMBOLS = new Set(['flow.schema.json', 'project-profile.schema.json']);
    const missing: string[] = [];
    for (const pair of pairs) {
      const pkgDir = join(REPO_ROOT, 'packages', pair.runtimePackage);
      const exported = await packageExportsSymbol(pkgDir, pair.runtimeSymbol);
      if (B00_RUNTIME_PAIRS.has(pair.published)) {
        if (!exported) {
          missing.push(`${pair.published} -> ${pair.runtimePackage}#${pair.runtimeSymbol}`);
        }
      } else if (!exported && !KNOWN_FUTURE_SYMBOLS.has(pair.published)) {
        // A pair that is neither B00-present nor a documented future-batch
        // pair must export its symbol today.
        missing.push(`${pair.published} -> ${pair.runtimePackage}#${pair.runtimeSymbol}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every existing parity test is well-formed and registered (no orphans)', async () => {
    const pairs = await loadRegistry();
    const registeredParityPaths = new Set(pairs.map((p) => p.parityTest));

    // (a) Every registered pair whose parity test already exists must be
    // well-formed (non-empty) — an empty file proves no equivalence.
    const emptyParityTests: string[] = [];
    for (const pair of pairs) {
      const parityPath = join(REPO_ROOT, pair.parityTest);
      if (existsSync(parityPath) && statSync(parityPath).size === 0) {
        emptyParityTests.push(pair.parityTest);
      }
    }
    expect(emptyParityTests).toEqual([]);

    // (b) Existing parity files must be a subset of the registered pairs (no
    // orphan parity files under any registered runtime package's test/parity/).
    // The flow and project-profile parity files are authored in later batches
    // (B08/B10, guide §11.3), so their absence in B00 is expected.
    const orphanParityFiles: string[] = [];
    for (const pkg of new Set(pairs.map((p) => p.runtimePackage))) {
      const parityDir = join(REPO_ROOT, 'packages', pkg, 'test', 'parity');
      if (!existsSync(parityDir)) continue;
      for (const file of readdirSync(parityDir)) {
        if (!file.endsWith('.test.ts')) continue;
        const relative = join('packages', pkg, 'test', 'parity', file);
        if (!registeredParityPaths.has(relative)) orphanParityFiles.push(relative);
      }
    }
    expect(orphanParityFiles).toEqual([]);

    // (c) Any parity test present today must be non-empty. In B00 this is
    // vacuous: no parity test files exist yet — the contracts parity tests are
    // authored in B02/B03/B04, flow in B08, project-profile in B10 (guide
    // §11.4/§11.3). This check starts exercising real files once those batches
    // land.
    const presentParityTests = pairs.filter((p) => existsSync(join(REPO_ROOT, p.parityTest)));
    const emptyPresent = presentParityTests.filter(
      (p) => statSync(join(REPO_ROOT, p.parityTest)).size === 0,
    );
    expect(emptyPresent).toEqual([]);
  });
});

describe('runtime schema availability (self-contained discovery)', () => {
  test('contracts package exports the runtime Zod schema for each published artifact', async () => {
    const contractDir = join(REPO_ROOT, 'packages', 'itestagent-contracts');
    // Known published->runtime symbol mappings (same truth the registry encodes).
    const known = [
      ['test-plan.schema.json', 'TestPlanSchema'],
      ['result.schema.json', 'RunResultSchema'],
      ['artifact-index.schema.json', 'ArtifactIndexSchema'],
      ['config.schema.json', 'ItestAgentConfigSchema'],
    ] as const;
    const missing: string[] = [];
    for (const [published, symbol] of known) {
      if (!(await packageExportsSymbol(contractDir, symbol))) {
        missing.push(`${published} -> ${symbol}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every published schema is covered by a parity test or a documented future-batch schema', async () => {
    // This gate verifies the G1 MECHANISM for schema coverage (guide §12.1,
    // §16 G1). The parity test FILES themselves are authored in later batches
    // (guide §11.4: config->B02, result+artifact-index->B03, TestPlan->B04;
    // §11.3: flow->B08, project-profile->B10), so their existence is NOT
    // asserted here. Instead we verify (a) every registered parityTest path is
    // well-formed, (b) registry coverage exactly matches the published
    // schemas, and (c) the contracts parity tests are recorded at their
    // documented paths.
    const pairs = await loadRegistry();
    const published = publishedSchemas();

    // (a) ParityTest paths must be well-formed: under the runtime package's
    // test/parity/ directory, ending with .test.ts, basename matching the
    // schema name.
    const malformed: string[] = [];
    for (const pair of pairs) {
      const expectedDir = join('packages', pair.runtimePackage, 'test', 'parity');
      const schemaBase = pair.published.replace(/\.schema\.json$/, '');
      if (
        dirname(pair.parityTest) !== expectedDir ||
        !pair.parityTest.endsWith('.test.ts') ||
        basename(pair.parityTest) !== `${schemaBase}.test.ts`
      ) {
        malformed.push(`${pair.published} -> ${pair.parityTest}`);
      }
    }
    expect(malformed).toEqual([]);

    // (b) Registered published schemas exactly match all published schemas in
    // schemas/ — no published schema lacks a registry entry and no registry
    // entry points at an unknown schema.
    const registeredPublished = [...new Set(pairs.map((p) => p.published))].sort();
    expect(registeredPublished).toEqual(published);

    // (c) The 4 contracts parity tests are recorded at their documented paths
    // (guide §11.4). Existence is NOT required in B00 — B02/B03/B04 author
    // them; the gate just locks the paths so those batches only write files.
    const contractsPairs = pairs.filter((p) => p.runtimePackage === 'itestagent-contracts');
    expect(contractsPairs.map((p) => p.published).sort()).toEqual([
      'artifact-index.schema.json',
      'config.schema.json',
      'result.schema.json',
      'test-plan.schema.json',
    ]);
    for (const pair of contractsPairs) {
      const schemaBase = pair.published.replace(/\.schema\.json$/, '');
      expect(pair.parityTest).toBe(
        `packages/itestagent-contracts/test/parity/${schemaBase}.test.ts`,
      );
    }
  });
});
