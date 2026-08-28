/**
 * validate-migration-manifest.ts — G6 batch manifest gate (promotion guide §12.4).
 *
 * Validates a batch manifest against `docs/06-verification/migration/manifest.schema.json`
 * and proves the recorded hashes:
 *
 *  1. SCHEMA   — the manifest parses and every field satisfies the schema
 *     (required fields, types, patterns, enums, additionalProperties=false).
 *  2. PAYLOAD TREE — HEAD is re-read into a temporary index, the manifest entry
 *     is removed (`git update-index --force-remove`), the payload tree is
 *     recomputed with `git write-tree` and must equal `manifest.stagedTreeHash`.
 *     (The two hashes are distinct: stagedTreeHash is the PRE-manifest staged
 *     tree; HEAD^{tree} includes the manifest itself.)
 *  3. COMMIT TREE — `git rev-parse <HEAD-ref>^{tree}` must equal the caller's
 *     EXPECTED_COMMIT_TREE, and `manifest.baseCommit` must equal the parent of
 *     the batch commit.
 *  4. FILE HASH — each existing payload file is re-hashed from the working tree
 *     (no-follow, physical containment) and must match the manifest record.
 *
 * CLI:
 *   bun scripts/validate-migration-manifest.ts <MANIFEST> <HEAD-REF> <EXPECTED_COMMIT_TREE>
 *
 * Exit codes:
 *   0  all validations pass
 *   1  at least one validation failed (each failure printed on stderr)
 *   2  usage / operational error
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { expectedBatchTag } from './expected-batch-tag.ts';
import { assertContained } from './verify-safe-path.ts';

const MANIFEST_SCHEMA_VERSION = 1;
const BASELINE_MODES = ['red', 'characterization', 'verification-missing'] as const;
const GATE_NAMES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G4b', 'G6', 'G7', 'LOCK_INVARIANT'] as const;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BATCH_RE = /^B[0-4][0-9]$/;
const MANIFEST_PATH_RE = /^docs\/06-verification\/migration\/B[0-4][0-9]\.json$/;
const ROLLBACK_TAG_RE = /^promo\/(b[0-9][0-9]-|base-|plan-approved-|wave-[0-9][0-9]-green)/;

type Check = { name: string; ok: boolean; detail: string };

function usage(message: string): never {
  process.stderr.write(`validate-migration-manifest: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/validate-migration-manifest.ts <MANIFEST> <HEAD-REF> <EXPECTED_COMMIT_TREE>\n',
  );
  process.exit(2);
}

function failCheck(checks: Check[], name: string, detail: string): void {
  checks.push({ name, ok: false, detail });
}

/** Runs a git command in a repo and returns {status, stdout, stderr}. */
function gitRun(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
  });
  return {
    status: res.status ?? -1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function sha256Of(filePath: string): string {
  let fd: number;
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    throw new Error(`cannot open ${filePath}: ${(err as Error).message}`);
  }
  try {
    return createHash('sha256').update(readFileSync(fd)).digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Manual JSON-schema validation of the manifest (mirrors manifest.schema.json). */
function validateSchema(
  manifest: Record<string, unknown>,
  manifestAbs: string,
  checks: Check[],
): void {
  const allowedKeys = new Set([
    'manifestVersion',
    'batchId',
    'baseCommit',
    'stagedTreeHash',
    'baselineMode',
    'baselineDigest',
    'greenCommand',
    'greenExit',
    'gateCommands',
    'lockInvariant',
    'payloadFiles',
    'rollbackTag',
  ]);
  for (const key of Object.keys(manifest)) {
    if (!allowedKeys.has(key))
      failCheck(checks, 'schema', `additional property "${key}" is not allowed`);
  }

  if (manifest.manifestVersion !== MANIFEST_SCHEMA_VERSION) {
    failCheck(
      checks,
      'schema',
      `manifestVersion must be ${MANIFEST_SCHEMA_VERSION}, got ${String(manifest.manifestVersion)}`,
    );
  }

  const batchId = manifest.batchId;
  if (typeof batchId !== 'string' || !BATCH_RE.test(batchId)) {
    failCheck(checks, 'schema', `batchId must match ^B[0-4][0-9]$, got ${String(batchId)}`);
  } else {
    if (!expectedBatchTag(batchId)) failCheck(checks, 'schema', `unknown batchId "${batchId}"`);
    // The manifest file name must match the batchId (docs/.../{BATCH}.json).
    if (basename(manifestAbs) !== `${batchId}.json`) {
      failCheck(
        checks,
        'schema',
        `manifest file ${basename(manifestAbs)} does not match batchId ${batchId}`,
      );
    }
  }

  if (typeof manifest.baseCommit !== 'string' || !SHA1_RE.test(manifest.baseCommit)) {
    failCheck(
      checks,
      'schema',
      `baseCommit must be a 40-hex git SHA, got ${String(manifest.baseCommit)}`,
    );
  }
  if (typeof manifest.stagedTreeHash !== 'string' || !SHA1_RE.test(manifest.stagedTreeHash)) {
    failCheck(
      checks,
      'schema',
      `stagedTreeHash must be a 40-hex git SHA, got ${String(manifest.stagedTreeHash)}`,
    );
  }

  const baselineMode = manifest.baselineMode;
  if (
    typeof baselineMode !== 'string' ||
    !(BASELINE_MODES as readonly string[]).includes(baselineMode)
  ) {
    failCheck(
      checks,
      'schema',
      `baselineMode must be one of ${BASELINE_MODES.join(', ')}, got ${String(baselineMode)}`,
    );
  } else if (typeof batchId === 'string') {
    if (batchId === 'B26' && baselineMode !== 'characterization') {
      failCheck(
        checks,
        'schema',
        `B26 baselineMode must be "characterization", got "${baselineMode}"`,
      );
    }
    if (['B38', 'B41', 'B42'].includes(batchId) && baselineMode !== 'verification-missing') {
      failCheck(
        checks,
        'schema',
        `${batchId} baselineMode must be "verification-missing", got "${baselineMode}"`,
      );
    }
    if (batchId !== 'B26' && !['B38', 'B41', 'B42'].includes(batchId) && baselineMode !== 'red') {
      failCheck(checks, 'schema', `${batchId} baselineMode must be "red", got "${baselineMode}"`);
    }
  }

  if (typeof manifest.baselineDigest !== 'string' || !SHA256_RE.test(manifest.baselineDigest)) {
    failCheck(
      checks,
      'schema',
      `baselineDigest must be a 64-hex SHA-256, got ${String(manifest.baselineDigest)}`,
    );
  }
  if (typeof manifest.greenCommand !== 'string' || manifest.greenCommand.length === 0) {
    failCheck(checks, 'schema', 'greenCommand must be a non-empty string');
  }
  if (manifest.greenExit !== 0) {
    failCheck(checks, 'schema', `greenExit must be 0, got ${String(manifest.greenExit)}`);
  }

  // gateCommands (optional).
  if (manifest.gateCommands !== undefined) {
    if (!Array.isArray(manifest.gateCommands)) {
      failCheck(checks, 'schema', 'gateCommands must be an array');
    } else {
      manifest.gateCommands.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          failCheck(checks, 'schema', `gateCommands[${index}] must be an object`);
          return;
        }
        const rec = item as Record<string, unknown>;
        const name = rec.name;
        if (typeof name !== 'string' || !(GATE_NAMES as readonly string[]).includes(name)) {
          failCheck(
            checks,
            'schema',
            `gateCommands[${index}].name must be one of ${GATE_NAMES.join(', ')}, got ${String(name)}`,
          );
        }
        if (typeof rec.command !== 'string' || rec.command.length === 0) {
          failCheck(checks, 'schema', `gateCommands[${index}].command must be a non-empty string`);
        }
        if (rec.exit !== 0) {
          failCheck(
            checks,
            'schema',
            `gateCommands[${index}].exit must be 0, got ${String(rec.exit)}`,
          );
        }
        for (const extra of Object.keys(rec)) {
          if (extra !== 'name' && extra !== 'command' && extra !== 'exit') {
            failCheck(
              checks,
              'schema',
              `gateCommands[${index}] has additional property "${extra}"`,
            );
          }
        }
      });
    }
  }

  // lockInvariant (optional, B05/B37 only).
  if (manifest.lockInvariant !== undefined) {
    if (manifest.lockInvariant === null) {
      failCheck(checks, 'schema', 'lockInvariant must not be null in this manifest (omit instead)');
    } else if (
      typeof manifest.lockInvariant === 'object' &&
      !Array.isArray(manifest.lockInvariant)
    ) {
      const li = manifest.lockInvariant as Record<string, unknown>;
      if (typeof li.beforeSha256 !== 'string' || !SHA256_RE.test(li.beforeSha256)) {
        failCheck(checks, 'schema', 'lockInvariant.beforeSha256 must be a 64-hex SHA-256');
      }
      if (typeof li.afterSha256 !== 'string' || !SHA256_RE.test(li.afterSha256)) {
        failCheck(checks, 'schema', 'lockInvariant.afterSha256 must be a 64-hex SHA-256');
      }
      if (li.equal !== true) failCheck(checks, 'schema', 'lockInvariant.equal must be true');
      for (const extra of Object.keys(li)) {
        if (extra !== 'beforeSha256' && extra !== 'afterSha256' && extra !== 'equal') {
          failCheck(checks, 'schema', `lockInvariant has additional property "${extra}"`);
        }
      }
    } else {
      failCheck(checks, 'schema', 'lockInvariant must be an object');
    }
  }

  // payloadFiles.
  const payloadFiles = manifest.payloadFiles;
  if (typeof payloadFiles !== 'object' || payloadFiles === null || Array.isArray(payloadFiles)) {
    failCheck(checks, 'schema', 'payloadFiles must be an object');
  } else {
    for (const [path, value] of Object.entries(payloadFiles as Record<string, unknown>)) {
      if (MANIFEST_PATH_RE.test(path)) {
        failCheck(
          checks,
          'schema',
          `payloadFiles key "${path}" is a manifest path (self-reference forbidden)`,
        );
        continue;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        failCheck(checks, 'schema', `payloadFiles["${path}"] must be an object`);
        continue;
      }
      const rec = value as Record<string, unknown>;
      if (typeof rec.sha256 !== 'string' || !SHA256_RE.test(rec.sha256)) {
        failCheck(checks, 'schema', `payloadFiles["${path}"].sha256 must be a 64-hex SHA-256`);
      }
      if (typeof rec.bytes !== 'number' || !Number.isInteger(rec.bytes) || rec.bytes < 0) {
        failCheck(checks, 'schema', `payloadFiles["${path}"].bytes must be a non-negative integer`);
      }
      for (const extra of Object.keys(rec)) {
        if (extra !== 'sha256' && extra !== 'bytes') {
          failCheck(checks, 'schema', `payloadFiles["${path}"] has additional property "${extra}"`);
        }
      }
    }
  }

  if (typeof manifest.rollbackTag !== 'string' || !ROLLBACK_TAG_RE.test(manifest.rollbackTag)) {
    failCheck(
      checks,
      'schema',
      `rollbackTag must match ^promo/(b[0-9][0-9]-|base-|plan-approved-|wave-[0-9][0-9]-green), got ${String(manifest.rollbackTag)}`,
    );
  } else if (typeof batchId === 'string') {
    const expected = expectedBatchTag(batchId);
    if (expected !== undefined && manifest.rollbackTag !== expected) {
      failCheck(
        checks,
        'schema',
        `rollbackTag "${manifest.rollbackTag}" does not match fixed tag for ${batchId} ("${expected}")`,
      );
    }
  }
}

