/**
 * verify-batch-allowlist.ts — batch:allowlist change-set gate.
 *
 * Contract (promotion guide §12.3 / appendix A.1):
 *  Compares the actual set of changed paths against the exact per-batch
 *  allowlist `docs/06-verification/migration/allowlists/{BATCH}-files.txt`.
 *  Exit 0 only when the two sets are identical.
 *
 * Three distinct modes (never a plain listing):
 *   --index     base -> index            (pre-commit G2 fixed mode)
 *   --worktree  base -> tracked worktree + all untracked   (generation phase)
 *   --commit    base...HEAD                                (post-commit)
 *
 * `--exclude-manifest` maps to EXCLUDE_MANIFEST=1 and removes the unique
 * manifest path `docs/06-verification/migration/{BATCH}.json` from both the
 * expected and actual sets before comparing.
 *
 * CLI:
 *   bun scripts/verify-batch-allowlist.ts <BATCH> <BASE> <HEAD> --index|--worktree|--commit [--exclude-manifest]
 *
 * Exit codes:
 *   0  actual changed paths == allowlist exactly
 *   1  mismatch (unified diff of expected vs actual on stdout)
 *   2  usage error / unknown mode / missing allowlist
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

function usage(message: string): never {
  process.stderr.write(`verify-batch-allowlist: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/verify-batch-allowlist.ts <BATCH> <BASE> <HEAD> --index|--worktree|--commit [--exclude-manifest]\n',
  );
  process.exit(2);
}

function runGit(args: string[]): { status: number; stdout: string; stderr: string } {
  // core.quotepath=false keeps UTF-8 paths (e.g. Chinese doc names) literal,
  // so the allowlist comparison does not see git's octal escapes (B39).
  const result = Bun.spawnSync(['git', '-c', 'core.quotepath=false', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    status: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** Read, then LC_ALL=C sort -u a list of paths. */
function sortUnique(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const modes = ['--index', '--worktree', '--commit'] as const;
  const modeArg = args.find((a) => modes.includes(a as (typeof modes)[number]));
  if (!modeArg) usage('exactly one of --index|--worktree|--commit is required');
  const mode = modeArg as (typeof modes)[number];

  let excludeManifest = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (modes.includes(arg as (typeof modes)[number])) continue;
    if (arg === '--exclude-manifest') {
      excludeManifest = true;
      continue;
    }
    positional.push(arg);
  }
  if (positional.length < 3) usage('BATCH, BASE and HEAD are required');
  if (positional.length > 3) usage(`unexpected extra arguments: ${positional.slice(3).join(' ')}`);
  const [batch, base, head] = positional;
  if (!/^B[0-4][0-9]$/.test(batch)) usage(`invalid BATCH "${batch}"`);

  const allowlistPath = join(
    REPO_ROOT,
    'docs',
    '06-verification',
    'migration',
    'allowlists',
    `${batch}-files.txt`,
  );
  const manifestPath = `docs/06-verification/migration/${batch}.json`;

  if (!existsSync(allowlistPath)) {
    process.stderr.write(`verify-batch-allowlist: allowlist not found: ${allowlistPath}\n`);
    process.exit(2);
  }

  // EXPECTED set from the allowlist file.
  let expected = sortUnique(readFileSync(allowlistPath, 'utf8').split(/\r?\n/));

  // ACTUAL set per mode.
  let actualOutput = '';
  switch (mode) {
    case '--index': {
      const r = runGit(['diff', '--cached', '--name-only', base, '--']);
      if (r.status !== 0) {
        process.stderr.write(
          `verify-batch-allowlist: git diff --cached failed: ${r.stderr.trim()}\n`,
        );
        process.exit(2);
      }
      actualOutput = r.stdout;
      break;
    }
    case '--worktree': {
      const tracked = runGit(['diff', '--name-only', base, '--']);
      const untracked = runGit(['ls-files', '--others', '--exclude-standard']);
      if (tracked.status !== 0 || untracked.status !== 0) {
        process.stderr.write(
          `verify-batch-allowlist: git diff/ls-files failed: ${tracked.stderr.trim()} ${untracked.stderr.trim()}\n`,
        );
        process.exit(2);
      }
      actualOutput = `${tracked.stdout}\n${untracked.stdout}`;
      break;
    }
    case '--commit': {
      const r = runGit(['diff', '--name-only', `${base}...${head}`, '--']);
      if (r.status !== 0) {
        process.stderr.write(
          `verify-batch-allowlist: git diff ${base}...${head} failed: ${r.stderr.trim()}\n`,
        );
        process.exit(2);
      }
      actualOutput = r.stdout;
      break;
    }
  }
  let actual = sortUnique(actualOutput.split(/\r?\n/));

  // --exclude-manifest removes the unique manifest path from both sides.
  if (excludeManifest) {
    expected = expected.filter((p) => p !== manifestPath);
    actual = actual.filter((p) => p !== manifestPath);
  }

  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    process.stdout.write(
      `verify-batch-allowlist: OK (${batch} ${mode}${excludeManifest ? ' --exclude-manifest' : ''}): ${actual.length} paths match allowlist\n`,
    );
    process.exit(0);
  }

  // Unified diff, expected vs actual (mirrors `diff -u EXPECTED ACTUAL`).
  const diff: string[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) {
      i++;
      j++;
    } else if (expected[i] < actual[j]) {
      diff.push(`-${expected[i]}`);
      i++;
    } else {
      diff.push(`+${actual[j]}`);
      j++;
    }
  }
  while (i < expected.length) diff.push(`-${expected[i++]}`);
  while (j < actual.length) diff.push(`+${actual[j++]}`);

  process.stdout.write(`verify-batch-allowlist: MISMATCH (${batch} ${mode})\n`);
  process.stdout.write(`--- expected (${expected.length}) +++ actual (${actual.length})\n`);
  for (const line of diff) process.stdout.write(`${line}\n`);
  process.exit(1);
}

if (import.meta.main) {
  main();
}
