/**
 * run-batch-tests.ts — batch:test runner for the promotion protocol.
 *
 * Contract (promotion guide §12.3, §11.1, appendix A.1/A.2):
 *  - Accepts batches B00-B42 only.
 *  - Reads the per-batch test file list from
 *    `docs/06-verification/migration/allowlists/{BATCH}-files.txt` (only
 *    `*.test.ts` entries) and executes them with `bun test` (via
 *    `process.execPath`, never a PATH-resolved bun).
 *  - RED   (`--expect-red`): the test command must exit NON-ZERO. The sha256 of
 *    the combined stdout+stderr is the baseline digest, written as a Git-dir-local
 *    receipt `{batchId, baselineMode:"red", baselineDigest}` (exclusive, 0600).
 *  - B26   (`--expect-characterization`): the pre-migration source is still GREEN;
 *    requires exit 0 and writes `baselineMode:"characterization"`.
 *  - B38/B41/B42 RED: dispatched to `scripts/verify-evidence.ts --batch <B> --require-current`
 *    which must exit 42 and emit exactly one stderr JSON object
 *    `{code:"MISSING_CURRENT_EVIDENCE", batchId:<B>}` (see
 *    tests/architecture/verification-missing-protocol.test.ts); the digest of the
 *    combined output is written with `baselineMode:"verification-missing"`.
 *  - GREEN (no expectation flag): the same command must exit 0.
 *
 * Receipts are written through `scripts/safe-receipt.py` (no-follow, mode 0600).
 *
 * CLI:
 *   bun scripts/run-batch-tests.ts <BATCH> --expect-red [--receipt <path>]
 *   bun scripts/run-batch-tests.ts B26 --expect-characterization [--receipt <path>]
 *   bun scripts/run-batch-tests.ts <BATCH> [--receipt <path>]      (GREEN)
 *
 * Exit codes:
 *   0  result JSON printed
 *   1  protocol violation (fail-closed)
 *   2  usage / configuration error
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BATCH_ROLLBACK_TAGS } from './expected-batch-tag.ts';

const MISSING_EVIDENCE_CODE = 'MISSING_CURRENT_EVIDENCE';
const VERIFICATION_MISSING_BATCHES = new Set(['B38', 'B41', 'B42']);
const CHARACTERIZATION_BATCH = 'B26';
const ALLOWLIST_DIR = join('docs', '06-verification', 'migration', 'allowlists');
const RECEIPT_PARENT = 'itestagent-receipts';

type Mode = 'red' | 'characterization' | 'verification-missing' | 'green';

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function usage(message: string): never {
  process.stderr.write(`run-batch-tests: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/run-batch-tests.ts <BATCH> [--expect-red|--expect-characterization] [--receipt <path>]\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`run-batch-tests: ${message}\n`);
  process.exit(1);
}

/** Parses stderr lines and returns the machine JSON objects that carry a "code" field. */
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