/**
 * Re-reads HEAD in a temporary index, removes the manifest entry and returns
 * the recomputed payload tree.
 */
function recomputePayloadTree(root: string, manifestRel: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'itestagent-g6-'));
  try {
    const indexPath = join(tmpDir, 'index');
    const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: indexPath };
    const readTree = gitRun(['read-tree', 'HEAD'], { cwd: root, env });
    if (readTree.status !== 0) throw new Error(`git read-tree HEAD failed: ${readTree.stderr}`);
    const remove = gitRun(['update-index', '--force-remove', '--', manifestRel], {
      cwd: root,
      env,
    });
    if (remove.status !== 0)
      throw new Error(`git update-index --force-remove failed: ${remove.stderr}`);
    const writeTree = gitRun(['write-tree'], { cwd: root, env });
    if (writeTree.status !== 0) throw new Error(`git write-tree failed: ${writeTree.stderr}`);
    return writeTree.stdout;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 3) usage('MANIFEST, HEAD-REF and EXPECTED_COMMIT_TREE are required');
  if (args.length > 3) usage(`unexpected extra arguments: ${args.slice(3).join(' ')}`);
  const manifestArg = args[0];
  const headRef = args[1];
  const expectedCommitTree = args[2];
  if (manifestArg === undefined || headRef === undefined || expectedCommitTree === undefined) {
    usage('MANIFEST, HEAD-REF and EXPECTED_COMMIT_TREE are required');
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommitTree)) {
    process.stderr.write(
      `validate-migration-manifest: EXPECTED_COMMIT_TREE must be a 40-hex git SHA, got "${expectedCommitTree}"\n`,
    );
    process.exit(1);
  }

  const manifestAbs = resolve(manifestArg);
  const checks: Check[] = [];

  // Parse + schema-validate the manifest.
  let manifest: Record<string, unknown>;
  let fd: number;
  try {
    fd = openSync(manifestAbs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    process.stderr.write(
      `validate-migration-manifest: cannot open manifest ${manifestAbs}: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }
  try {
    const text = readFileSync(fd, 'utf8');
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    closeSync(fd);
    process.stderr.write(
      `validate-migration-manifest: manifest is not valid JSON: ${(err as Error).message}\n`,
    );
    process.exit(1);
  } finally {
    closeSync(fd);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    process.stderr.write('validate-migration-manifest: manifest is not a JSON object\n');
    process.exit(1);
  }
  validateSchema(manifest, manifestAbs, checks);

  const repoGit = gitRun(['rev-parse', '--show-toplevel'], { cwd: resolve('.') });
  if (repoGit.status !== 0) {
    process.stderr.write(
      `validate-migration-manifest: not inside a git repository: ${repoGit.stderr}\n`,
    );
    process.exit(2);
  }
  const root = resolve(repoGit.stdout);
  const manifestRel = relative(root, manifestAbs);

  // Payload tree via a temporary index.
  let payloadTree: string;
  try {
    payloadTree = recomputePayloadTree(root, manifestRel);
  } catch (err) {
    failCheck(checks, 'payload-tree', (err as Error).message);
    payloadTree = '';
  }
  if (payloadTree === '' || payloadTree !== manifest.stagedTreeHash) {
    failCheck(
      checks,
      'payload-tree',
      `recomputed payload tree ${payloadTree || '(failed)'} != stagedTreeHash ${String(manifest.stagedTreeHash)}`,
    );
  }

  // Commit tree and base commit.
  const headTree = gitRun(['rev-parse', `${headRef}^{tree}`], { cwd: root });
  if (headTree.status !== 0) {
    failCheck(checks, 'commit-tree', `cannot resolve ${headRef}^{tree}: ${headTree.stderr}`);
  } else if (headTree.stdout !== expectedCommitTree) {
    failCheck(
      checks,
      'commit-tree',
      `${headRef}^{tree} ${headTree.stdout} != EXPECTED_COMMIT_TREE ${expectedCommitTree}`,
    );
  }
  const parent = gitRun(['rev-parse', `${headRef}^`], { cwd: root });
  if (parent.status !== 0) {
    failCheck(checks, 'base-commit', `cannot resolve ${headRef}^: ${parent.stderr}`);
  } else if (parent.stdout !== manifest.baseCommit) {
    failCheck(
      checks,
      'base-commit',
      `${headRef}^ ${parent.stdout} != manifest.baseCommit ${String(manifest.baseCommit)}`,
    );
  }

  // File hashes (present files only; absent = legitimately deleted in the batch).
  if (typeof manifest.payloadFiles === 'object' && manifest.payloadFiles !== null) {
    for (const [rel, value] of Object.entries(manifest.payloadFiles as Record<string, unknown>)) {
      const rec = value as { sha256?: unknown } | null;
      if (typeof rec !== 'object' || rec === null || typeof rec.sha256 !== 'string') continue;
      let safe: string;
      try {
        safe = assertContained(root, rel);
      } catch (err) {
        failCheck(
          checks,
          'file-hash',
          `payload path invalid for "${rel}": ${(err as Error).message}`,
        );
        continue;
      }
      try {
        const actual = sha256Of(safe);
        if (actual !== rec.sha256) {
          failCheck(
            checks,
            'file-hash',
            `payload file "${rel}" sha256 ${actual} != manifest ${rec.sha256}`,
          );
        }
      } catch {
        // Working-tree file absent: the batch deleted it; content is proven by the tree check.
      }
    }
  }

  const failures = checks.filter((c) => !c.ok);
  if (failures.length > 0) {
    for (const c of failures) {
      process.stderr.write(`validate-migration-manifest: FAIL ${c.name}: ${c.detail}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `validate-migration-manifest: OK ${basename(manifestAbs)} (schema, payload tree ${manifest.stagedTreeHash}, commit tree ${expectedCommitTree})\n`,
  );
  process.exit(0);
}

if (import.meta.main) {
  main();
}
