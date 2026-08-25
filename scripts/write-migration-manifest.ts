/**
 * write-migration-manifest.ts — batch manifest writer (promotion guide §12.4).
 *
 * Generates the non-self-referential batch manifest at
 * `docs/06-verification/migration/{BATCH}.json` matching
 * `docs/06-verification/migration/manifest.schema.json`.
 *
 * The manifest never records a commit SHA of itself: `stagedTreeHash` is the
 * git tree of the STAGED payload (excluding the manifest file), `baseCommit`
 * is the commit the batch was built on.
 *
 * Payload file hashes are computed from the working tree bytes through a
 * no-follow retained FD (safe-file-read discipline); each path is validated by
 * `verify-safe-path.ts` (physical containment + symlink rejection).
 *
 * CLI:
 *   bun scripts/write-migration-manifest.ts \
 *     --batch <B> --base-commit <sha> --staged-tree-hash <sha> \
 *     --baseline-mode <red|characterization|verification-missing> \
 *     --baseline-digest <sha> --gate-receipt <path> --rollback-tag <tag>
 *
 * Exit codes:
 *   0  manifest written; final manifest path printed on stdout
 *   1  validation / write failure
 *   2  usage error
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { expectedBatchTag } from './expected-batch-tag.ts';
import { assertContained } from './verify-safe-path.ts';

const MANIFEST_SCHEMA_VERSION = 1;
const BASELINE_MODES = ['red', 'characterization', 'verification-missing'] as const;
const GATE_NAMES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G4b', 'G6', 'G7', 'LOCK_INVARIANT'] as const;

interface GateCommand {
  name: string;
  command: string;
  exit: number;
}

interface Options {
  batch: string;
  baseCommit: string;
  stagedTreeHash: string;
  baselineMode: string;
  baselineDigest: string;
  gateReceipt?: string;
  rollbackTag: string;
}

function usage(message: string): never {
  process.stderr.write(`write-migration-manifest: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/write-migration-manifest.ts --batch <B> --base-commit <sha> --staged-tree-hash <sha> --baseline-mode <mode> --baseline-digest <sha> --gate-receipt <path> --rollback-tag <tag>\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`write-migration-manifest: ${message}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): Options {
  const opts: Partial<Options> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) usage(`${arg} requires a value`);
    switch (arg) {
      case '--batch':
        opts.batch = value;
        break;
      case '--base-commit':
        opts.baseCommit = value;
        break;
      case '--staged-tree-hash':
        opts.stagedTreeHash = value;
        break;
      case '--baseline-mode':
        opts.baselineMode = value;
        break;
      case '--baseline-digest':
        opts.baselineDigest = value;
        break;
      case '--gate-receipt':
        opts.gateReceipt = value;
        break;
      case '--rollback-tag':
        opts.rollbackTag = value;
        break;
      default:
        usage(`unexpected argument "${arg}"`);
    }
  }
  for (const key of [
    'batch',
    'baseCommit',
    'stagedTreeHash',
    'baselineMode',
    'baselineDigest',
    'rollbackTag',
  ] as const) {
    if (opts[key] === undefined)
      usage(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  return opts as Options;
}

function repoRoot(): string {
  const res = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (res.exitCode !== 0) {
    fail(`not inside a git repository: ${res.stderr.toString().trim()}`);
  }
  return resolve(res.stdout.toString().trim());
}

function gitList(args: string[], root: string): string[] {
  const res = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (res.exitCode !== 0) {
    fail(`git ${args.join(' ')} failed (exit ${res.exitCode}): ${res.stderr.toString().trim()}`);
  }
  return res.stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Hashes a file's bytes through a retained no-follow FD. */
function sha256AndBytes(filePath: string): { sha256: string; bytes: number } {
  let fd: number;
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    fail(`cannot open payload file ${filePath}: ${(err as Error).message}`);
  }
  try {
    const data = readFileSync(fd);
    return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
  } finally {
    closeSync(fd);
  }
}

