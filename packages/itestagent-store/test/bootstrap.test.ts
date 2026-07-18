import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_DIRS, initStore, resolveStoreRoot } from '../src/bootstrap.js';

describe('bootstrap', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      tmpdir(),
      `itestagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('resolveStoreRoot', () => {
    it('returns ITESTAGENT_HOME env var when set', () => {
      const original = process.env.ITESTAGENT_HOME;
      process.env.ITESTAGENT_HOME = testRoot;
      const result = resolveStoreRoot();
      process.env.ITESTAGENT_HOME = original;
      expect(result).toBe(testRoot);
    });

    it('returns ~/.itestagent when ITESTAGENT_HOME is unset', () => {
      const original = process.env.ITESTAGENT_HOME;
      process.env.ITESTAGENT_HOME = undefined;
      const result = resolveStoreRoot();
      process.env.ITESTAGENT_HOME = original;
      expect(result).toContain('.itestagent');
    });
  });

  describe('initStore', () => {
    // AC1: directory structure ~/.itestagent/{config,db,projects,sessions,flows,baselines,runs}
    it('creates all required directories on first call (AC1)', () => {
      const storeRoot = join(testRoot, '.itestagent');
      const result = initStore(storeRoot);

      const expectedDirs = ['config', 'db', 'projects', 'sessions', 'flows', 'baselines', 'runs'];

      for (const dir of expectedDirs) {
        const fullPath = join(storeRoot, dir);
        expect(existsSync(fullPath)).toBe(true);
      }

      // AC1: baselines 按 targetKind 分域
      const baselinePhysical = join(storeRoot, 'baselines', 'physical');
      const baselineSimulator = join(storeRoot, 'baselines', 'simulator');
      expect(existsSync(baselinePhysical)).toBe(true);
      expect(existsSync(baselineSimulator)).toBe(true);

      expect(result).toBe(storeRoot);
    });

    it('is idempotent — calling twice does not throw', () => {
      const storeRoot = join(testRoot, '.itestagent');
      initStore(storeRoot);
      expect(() => initStore(storeRoot)).not.toThrow();
    });

    it('returns the same path that was passed in', () => {
      const storeRoot = join(testRoot, '.itestagent');
      const result = initStore(storeRoot);
      expect(result).toBe(storeRoot);
    });

    it('defaults to ~/.itestagent when no path provided', () => {
      const home = process.env.HOME || '/tmp';
      const result = initStore();
      expect(result).toContain('.itestagent');
      // Verify the default was created
      const defaultRoot = result;
      expect(existsSync(defaultRoot)).toBe(true);
      for (const dir of STORE_DIRS) {
        expect(existsSync(join(defaultRoot, dir))).toBe(true);
      }
      // Clean up default store created by this test
      rmSync(defaultRoot, { recursive: true, force: true });
    });
  });
});
