/**
 * safe-file-read-race.test.ts — B00 audit infrastructure (promotion guide
 * §12.1). Companion to safe-file-read.test.ts, focused on the check-then-use
 * symlink swap.
 *
 * RED-phase contract for `scripts/safe-file-read.py`. This file is authored
 * BEFORE the script exists; it fails RED until GREEN provides the script.
 *
 * THREAT MODEL
 * A naive reader validates a path, then later opens it by pathname again
 * ("check-then-use"). An attacker swaps the path to a symlink / different file
 * between the check and the use, redirecting the read to attacker content.
 * `safe-file-read.py` defeats this by opening ONCE through a retained
 * directory FD with per-component `O_NOFOLLOW`, and reading all bytes from that
 * same FD — a later path swap cannot change what the reader returns.
 *
 * VERIFICATION TECHNIQUE
 * The reader's stdout is redirected into a named FIFO. We hold the FIFO
 * read-end open (O_NONBLOCK) but never read it, so the reader blocks in
 * write() after emitting ~64KB — at that point it has already opened and read
 * the real file through its retained FD. We then swap the path to attacker
 * content and drain the FIFO. The bytes must still be the original file's
 * bytes, proving the read came from the pre-swap retained FD.
 *
 * RED expectations:
 * - The script does not exist until GREEN: positive proofs fail RED; the
 *   pre-existing-symlink control passes trivially.
 */

import { describe, expect, test } from 'bun:test';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

// ─── Constants ───────────────────────────────────────────

const repoRoot = join(import.meta.dir, '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'safe-file-read.py');

/** Deterministic 1MB payload with a marker so truncation is detectable. */
function payload(): Buffer {
  const buf = Buffer.alloc(1_000_000, 0x61);
  buf.writeUInt32BE(0xfeedface, 500_000);
  return buf;
}

const ATTACK_BYTES = Buffer.from('ATTACK-CONTENT-MUST-NEVER-BE-READ', 'utf8');

// ─── Helpers ─────────────────────────────────────────────

interface RunResult {
  exitCode: number | null;
  stdout: Buffer;
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
    return { exitCode: 127, stdout: Buffer.alloc(0), stderr: String(err) };
  }
  const [outBuf, errBuf] = await Promise.all([
    streamToBuffer(proc.stdout),
    streamToBuffer(proc.stderr),
  ]);
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: outBuf,
    stderr: errBuf.toString('utf8'),
  };
}

function runRead(args: string[]): Promise<RunResult> {
  return run(['python3', scriptPath, ...args], { cwd: repoRoot });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the reader with stdout redirected into a FIFO, waits until it is
 * blocked writing (guaranteeing the retained-FD open+read already happened),
 * swaps the path to attacker content, then drains the FIFO.
 */
async function runSwapRace(kind: 'symlink' | 'rename'): Promise<{
  out: Buffer;
  exitCode: number | null;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-race-'));
  try {
    const target = join(dir, 'target.bin');
    const attack = join(dir, 'attack.bin');
    const fifo = join(dir, 'out.fifo');
    const content = payload();
    writeFileSync(target, content);
    writeFileSync(attack, ATTACK_BYTES);
    if (!existsSync(scriptPath)) {
      throw new Error(
        'scripts/safe-file-read.py is missing (GREEN artifact not authored yet) — RED expected',
      );
    }
    const mk = await run(['mkfifo', fifo]);
    if (mk.exitCode !== 0) {
      throw new Error(`mkfifo failed: ${mk.stderr}`);
    }

    const readFd = openSync(fifo, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
      const proc = Bun.spawn(
        ['bash', '-c', 'python3 "$1" --path "$2" > "$3"', '_', scriptPath, target, fifo],
        { cwd: repoRoot, stdout: 'ignore', stderr: 'pipe' },
      );

      // Blocked in write() ⇒ the real file was already opened+read. 1MB of
      // output cannot fit in the undrained FIFO, so the reader cannot finish.
      await sleep(1000);
      const exitedEarly = await Promise.race([
        proc.exited.then(() => true),
        sleep(0).then(() => false),
      ]);
      if (exitedEarly) {
        throw new Error('reader exited before the swap — swap window missed');
      }

      renameSync(target, join(dir, 'target.bin.orig'));
      if (kind === 'symlink') {
        symlinkSync(attack, target);
      } else {
        renameSync(attack, target);
      }

      const chunks: Buffer[] = [];
      const buf = Buffer.alloc(65536);
      const deadline = Date.now() + 15_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error('timed out draining fifo');
        let n: number;
        try {
          n = readSync(readFd, buf);
        } catch {
          await sleep(10);
          continue;
        }
        if (n === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, n)));
      }

      const exitCode = await proc.exited;
      return { out: Buffer.concat(chunks), exitCode };
    } finally {
      closeSync(readFd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Suite ───────────────────────────────────────────────

describe('B00 security: safe file read — swap race (safe-file-read-race.test.ts)', () => {
  test('the safe-file-read.py script exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  // ─── Mid-read symlink swap ────────────────────────────

  test('defeats a symlink swap: path replaced by a symlink mid-read, original bytes returned', async () => {
    const expected = payload();
    const result = await runSwapRace('symlink');
    expect(result.exitCode).toBe(0);
    expect(result.out.equals(expected)).toBe(true);
  });

  test('attack content never appears in the reader output after a symlink swap', async () => {
    const result = await runSwapRace('symlink');
    const idx = result.out.indexOf(ATTACK_BYTES);
    expect(idx).toBe(-1);
  });

  // ─── Mid-read rename swap ─────────────────────────────

  test('defeats a rename swap: path replaced by a different regular file mid-read, original bytes returned', async () => {
    const expected = payload();
    const result = await runSwapRace('rename');
    expect(result.exitCode).toBe(0);
    expect(result.out.equals(expected)).toBe(true);
  });

  // ─── Control: symlink present BEFORE the read ─────────

  test('rejects a symlink present before the read starts (no swap involved)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'itestagent-race-control-'));
    try {
      const real = join(dir, 'real.txt');
      const link = join(dir, 'link.txt');
      writeFileSync(real, 'secret');
      symlinkSync(real, link);
      const res = await runRead(['--path', link]);
      expect(res.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
