/**
 * verify-batch-state.ts — G0 provenance gate for the iTestAgent promotion.
 *
 * Contract (promotion guide §16 G0 / §12.1):
 *  - Verifies the process runs from the physical repository root.
 *  - Verifies the current branch is the promotion branch.
 *  - Verifies HEAD resolves to the provided BASE commit.
 *  - Verifies the working-tree state according to the mode:
 *      --require-clean  -> `git status --porcelain=v1 --untracked-files=all` is empty
 *      --index          -> no unstaged changes and no untracked files (staged index may be non-empty)
 *
 * CLI:
 *   bun scripts/verify-batch-state.ts <BASE> <BATCH> --require-clean
 *   bun scripts/verify-batch-state.ts <BASE> <BATCH> --index
 *
 * Exit codes:
 *   0  all checks passed
 *   1  at least one provenance / state violation (machine-readable JSON on stdout)
 *   2  usage error
 */

import { spawnSync } from 'node:child_process';

const EXPECTED_BRANCH = process.env.ITESTAGENT_EXPECTED_BRANCH ?? 'feat/mvp-e2e-promotion';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Runs a git command and returns trimmed stdout (throws on non-zero exit). */
function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr?.trim()}`,
    );
  }
  return (result.stdout ?? '').trim();
}

function runGitQuiet(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function physical(path: string): string {
  return spawnSync('pwd', ['-P'], { encoding: 'utf8', cwd: path }).stdout?.trim() ?? '';
}

function usage(message: string): never {
  process.stderr.write(`verify-batch-state: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/verify-batch-state.ts <BASE> <BATCH> --require-clean|--index\n',
  );
  process.exit(2);
}

function fail(batchId: string, base: string, mode: string, violations: CheckResult[]): never {
  const payload = {
    code: 'BATCH_STATE_VIOLATION',
    batchId,
    base,
    mode,
    violations: violations.map((v) => v.detail),
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);

  const modeFlag = args.find((a) => a === '--require-clean' || a === '--index');
  const positional = args.filter((a) => a !== '--require-clean' && a !== '--index');
  if (!modeFlag) {
    usage('exactly one of --require-clean or --index is required');
  }
  if (positional.length < 2) {
    usage('BASE and BATCH are required');
  }
  if (positional.length > 2) {
    usage(`unexpected extra arguments: ${positional.slice(2).join(' ')}`);
  }
  const [base, batchId] = positional;
  if (!/^B[0-4][0-9]$/.test(batchId)) {
    usage(`invalid BATCH "${batchId}" (expected B00-B42)`);
  }
  const mode = modeFlag;

  const violations: CheckResult[] = [];

  // 1. Repository root: the process must run from the physical repo root.
  let repoRoot = '';
  let cwdPhysical = '';
  try {
    repoRoot = git(['rev-parse', '--show-toplevel']);
  } catch {
    repoRoot = '';
  }
  cwdPhysical = physical(process.cwd());
  if (!repoRoot) {
    violations.push({ name: 'repo-root', ok: false, detail: 'not inside a git repository' });
  } else if (cwdPhysical !== physical(repoRoot)) {
    violations.push({
      name: 'repo-root',
      ok: false,
      detail: `must run from the repository root (cwd=${cwdPhysical}, root=${repoRoot})`,
    });
  } else {
    violations.push({ name: 'repo-root', ok: true, detail: `repo root: ${repoRoot}` });
  }

  // 2. Branch: must be the promotion branch.
  const branch = repoRoot
    ? runGitQuiet(['branch', '--show-current'])
    : { status: 1, stdout: '', stderr: '' };
  if (branch.status === 0 && branch.stdout === EXPECTED_BRANCH) {
    violations.push({ name: 'branch', ok: true, detail: `branch: ${branch.stdout}` });
  } else {
    violations.push({
      name: 'branch',
      ok: false,
      detail: `expected branch "${EXPECTED_BRANCH}", got "${branch.stdout || '(none)'}"`,
    });
  }

  // 3. Base commit: HEAD must resolve to BASE.
  const head = runGitQuiet(['rev-parse', 'HEAD']);
  const baseRev = runGitQuiet(['rev-parse', `${base}^{commit}`]);
  if (head.status === 0 && baseRev.status === 0 && head.stdout === baseRev.stdout) {
    violations.push({ name: 'base', ok: true, detail: `HEAD == BASE == ${head.stdout}` });
  } else {
    violations.push({
      name: 'base',
      ok: false,
      detail: `HEAD (${head.stdout || '(unresolved)'}) must equal BASE commit (${baseRev.stdout || '(unresolved)'})`,
    });
  }

  // 4. Working-tree state.
  if (mode === '--require-clean') {
    const status = runGitQuiet(['status', '--porcelain=v1', '--untracked-files=all']);
    if (status.status === 0 && status.stdout === '') {
      violations.push({
        name: 'status',
        ok: true,
        detail: 'working tree is clean (no staged/unstaged/untracked)',
      });
    } else {
      const lines = status.stdout ? status.stdout.split(/\r?\n/) : [];
      violations.push({
        name: 'status',
        ok: false,
        detail: `working tree is not clean (${lines.length} porcelain entr${lines.length === 1 ? 'y' : 'ies'})`,
      });
    }
  } else {
    // --index: no unstaged changes, no untracked files. Staged index may differ.
    const unstaged = runGitQuiet(['diff', '--name-only']);
    const untracked = runGitQuiet(['ls-files', '--others', '--exclude-standard']);
    if (unstaged.status === 0 && unstaged.stdout === '') {
      violations.push({ name: 'status', ok: true, detail: 'no unstaged changes' });
    } else {
      violations.push({
        name: 'status',
        ok: false,
        detail: `unstaged changes present: ${unstaged.stdout.split(/\r?\n/).slice(0, 5).join(', ')}${unstaged.stdout ? '...' : ''}`,
      });
    }
    if (untracked.status === 0 && untracked.stdout === '') {
      violations.push({ name: 'status', ok: true, detail: 'no untracked files' });
    } else {
      violations.push({
        name: 'status',
        ok: false,
        detail: `untracked files present: ${untracked.stdout.split(/\r?\n/).slice(0, 5).join(', ')}${untracked.stdout ? '...' : ''}`,
      });
    }
  }

  if (violations.some((v) => !v.ok)) {
    for (const v of violations) {
      if (!v.ok) process.stderr.write(`verify-batch-state: FAIL ${v.name}: ${v.detail}\n`);
    }
    fail(batchId, base, mode === '--index' ? 'index' : 'require-clean', violations);
  }

  process.stdout.write(
    `verify-batch-state: OK (${mode}): branch=${branch.stdout} base=${head.stdout}\n`,
  );
  process.exit(0);
}

if (import.meta.main) {
  main();
}
