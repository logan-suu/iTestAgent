#!/usr/bin/env bun
/**
 * verify-precommit-receipt.ts -- B00 audit infrastructure (promotion guide
 * §12.1).
 *
 * Contract:
 *   bun scripts/verify-precommit-receipt.ts --receipt <absolute-path>
 * executed from the repository root.
 *
 * The receipt is the GATE_RECEIPT JSON written by run-precommit-gates.ts
 * (guide §12.3 step 6), stored under $GIT_DIR/itestagent-receipts/:
 *     { "batchId": "...", "stagedTreeHash": "<40-hex>", "g7": true }
 * It must be mode 0600, owned by the current user, and not a symlink.
 *
 * The verifier exits 0 only when ALL of the following hold:
 *   (a) the receipt exists, is readable and is not a symlink (no-follow read);
 *   (b) `stagedTreeHash` equals the current index tree (`git write-tree`), or
 *       equals the current index tree with the batch manifest excluded (see
 *       the guide §12.4: `stagedTreeHash` is the STAGED payload tree
 *       EXCLUDING the batch's own manifest file; once the manifest is staged
 *       the full index tree includes it, so the full-tree check is the
 *       primary check and the manifest-excluded tree is the fallback);
 *   (c) `g7 === true` (the pre-Bun secret scan passed);
 *   (d) the receipt is owned by the current user and mode & 0o077 === 0.
 * Any violation exits non-zero.
 */

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fail(message: string): never {
  process.stderr.write(`verify-precommit-receipt: error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): string {
  let receipt: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--receipt') {
      receipt = argv[i + 1];
      i++;
    }
  }
  if (receipt === undefined || receipt === '') {
    fail('missing required --receipt <absolute-path>');
  }
  if (!receipt.startsWith('/')) {
    fail(`receipt path is not absolute: ${receipt}`);
  }
  return receipt;
}

function noFollowRead(receipt: string): string {
  // No-follow read: the file must not be a symlink (open with O_NOFOLLOW so a
  // symlink swap between lstat and read cannot redirect us).
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(receipt);
  } catch {
    fail(`receipt not found or unreadable: ${receipt}`);
  }
  if (st.isSymbolicLink()) {
    fail('receipt path is a symlink');
  }
  if (!st.isFile()) {
    fail('receipt path is not a regular file');
  }

  // (d) owner == euid and mode & 0o077 === 0.
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : process.getuid();
  if (st.uid !== euid) {
    fail('receipt owner is not the current user');
  }
  if ((st.mode & 0o077) !== 0) {
    fail(`receipt mode is not safe (mode & 0o077 != 0): ${(st.mode & 0o777).toString(8)}`);
  }

  // Read through an O_NOFOLLOW descriptor for the retained-FD guarantee.
  let fd: number;
  try {
    fd = openSync(receipt, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail(`receipt not readable via no-follow open: ${receipt}`);
  }
  try {
    return readFileSync(fd, 'utf8');
  } catch {
    fail(`receipt read failed: ${receipt}`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Returns the current index tree with the batch manifest entry removed, or
 * null when the tree cannot be computed (e.g. not a git repo).
 *
 * Guide §12.4 defines `stagedTreeHash` as the STAGED payload tree EXCLUDING
 * the batch's own manifest file. Once write-migration-manifest.ts has staged
 * the manifest, the full `git write-tree` includes it and no longer equals
 * `stagedTreeHash`. This fallback recomputes the tree as the current index
 * minus the manifest entry, using a throwaway index so the real index is
 * never mutated.
 */
function indexTreeWithoutManifest(
  cwd: string,
  fullTree: string,
  manifestRel: string,
): string | null {
  const tmpIndex = join(tmpdir(), `verify-receipt-${process.pid}-${Date.now()}.idx`);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the throwaway index from the CURRENT index tree (not HEAD, which
    // would drop staged-but-uncommitted payload files).
    const seed = spawnSync('git', ['-C', cwd, 'read-tree', fullTree], { encoding: 'utf8', env });
    if (seed.status !== 0) return null;
    // Drop only the manifest entry; --ignore-unmatch makes this a no-op when
    // the manifest is absent (temp repos, or already committed), so the
    // recomputed tree equals the full tree in those cases.
    const remove = spawnSync(
      'git',
      ['-C', cwd, 'rm', '--cached', '--ignore-unmatch', '--', manifestRel],
      { encoding: 'utf8', env },
    );
    if (remove.status !== 0) return null;
    const write = spawnSync('git', ['-C', cwd, 'write-tree'], { encoding: 'utf8', env });
    if (write.status !== 0) return null;
    return (write.stdout ?? '').trim();
  } finally {
    rmSync(tmpIndex, { force: true });
  }
}

function main(): void {
  const receipt = parseArgs(process.argv.slice(2));

  const content = noFollowRead(receipt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail(`receipt is not valid JSON: ${receipt}`);
  }
  const rec = parsed as { batchId?: unknown; stagedTreeHash?: unknown; g7?: unknown };

  // (c) G7 passed.
  if (rec.g7 !== true) {
    fail('receipt g7 !== true (pre-Bun secret scan did not pass)');
  }

  // stagedTreeHash must be a 40-hex string.
  if (typeof rec.stagedTreeHash !== 'string' || !/^[0-9a-f]{40}$/.test(rec.stagedTreeHash)) {
    fail('receipt stagedTreeHash is not a 40-hex string');
  }

  // (b) stagedTreeHash === current index tree (`git write-tree` in cwd).
  // Work in arbitrary cwd via `git -C`.
  const cwd = process.cwd();
  const res = spawnSync('git', ['-C', cwd, 'write-tree'], { encoding: 'utf8' });
  if (res.status !== 0) {
    fail(`git write-tree failed (not a git repo?): ${(res.stderr ?? '').trim()}`);
  }
  const tree = (res.stdout ?? '').trim();
  if (rec.stagedTreeHash !== tree) {
    // Guide §12.4: stagedTreeHash is the staged payload tree EXCLUDING the
    // batch's own manifest; once the manifest is staged the full index tree
    // includes it. Accept when stagedTreeHash equals the index tree with the
    // manifest entry removed.
    const batchId = typeof rec.batchId === 'string' ? rec.batchId : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(batchId)) {
      fail(
        `receipt stagedTreeHash ${rec.stagedTreeHash} does not match index tree ${tree}${
          batchId === '' ? ' (receipt has no valid batchId for manifest-exclusion fallback)' : ''
        }`,
      );
    }
    const manifestRel = `docs/06-verification/migration/${batchId}.json`;
    const excluded = indexTreeWithoutManifest(cwd, tree, manifestRel);
    if (excluded === null || excluded !== rec.stagedTreeHash) {
      fail(
        `receipt stagedTreeHash ${rec.stagedTreeHash} does not match index tree ${tree}${
          excluded === null
            ? ' (manifest-excluded tree could not be computed)'
            : ` or manifest-excluded tree ${excluded}`
        }`,
      );
    }
  }

  process.exit(0);
}

main();
