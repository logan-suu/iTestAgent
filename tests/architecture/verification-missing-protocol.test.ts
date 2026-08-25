/**
 * verification-missing-protocol.test.ts
 *
 * RED-phase architecture test for the B00 batch.
 *
 * Contract (promotion guide §12.1 / §16 G1 evidence):
 *  - `scripts/verify-evidence.ts` and the G5 verifier, when the current
 *    evidence/report is missing, exit with code 42 AND print exactly one
 *    machine-readable JSON object to stderr:
 *        { "code": "MISSING_CURRENT_EVIDENCE", "batchId": "<BATCH>" }
 *  - Any other failure (unknown batch, bad flags, internal error) uses a
 *    different exit code and does NOT emit MISSING_CURRENT_EVIDENCE.
 *
 * RED phase: `scripts/verify-evidence.ts` does not exist yet (authored in the
 * GREEN phase), so the spawned process fails with a non-42 exit code and no
 * machine JSON — the protocol assertions fail (expected).
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const MISSING_EVIDENCE_CODE = 'MISSING_CURRENT_EVIDENCE';

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns `bun scripts/verify-evidence.ts <args>` from the repo root and
 * captures exit code, stdout and stderr.
 */
async function runVerifyEvidence(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', 'scripts/verify-evidence.ts', ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/**
 * Extracts the machine JSON protocol objects from stderr. Returns the decoded
 * objects for every stderr line that is a JSON object with a "code" field.
 */
function extractProtocolJson(stderr: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'code' in (parsed as object)) {
        objects.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON line — ignore.
    }
  }
  return objects;
}

describe('verify-evidence.ts missing-current-evidence protocol (§12.1)', () => {
  test('exits with code 42 when current evidence is missing', async () => {
    const result = await runVerifyEvidence(['--batch', 'B38', '--require-current']);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(42);
  });

  test('prints exactly one machine JSON to stderr', async () => {
    const result = await runVerifyEvidence(['--batch', 'B38', '--require-current']);
    const objects = extractProtocolJson(result.stderr);
    expect(objects, `stderr: ${result.stderr}`).toHaveLength(1);
  });

  test('machine JSON declares MISSING_CURRENT_EVIDENCE with the requested batchId', async () => {
    const result = await runVerifyEvidence(['--batch', 'B38', '--require-current']);
    const objects = extractProtocolJson(result.stderr);
    expect(objects[0]).toMatchObject({
      code: MISSING_EVIDENCE_CODE,
      batchId: 'B38',
    });
  });

  test('G5 verifier shares the same missing-evidence protocol', async () => {
    const result = await runVerifyEvidence(['--scope', 'g5', '--require-current']);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(42);
    const objects = extractProtocolJson(result.stderr);
    expect(objects.some((o) => o.code === MISSING_EVIDENCE_CODE)).toBe(true);
  });

  test('other failure modes use a different exit code (never 42)', async () => {
    const result = await runVerifyEvidence(['--batch', 'B999', '--require-current']);
    expect(result.exitCode).not.toBe(42);
    expect(result.exitCode).not.toBe(0);
    const objects = extractProtocolJson(result.stderr);
    expect(objects.some((o) => o.code === MISSING_EVIDENCE_CODE)).toBe(false);
  });
});
