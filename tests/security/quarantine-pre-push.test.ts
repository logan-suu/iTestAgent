/**
 * quarantine-pre-push.test.ts — B00 audit infrastructure (promotion guide §12.1).
 *
 * RED-phase contract for the pre-push quarantine gate. This file is authored
 * BEFORE the hook scripts exist; it fails RED until GREEN provides:
 *   - `.githooks/pre-push`          — installed hook (delegates to the script)
 *   - `scripts/quarantine-pre-push.sh` — shared implementation
 *   - `git config core.hooksPath`   — must be `.githooks`
 *
 * CONTRACT
 * - The hook and the standalone script consume git's pre-push ref lines from
 *   stdin. Each line has the git pre-push shape:
 *       <local ref> <local oid> <remote ref> <remote oid>
 * - The gate exits 0 if and only if EVERY line has both a local ref and a
 *   remote ref that are OUTSIDE the `refs/quarantine/**` namespace.
 * - A push whose local or remote ref matches `refs/quarantine/**` is rejected
 *   (exit non-zero). This includes the ref input produced by `git push --all`
 *   and `git push --mirror` whenever a quarantine ref exists locally (guide
 *   §17: "永久禁止 git push --mirror、git push --all 或显式 push
 *   refs/quarantine/**; ... 逐行检查 stdin 的 local/remote refs").
 * - The gate must inspect EVERY stdin line, not only the first.
 *
 * RED expectations:
 * - `core.hooksPath` is unset until B00 GREEN runs `git config core.hooksPath .githooks`.
 * - The hook script files do not exist until the GREEN phase authors them.
 * - Spawning a missing script yields a non-zero exit, so negative cases pass
 *   trivially in RED; the file is RED because the positive cases fail.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

// ─── Helpers ─────────────────────────────────────────────

const repoRoot = join(import.meta.dir, '..', '..');

/** A well-formed 40-hex object id used in synthetic ref lines. */
const OID = 'a'.repeat(40);

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

/**
 * Runs a command capturing stdout/stderr. A spawn failure (e.g. the GREEN
 * script is still missing) is surfaced as a non-zero exit so assertions keep
 * working during the RED phase.
 */
async function run(
  cmd: string[],
  opts: { cwd?: string; stdinData?: string } = {},
): Promise<RunResult> {
  let proc: Subprocess;
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd ?? repoRoot,
      stdin: opts.stdinData !== undefined ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: String(err) };
  }
  if (opts.stdinData !== undefined && proc.stdin && typeof proc.stdin !== 'number') {
    proc.stdin.write(opts.stdinData);
    proc.stdin.end();
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

/**
 * Resolves the hook implementation. The standalone script is the source of
 * truth; the installed `.githooks/pre-push` wrapper (if present) is preferred
 * because it is what git actually invokes.
 */
function hookScriptPath(): string {
  const installedHook = join(repoRoot, '.githooks', 'pre-push');
  if (existsSync(installedHook)) {
    return installedHook;
  }
  return join(repoRoot, 'scripts', 'quarantine-pre-push.sh');
}

/** Feeds the given git pre-push ref lines to the hook and returns the result. */
function runHook(refLines: string): Promise<RunResult> {
  return run(['bash', hookScriptPath()], { stdinData: refLines });
}

function pushLine(localRef: string, remoteRef: string): string {
  return `${localRef} ${OID} ${remoteRef} ${OID}`;
}

/** Joins git pre-push ref lines into a single stdin payload (LF-terminated). */
function multiLine(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

// ─── Suite ───────────────────────────────────────────────

describe('B00 security: quarantine pre-push gate (quarantine-pre-push.test.ts)', () => {
  // ─── Installation ──────────────────────────────────────

  test('core.hooksPath is configured to .githooks', async () => {
    // B00 GREEN must run `git config core.hooksPath .githooks` (guide §12.1).
    const res = await run(['git', 'config', '--get', 'core.hooksPath']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('.githooks');
  });

  test('the pre-push hook script exists (.githooks/pre-push or scripts/quarantine-pre-push.sh)', () => {
    // Both files are part of the B00 allowlist; GREEN authors them.
    expect(existsSync(hookScriptPath())).toBe(true);
  });

  // ─── Normal branch push is allowed ────────────────────

  test('allows a normal branch push', async () => {
    const res = await runHook(`${pushLine('refs/heads/main', 'refs/heads/main')}\n`);
    expect(res.exitCode).toBe(0);
  });

  // ─── Explicit quarantine refs are rejected ────────────

  test('rejects an explicit quarantine LOCAL ref', async () => {
    const res = await runHook(`${pushLine('refs/quarantine/evidence-001', 'refs/heads/main')}\n`);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects an explicit quarantine REMOTE ref', async () => {
    const res = await runHook(`${pushLine('refs/heads/main', 'refs/quarantine/evidence-001')}\n`);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── --all / --mirror ref input is rejected ───────────

  test('rejects --mirror ref input (every local ref, including quarantine)', async () => {
    // `git push --mirror` pushes ALL local refs; when a quarantine ref exists
    // locally it appears on stdin and the gate must reject the whole push.
    const res = await runHook(
      multiLine(
        pushLine('refs/heads/main', 'refs/heads/main'),
        pushLine('refs/tags/v1.0.0', 'refs/tags/v1.0.0'),
        pushLine('refs/quarantine/snapshot-001', 'refs/quarantine/snapshot-001'),
      ),
    );
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects --all ref input that carries a quarantine ref', async () => {
    // `git push --all` emits every branch line; a locally-present quarantine
    // branch would be part of that input and must trip the gate.
    const res = await runHook(
      multiLine(
        pushLine('refs/heads/feature-a', 'refs/heads/feature-a'),
        pushLine('refs/quarantine/host-forensics-01', 'refs/quarantine/host-forensics-01'),
      ),
    );
    expect(res.exitCode).not.toBe(0);
  });

  // ─── Per-line scan ────────────────────────────────────

  test('scans every stdin line (quarantine ref after normal refs is still rejected)', async () => {
    const res = await runHook(
      multiLine(
        pushLine('refs/heads/main', 'refs/heads/main'),
        pushLine('refs/heads/feature-b', 'refs/heads/feature-b'),
        pushLine('refs/quarantine/last-line', 'refs/heads/main'),
      ),
    );
    expect(res.exitCode).not.toBe(0);
  });
});
