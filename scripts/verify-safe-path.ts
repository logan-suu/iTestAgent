/**
 * verify-safe-path.ts — B00 audit infrastructure (promotion guide §12.1).
 *
 * Physical repo-root containment, symlink and protected-path validation for
 * repo-relative payload/receipt paths.
 *
 * Contract:
 *  - `repoRoot` is resolved PHYSICALLY (realpath), so a repo root reached
 *    through a symlink is normalized before any comparison.
 *  - `relativePath` must be relative, must not contain any `..` component, and
 *    must stay inside the repo root.
 *  - Every component of the target path is lstat-walked from the physical root;
 *    any symlink component (intermediate or final) is rejected.
 *  - Protected paths (`.git` and everything under `.git`) are rejected.
 *  - With `--type file|dir` the final component must exist and be a regular
 *    file / directory (checked via lstat, so a symlink is never accepted).
 *  - `--allow-missing` permits an absent final component (e.g. a not-yet
 *    created receipt or manifest write target).
 *
 * CLI:
 *   bun scripts/verify-safe-path.ts <repoRoot> <relativePath> [--type file|dir] [--allow-missing]
 *
 * On success the canonical safe absolute path is printed and the script exits
 * 0. Any violation exits non-zero (fail-closed).
 *
 * The helper functions (`assertContained`, `checkNoSymlinks`,
 * `isProtectedPath`, `normalizeRelative`) are exported for reuse by the other
 * B00 scripts.
 */

import { type Stats, lstatSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Raised whenever a path must be rejected. */
export class SafePathError extends Error {}

/** Top-level protected entries. Everything under these is also protected. */
export const PROTECTED_TOP_LEVEL: string[] = ['.git'];

export interface ResolveOptions {
  /** Required file type of the final component ("file" or "dir"). */
  type?: 'file' | 'dir';
  /** Permit an absent final component (write target). */
  allowMissing?: boolean;
}

/** True when the repo-relative path is a protected path (e.g. .git/**). */
export function isProtectedPath(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  for (const entry of PROTECTED_TOP_LEVEL) {
    if (normalized === entry || normalized.startsWith(`${entry}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes a repo-relative path: rejects absolute paths, empty paths and any
 * `..` component; collapses `.` and empty segments. Returns the normalized
 * slash-separated relative path.
 */
export function normalizeRelative(relativePath: string): string {
  if (relativePath.startsWith('/')) {
    throw new SafePathError(`relative path must not be absolute: "${relativePath}"`);
  }
  const out: string[] = [];
  for (const part of relativePath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      throw new SafePathError(`path escapes repository root via "..": "${relativePath}"`);
    }
    out.push(part);
  }
  if (out.length === 0) {
    throw new SafePathError(
      `relative path is empty or resolves to the repo root: "${relativePath}"`,
    );
  }
  return out.join('/');
}

/**
 * lstat-walks every component of `relativePath` starting from `repoRoot` and
 * rejects any symlink component. A missing FINAL component is allowed (the
 * caller decides); any missing intermediate component is a hard violation.
 */
export function checkNoSymlinks(repoRoot: string, relativePath: string): void {
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split('/');
  let current = repoRoot;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;
    const candidate = join(current, part);
    let st: Stats;
    try {
      st = lstatSync(candidate);
    } catch (err) {
      if (i === parts.length - 1) return; // absent final component
      throw new SafePathError(
        `path component does not exist: "${part}" in "${relativePath}" (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
      );
    }
    if (st.isSymbolicLink()) {
      throw new SafePathError(
        `symlink component in path: "${relativePath}" resolves through ${candidate}`,
      );
    }
    current = candidate;
  }
}

/**
 * Resolves `relativePath` against the PHYSICAL `repoRoot`, asserting
 * containment, symlink-freedom and protected-path rules. Returns the canonical
 * safe absolute path. Throws SafePathError on any violation.
 */
export function assertContained(repoRoot: string, relativePath: string): string {
  let root: string;
  try {
    root = realpathSync(repoRoot);
  } catch (err) {
    throw new SafePathError(
      `cannot resolve repo root physically: ${repoRoot} (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
    );
  }
  if (!statSync(root).isDirectory()) {
    throw new SafePathError(`repo root is not a directory: ${root}`);
  }
  const normalized = normalizeRelative(relativePath);
  if (isProtectedPath(normalized)) {
    throw new SafePathError(`protected path rejected: "${relativePath}"`);
  }
  checkNoSymlinks(root, normalized);

  const safe = join(root, ...normalized.split('/'));
  if (safe !== root && !safe.startsWith(`${root}${sep}`)) {
    throw new SafePathError(`path escapes repository root: "${relativePath}"`);
  }
  return safe;
}

/**
 * Full safe-path resolution including optional final file-type validation.
 * Equivalent to the CLI logic.
 */
export function resolveSafePath(
  repoRoot: string,
  relativePath: string,
  opts: ResolveOptions = {},
): string {
  const safe = assertContained(repoRoot, relativePath);

  const type = opts.type ?? 'file';
  let st: Stats;
  try {
    st = lstatSync(safe);
  } catch (err) {
    if (opts.allowMissing) return safe;
    throw new SafePathError(
      `target does not exist: "${relativePath}" (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
    );
  }
  if (st.isSymbolicLink()) {
    throw new SafePathError(`target is a symlink: "${relativePath}"`);
  }
  if (type === 'file' && !st.isFile()) {
    throw new SafePathError(`target is not a regular file: "${relativePath}"`);
  }
  if (type === 'dir' && !st.isDirectory()) {
    throw new SafePathError(`target is not a directory: "${relativePath}"`);
  }
  return safe;
}

function usage(message: string): never {
  process.stderr.write(`verify-safe-path: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/verify-safe-path.ts <repoRoot> <relativePath> [--type file|dir] [--allow-missing]\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`verify-safe-path: error: ${message}\n`);
  process.exit(1);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const opts: ResolveOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--type') {
      const value = args[++i];
      if (value !== 'file' && value !== 'dir')
        usage(`invalid --type "${value}" (expected file|dir)`);
      opts.type = value;
    } else if (arg === '--allow-missing') {
      opts.allowMissing = true;
    } else {
      positional.push(arg);
    }
  }

  const repoRoot = positional[0];
  const relativePath = positional[1];
  if (repoRoot === undefined || relativePath === undefined)
    usage('repoRoot and relativePath are required');
  if (positional.length > 2) usage(`unexpected extra arguments: ${positional.slice(2).join(' ')}`);

  let safe: string;
  try {
    safe = resolveSafePath(repoRoot, relativePath, opts);
  } catch (err) {
    fail(err instanceof SafePathError ? err.message : String(err));
  }

  process.stdout.write(`${safe}\n`);
  process.exit(0);
}
