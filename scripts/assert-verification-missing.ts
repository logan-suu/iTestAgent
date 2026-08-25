/**
 * assert-verification-missing.ts — B38/B41/B42-only RED baseline assertion.
 *
 * Contract (promotion guide §12.1 / §12.3 CLEAN-FIRST VERIFICATION EXCEPTION):
 *  - Only accepts batches B38, B41 and B42 (verification-missing baseline mode).
 *  - Runs the command given after `--`.
 *  - Accepts the result ONLY when the command exits with code 42 AND its stderr
 *    contains a machine JSON object with code == "MISSING_CURRENT_EVIDENCE" and
 *    batchId matching the requested batch.
 *  - On acceptance, writes the baseline digest receipt JSON:
 *        { "baselineDigest": <sha256 of command output>, "baselineMode": "verification-missing", "batchId": "<BATCH>" }
 *    to `--receipt <path>` (Git-dir-local, mode 0600, exclusive create).
 *
 * CLI:
 *   bun scripts/assert-verification-missing.ts --batch <B> --receipt <path> -- <command...>
 *
 * Exit codes:
 *   0  protocol accepted and receipt written
 *   1  protocol not satisfied (command exit / JSON code / batchId mismatch / receipt write failure)
 *   2  usage error
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MISSING_EVIDENCE_CODE = 'MISSING_CURRENT_EVIDENCE';
const ELIGIBLE_BATCHES = new Set(['B38', 'B41', 'B42']);

function usage(message: string): never {
  process.stderr.write(`assert-verification-missing: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/assert-verification-missing.ts --batch <B> --receipt <path> -- <command...>\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`assert-verification-missing: ${message}\n`);
  process.exit(1);
}

/** Extracts every stderr line that is a JSON object carrying a "code" field. */
function protocolObjects(stderr: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
        objects.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON line — ignore.
    }
  }
  return objects;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

if (import.meta.main) {
  const args = process.argv.slice(2);

  let batch: string | undefined;
  let receiptPath: string | undefined;
  const dashDashIndex = args.indexOf('--');
  const command = dashDashIndex === -1 ? [] : args.slice(dashDashIndex + 1);
  const flagArgs = dashDashIndex === -1 ? args : args.slice(0, dashDashIndex);

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    switch (arg) {
      case '--batch':
        batch = flagArgs[++i];
        if (!batch) usage('--batch requires a value');
        break;
      case '--receipt':
        receiptPath = flagArgs[++i];
        if (!receiptPath) usage('--receipt requires a value');
        break;
      default:
        usage(`unexpected argument "${arg}"`);
    }
  }

  if (!batch) usage('--batch is required');
  if (!receiptPath) usage('--receipt is required');
  if (!ELIGIBLE_BATCHES.has(batch)) {
    fail(`batch ${batch} is not eligible for verification-missing assertion (only B38, B41, B42)`);
  }
  if (command.length === 0) usage('a command must follow --');

  // Run the command and capture stdout + stderr + exit code.
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  const objects = protocolObjects(stderr);
  const match = objects.find((o) => o.code === MISSING_EVIDENCE_CODE);
  const batchMatches = match !== undefined && match.batchId === batch;

  if (exitCode !== 42) {
    fail(`command exited ${exitCode}, expected 42 (verification-missing protocol)`);
  }
  if (!match) {
    fail(`command exited 42 but no machine JSON with code "${MISSING_EVIDENCE_CODE}" on stderr`);
  }
  if (!batchMatches) {
    fail(`machine JSON batchId mismatch: got "${String(match?.batchId)}", expected "${batch}"`);
  }

  // Protocol satisfied: write the baseline digest receipt (0600, exclusive).
  const digest = sha256Hex(`${stdout}${stderr}`);
  const receipt = {
    baselineDigest: digest,
    baselineMode: 'verification-missing',
    batchId: batch,
  };

  try {
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    fail(`failed to write receipt ${receiptPath}: ${(err as Error).message}`);
  }

  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exit(0);
}
