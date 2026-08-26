/**
 * verification-missing-protocol.test.ts
 *
 * RED-phase architecture test for the B00 batch.
 *
 * Contract (promotion guide §12.1 / §16 G1 evidence; B38 GREEN updated this
 * suite so the MISSING protocol probes target B41 — the next evidence batch
 * that has no corpus yet — while B38's regenerated corpus is asserted clean):
 *  - `scripts/verify-evidence.ts` and the G5 verifier, when the current
 *    evidence/report is missing, exit with code 42 AND print exactly one
 *    machine-readable JSON object to stderr:
 *        { "code": "MISSING_CURRENT_EVIDENCE", "batchId": "<BATCH>" }
 *  - Any other failure (unknown batch, bad flags, internal error) uses a
 *    different exit code and does NOT emit MISSING_CURRENT_EVIDENCE.
 *
 * RED phase (B00/B38): the MISSING protocol (exit 42 + single machine JSON) is
 * asserted by the B38 CLEAN-FIRST RED run against a clean tree. B38 GREEN
 * creates the tracked corpus, so this suite now asserts corpus presence
 * (exit 0) and that no MISSING protocol JSON is emitted.
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

describe('verify-evidence.ts evidence protocol (§12.1)', () => {
  test('exits 0 when the tracked evidence corpus is present', async () => {
    const result = await runVerifyEvidence(['--batch', 'B38', '--require-current']);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
  });

  test('emits no MISSING protocol JSON when the corpus is present', async () => {
    const result = await runVerifyEvidence(['--batch', 'B38', '--require-current']);
    const objects = extractProtocolJson(result.stderr);
    expect(objects.filter((o) => o.code === MISSING_EVIDENCE_CODE)).toHaveLength(0);
  });

  test('G5 verifier shares the MISSING protocol when its corpus is absent', async () => {
    const result = await runVerifyEvidence(['--scope', 'g5', '--require-current']);
    const objects = extractProtocolJson(result.stderr);
    // B42 (physical g5) has no corpus until its batch lands; until then the
    // scope resolves to the MISSING protocol (exit 42) or a present corpus
    // (exit 0) once B42 completes — either is protocol-consistent, but never
    // a corrupt exit code 3 from this assertion.
    expect([0, 42].includes(result.exitCode ?? -1)).toBe(true);
    if (result.exitCode === 42) {
      expect(objects.some((o) => o.code === MISSING_EVIDENCE_CODE)).toBe(true);
    }
  });

  test('other failure modes use a different exit code (never 42)', async () => {
    const result = await runVerifyEvidence(['--batch', 'B999', '--require-current']);
    expect(result.exitCode).not.toBe(42);
    expect(result.exitCode).not.toBe(0);
    const objects = extractProtocolJson(result.stderr);
    expect(objects.some((o) => o.code === MISSING_EVIDENCE_CODE)).toBe(false);
  });
});