/** Runs a command with captured stdout/stderr and exit code. */
async function run(cmd: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/** Runs a synchronous command; returns exit code + combined output. */
function runSync(cmd: string[], cwd: string): { exitCode: number; output: string } {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { exitCode: proc.exitCode ?? -1, output: `${stdout}${stderr}` };
}

/** Reads the allowlist and returns the sorted `*.test.ts` entries. */
function testFiles(batch: string, repoRoot: string): string[] {
  const allowlistPath = join(repoRoot, ALLOWLIST_DIR, `${batch}-files.txt`);
  let text: string;
  try {
    text = readFileSync(allowlistPath, 'utf8');
  } catch (err) {
    fail(`cannot read allowlist ${allowlistPath}: ${(err as Error).message}`);
  }
  const files = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.endsWith('.test.ts'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Pure-documentation batches (e.g. B39 docs-truth) carry no test files;
  // the caller decides RED/GREEN semantics for an empty file list.
  return files;
}

/** Writes a baseline receipt through safe-receipt.py (init-dir + exclusive write). */
function writeReceipt(repoRoot: string, receiptPath: string, payload: unknown): void {
  const parent = dirname(receiptPath);
  const init = runSync(
    ['python3', 'scripts/safe-receipt.py', 'init-dir', '--path', parent],
    repoRoot,
  );
  if (init.exitCode !== 0) {
    fail(`safe-receipt init-dir failed for ${parent}:\n${init.output.trim()}`);
  }
  const value = `${JSON.stringify(payload)}\n`;
  const write = runSync(
    [
      'python3',
      'scripts/safe-receipt.py',
      'write-text',
      '--exclusive',
      '--path',
      receiptPath,
      '--value',
      value,
    ],
    repoRoot,
  );
  if (write.exitCode !== 0) {
    fail(`safe-receipt write-text failed for ${receiptPath}:\n${write.output.trim()}`);
  }
}

/** Runs `bun test <files>` via the current bun binary and returns the result. */
function bunTestCmdFor(files: string[]): { cmd: string[]; commandText: string } {
  return { cmd: [process.execPath, 'test', ...files], commandText: `bun test ${files.join(' ')}` };
}

/** The verification-missing dispatch command for B38/B41/B42. */
function verifyEvidenceCmd(batch: string): { cmd: string[]; commandText: string } {
  return {
    cmd: [process.execPath, 'scripts/verify-evidence.ts', '--batch', batch, '--require-current'],
    commandText: `bun scripts/verify-evidence.ts --batch ${batch} --require-current`,
  };
}

async function main(): Promise<never> {
  const args = process.argv.slice(2);
  const repoRoot = resolve(process.cwd());

  let batch: string | undefined;
  let expectRed = false;
  let expectCharacterization = false;
  let receiptPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--expect-red':
        expectRed = true;
        break;
      case '--expect-characterization':
        expectCharacterization = true;
        break;
      case '--receipt':
        receiptPath = args[++i];
        if (!receiptPath) usage('--receipt requires a value');
        break;
      default:
        if (arg.startsWith('-')) usage(`unexpected argument "${arg}"`);
        if (batch !== undefined) usage(`unexpected extra argument "${arg}"`);
        batch = arg;
    }
  }

  if (!batch) usage('BATCH is required');
  if (!(batch in BATCH_ROLLBACK_TAGS)) {
    fail(`unknown batch "${batch}" (expected B00-B42)`);
  }
  if (expectRed && expectCharacterization) {
    usage('--expect-red and --expect-characterization are mutually exclusive');
  }
  if (expectCharacterization && batch !== CHARACTERIZATION_BATCH) {
    fail(`--expect-characterization is only valid for ${CHARACTERIZATION_BATCH}, got ${batch}`);
  }

  const isVerificationMissingBatch = VERIFICATION_MISSING_BATCHES.has(batch);
  let mode: Mode;
  if (expectCharacterization) mode = 'characterization';
  else if (expectRed) mode = 'red';
  else mode = 'green';
  if (expectRed && isVerificationMissingBatch) mode = 'verification-missing';

  let cmd: string[];
  let commandText: string;
  let noBatchTests = false;
  if (isVerificationMissingBatch) {
    ({ cmd, commandText } = verifyEvidenceCmd(batch));
  } else {
    const files = testFiles(batch, repoRoot);
    noBatchTests = files.length === 0;
    ({ cmd, commandText } = bunTestCmdFor(files));
  }

  let result: RunResult;
  if (mode === 'red' && noBatchTests) {
    // Pure-documentation batch with no test files: RED = no batch tests
    // exist to verify (records a red baseline over the empty run).
    result = { exitCode: 1, stdout: '', stderr: 'no batch tests' };
  } else {
    result = await run(cmd, repoRoot);
  }

  // Expectation enforcement per mode.
  let baselineMode: Mode | undefined;
  let pass = false;

  if (mode === 'verification-missing') {
    // Exit 42 + exactly the MISSING_CURRENT_EVIDENCE protocol object on stderr.
    const objects = protocolObjects(result.stderr);
    const match = objects.find((o) => o.code === MISSING_EVIDENCE_CODE);
    if (result.exitCode !== 42) {
      fail(
        `batch ${batch} RED: command exited ${result.exitCode}, expected 42 (verification-missing protocol)`,
      );
    }
    if (!match || match.batchId !== batch) {
      fail(
        `batch ${batch} RED: no MISSING_CURRENT_EVIDENCE protocol object for ${batch} on stderr`,
      );
    }
    pass = true;
    baselineMode = 'verification-missing';
  } else if (mode === 'characterization') {
    if (result.exitCode !== 0) {
      fail(
        `batch ${batch} characterization RED: expected exit 0 (old source GREEN), got ${result.exitCode}`,
      );
    }
    pass = true;
    baselineMode = 'characterization';
  } else if (mode === 'red') {
    if (result.exitCode === 0) {
      fail(`batch ${batch} RED unexpectedly passed (${commandText})`);
    }
    pass = true;
    baselineMode = 'red';
  } else {
    // GREEN
    if (result.exitCode !== 0) {
      fail(`batch ${batch} GREEN failed (${commandText}): exit ${result.exitCode}`);
    }
    pass = true;
  }

  const digest = sha256Hex(`${result.stdout}${result.stderr}`);

  if (baselineMode !== undefined) {
    const payload = { batchId: batch, baselineMode, baselineDigest: digest };
    if (receiptPath) {
      writeReceipt(repoRoot, receiptPath, payload);
    }
    process.stdout.write(
      `${JSON.stringify({ ...payload, pass, exit: result.exitCode, command: commandText })}\n`,
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({ batchId: batch, mode: 'green', pass, exit: result.exitCode })}\n`,
    );
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
