/**
 * verify-approved-lock.ts — G7 fail-closed check for the approved lockfile
 * (promotion guide §12.1). The lockfile used for installs must be the exact
 * approved lock, resolved exclusively from the public registry, with integrity
 * hashes on every package and every direct dependency locked.
 *
 *   CLI: bun scripts/verify-approved-lock.ts --lock <path> [--registry <url>]
 *
 * The script REJECTS (exit non-zero, no `ok` line) when any of:
 *   (a) sha256 of the lock file differs from the signed approval hash.
 *   (b) an explicit registry URL is not a public registry. Public means the
 *       empty string (default public registry) or `https://registry.npmjs.org`.
 *   (c) any package entry has an empty/missing integrity hash.
 *   (d) a direct dependency (workspaces.*.dependencies / devDependencies) has
 *       no resolved entry in the lock's packages table.
 *
 * Approval hash resolution: env `VERIFY_LOCK_EXPECTED_SHA` when set, otherwise
 * `targetBunLockSha256` from docs/05-planning/promotion-plan-approval.json.
 *
 * On full success the script prints exactly one line `ok` and exits 0.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org';

/** Parse the lock text, tolerating Bun's JSONC-style trailing commas. */
function parseLock(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Bun's bun.lock text format allows trailing commas (e.g. before `}`/`]`).
    // A `,` immediately followed (after whitespace) by `}` or `]` is always a
    // structural trailing comma, never string content in a real lockfile.
    const stripped = raw.replace(/,([ \t\r\n]*[}\]])/g, '$1');
    return JSON.parse(stripped);
  }
}

function fail(message: string): never {
  process.stderr.write(`verify-approved-lock: ${message}\n`);
  process.exit(1);
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── CLI parsing ────────────────────────────────────────────────────────────
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

const args = process.argv.slice(2);
const lockPath = argValue(args, '--lock');
const cliRegistry = argValue(args, '--registry');
if (lockPath === undefined) {
  fail('usage: bun scripts/verify-approved-lock.ts --lock <path> [--registry <url>]');
}

// ─── (a) Lock must be bound to the signed approval hash ─────────────────────
let lockRaw: string;
try {
  lockRaw = readFileSync(lockPath, 'utf8');
} catch {
  fail(`cannot read lock file: ${lockPath}`);
}
const actualSha = sha256Text(lockRaw);

let expectedSha: string | undefined = process.env.VERIFY_LOCK_EXPECTED_SHA;
if (expectedSha === undefined) {
  const approvalPath = resolve(
    import.meta.dir,
    '..',
    'docs',
    '05-planning',
    'promotion-plan-approval.json',
  );
  try {
    const approval = JSON.parse(readFileSync(approvalPath, 'utf8')) as {
      targetBunLockSha256?: string;
    };
    expectedSha = approval.targetBunLockSha256;
  } catch {
    fail(`cannot read ${approvalPath} and VERIFY_LOCK_EXPECTED_SHA is not set`);
  }
}
if (typeof expectedSha !== 'string' || expectedSha.length === 0) {
  fail('approval hash is empty');
}
if (actualSha !== expectedSha) {
  fail(`lock SHA-256 mismatch (approved ${expectedSha}, on disk ${actualSha})`);
}

// ─── Parse the lock ─────────────────────────────────────────────────────────
let lock: unknown;
try {
  lock = parseLock(lockRaw);
} catch {
  fail('lock file is not valid JSON');
}
if (typeof lock !== 'object' || lock === null) {
  fail('lock file root must be an object');
}
const lockObj = lock as Record<string, unknown>;
const packages = lockObj.packages;
if (typeof packages !== 'object' || packages === null) {
  fail('lock has no packages table');
}
const packagesTable = packages as Record<string, unknown>;

// Allowed registries: empty string (default public registry), the public
// npm registry, and the CLI-provided registry (if any).
const allowedRegistries = new Set<string>(['', PUBLIC_REGISTRY]);
if (cliRegistry !== undefined) {
  allowedRegistries.add(cliRegistry);
}

// ─── (c) Every package entry must carry a non-empty integrity hash ──────────
// (b) Every explicit registry URL must be a public registry.
// Workspace-local packages appear as single-element entries
// (`["name@workspace:packages/..."]`) and legitimately have no registry or
// integrity — they are skipped.
for (const [name, entry] of Object.entries(packagesTable)) {
  if (!Array.isArray(entry)) {
    fail(`package entry "${name}" is malformed (not an array)`);
  }
  if (entry.length === 1) {
    continue; // workspace-local package
  }
  const registry = entry[1];
  if (typeof registry !== 'string' || !allowedRegistries.has(registry)) {
    fail(`package "${name}" uses non-public registry: ${String(registry)}`);
  }
  const integrity = entry[3];
  if (typeof integrity !== 'string' || integrity.length === 0) {
    fail(`package "${name}" has empty/missing integrity hash`);
  }
}

// ─── (d) Every direct dependency must have a resolved lock entry ────────────
const workspaces = lockObj.workspaces;
if (typeof workspaces === 'object' && workspaces !== null) {
  for (const [wsName, wsConfig] of Object.entries(workspaces as Record<string, unknown>)) {
    if (typeof wsConfig !== 'object' || wsConfig === null) {
      continue;
    }
    const cfg = wsConfig as Record<string, unknown>;
    const directDeps: Record<string, unknown> = {};
    for (const section of ['dependencies', 'devDependencies']) {
      const deps = cfg[section];
      if (typeof deps === 'object' && deps !== null) {
        Object.assign(directDeps, deps as Record<string, unknown>);
      }
    }
    for (const depName of Object.keys(directDeps)) {
      if (!(depName in packagesTable)) {
        fail(`direct dependency "${depName}" of workspace "${wsName}" has no resolved lock entry`);
      }
    }
  }
}

process.stdout.write('ok\n');
