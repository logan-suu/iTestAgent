/**
 * precommit-receipt.test.ts — B00 audit infrastructure (promotion guide §12.1).
 *
 * RED-phase contract for the pre-commit gate receipt verifier. This file is
 * authored BEFORE the script exists; it fails RED until GREEN provides:
 *   - `.githooks/pre-commit`             — installed hook (delegates)
 *   - `scripts/verify-precommit-receipt.ts` — the verifier under test
 *
 * CONTRACT
 * - Usage: `bun scripts/verify-precommit-receipt.ts --receipt <absolute-path>`
 *   executed from the repository root.
 * - The receipt is the GATE_RECEIPT JSON written by `run-precommit-gates.ts`
 *   (guide §12.3 step 6), stored under `$GIT_DIR/itestagent-receipts/`:
 *       { "batchId": "...", "stagedTreeHash": "<40-hex>", "g7": true }
 *   It must be mode 0600, owned by the current user, and not a symlink.
 * - The verifier exits 0 only when ALL of the following hold:
 *     (a) the receipt exists, is readable and is not a symlink (no-follow read);
 *     (b) `stagedTreeHash` equals the current index tree (`git write-tree`);
 *     (c) `g7 === true` (the pre-Bun secret scan passed);
 *     (d) the receipt is owned by the current user and mode & 0o077 === 0.
 *   Any violation exits non-zero.
 *
 * RED expectations:
 * - `scripts/verify-precommit-receipt.ts` does not exist until GREEN.
 * - Running `bun <missing-script>` exits non-zero, so the positive control
 *   fails (RED) while the negative cases pass trivially.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  chownSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';

// ─── Constants ───────────────────────────────────────────

const repoRoot = join(import.meta.dir, '..', '..');
const fixturesDir = join(import.meta.dir, 'fixtures');
const verifierScript = join(repoRoot, 'scripts', 'verify-precommit-receipt.ts');

const TREE_ZEROS = '0'.repeat(40);

// ─── Helpers ─────────────────────────────────────────────

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function streamToBuffer(
  stream: number | ReadableStream<Uint8Array> | undefined | null,
): Promise<Buffer> {
  if (stream == null || typeof stream === 'number') return Buffer.alloc(0);
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function run(cmd: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  let proc: Subprocess;
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: String(err) };
  }
  const [outBuf, errBuf] = await Promise.all([
    streamToBuffer(proc.stdout),
    streamToBuffer(proc.stderr),
  ]);
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: outBuf.toString('utf8'),
    stderr: errBuf.toString('utf8'),
  };
}

/** Probes once whether we may chown files to another uid (needs privileges). */
function canChownToOtherUid(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-chown-probe-'));
  const probe = join(dir, 'probe');
  try {
    writeFileSync(probe, 'x');
    // uid 65534 ("nobody") differs from the current user on macOS/Linux.
    chownSync(probe, 65534, -1);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const CAN_CHOWN_TO_OTHER_UID = canChownToOtherUid();

/**
 * Creates an isolated throwaway git repo with one staged file and returns its
 * root. The verifier must run with this directory as its cwd so that
 * `git write-tree` reflects the temp index, not the promotion repo.
 */
function runSync(cmd: string[], opts: { cwd?: string } = {}): RunResult {
  try {
    const proc = Bun.spawnSync(cmd, {
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: String(err) };
  }
}

/**
 * Creates an isolated throwaway git repo with one staged file and returns its
 * root. The verifier must run with this directory as its cwd so that
 * `git write-tree` reflects the temp index, not the promotion repo.
 */
function makeTempGitRepo(): { dir: string; gitDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-receipt-'));
  // Silence git identity/init warnings in the throwaway repo.
  writeFileSync(join(dir, 'hello.txt'), 'hello\n');
  runSync(['git', 'init', '-q'], { cwd: dir });
  runSync(['git', 'config', 'user.name', 'itestagent-test'], { cwd: dir });
  runSync(['git', 'config', 'user.email', 'itestagent-test@example.invalid'], { cwd: dir });
  runSync(['git', 'add', 'hello.txt'], { cwd: dir });
  return { dir, gitDir: join(dir, '.git') };
}

/** Returns the 40-hex tree of the current index in the given repo. */
function currentIndexTree(dir: string): string {
  const res = runSync(['git', 'write-tree'], { cwd: dir });
  return resOut(res);
}

function resOut(res: RunResult): string {
  return res.stdout.trim();
}

function receiptPath(gitDir: string): string {
  return join(gitDir, 'itestagent-receipts', 'test-gates.json');
}

/** Writes a gate receipt with the given payload and file mode. */
function writeReceipt(gitDir: string, payload: unknown, mode = 0o600): string {
  const path = receiptPath(gitDir);
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`);
  chmodSync(path, mode);
  return path;
}

/** Runs the verifier against the given receipt path inside `cwd`. */
function runVerifier(cwd: string, receipt: string): Promise<RunResult> {
  return run(['bun', verifierScript, '--receipt', receipt], { cwd });
}

// ─── Suite ───────────────────────────────────────────────

describe('B00 security: pre-commit receipt gate (precommit-receipt.test.ts)', () => {
  let repo: { dir: string; gitDir: string };

  beforeEach(() => {
    repo = makeTempGitRepo();
  });

  afterEach(() => {
    rmSync(repo.dir, { recursive: true, force: true });
  });

  // ─── Positive control ─────────────────────────────────

  test('accepts a receipt that matches the staged index with G7 passed and safe mode', async () => {
    const tree = currentIndexTree(repo.dir);
    expect(tree).toMatch(/^[0-9a-f]{40}$/);
    const path = writeReceipt(
      repo.gitDir,
      {
        batchId: 'B00-test',
        stagedTreeHash: tree,
        g7: true,
      },
      0o600,
    );
    const res = await runVerifier(repo.dir, path);
    expect(res.exitCode).toBe(0);
  });

  // ─── (a) receipt missing / unreadable / symlink ───────

  test('rejects when the receipt is missing', async () => {
    const missing = join(repo.gitDir, 'itestagent-receipts', 'does-not-exist.json');
    const res = await runVerifier(repo.dir, missing);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects when the receipt path is a symlink', async () => {
    // Real receipt elsewhere; symlink presented at the expected path.
    const real = writeReceipt(
      repo.gitDir,
      {
        batchId: 'B00-test',
        stagedTreeHash: currentIndexTree(repo.dir),
        g7: true,
      },
      0o600,
    );
    const link = join(repo.gitDir, 'itestagent-receipts', 'symlinked-gates.json');
    symlinkSync(real, link);
    const res = await runVerifier(repo.dir, link);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── (b) receipt tree != current index ────────────────

  test('rejects when the receipt tree differs from the current index', async () => {
    const path = writeReceipt(
      repo.gitDir,
      {
        batchId: 'B00-test',
        stagedTreeHash: currentIndexTree(repo.dir),
        g7: true,
      },
      0o600,
    );
    // Mutate the index AFTER the receipt was bound to it.
    writeFileSync(join(repo.dir, 'second.txt'), 'more\n');
    runSync(['git', 'add', 'second.txt'], { cwd: repo.dir });
    const res = await runVerifier(repo.dir, path);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects a static fixture receipt whose tree cannot match any index', async () => {
    const path = writeReceipt(
      repo.gitDir,
      {
        batchId: 'B00-test',
        stagedTreeHash: TREE_ZEROS,
        g7: true,
      },
      0o600,
    );
    const res = await runVerifier(repo.dir, path);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── (c) G7 not passed ────────────────────────────────

  test('rejects when G7 was not passed (g7 !== true)', async () => {
    const path = receiptPath(repo.gitDir);
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    copyFileSync(join(fixturesDir, 'receipt-g7-false.json'), path);
    chmodSync(path, 0o600);
    const res = await runVerifier(repo.dir, path);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── (d) receipt owner / mode unsafe ──────────────────

  test('rejects when the receipt is group/world accessible (unsafe mode)', async () => {
    const path = writeReceipt(
      repo.gitDir,
      {
        batchId: 'B00-test',
        stagedTreeHash: currentIndexTree(repo.dir),
        g7: true,
      },
      0o644,
    ); // mode 0644 leaks the receipt to group/other.
    const res = await runVerifier(repo.dir, path);
    expect(res.exitCode).not.toBe(0);
  });

  test.skipIf(!CAN_CHOWN_TO_OTHER_UID)(
    'rejects when the receipt owner is not the current user',
    async () => {
      const path = writeReceipt(
        repo.gitDir,
        {
          batchId: 'B00-test',
          stagedTreeHash: currentIndexTree(repo.dir),
          g7: true,
        },
        0o600,
      );
      chownSync(path, 65534, -1); // "nobody" ≠ current user.
      const res = await runVerifier(repo.dir, path);
      expect(res.exitCode).not.toBe(0);
    },
  );
});
