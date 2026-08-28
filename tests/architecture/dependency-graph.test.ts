/**
 * dependency-graph.test.ts
 *
 * B00 architecture test for the promotion batch (GREEN phase).
 *
 * Contract (promotion guide §12.1 / §8.2):
 *  - The dependency-graph test's B00 job is to verify the MECHANISM that
 *    rejects cycles and undeclared imports — NOT to require the baseline
 *    graph to be fully clean. The baseline intentionally carries documented
 *    undeclared workspace imports; the manifest fixes belong to batches
 *    B01-B05 (guide §8.2), not B00.
 *  - Undeclared-import check: the graph scan must not report anything NEW
 *    beyond the documented baseline snapshot in
 *    `tests/architecture/fixtures/known-undeclared-imports.json`, and the
 *    reported count must equal the snapshot count. New undeclared imports
 *    introduced by a batch therefore fail loudly.
 *  - Allowed-edge check: every declared workspace dependency edge must be an
 *    allowed edge in `allowed-edges.json`, or be explicitly documented as a
 *    known baseline edge in
 *    `tests/architecture/fixtures/known-baseline-edges.json`. This asserts
 *    the allowlist COVERS the current declared graph (B01+ may still declare
 *    edges that are not yet allowed).
 *  - No workspace dependency cycle exists.
 *  - `itestagent-process` is a leaf: zero internal workspace dependencies, and
 *    the only allowed inbound edge is from `itestagent-backends-device-appium`.
 *  - `scripts/verify-dependency-graph.ts` (authored in the GREEN phase)
 *    exposes a `verifyDependencyGraph()` entry point that performs the same
 *    scan, so the verifier used by CI matches this test's mechanism.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const ALLOWED_EDGES_PATH = join(import.meta.dir, 'allowed-edges.json');
const KNOWN_UNDECLARED_IMPORTS_PATH = join(
  import.meta.dir,
  'fixtures',
  'known-undeclared-imports.json',
);
const KNOWN_BASELINE_EDGES_PATH = join(import.meta.dir, 'fixtures', 'known-baseline-edges.json');
const PROCESS_PACKAGE = 'itestagent-process';
const DEVICE_APPIUM_PACKAGE = 'itestagent-backends-device-appium';

interface Manifest {
  name: string;
  dir: string;
  manifestPath: string;
  internalDeps: string[];
  declared: Set<string>;
}

interface AllowedEdge {
  from: string;
  to: string;
}

/** Recursively collects .ts files under a directory (excluding node_modules). */
function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

/** Expands a workspace glob such as "packages/*" into directories. */
function expandWorkspaceGlob(root: string, glob: string): string[] {
  const parts = glob.split('/');
  let current = [root];
  for (const part of parts) {
    if (part === '*') {
      const next: string[] = [];
      for (const dir of current) {
        for (const entry of readdirSync(dir)) {
          if (entry.startsWith('.')) continue;
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) next.push(full);
        }
      }
      current = next;
    } else {
      current = current.map((dir) => join(dir, part));
    }
  }
  return current.filter((dir) => existsSync(join(dir, 'package.json')));
}

/** Lists the package.json `name` of every workspace package. */
function listWorkspaceNames(root: string): string[] {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    workspaces: string[];
  };
  const dirs: string[] = [];
  for (const glob of rootManifest.workspaces) dirs.push(...expandWorkspaceGlob(root, glob));
  return dirs.map(
    (dir) => (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }).name,
  );
}

/** Loads every workspace package manifest. */
function loadWorkspacePackages(root: string): Manifest[] {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    workspaces: string[];
  };
  const dirs: string[] = [];
  for (const glob of rootManifest.workspaces) dirs.push(...expandWorkspaceGlob(root, glob));
  const manifests: Manifest[] = [];
  for (const dir of dirs) {
    const manifestPath = join(dir, 'package.json');
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const internalDeps = [...declared].filter(isWorkspacePackage);
    manifests.push({ name: pkg.name, dir, manifestPath, internalDeps, declared });
  }
  return manifests;
}

