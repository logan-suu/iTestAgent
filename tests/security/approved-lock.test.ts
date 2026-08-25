/**
 * approved-lock.test.ts — G7 contract: the lockfile used for installs must be
 * the exact approved lock, resolved exclusively from the public registry,
 * with integrity hashes on every package and every direct dependency locked.
 *
 * Guide §12.1: `scripts/verify-approved-lock.ts` 拒绝未被 signed approval
 * hash 绑定的 lock、非公共 registry URL、缺失 integrity 或未锁定 direct
 * dependency。
 *
 * RED phase (B00): `scripts/verify-approved-lock.ts` does not exist yet
 * (authored in GREEN). Each test first asserts the script exists, which fails
 * in RED. After GREEN, every rejection scenario below must exit non-zero and
 * the valid control must exit zero.
 *
 * GREEN contract for `scripts/verify-approved-lock.ts`:
 *
 *   CLI:  bun scripts/verify-approved-lock.ts --lock <path> [--registry <url>]
 *
 *   The script REJECTS (exit non-zero, no `ok` line) when any of:
 *     (a) sha256 of the lock file differs from the signed approval hash.
 *     (b) an explicit registry URL is not a public registry. Public means the
 *         empty string (default public registry) or `https://registry.npmjs.org`.
 *     (c) any package entry has an empty/missing integrity hash.
 *     (d) a direct dependency (workspaces.*.dependencies / devDependencies)
 *         has no resolved entry in the lock's packages table.
 *
 *   Approval hash resolution: env `VERIFY_LOCK_EXPECTED_SHA` when set,
 *   otherwise `targetBunLockSha256` from
 *   `docs/05-planning/promotion-plan-approval.json`.
 *
 *   On full success the script prints exactly one line `ok` and exits 0.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-approved-lock.ts');
const FIXTURES = join(import.meta.dir, 'fixtures');

// ─── Helpers ──────────────────────────────────────────────

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

interface ProcResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runVerifier(lockPath: string, env: Record<string, string>): Promise<ProcResult> {
  const proc = Bun.spawn([process.execPath, VERIFY_SCRIPT, '--lock', lockPath], {
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

const fixture = (name: string): string => join(FIXTURES, name);

// ─── Suite ────────────────────────────────────────────────

describe('scripts/verify-approved-lock.ts — approved-lock contract (G7)', () => {
  test('verifier script exists (authored in GREEN)', () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true);
  });

  test('rejects a lock not bound to the signed approval hash', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    // Expected hash is the sha of the VALID control lock — so the
    // not-bound fixture is demonstrably NOT the approved lock.
    const expectedSha = sha256File(fixture('lock-valid.json'));
    const result = await runVerifier(fixture('lock-not-bound.json'), {
      VERIFY_LOCK_EXPECTED_SHA: expectedSha,
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('rejects non-public registry URLs', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    // Bind the hash to this fixture so only the registry violation remains.
    const expectedSha = sha256File(fixture('lock-private-registry.json'));
    const result = await runVerifier(fixture('lock-private-registry.json'), {
      VERIFY_LOCK_EXPECTED_SHA: expectedSha,
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('rejects a lock with missing package integrity', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const expectedSha = sha256File(fixture('lock-missing-integrity.json'));
    const result = await runVerifier(fixture('lock-missing-integrity.json'), {
      VERIFY_LOCK_EXPECTED_SHA: expectedSha,
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('rejects an unlocked direct dependency', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const expectedSha = sha256File(fixture('lock-unlocked-direct.json'));
    const result = await runVerifier(fixture('lock-unlocked-direct.json'), {
      VERIFY_LOCK_EXPECTED_SHA: expectedSha,
    });

    expect(result.exitCode).not.toBe(0);
    expect(hasOkLine(result)).toBe(false);
  });

  test('accepts a lock bound to its own approval hash (control)', async () => {
    expect(existsSync(VERIFY_SCRIPT)).toBe(true); // RED: script missing

    const expectedSha = sha256File(fixture('lock-valid.json'));
    const result = await runVerifier(fixture('lock-valid.json'), {
      VERIFY_LOCK_EXPECTED_SHA: expectedSha,
    });

    expect(result.exitCode).toBe(0);
    expect(hasOkLine(result)).toBe(true);
  });
});
