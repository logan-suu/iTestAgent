/**
 * gitleaks-binary-integrity.test.ts — G7 contract: the pinned gitleaks binary
 * must be verified from the pinned archive + signed checksum, and every
 * tampering scenario must FAIL CLOSED (non-zero exit, no `ok` marker).
 *
 * Guide §12.1: `scripts/verify-gitleaks-binary.sh` 每次 G7 都重验 cached
 * archive SHA-256、从 archive 临时解包并 `cmp` installed binary，禁止只信任
 * 自报版本。
 *
 * RED phase (B00): `scripts/verify-gitleaks-binary.sh` does not exist yet
 * (authored in GREEN). Each test first asserts the script exists, which fails
 * in RED. After GREEN, the tamper scenarios below must all exit non-zero.
 *
 * GREEN contract for `scripts/verify-gitleaks-binary.sh` (env-driven so tests
 * can simulate tampering without a real gitleaks install):
 *
 *   GITLEAKS_ARCHIVE_SHA   (required) expected SHA-256 of the cached archive.
 *                          On mismatch → exit 1 (fail closed).
 *   GITLEAKS_ARCHIVE       (required) path to the cached archive. Missing
 *                          file → exit 1.
 *   GITLEAKS_BINARY_PATH   (required) path of the installed binary. The
 *                          script extracts the archive to a temp dir and
 *                          `cmp` the fresh `gitleaks` bytes against this
 *                          path. Any byte difference → exit 1.
 *   GITLEAKS_VERSION       (required) pinned version string; `"$BINARY"
 *                          version` must equal it, else exit 1.
 *   GITLEAKS_EXTRACT_DIR   (optional) override the temp extraction dir.
 *
 * On success the script prints exactly one line `ok` to stdout and exits 0.
 * On any failure it must NOT print `ok`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-gitleaks-binary.sh');

// ─── Helpers ──────────────────────────────────────────────

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Build a real gzip tarball containing a single `gitleaks` file. */
function buildFakeArchive(archivePath: string, content: string): void {
  const staging = mkdtempSync(join(tmpdir(), 'itestagent-gitleaks-stage-'));
  try {
    writeFileSync(join(staging, 'gitleaks'), content);
    const result = spawnSync('tar', ['-czf', archivePath, '-C', staging, 'gitleaks'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`tar failed to build fixture archive: ${result.stderr}`);
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
let originalArchiveBytes: Buffer;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'itestagent-gitleaks-verify-'));
  archivePath = join(tmpDir, 'gitleaks-8.28.0.tar.gz');
  installedBinary = join(tmpDir, 'gitleaks');
  buildFakeArchive(archivePath, 'fake-gitleaks-binary-A\n');
  // The installed binary is deliberately DIFFERENT from the archive content
  // (simulates a substituted binary on disk).
  writeFileSync(installedBinary, 'TAMPERED-BINARY-B\n');
  originalArchiveBytes = readFileSync(archivePath);
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Suite ────────────────────────────────────────────────

describe('scripts/verify-gitleaks-binary.sh — fail-closed binary integrity (G7)', () => {
  test('verifier script exists (authored in GREEN)', () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true);
  });

  test('fails closed when the installed binary is substituted', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const result = await runVerifier({
      GITLEAKS_ARCHIVE_SHA: sha256File(archivePath), // archive checksum is valid
      GITLEAKS_ARCHIVE: archivePath,
      GITLEAKS_BINARY_PATH: installedBinary, // bytes differ from archive → fail
      GITLEAKS_VERSION: '8.28.0',
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed when the cached archive is replaced', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    // Tamper the archive after recording its original bytes.
    writeFileSync(archivePath, 'TAMPERED-ARCHIVE-BYTES\n');
    const result = await runVerifier({
      GITLEAKS_ARCHIVE_SHA: createHash('sha256').update(originalArchiveBytes).digest('hex'),
      GITLEAKS_ARCHIVE: archivePath,
      GITLEAKS_BINARY_PATH: installedBinary,
      GITLEAKS_VERSION: '8.28.0',
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed on a wrong-architecture checksum', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    // Restore the archive, then present a checksum that belongs to a
    // different architecture asset — i.e. an archive that is not the
    // expected one for this platform.
    writeFileSync(archivePath, originalArchiveBytes);
    const wrongArchSha = '0'.repeat(64);
    const result = await runVerifier({
      GITLEAKS_ARCHIVE_SHA: wrongArchSha,
      GITLEAKS_ARCHIVE: archivePath,
      GITLEAKS_BINARY_PATH: installedBinary,
      GITLEAKS_VERSION: '8.28.0',
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed when the cached archive is missing', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const missing = join(tmpDir, 'does-not-exist.tar.gz');
    const result = await runVerifier({
      GITLEAKS_ARCHIVE_SHA: '0'.repeat(64),
      GITLEAKS_ARCHIVE: missing,
      GITLEAKS_BINARY_PATH: installedBinary,
      GITLEAKS_VERSION: '8.28.0',
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('fails closed when the pinned version does not match', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    writeFileSync(archivePath, originalArchiveBytes);
    const result = await runVerifier({
      GITLEAKS_ARCHIVE_SHA: sha256File(archivePath),
      GITLEAKS_ARCHIVE: archivePath,
      GITLEAKS_BINARY_PATH: installedBinary,
      GITLEAKS_VERSION: '1.0.0-does-not-exist',
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });
});
