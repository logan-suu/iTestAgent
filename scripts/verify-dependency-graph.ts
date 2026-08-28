/**
 * verify-dependency-graph.ts — workspace dependency graph verifier
 * (promotion guide §12.1). Scans workspace package manifests
 * (`packages/*`, `packages/itestagent-backends/*`), cross-checks direct
 * workspace imports in TypeScript sources against each importer's manifest,
 * and validates declared workspace edges against the architecture allowlist.
 *
 * Exports `verifyDependencyGraph()` for programmatic use (the B00
 * dependency-graph test asserts this entry point exists) and a CLI mode:
 *
 *   bun scripts/verify-dependency-graph.ts --allowlist tests/architecture/allowed-edges.json
 *
 * The CLI prints a JSON summary and exits 0 when there are no cycles and
 * non-zero (1) when a cycle is found. Undeclared imports and disallowed
 * declared edges are reported but do not change the exit code — cycles are
 * the hard failure for the gate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_ALLOWLIST = join(REPO_ROOT, 'tests', 'architecture', 'allowed-edges.json');

/** A single workspace package manifest plus its derived dependency facts. */
interface PackageManifest {
  name: string;
  dir: string;
  declared: Set<string>;
  internalDeps: string[];
}

/** A directed edge between two workspace packages. */
interface AllowedEdge {
  from: string;
  to: string;
}

/** A direct workspace import that is not declared in the importer's manifest. */
interface UndeclaredImport {
  pkg: string;
  specifier: string;
  file: string;
}

/** Aggregate result of the dependency-graph scan. */
export interface DependencyGraphResult {
  cycles: string[];
  undeclaredImports: UndeclaredImport[];
  disallowedEdges: string[];
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

/** Expands a workspace glob such as "packages/*" into package directories. */
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

/** Reads the `name` of a package.json at a directory. */
function packageNameAt(dir: string): string | undefined {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf8')) as { name: string }).name;
}

/** Loads every workspace package manifest from the root workspace globs. */
function loadWorkspacePackages(root: string): PackageManifest[] {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    workspaces: string[];
  };
  const dirs: string[] = [];
  for (const glob of rootManifest.workspaces) dirs.push(...expandWorkspaceGlob(root, glob));
  const names = new Set(
    dirs.map((dir) => packageNameAt(dir)).filter((n): n is string => n !== undefined),
  );
  const manifests: PackageManifest[] = [];
  for (const dir of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
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
    const internalDeps = [...declared].filter((name) => names.has(name));
    manifests.push({ name: pkg.name, dir, declared, internalDeps });
  }
  return manifests;
}

/** Loads the allowed-edges allowlist from a JSON file. */
function loadAllowedEdges(path: string): AllowedEdge[] {
  return JSON.parse(readFileSync(path, 'utf8')) as AllowedEdge[];
}

/** Normalizes a workspace import specifier to its bare package name. */
function bareSpecifier(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? specifier);
}

/**
 * Scans TypeScript sources for workspace imports that are not declared in the
 * importer's manifest (`from "pkg"`, dynamic `import("pkg")`, scoped or bare).
 */
function findUndeclaredImports(
  pkg: PackageManifest,
  workspaceNames: Set<string>,
  root: string,
): UndeclaredImport[] {
  const violations = new Map<string, UndeclaredImport>();
  const importPattern = /(?:from|import\()\s*["']([^"']+)["']/g;
  const files = [...collectTsFiles(join(pkg.dir, 'src')), ...collectTsFiles(join(pkg.dir, 'test'))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const bareName = bareSpecifier(specifier);
      if (workspaceNames.has(bareName) && !pkg.declared.has(bareName)) {
        violations.set(`${file}->${bareName}`, {
          pkg: pkg.name,
          specifier: bareName,
          file: relative(root, file),
        });
      }
    }
  }
  return [...violations.values()];
}

/** Detects dependency cycles among workspace manifests via DFS. */
function findCycles(manifests: PackageManifest[]): string[] {
  const byName = new Map(manifests.map((p) => [p.name, p]));
  const state = new Map<string, 'visiting' | 'done' | 'unvisited'>();
  const stack: string[] = [];
  const cycles: string[] = [];
  for (const name of byName.keys()) state.set(name, 'unvisited');

  const visit = (name: string): void => {
    const status = state.get(name);
    if (status === 'done') return;
    if (status === 'visiting') {
      const cycleStart = stack.indexOf(name);
      const cycle = cycleStart === -1 ? stack.slice() : stack.slice(cycleStart);
      cycles.push(cycle.join(' -> '));
      return;
    }
    state.set(name, 'visiting');
    stack.push(name);
    for (const dep of byName.get(name)?.internalDeps ?? []) {
      if (byName.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(name, 'done');
  };

  for (const name of byName.keys()) visit(name);
  return cycles;
}

/** Declared workspace edges that are NOT present in the allowlist. */
function findDisallowedEdges(manifests: PackageManifest[], allowed: Set<string>): string[] {
  const violations: string[] = [];
  for (const pkg of manifests) {
    for (const dep of pkg.internalDeps) {
      if (!allowed.has(`${pkg.name}->${dep}`)) {
        violations.push(`${pkg.name} -> ${dep} (declared but not allowed)`);
      }
    }
  }
  return violations;
}

/** Runs the full dependency-graph scan over the workspace. */
export function verifyDependencyGraph(
  allowlistPath: string = DEFAULT_ALLOWLIST,
): DependencyGraphResult {
  const manifests = loadWorkspacePackages(REPO_ROOT);
  const workspaceNames = new Set(manifests.map((p) => p.name));
  const allowedEdges = loadAllowedEdges(allowlistPath);
  const allowedEdgeSet = new Set(allowedEdges.map((e) => `${e.from}->${e.to}`));

  const undeclaredImports: UndeclaredImport[] = [];
  for (const pkg of manifests) {
    undeclaredImports.push(...findUndeclaredImports(pkg, workspaceNames, REPO_ROOT));
  }

  return {
    cycles: findCycles(manifests),
    undeclaredImports,
    disallowedEdges: findDisallowedEdges(manifests, allowedEdgeSet),
  };
}

/** Runs the CLI mode when the script is executed directly. */
function runCli(args: string[]): void {
  let allowlistPath = DEFAULT_ALLOWLIST;
  const flagIndex = args.indexOf('--allowlist');
  if (flagIndex !== -1) {
    const value = args[flagIndex + 1];
    if (value !== undefined) allowlistPath = resolve(REPO_ROOT, value);
  }
  const result = verifyDependencyGraph(allowlistPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.cycles.length === 0 ? 0 : 1);
}

if (import.meta.main) {
  runCli(process.argv.slice(2));
}
