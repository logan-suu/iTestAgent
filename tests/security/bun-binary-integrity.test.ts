/**
 * bun-binary-integrity.test.ts — G7 contract: the pinned Bun runtime, the
 * approved lockfile, and the install policy must be re-verified on every
 * prelude, and every tampering scenario must FAIL CLOSED (non-zero exit,
 * no `ok` marker).
 *
 * Guide §12.1: `scripts/verify-bun-binary.sh` 每次 prelude 重验 Bun cached
 * ZIP checksum、fresh extraction 与 installed absolute binary bytes。
 *
 * RED phase (B00): `scripts/verify-bun-binary.sh` does not exist yet
 * (authored in GREEN). Each test first asserts the script exists, which fails
 * in RED. After GREEN, the tamper scenarios below must all exit non-zero.
 *
 * GREEN contract for `scripts/verify-bun-binary.sh` (env-driven so tests can
 * simulate tampering without a real Bun install):
 *
 *   BUN_ARCHIVE_SHA         (required) expected SHA-256 of the cached Bun ZIP.
 *                           On mismatch → exit 1 (fail closed).
 *   BUN_ARCHIVE             (required) path to the cached ZIP. Missing → exit 1.
 *   BUN_BINARY_PATH         (required) path of the installed Bun binary. The
 *                           script extracts the ZIP to a temp dir and `cmp`
 *                           the fresh `bun` bytes against this path. Any byte
 *                           difference → exit 1.
 *   BUN_LOCK_PATH           (required) path of the lockfile to verify.
 *                           Defaults to <repo-root>/bun.lock.
 *   BUN_LOCK_EXPECTED_SHA   (required) SHA-256 of the signed/approved lock
 *                           (targetBunLockSha256). If the lock on disk does
 *                           not hash to this value (floating/unapproved
 *                           lock) → exit 1.
 *   BUN_LIFECYCLE_SCRIPTS   (optional, default "0"). If "1" — i.e. an install
 *                           that would run lifecycle scripts BEFORE G7 passed —
 *                           the script must fail closed → exit 1.
 *
 * On success the script prints exactly one line `ok` to stdout and exits 0.
 * On any failure it must NOT print `ok`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-bun-binary.sh');
const REPO_LOCK = join(REPO_ROOT, 'bun.lock');

// ─── Helpers ──────────────────────────────────────────────

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Build a real ZIP archive containing a single top-level `bun` file. */
function buildFakeArchive(archivePath: string, content: string): void {
  const staging = mkdtempSync(join(tmpdir(), 'itestagent-bun-stage-'));
  try {
    writeFileSync(join(staging, 'bun'), content);
    const result = spawnSync('zip', ['-q', archivePath, 'bun'], { cwd: staging });
    if (result.status !== 0) {
      throw new Error(`zip failed to build fixture archive: ${result.stderr?.toString()}`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

interface ProcResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runVerifier(env: Record<string, string>): Promise<ProcResult> {
  const proc = Bun.spawn(['bash', VERIFY_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/** The success marker is a standalone `ok` line; nothing else counts. */
function hasOkLine(result: ProcResult): boolean {
  return /(^|\n)ok(\n|$)/.test(`${result.stdout}\n${result.stderr}`);
}

// ─── Fixture setup ────────────────────────────────────────

let tmpDir: string;
let archivePath: string;
let installedBinary: string;
let tamperedLockPath: string;
let originalArchiveBytes: Buffer;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'itestagent-bun-verify-'));
  archivePath = join(tmpDir, 'bun-darwin-arm64.zip');
  installedBinary = join(tmpDir, 'bun');
  buildFakeArchive(archivePath, 'fake-bun-binary-A\n');
  // Installed binary deliberately DIFFERENT from the archive content.
  writeFileSync(installedBinary, 'TAMPERED-BINARY-B\n');
  originalArchiveBytes = readFileSync(archivePath);

  // A lockfile whose bytes differ from the approved repo lock.
  tamperedLockPath = join(tmpDir, 'bun.lock.tampered');
  writeFileSync(tamperedLockPath, '{"lockfileVersion":1,"configVersion":0,"tampered":true}\n');
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Suite ────────────────────────────────────────────────

describe('scripts/verify-bun-binary.sh — fail-closed Bun + lock integrity (G7)', () => {
  test('verifier script exists (authored in GREEN)', () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true);
  });

  test('fails closed on binary/cache substitution (wrong archive checksum)', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const result = await runVerifier({
      BUN_ARCHIVE_SHA: '0'.repeat(64), // does not match the real archive
      BUN_ARCHIVE: archivePath,
      BUN_BINARY_PATH: installedBinary,
      BUN_LOCK_PATH: REPO_LOCK,
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK),
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed on binary/cache substitution (tampered cached ZIP)', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    writeFileSync(archivePath, 'TAMPERED-ARCHIVE-BYTES\n');
    const result = await runVerifier({
      BUN_ARCHIVE_SHA: createHash('sha256').update(originalArchiveBytes).digest('hex'),
      BUN_ARCHIVE: archivePath,
      BUN_BINARY_PATH: installedBinary,
      BUN_LOCK_PATH: REPO_LOCK,
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK),
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed on binary substitution (installed binary differs from archive)', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    writeFileSync(archivePath, originalArchiveBytes);
    const result = await runVerifier({
      BUN_ARCHIVE_SHA: sha256File(archivePath), // archive checksum is valid
      BUN_ARCHIVE: archivePath,
      BUN_BINARY_PATH: installedBinary, // bytes differ from archive → fail
      BUN_LOCK_PATH: REPO_LOCK,
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK),
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed on a floating/unapproved lock (lock not bound to approval hash)', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const result = await runVerifier({
      BUN_ARCHIVE_SHA: '0'.repeat(64), // irrelevant for this scenario
      BUN_ARCHIVE: archivePath,
      BUN_BINARY_PATH: installedBinary,
      BUN_LOCK_PATH: tamperedLockPath, // bytes differ from the approved lock
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK), // the approved hash
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed on lifecycle scripts requested before G7', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const result = await runVerifier({
      BUN_ARCHIVE_SHA: '0'.repeat(64),
      BUN_ARCHIVE: archivePath,
      BUN_BINARY_PATH: installedBinary,
      BUN_LOCK_PATH: REPO_LOCK,
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK),
      BUN_LIFECYCLE_SCRIPTS: '1', // must be blocked until G7 passes
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed when the cached ZIP is missing', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const missing = join(tmpDir, 'does-not-exist.zip');
    const result = await runVerifier({
      BUN_ARCHIVE_SHA: '0'.repeat(64),
      BUN_ARCHIVE: missing,
      BUN_BINARY_PATH: installedBinary,
      BUN_LOCK_PATH: REPO_LOCK,
      BUN_LOCK_EXPECTED_SHA: sha256File(REPO_LOCK),
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });
});
