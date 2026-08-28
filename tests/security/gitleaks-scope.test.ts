/**
 * gitleaks-scope.test.ts — G7 contract: `.gitleaks.toml` must NOT contain
 * broad directory-level exclusions that hide secrets from the scanner.
 *
 * Guide §12.1: `tests/security/gitleaks-scope.test.ts` 禁止 `.gitleaks.toml`
 * broad-exclude `docs/**`、`fixtures/**` 或 evidence roots。
 *
 * Policy enforced here:
 *   - REJECTED: broad exclusions of `docs/**` (Chinese-language project docs
 *     are still code-reviewable and must be scanned for leaked secrets).
 *   - REJECTED: broad exclusions of `fixtures/**` (test data often contains
 *     fake-but-realistic-looking secrets — exactly what G7 must catch).
 *   - REJECTED: broad exclusions of evidence roots (`docs/06-verification/**`
 *     and any other report/evidence root).
 *   - ACCEPTED: broad exclusions of tooling/third-party directories
 *     (`node_modules/**`, `.opencode/**`, `.codegraph/**`).
 *
 * RED phase (B00): the current `.gitleaks.toml` broadly excludes `^docs\/`
 * and `^fixtures\/`, so the corresponding assertions fail — this is the
 * intended RED failure that GREEN must fix by narrowing the allowlist.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const GITLEAKS_CONFIG = new URL('../../.gitleaks.toml', import.meta.url).pathname;

/** Tooling / third-party directories that may be broadly excluded. */
const PERMITTED_TOOLING_DIRS = new Set(['node_modules', '.opencode', '.codegraph']);

/** Roots that MUST NOT be broadly excluded from secret scanning. */
const PROTECTED_ROOTS = ['docs', 'fixtures', 'docs/06-verification'];

// ─── Minimal TOML extraction (only what this test needs) ──────────────

/** Extract string literals from a `paths = [...]` array inside a TOML section. */
function extractPathLiterals(section: string): string[] {
  const arrayMatch = section.match(/paths\s*=\s*\[([\s\S]*?)\]/);
  const body = arrayMatch?.[1] ?? section;
  const literals: string[] = [];
  // TOML raw (triple-quoted) strings first, then single/double quoted.
  for (const m of body.matchAll(/'''([\s\S]*?)'''/g)) literals.push(m[1] ?? '');
  for (const m of body.matchAll(/"""([\s\S]*?)"""/g)) literals.push(m[1] ?? '');
  for (const m of body.matchAll(/'([^']*)'/g)) literals.push(m[1] ?? '');
  for (const m of body.matchAll(/"([^"]*)"/g)) literals.push(m[1] ?? '');
  return [...new Set(literals)];
}

/** Read the `[allowlist] paths` entries from `.gitleaks.toml`. */
function readGitleaksAllowlistPaths(configPath: string): string[] {
  const text = readFileSync(configPath, 'utf8');
  const sectionMatch = text.match(/\[allowlist\]\s*([\s\S]*?)(?:\n\[[A-Za-z]|\s*$)/);
  if (!sectionMatch) return [];
  return extractPathLiterals(sectionMatch[1] ?? '');
}

/** Normalize a gitleaks path pattern (`^docs\/` → `docs/`). */
function normalizePathPattern(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('^')) s = s.slice(1);
  return s.replace(/\\\//g, '/');
}

/** True if `raw` broadly excludes an entire directory tree (dir/ or dir$). */
function isBroadExclusion(raw: string, dir: string): boolean {
  const normalized = normalizePathPattern(raw);
  return normalized === dir || normalized.startsWith(`${dir}/`);
}

/** True if `raw` broadly excludes `dir` or any of its ancestors. */
function isCoveredByBroadExclusion(raw: string, dir: string): boolean {
  const normalized = normalizePathPattern(raw);
  const parts = dir.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

// ─── Fixture setup ────────────────────────────────────────

const allowlistPaths = readGitleaksAllowlistPaths(GITLEAKS_CONFIG);

const broadExclusionsFor = (dir: string): string[] =>
  allowlistPaths.filter((p) => isBroadExclusion(p, dir));

const coveredByBroadExclusion = (dir: string): boolean =>
  allowlistPaths.some((p) => isCoveredByBroadExclusion(p, dir));

// ─── Suite ────────────────────────────────────────────────

describe('gitleaks scan scope (G7) — no broad exclusions that hide secrets', () => {
  test('.gitleaks.toml exists and defines an [allowlist] section', () => {
    const text = readFileSync(GITLEAKS_CONFIG, 'utf8');
    expect(text).toContain('[allowlist]');
  });

  test('does not broad-exclude docs/**', () => {
    expect(broadExclusionsFor('docs')).toEqual([]);
  });

  test('does not broad-exclude fixtures/**', () => {
    expect(broadExclusionsFor('fixtures')).toEqual([]);
  });

  test('does not broad-exclude evidence roots (docs/06-verification/**)', () => {
    // A broad `docs/**` exclusion covers the evidence root too.
    expect(coveredByBroadExclusion('docs/06-verification')).toBe(false);
  });

  test('every broad exclusion targets a permitted tooling directory', () => {
    for (const raw of allowlistPaths) {
      if (!raw.trim().startsWith('^')) continue;
      const dir = normalizePathPattern(raw).replace(/\/$/, '');
      if (dir === '') continue;
      expect(PERMITTED_TOOLING_DIRS.has(dir)).toBe(true);
    }
  });

  test('node_modules, .opencode, and .codegraph broad exclusions are acceptable', () => {
    for (const dir of ['node_modules', '.opencode', '.codegraph']) {
      expect(PERMITTED_TOOLING_DIRS.has(dir)).toBe(true);
    }
  });

  test('protected roots are never in the permitted broad-exclusion set', () => {
    for (const root of PROTECTED_ROOTS) {
      expect(PERMITTED_TOOLING_DIRS.has(root)).toBe(false);
    }
  });
});
