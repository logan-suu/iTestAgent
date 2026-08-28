/**
 * bunfig-policy.test.ts
 *
 * RED-phase architecture test for the B00 batch.
 *
 * Contract (promotion guide §7.2):
 *  - Preserve the fixed-baseline `[test].preload` entry
 *    `./node_modules/@opentui/solid/jsx-runtime.js` (the pinned OpenTUI Solid
 *    JSX runtime used by the test runner).
 *  - Enforce the target `[install]` policy: public npm registry,
 *    `exact = true` and the `hoisted` linker. The existing `save.lockfile`
 *    entry must be preserved.
 *
 * RED phase: the target `[install].registry` and `[install].linker` keys are
 * not present yet, so the policy assertions fail (expected).
 * GREEN phase: bunfig.toml is updated in-batch to add the public registry and
 * `linker = "hoisted"`; these assertions then pass.
 *
 * This test is self-contained: it reads bunfig.toml directly and does not
 * depend on any script from scripts/.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const BUNFIG_PATH = join(REPO_ROOT, 'bunfig.toml');

/** Fixed baseline preload entry that must never be removed (guide §7.2). */
const PINNED_PRELOAD = './node_modules/@opentui/solid/jsx-runtime.js';

/** Target install policy (guide §7.2). */
const TARGET_REGISTRY = 'https://registry.npmjs.org';
const TARGET_LINKER = 'hoisted';

interface TomlSection {
  [key: string]: string | boolean | number | string[];
}

/**
 * Minimal TOML parser sufficient for the shape of bunfig.toml.
 *
 * Handles `[section]` headers, `key = "string"`, `key = true/false`,
 * `key = 123`, `key = ["a", "b"]` and inline tables such as
 * `save = { lockfile = "bun.lock" }` (parsed as a raw string). Comments and
 * blank lines are ignored. Nested tables are intentionally out of scope.
 */
function parseToml(text: string): Map<string, TomlSection> {
  const sections = new Map<string, TomlSection>();
  let current: TomlSection | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const name = header[1]?.trim() ?? '';
      if (!sections.has(name)) sections.set(name, {});
      current = sections.get(name);
      continue;
    }
    if (!current) continue;
    // Strip trailing comment (only when not inside a quoted string).
    const eq = findAssignment(line);
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    current[key] = parseValue(rawValue);
  }
  return sections;
}

/** Finds the `=` that separates key and value, ignoring `=` inside quotes. */
function findAssignment(line: string): number {
  let inQuote = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (inQuote) {
      if (ch === quote) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true;
      quote = ch;
      continue;
    }
    if (ch === '=') return i;
  }
  return -1;
}

function parseValue(raw: string): string | boolean | number | string[] {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    return end === -1 ? value : value.slice(1, end);
  }
  if (value.startsWith('[')) {
    const inner = value.slice(1, value.lastIndexOf(']'));
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
      .filter(Boolean);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  // Inline table (e.g. `save = { lockfile = "bun.lock" }`) — keep raw.
  return value;
}

function readBunfig(): Map<string, TomlSection> {
  const text = readFileSync(BUNFIG_PATH, 'utf8');
  return parseToml(text);
}

describe('bunfig.toml install policy (guide §7.2)', () => {
  const sections = readBunfig();
  const install = sections.get('install');

  test('declares a [install] section', () => {
    expect(install, 'missing [install] section in bunfig.toml').toBeDefined();
  });

  test('pins the public npm registry', () => {
    expect(install?.registry, 'registry is not pinned to the public npm registry').toBe(
      TARGET_REGISTRY,
    );
  });

  test('uses exact version pinning', () => {
    expect(install?.exact, 'exact = true is required for reproducible installs').toBe(true);
  });

  test('uses the hoisted linker (configVersion 0 semantics)', () => {
    expect(install?.linker, 'linker = "hoisted" is required').toBe(TARGET_LINKER);
  });

  test('preserves the lockfile save location', () => {
    expect(install?.save, 'save = { lockfile = "bun.lock" } must be preserved').toBeDefined();
  });
});

describe('bunfig.toml fixed-baseline test preload (guide §7.2)', () => {
  const sections = readBunfig();
  const testSection = sections.get('test');

  test('declares a [test] section', () => {
    expect(testSection, 'missing [test] section in bunfig.toml').toBeDefined();
  });

  test('keeps the pinned OpenTUI Solid JSX runtime in [test].preload', () => {
    const preload = testSection?.preload;
    expect(Array.isArray(preload), 'preload must be an array').toBe(true);
    expect(preload).toContain(PINNED_PRELOAD);
  });
});
