/**
 * bootstrap-isolation.test.ts — B07 store-artifacts batch (promotion guide
 * §11.3). Locks the isolation guarantee of store bootstrapping:
 *
 *   - when ITESTAGENT_HOME points at a temp root, initStore must create the
 *     full directory contract there and NEVER touch the real ~/.itestagent;
 *   - baseline domains (ADR-011) are part of the created tree;
 *   - re-running initStore is idempotent and preserves foreign files.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_DIRS, initStore, resolveStoreRoot } from '../src/bootstrap.js';

describe('bootstrap isolation (B07)', () => {
  let isolatedRoot: string;
  const previousEnv = process.env.ITESTAGENT_HOME;

  beforeEach(() => {
    isolatedRoot = join(
      tmpdir(),
      `itestagent-b07-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.ITESTAGENT_HOME = isolatedRoot;
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      process.env.ITESTAGENT_HOME = undefined as unknown as string;
    } else {
      process.env.ITESTAGENT_HOME = previousEnv;
    }
    if (existsSync(isolatedRoot)) {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('creates every STORE_DIR under the isolated root', () => {
    const root = initStore();
    expect(root).toBe(resolveStoreRoot());
    for (const dir of STORE_DIRS) {
      expect(existsSync(join(root, dir))).toBe(true);
    }
  });

  it('creates ADR-011 baseline domain subdirectories', () => {
    const root = initStore();
    expect(existsSync(join(root, 'baselines', 'physical'))).toBe(true);
    expect(existsSync(join(root, 'baselines', 'simulator'))).toBe(true);
  });

  it('resolves the isolated env root, never the real ~/.itestagent', () => {
    const root = initStore();
    expect(root.startsWith(isolatedRoot)).toBe(true);
    expect(root).not.toBe(join(import.meta.dir, '..', '..', '..', '.itestagent'));
  });

  it('is idempotent and preserves pre-existing foreign files', () => {
    mkdirSync(join(isolatedRoot, 'runs'), { recursive: true });
    const sentinel = join(isolatedRoot, 'runs', 'foreign-run-dir');
    mkdirSync(sentinel, { recursive: true });
    writeFileSync(join(sentinel, 'result.json'), '{}\n');

    expect(() => initStore()).not.toThrow();
    expect(() => initStore()).not.toThrow();
    expect(existsSync(join(sentinel, 'result.json'))).toBe(true);
  });
});
