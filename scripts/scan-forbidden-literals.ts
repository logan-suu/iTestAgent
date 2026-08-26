/**
 * scan-forbidden-literals.ts — G2 forbidden-literal scope policy gate.
 *
 * Contract (promotion guide §12.1 G2 / §16 G2, forbidden-literals.test.ts):
 *  - Generic schema/contract surfaces must not contain product/scenario
 *    literals, team IDs, or machine-specific absolute paths.
 *  - The same literal policy enforced by tests/architecture/forbidden-literals.test.ts
 *    is mirrored here via the exported `forbiddenLiterals` and `genericSurfaceDirs`
 *    arrays (the test dynamically imports this module and asserts both are arrays).
 *
 * CLI:
 *   bun scripts/scan-forbidden-literals.ts [--base <ref>] [--head <ref>]
 *       --index | --worktree | --commit [--scope changed|generic|all]
 *
 * Modes (which diff is read):
 *   --index     base -> index            (pre-commit G2 fixed mode)
 *   --worktree  base -> tracked worktree + all untracked
 *   --commit    base...HEAD
 *
 * Scope (which file set is scanned):
 *   changed  only files changed by the selected mode diff; the literal policy
 *            is applied to the files among them that live under a generic surface
 *   generic  every file under a generic surface (default)
 *   all      alias for generic (full generic corpus)
 *
 * Exit codes:
 *   0  no violations
 *   1  violations found (one `path: reason` line per hit on stdout)
 *   2  usage error
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Scenario/product literals forbidden in generic surfaces. */
export const forbiddenLiterals: string[] = ['feed-memory', 'echo-search', 'team-id-abc123'];

/** Generic surfaces subject to the literal policy (repo-relative dirs). */
export const genericSurfaceDirs: string[] = [
  'schemas',
  'packages/itestagent-contracts/src',
  'packages/itestagent-flow/src',
  'packages/itestagent-report/src',
];

/** Machine-specific absolute paths (mirrors forbidden-literals.test.ts). */
export const machinePathPattern = /(^|[/:"'])("?)(\/[Uu]sers|\/home\/)/;

type Mode = 'index' | 'worktree' | 'commit';
type Scope = 'changed' | 'generic' | 'all';

function usage(message: string): never {
  process.stderr.write(`scan-forbidden-literals: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/scan-forbidden-literals.ts [--base <ref>] [--head <ref>] --index|--worktree|--commit [--scope changed|generic|all]\n',
  );
  process.exit(2);
}

function runGit(args: string[]): string[] {
  const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim();
    throw new Error(`git ${args.join(' ')} failed (exit ${result.exitCode}): ${err}`);
  }
  return result.stdout
    .toString()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Collects text-bearing file paths under a directory (no node_modules/dist/hidden). */
function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...collectFiles(full));
    else files.push(full);
  }
  return files;
}

/**
 * Scenario surfaces exempt from the GENERIC literal policy (guide §9 Stage
 * 1): scenario contracts live behind their own subpath and carry scenario
 * vocabulary (e.g. "feed-memory") BY DESIGN — they are not generic surface.
 */
export const genericSurfaceExclusions: string[] = [
  'packages/itestagent-contracts/src/scenarios/',
  'schemas/scenarios/',
];

function isUnderExcludedScenarioSurface(file: string): boolean {
  const normalized = `${file.replaceAll('/', sep)}${sep}`;
  return genericSurfaceExclusions.some((dir) => normalized.startsWith(dir.replaceAll('/', sep)));
}

function isUnderGenericSurface(file: string): boolean {
  if (isUnderExcludedScenarioSurface(file)) return false;
  const normalized = file.replaceAll('/', sep);
  return genericSurfaceDirs.some(
    (dir) => normalized === dir || normalized.startsWith(`${dir.replaceAll('/', sep)}${sep}`),
  );
}

function main(): void {
  const args = process.argv.slice(2);

  let base: string | undefined;
  let head: string | undefined;
  let mode: Mode | undefined;
  let scope: Scope = 'generic';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--base':
        base = args[++i];
        if (!base) usage('--base requires a value');
        break;
      case '--head':
        head = args[++i];
        if (!head) usage('--head requires a value');
        break;
      case '--index':
        mode = 'index';
        break;
      case '--worktree':
        mode = 'worktree';
        break;
      case '--commit':
        mode = 'commit';
        break;
      case '--scope':
        scope = args[++i] as Scope;
        if (scope !== 'changed' && scope !== 'generic' && scope !== 'all') {
          usage(`invalid --scope "${scope}" (expected changed|generic|all)`);
        }
        break;
      default:
        usage(`unexpected argument "${arg}"`);
    }
  }

  // Mode resolution: explicit flag wins; --head implies commit; --base implies index.
  if (!mode) {
    if (head) mode = 'commit';
    else if (base) mode = 'index';
    else mode = 'worktree';
  }

  const repoRoot = resolve(process.cwd());
  let targetFiles: string[] = [];

  if (scope === 'changed') {
    if (!base) usage('--scope changed requires --base');
    let changed: string[];
    try {
      switch (mode) {
        case 'index':
          changed = runGit(['diff', '--cached', '--name-only', base, '--']);
          break;
        case 'worktree': {
          const tracked = runGit(['diff', '--name-only', base, '--']);
          const untracked = runGit(['ls-files', '--others', '--exclude-standard']);
          changed = [...new Set([...tracked, ...untracked])];
          break;
        }
        case 'commit':
          changed = runGit(['diff', '--name-only', `${base}...${head ?? 'HEAD'}`, '--']);
          break;
      }
    } catch (err) {
      process.stderr.write(`scan-forbidden-literals: ${(err as Error).message}\n`);
      process.exit(2);
    }
    // Policy applies to changed files that live under a generic surface.
    targetFiles = changed.filter((f) => isUnderGenericSurface(f));
  } else {
    // generic / all: scan the whole generic corpus (scenario subpaths exempt).
    for (const dir of genericSurfaceDirs) {
      const abs = join(repoRoot, dir);
      if (existsSync(abs)) {
        for (const file of collectFiles(abs)) {
          if (!isUnderExcludedScenarioSurface(file)) targetFiles.push(relative(repoRoot, file));
        }
      }
    }
  }

  const violations: string[] = [];
  for (const file of [...new Set(targetFiles)].sort()) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue; // non-text or unreadable file
    }
    for (const literal of forbiddenLiterals) {
      if (text.includes(literal)) {
        violations.push(`${file}: contains forbidden literal "${literal}"`);
      }
    }
    if (machinePathPattern.test(text)) {
      violations.push(`${file}: contains a machine-specific absolute path`);
    }
  }

  if (violations.length > 0) {
    for (const v of violations) process.stdout.write(`${v}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `scan-forbidden-literals: OK (scope=${scope} mode=${mode} files=${targetFiles.length})\n`,
  );
  process.exit(0);
}

if (import.meta.main) {
  main();
}
