/**
 * forbidden-literals.test.ts
 *
 * RED-phase architecture test for the B00 batch.
 *
 * Contract (promotion guide §12.1 G2 / §16 G2):
 *  - Generic schema/contract surfaces must not contain product/scenario
 *    literals: scenario feature names (e.g. "feed-memory"), product app
 *    names, team IDs or machine-specific absolute paths.
 *  - The scope policy is enforced by `scripts/scan-forbidden-literals.ts`
 *    (--base/--head/--scope). That script is authored in the GREEN phase and
 *    does not exist yet, so the infrastructure-contract test fails RED.
 *
 * Generic surfaces covered here:
 *   - schemas/*.schema.json                (published generic schemas)
 *   - packages/itestagent-contracts/src    (generic runtime contracts)
 *   - packages/itestagent-flow/src         (generic Flow DSL)
 *   - packages/itestagent-report/src       (generic report trio)
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/**
 * Scenario/product literals that are forbidden in generic surfaces.
 * Adding a new scenario feature name here must be mirrored in
 * scripts/scan-forbidden-literals.ts (GREEN phase).
 */
const FORBIDDEN_LITERALS: string[] = ['feed-memory', 'echo-search', 'team-id-abc123'];

/**
 * Generic surfaces subject to the literal policy. Each entry is a
 * repo-relative directory that is scanned recursively.
 */
const GENERIC_SURFACE_DIRS: string[] = [
  'schemas',
  'packages/itestagent-contracts/src',
  'packages/itestagent-flow/src',
  'packages/itestagent-report/src',
];

/**
 * Scenario surfaces exempt from the GENERIC policy (guide §9 Stage 1):
 * scenario contracts live behind their own subpath and carry scenario
 * vocabulary BY DESIGN — they are not generic surface. Mirrors
 * scripts/scan-forbidden-literals.ts.
 */
const GENERIC_SURFACE_EXCLUSIONS: string[] = [
  'packages/itestagent-contracts/src/scenarios/',
  'schemas/scenarios/',
];

function isExcludedScenarioSurface(file: string): boolean {
  return GENERIC_SURFACE_EXCLUSIONS.some((dir) => file.startsWith(dir));
}

/** Collects text-bearing files under a directory (no node_modules/dist). */
function collectFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    if (statSync(full).isDirectory()) files.push(...collectFiles(full));
    else files.push(full);
  }
  return files;
}

/** Returns repo-relative paths of every file in the generic surfaces. */
function genericSurfaceFiles(): string[] {
  const files: string[] = [];
  for (const dir of GENERIC_SURFACE_DIRS) {
    const abs = join(REPO_ROOT, dir);
    for (const file of collectFiles(abs)) {
      const rel = relative(REPO_ROOT, file);
      if (!isExcludedScenarioSurface(rel)) files.push(rel);
    }
  }
  return files.sort();
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

describe('forbidden literals in generic schema surfaces (guide §16 G2)', () => {
  const schemaFiles = genericSurfaceFiles().filter((f) => f.startsWith('schemas/'));

  test('generic schemas contain no product/scenario literals', () => {
    const hits: string[] = [];
    for (const file of schemaFiles) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const literal of FORBIDDEN_LITERALS) {
        if (text.includes(literal)) hits.push(`${file} contains "${literal}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('generic schemas contain no machine-specific absolute paths', () => {
    const machinePathPattern = /(^|[/:"'])("?)(\/[Uu]sers|\/home\/)/;
    const hits: string[] = [];
    for (const file of schemaFiles) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      if (machinePathPattern.test(text)) hits.push(`${file} contains a machine-specific path`);
    }
    expect(hits).toEqual([]);
  });
});

describe('forbidden literals in generic contract surfaces (guide §16 G2)', () => {
  const contractFiles = genericSurfaceFiles().filter(
    (f) =>
      f.startsWith('packages/itestagent-contracts/src/') ||
      f.startsWith('packages/itestagent-flow/src/') ||
      f.startsWith('packages/itestagent-report/src/'),
  );

  test('generic contracts contain no product/scenario literals', () => {
    const hits: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const literal of FORBIDDEN_LITERALS) {
        if (text.includes(literal))
          hits.push(`${file} contains "${literal}" (${occurrences(text, literal)}x)`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('generic contracts contain no machine-specific absolute paths', () => {
    const machinePathPattern = /(^|[/:"'])("?)(\/[Uu]sers|\/home\/)/;
    const hits: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      if (machinePathPattern.test(text)) hits.push(`${file} contains a machine-specific path`);
    }
    expect(hits).toEqual([]);
  });
});

describe('infrastructure contract (RED)', () => {
  test('scripts/scan-forbidden-literals.ts exists and supports the scope policy (--base/--head/--scope)', async () => {
    // RED phase: this module is authored in the GREEN phase, so the dynamic
    // import throws and this test fails (expected).
    const mod = (await import('../../scripts/scan-forbidden-literals')) as {
      forbiddenLiterals?: unknown;
      genericSurfaceDirs?: unknown;
    };
    expect(Array.isArray(mod.forbiddenLiterals)).toBe(true);
    expect(Array.isArray(mod.genericSurfaceDirs)).toBe(true);
  });
});