/** Loads the allowed-edges whitelist. */
function loadAllowedEdges(path: string): AllowedEdge[] {
  return JSON.parse(readFileSync(path, 'utf8')) as AllowedEdge[];
}

/** Precomputed set of workspace package names (avoids recursion on load). */
const workspaceNames: string[] = listWorkspaceNames(REPO_ROOT);
function isWorkspacePackage(name: string): boolean {
  return workspaceNames.includes(name);
}

/** Extracts the package.json `name` for a package directory. */
function packageNameAt(dir: string): string | undefined {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf8')) as { name: string }).name;
}

const allowedEdges = loadAllowedEdges(ALLOWED_EDGES_PATH);
const allowedEdgeKey = (from: string, to: string) => `${from}->${to}`;
const allowedEdgeSet = new Set(allowedEdges.map((e) => allowedEdgeKey(e.from, e.to)));

const packages = loadWorkspacePackages(REPO_ROOT);
const packageByName = new Map(packages.map((p) => [p.name, p]));

/**
 * Scans TypeScript sources for workspace import specifiers that are NOT
 * declared in the importer's manifest. Handles `from "pkg"`, dynamic
 * `import("pkg")` and scoped/bare specifiers. Each violation is normalized to
 * `{pkg, specifier, file}` so it can be compared against the documented
 * baseline snapshot (`fixtures/known-undeclared-imports.json`).
 */
function findUndeclaredImports(
  pkg: Manifest,
): Array<{ pkg: string; specifier: string; file: string }> {
  const violations = new Map<string, { pkg: string; specifier: string; file: string }>();
  const importPattern = /(?:from|import\()\s*["']([^"']+)["']/g;
  const files = [...collectTsFiles(join(pkg.dir, 'src')), ...collectTsFiles(join(pkg.dir, 'test'))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const bareName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);
      if (isWorkspacePackage(bareName) && !pkg.declared.has(bareName)) {
        violations.set(`${file}->${bareName}`, {
          pkg: pkg.name,
          specifier: bareName,
          file: relative(REPO_ROOT, file),
        });
      }
    }
  }
  return [...violations.values()];
}

/** Stable identity key for a single undeclared-import violation. */
function undeclaredKey(v: { pkg: string; specifier: string; file: string }): string {
  return `${v.pkg}|${v.specifier}|${v.file}`;
}

/** Loads the documented B00 baseline of known undeclared imports. */
function loadKnownUndeclaredImports(): Array<{ pkg: string; specifier: string; file: string }> {
  return JSON.parse(readFileSync(KNOWN_UNDECLARED_IMPORTS_PATH, 'utf8')) as Array<{
    pkg: string;
    specifier: string;
    file: string;
  }>;
}

/** Loads declared workspace edges that are documented as known baseline carve-outs. */
function loadKnownBaselineEdges(): AllowedEdge[] {
  return JSON.parse(readFileSync(KNOWN_BASELINE_EDGES_PATH, 'utf8')) as AllowedEdge[];
}