/** Reads `gateCommands` from the gate receipt (absent when the field is missing). */
function readGateCommands(repoRoot: string, gateReceipt: string): GateCommand[] | undefined {
  const res = Bun.spawnSync(
    [
      'python3',
      'scripts/safe-receipt.py',
      'read-field',
      '--path',
      gateReceipt,
      '--field',
      'gateCommands',
    ],
    { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' },
  );
  if (res.exitCode !== 0) {
    process.stderr.write(
      `write-migration-manifest: warning: gate receipt has no readable gateCommands field (${gateReceipt}); omitting gateCommands\n`,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout.toString().trim());
  } catch (err) {
    fail(`gate receipt gateCommands is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    fail('gate receipt gateCommands is not an array');
  }
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      fail(`gateCommands[${index}] is not an object`);
    }
    const rec = item as Record<string, unknown>;
    const { name, command, exit } = rec;
    if (typeof name !== 'string' || !(GATE_NAMES as readonly string[]).includes(name)) {
      fail(`gateCommands[${index}].name is invalid: ${String(name)}`);
    }
    if (typeof command !== 'string' || command.length === 0) {
      fail(`gateCommands[${index}].command must be a non-empty string`);
    }
    if (exit !== 0) {
      fail(`gateCommands[${index}].exit must be 0, got ${String(exit)}`);
    }
    return { name, command, exit: 0 } as GateCommand;
  });
}

function validateOptions(opts: Options): void {
  if (!/^B[0-4][0-9]$/.test(opts.batch)) {
    fail(`invalid batch "${opts.batch}"`);
  }
  if (!expectedBatchTag(opts.batch)) {
    fail(`unknown batch "${opts.batch}" (expected B00-B42)`);
  }
  if (!/^[0-9a-f]{40}$/.test(opts.baseCommit)) {
    fail(`--base-commit must be a 40-hex git SHA, got "${opts.baseCommit}"`);
  }
  if (!/^[0-9a-f]{40}$/.test(opts.stagedTreeHash)) {
    fail(`--staged-tree-hash must be a 40-hex git SHA, got "${opts.stagedTreeHash}"`);
  }
  if (!(BASELINE_MODES as readonly string[]).includes(opts.baselineMode)) {
    fail(`--baseline-mode must be one of ${BASELINE_MODES.join(', ')}`);
  }
  if (!/^[0-9a-f]{64}$/.test(opts.baselineDigest)) {
    fail(`--baseline-digest must be a 64-hex SHA-256, got "${opts.baselineDigest}"`);
  }
  const expectedTag = expectedBatchTag(opts.batch);
  if (opts.rollbackTag !== expectedTag) {
    fail(
      `--rollback-tag "${opts.rollbackTag}" does not match the fixed tag for ${opts.batch} ("${expectedTag}")`,
    );
  }
  // Per-batch baselineMode constraints (manifest.schema.json description).
  if (opts.batch === 'B26' && opts.baselineMode !== 'characterization') {
    fail(`B26 baselineMode must be "characterization", got "${opts.baselineMode}"`);
  }
  if (['B38', 'B41', 'B42'].includes(opts.batch) && opts.baselineMode !== 'verification-missing') {
    fail(`${opts.batch} baselineMode must be "verification-missing", got "${opts.baselineMode}"`);
  }
  if (
    opts.batch !== 'B26' &&
    !['B38', 'B41', 'B42'].includes(opts.batch) &&
    opts.baselineMode !== 'red'
  ) {
    fail(`${opts.batch} baselineMode must be "red", got "${opts.baselineMode}"`);
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  validateOptions(opts);

  const root = repoRoot();
  const manifestRel = `docs/06-verification/migration/${opts.batch}.json`;
  const manifestAbs = join(root, manifestRel);

  // Gate commands (optional per schema).
  const gateCommands = opts.gateReceipt ? readGateCommands(root, opts.gateReceipt) : undefined;

  // Payload file list: staged diff against the base commit, minus the manifest.
  const changed = gitList(['diff', '--cached', '--name-only', opts.baseCommit, '--'], root);
  const payloadFiles: Record<string, { sha256: string; bytes: number }> = {};
  for (const rel of [...new Set(changed)].sort()) {
    if (rel === manifestRel) continue; // no self-reference
    // Physical containment + symlink check before the no-follow open.
    const safe = assertContained(root, rel);
    const { sha256, bytes } = sha256AndBytes(safe);
    payloadFiles[rel] = { sha256, bytes };
  }

  const manifest: Record<string, unknown> = {
    manifestVersion: MANIFEST_SCHEMA_VERSION,
    batchId: opts.batch,
    baseCommit: opts.baseCommit,
    stagedTreeHash: opts.stagedTreeHash,
    baselineMode: opts.baselineMode,
    baselineDigest: opts.baselineDigest,
    greenCommand: `bun run batch:test -- ${opts.batch}`,
    greenExit: 0,
  };
  if (gateCommands !== undefined) {
    manifest.gateCommands = gateCommands;
  }
  manifest.payloadFiles = payloadFiles;
  manifest.rollbackTag = opts.rollbackTag;

  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    writeFileSync(manifestAbs, text, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    fail(`cannot write manifest ${manifestAbs}: ${(err as Error).message}`);
  }

  process.stdout.write(
    `write-migration-manifest: wrote ${manifestRel} (${Object.keys(payloadFiles).length} payload files)\n`,
  );
  process.exit(0);
}

if (import.meta.main) {
  main();
}
