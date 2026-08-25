/**
 * verify-lock-invariant.ts — B05/B37 dedicated gate (promotion guide §11.4).
 *
 * B05 and B37 only change the contracts `exports` map and must NOT alter the
 * lockfile: dependencies, workspaces and install policy are untouched. This
 * gate proves that the lock file is byte-identical before and after the batch
 * GREEN files are authored.
 *
 *   CLI: bun scripts/verify-lock-invariant.ts --batch B05|B37 \
 *          --receipt <path> --file bun.lock
 *
 * The receipt file (written by the clean precheck with safe-receipt.py
 * write-text) holds the before-SHA-256 hex string. This script hashes the
 * current `--file` and compares.
 *
 * Output: sanitized JSON `{beforeSha256, afterSha256, equal}` on stdout for
 * run-precommit-gates.ts. On mismatch (`equal:false`) the script still prints
 * the JSON but exits non-zero.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  process.stderr.write(`verify-lock-invariant: ${message}\n`);
  process.exit(1);
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function sha256File(filePath: string): string {
  const raw = readFileSync(filePath);
  return createHash('sha256').update(raw).digest('hex');
}

const args = process.argv.slice(2);
const batch = argValue(args, '--batch');
const receiptPath = argValue(args, '--receipt');
const filePath = argValue(args, '--file');

if (batch === undefined || receiptPath === undefined || filePath === undefined) {
  fail(
    'usage: bun scripts/verify-lock-invariant.ts --batch B05|B37 --receipt <path> --file bun.lock',
  );
}
if (batch !== 'B05' && batch !== 'B37') {
  fail(`LOCK_BATCH must be B05 or B37, got: ${batch}`);
}

let beforeSha256: string;
try {
  beforeSha256 = readFileSync(receiptPath, 'utf8').trim();
} catch {
  fail(`cannot read receipt file: ${receiptPath}`);
}
if (!SHA256_RE.test(beforeSha256)) {
  fail(`receipt does not contain a valid SHA-256: ${receiptPath}`);
}

let afterSha256: string;
try {
  afterSha256 = sha256File(filePath);
} catch {
  fail(`cannot read lock file: ${filePath}`);
}

const equal = beforeSha256 === afterSha256;
const output = JSON.stringify({ beforeSha256, afterSha256, equal });
process.stdout.write(`${output}\n`);

if (!equal) {
  fail(`lock file changed for ${batch} (before ${beforeSha256}, after ${afterSha256})`);
}