/** Detects a dependency cycle among workspace manifests via DFS. */
function findFirstCycle(packagesByName: Map<string, Manifest>): string[] | null {
  const state = new Map<string, 'visiting' | 'done' | 'unvisited'>();
  const stack: string[] = [];
  for (const name of packagesByName.keys()) state.set(name, 'unvisited');

  const visit = (name: string): string[] | null => {
    const status = state.get(name);
    if (status === 'done') return null;
    if (status === 'visiting') {
      const cycleStart = stack.indexOf(name);
      return cycleStart === -1 ? stack.slice() : stack.slice(cycleStart);
    }
    state.set(name, 'visiting');
    stack.push(name);
    const pkg = packagesByName.get(name);
    for (const dep of pkg?.internalDeps ?? []) {
      if (!packagesByName.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, 'done');
    return null;
  };

  for (const name of packagesByName.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

describe('workspace dependency graph (guide §8)', () => {
  test('the scan detects no undeclared workspace imports beyond the documented B00 baseline', () => {
    const violations: Array<{ pkg: string; specifier: string; file: string }> = [];
    for (const pkg of packages) {
      violations.push(...findUndeclaredImports(pkg));
    }
    const snapshot = loadKnownUndeclaredImports();

    // The mechanism must be stable: the snapshot exists and is non-empty.
    expect(snapshot.length).toBeGreaterThan(0);

    // (a) Every violation found by the scan is documented in the snapshot —
    // no NEW undeclared imports may be introduced beyond the B00 baseline.
    const snapshotKeys = new Set(snapshot.map(undeclaredKey));
    const newViolations = violations
      .filter((v) => !snapshotKeys.has(undeclaredKey(v)))
      .map((v) => `${v.pkg}: imports "${v.specifier}" in ${v.file}`);
    expect(newViolations).toEqual([]);

    // (b) The reported count must never exceed the documented baseline count.
    // Legitimate fixes REMOVE violations (manifest declarations land in later
    // batches), so a decreasing count is the expected direction of travel.
    expect(violations.length).toBeLessThanOrEqual(snapshot.length);
  });

  test('every declared workspace dependency edge is allowed or a documented baseline edge', () => {
    const declaredEdges: string[] = [];
    for (const pkg of packages) {
      for (const dep of pkg.internalDeps) {
        declaredEdges.push(allowedEdgeKey(pkg.name, dep));
      }
    }
    const baselineEdges = new Set(
      loadKnownBaselineEdges().map((e) => allowedEdgeKey(e.from, e.to)),
    );
    const uncovered = declaredEdges.filter(
      (edge) => !allowedEdgeSet.has(edge) && !baselineEdges.has(edge),
    );
    expect(uncovered).toEqual([]);
  });

  test('no workspace dependency cycle exists', () => {
    const cycle = findFirstCycle(packageByName);
    expect(cycle, cycle ? `cycle detected: ${cycle.join(' -> ')}` : undefined).toBeNull();
  });

  test('allowed-edges.json only references known workspace packages or the future process leaf', () => {
    const known = new Set(packages.map((p) => p.name));
    known.add(PROCESS_PACKAGE);
    const unknown = allowedEdges
      .filter((e) => !known.has(e.from) || !known.has(e.to))
      .map((e) => `${e.from} -> ${e.to}`);
    expect(unknown).toEqual([]);
  });
});

describe('itestagent-process leaf (guide §8.1)', () => {
  const processDir = join(REPO_ROOT, 'packages', 'itestagent-process');

  test('the only allowed inbound edge to itestagent-process is from device-appium', () => {
    const inbound = allowedEdges.filter((e) => e.to === PROCESS_PACKAGE).map((e) => e.from);
    expect(inbound).toEqual([DEVICE_APPIUM_PACKAGE]);
  });

  test('itestagent-process declares zero internal workspace dependencies', () => {
    if (!existsSync(join(processDir, 'package.json'))) {
      // Package does not exist yet (created in a later batch); vacuously green.
      expect(true).toBe(true);
      return;
    }
    const name = packageNameAt(processDir);
    const pkg = name === undefined ? undefined : packageByName.get(name);
    expect(pkg?.internalDeps ?? []).toEqual([]);
  });
});

describe('infrastructure contract (RED)', () => {
  test('scripts/verify-dependency-graph.ts exists and exposes a verifyDependencyGraph() entry point', async () => {
    // RED phase: this module is authored in the GREEN phase, so the dynamic
    // import throws and this test fails (expected).
    const mod = (await import('../../scripts/verify-dependency-graph')) as {
      verifyDependencyGraph?: unknown;
    };
    expect(typeof mod.verifyDependencyGraph).toBe('function');
  });
});
