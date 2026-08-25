/**
 * read-baseline-receipt.ts — read a Git-dir-local baseline receipt field.
 *
 * Contract (promotion guide §12.1 / §12.4): reads a JSON receipt and prints
 * the value of the requested field (`baselineMode` | `baselineDigest`) to
 * stdout for the manifest writer. Receipts live in the Git-dir-local
 * `itestagent-receipts/` directory and are never committed.
 *
 * CLI:
 *   bun scripts/read-baseline-receipt.ts --receipt <path> --field baselineMode|baselineDigest
 *
 * Exit codes:
 *   0  field read and printed
 *   1  receipt missing / unreadable / malformed / field absent
 *   2  usage error
 */

import { existsSync, readFileSync } from 'node:fs';

const SUPPORTED_FIELDS = new Set(['baselineMode', 'baselineDigest']);

function usage(message: string): never {
  process.stderr.write(`read-baseline-receipt: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/read-baseline-receipt.ts --receipt <path> --field baselineMode|baselineDigest\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`read-baseline-receipt: ${message}\n`);
  process.exit(1);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let receiptPath: string | undefined;
  let field: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--receipt':
        receiptPath = args[++i];
        if (!receiptPath) usage('--receipt requires a value');
        break;
      case '--field':
        field = args[++i];
        if (!field) usage('--field requires a value');
        break;
      default:
        usage(`unexpected argument "${arg}"`);
    }
  }

  if (!receiptPath) usage('--receipt is required');
  if (!field) usage('--field is required');
  if (!SUPPORTED_FIELDS.has(field)) {
    usage(`unsupported --field "${field}" (expected baselineMode or baselineDigest)`);
  }

  if (!existsSync(receiptPath)) {
    fail(`receipt not found: ${receiptPath}`);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    fail(`receipt is not valid JSON (${receiptPath}): ${(err as Error).message}`);
  }
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    fail(`receipt is not a JSON object (${receiptPath})`);
  }

  const value = receipt[field];
  if (value === undefined || value === null) {
    fail(`receipt has no field "${field}" (${receiptPath})`);
  }

  process.stdout.write(`${String(value)}\n`);
  process.exit(0);
}
