/**
 * verify-authorized-path.test.ts — B00 audit infrastructure (promotion guide
 * §12.1) + B40/G5 context (external project directory authorization).
 *
 * RED-phase contract for `scripts/verify-authorized-path.py`. This file is
 * authored BEFORE the script exists; it fails RED until GREEN provides the
 * script.
 *
 * CONTRACT
 * - Usage: `python3 scripts/verify-authorized-path.py --directory <path>`
 * - The gate guards external G5/G5-SIM project directories (e.g.
 *   `ITESTAGENT_IOS_PROJECT`, `ITESTAGENT_WDA_PROJECT`) before any test run.
 * - It requires:
 *     (a) an ABSOLUTE path (a relative path is rejected);
 *     (b) every component from `/` is opened with O_NOFOLLOW — any symlink
 *         component (intermediate or final) is rejected;
 *     (c) the final component is an existing directory.
 * - On success it prints the canonical (fully resolved, symlink-free) path to
 *   stdout and exits 0 (callers use command substitution to re-bind the
 *   variable, as in guide §13).
 *
 * RED expectations:
 * - The script does not exist until GREEN, so the positive case fails RED
 *   while the negative cases pass trivially.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

// ─── Helpers ─────────────────────────────────────────────

const repoRoot = join(import.meta.dir, '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'verify-authorized-path.py');

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
    proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
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

function runVerify(directory: string): Promise<RunResult> {
  return run(['python3', scriptPath, '--directory', directory], {
    cwd: repoRoot,
  });
}

// ─── Suite ───────────────────────────────────────────────

describe('B00 security: authorized external project path (verify-authorized-path.test.ts)', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'itestagent-authpath-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  test('the verify-authorized-path.py script exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  // ─── (a) relative path rejected ───────────────────────

  test('rejects a relative directory path', async () => {
    const rel = 'some/relative/dir';
    const res = await runVerify(rel);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── (b) valid absolute dir accepted + canonical path ─

  test('accepts an absolute real directory and prints its canonical path', async () => {
    const dir = join(work, 'real-dir');
    mkdirSync(dir, { recursive: true });
    const res = await runVerify(dir);
    expect(res.exitCode).toBe(0);
    // No symlinks in the path → canonical path is the realpath.
    expect(res.stdout.trim()).toBe(realpathSync(dir));
  });

  test('accepts an absolute directory path with a trailing slash', async () => {
    const dir = join(work, 'trailing');
    mkdirSync(dir, { recursive: true });
    const res = await runVerify(`${dir}/`);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe(realpathSync(dir));
  });

  // ─── (c) symlinked component rejected ─────────────────

  test('rejects a symlinked final component', async () => {
    const real = join(work, 'real-target');
    const link = join(work, 'link-final');
    mkdirSync(real);
    symlinkSync(real, link);
    const res = await runVerify(link);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects an intermediate symlink component', async () => {
    const inner = join(work, 'real-a', 'real-b');
    mkdirSync(inner, { recursive: true });
    const link = join(work, 'link-mid');
    symlinkSync(join(work, 'real-a'), link);
    const res = await runVerify(join(link, 'real-b'));
    expect(res.exitCode).not.toBe(0);
  });

  // ─── Other rejects ────────────────────────────────────

  test('rejects a nonexistent path', async () => {
    const res = await runVerify(join(work, 'does-not-exist'));
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects a regular file (final component is not a directory)', async () => {
    const file = join(work, 'file.txt');
    writeFileSync(file, 'x');
    const res = await runVerify(file);
    expect(res.exitCode).not.toBe(0);
  });
});
