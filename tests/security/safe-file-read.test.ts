/**
 * safe-file-read.test.ts — B00 audit infrastructure (promotion guide §12.1,
 * §7 line 707, line 1375).
 *
 * RED-phase contract for `scripts/safe-file-read.py`. This file is authored
 * BEFORE the script exists; it fails RED until GREEN provides the script.
 *
 * CONTRACT
 * - Usage: `python3 scripts/safe-file-read.py --path <absolute-path> [--hash sha256]`
 * - The reader opens the file through a retained directory FD plus per-component
 *   `openat` with `O_NOFOLLOW` (intermediate components `O_DIRECTORY|O_NOFOLLOW`,
 *   final component `O_RDONLY|O_NOFOLLOW`). It NEVER re-opens by pathname after
 *   the open, eliminating the check-then-use symlink swap.
 * - It `fstat`s the final FD: only a regular file is accepted. FIFOs, device
 *   nodes, sockets and directories are rejected with a non-zero exit.
 * - Default mode writes the file content to stdout (read from the SAME retained
 *   FD) and exits 0. With `--hash sha256` it writes the hex SHA-256 of those
 *   bytes instead.
 *
 * RED expectations:
 * - The script does not exist until GREEN: positive cases fail RED; negative
 *   rejection cases pass trivially.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readlinkSync,
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

/** Probes whether device-node creation is permitted on this host (root only). */
function canMknod(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-mknod-probe-'));
  const probe = join(dir, 'devnode');
  try {
    const res = Bun.spawnSync(['mknod', probe, 'c', '1', '3'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return res.exitCode === 0;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const CAN_MKNOD = canMknod();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retained-FD proof. Runs the reader with its stdout redirected into a named
 * FIFO, waits until it blocks writing (guaranteeing it already opened and read
 * the real file through its retained FD), then swaps the path to attacker
 * content, drains the FIFO and returns the bytes. A reader that re-opens by
 * pathname would read the swapped content or be rejected; a correct reader
 * returns the pre-swap original bytes.
 */
async function runSwapRace(kind: 'symlink' | 'rename'): Promise<{
  out: Buffer;
  exitCode: number | null;
  swapped: boolean;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-fifo-race-'));
  try {
    const target = join(dir, 'target.bin');
    const attack = join(dir, 'attack.bin');
    const fifo = join(dir, 'out.fifo');
    const content = payload();
    const attackBytes = Buffer.from('ATTACK-CONTENT-MUST-NEVER-BE-READ', 'utf8');
    writeFileSync(target, content);
    writeFileSync(attack, attackBytes);
    if (!existsSync(scriptPath)) {
      throw new Error(
        'scripts/safe-file-read.py is missing (GREEN artifact not authored yet) — RED expected',
      );
    }
    const mk = await run(['mkfifo', fifo]);
    if (mk.exitCode !== 0) {
      throw new Error(`mkfifo failed: ${mk.stderr}`);
    }

    // Hold the FIFO read-end open (O_NONBLOCK) so the writer never blocks on
    // open; we simply never read from it until after the swap.
    const readFd = openSync(fifo, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
      const proc = Bun.spawn(
        ['bash', '-c', 'python3 "$1" --path "$2" > "$3"', '_', scriptPath, target, fifo],
        { cwd: repoRoot, stdout: 'ignore', stderr: 'pipe' },
      );

      // The reader cannot complete: its 1MB output vastly exceeds the FIFO
      // buffer and nothing drains it until we do. So by now it is blocked in
      // write(), having already opened+read the real file.
      await sleep(1000);
      const exitedEarly = await Promise.race([
        proc.exited.then(() => true),
        sleep(0).then(() => false),
      ]);
      if (exitedEarly) {
        throw new Error('reader exited before the swap — swap window missed');
      }

      // Swap the path mid-read.
      renameSync(target, join(dir, 'target.bin.orig'));
      if (kind === 'symlink') {
        symlinkSync(attack, target);
      } else {
        renameSync(attack, target);
      }

      // Drain the FIFO until EOF.
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
      const swapped = kind === 'symlink' ? readlinkSync(target).length > 0 : true;
      return { out: Buffer.concat(chunks), exitCode, swapped };
    } finally {
      closeSync(readFd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Suite ───────────────────────────────────────────────

describe('B00 security: safe file read (safe-file-read.test.ts)', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'itestagent-saferead-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  test('the safe-file-read.py script exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  // ─── Basic reads ───────────────────────────────────────

  test('reads a regular file and returns its exact content', async () => {
    const file = join(work, 'hello.txt');
    writeFileSync(file, 'hello safe read\n');
    const res = await runRead(['--path', file]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString('utf8')).toBe('hello safe read\n');
  });

  test('reads binary content byte-for-byte', async () => {
    const file = join(work, 'blob.bin');
    const data = payload();
    writeFileSync(file, data);
    const res = await runRead(['--path', file]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.equals(data)).toBe(true);
  });

  test('--hash sha256 emits the sha256 of the retained-FD bytes', async () => {
    const file = join(work, 'hash-me.txt');
    writeFileSync(file, 'deterministic bytes');
    const res = await runRead(['--path', file, '--hash', 'sha256']);
    expect(res.exitCode).toBe(0);
    const expected = createHash('sha256').update('deterministic bytes').digest('hex');
    expect(res.stdout.toString('utf8').trim()).toBe(expected);
  });

  // ─── Symlink rejection ─────────────────────────────────

  test('rejects an intermediate symlink component', async () => {
    const realDir = join(work, 'real-dir');
    const link = join(work, 'link-dir');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'file.txt'), 'secret');
    symlinkSync(realDir, link);
    const res = await runRead(['--path', join(link, 'file.txt')]);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects a final symlink', async () => {
    const real = join(work, 'real.txt');
    const link = join(work, 'link.txt');
    writeFileSync(real, 'secret');
    symlinkSync(real, link);
    const res = await runRead(['--path', link]);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── Non-regular final components ─────────────────────

  test('rejects a FIFO (non-regular final component)', async () => {
    const fifo = join(work, 'pipe.fifo');
    const mk = await run(['mkfifo', fifo]);
    expect(mk.exitCode).toBe(0);
    const res = await runRead(['--path', fifo]);
    expect(res.exitCode).not.toBe(0);
  });

  test.skipIf(!CAN_MKNOD)('rejects a device node (non-regular final component)', async () => {
    const dev = join(work, 'devnode');
    const mk = await run(['mknod', dev, 'c', '1', '3']);
    expect(mk.exitCode).toBe(0);
    const res = await runRead(['--path', dev]);
    expect(res.exitCode).not.toBe(0);
  });

  test('rejects a directory as the final component', async () => {
    const dir = join(work, 'a-directory');
    mkdirSync(dir);
    const res = await runRead(['--path', dir]);
    expect(res.exitCode).not.toBe(0);
  });

  // ─── Retained-FD proof ─────────────────────────────────

  test('returns original content from the retained FD after the path is swapped to a symlink mid-read', async () => {
    const expected = payload();
    const result = await runSwapRace('symlink');
    expect(result.swapped).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.out.equals(expected)).toBe(true);
  });
});
