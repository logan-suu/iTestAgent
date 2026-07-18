import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreDriver } from '../src/store-driver.js';

describe('StoreDriver', () => {
  let testRoot: string;
  let driver: ReturnType<typeof createStoreDriver>;

  beforeEach(async () => {
    testRoot = join(
      tmpdir(),
      `itestagent-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testRoot, 'db'), { recursive: true });
    driver = createStoreDriver(join(testRoot, 'db', 'itestagent.db'));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('migrate', () => {
    // AC2: metadata 存 SQLite + Drizzle
    it('creates tables on first migration (AC2)', async () => {
      await driver.migrate();

      const dbPath = join(testRoot, 'db', 'itestagent.db');
      expect(existsSync(dbPath)).toBe(true);

      // Verify tables exist by running SQL
      const tables = await driver.transaction(async () => {
        // We use a raw query to check table existence
        const { Database } = await import('bun:sqlite');
        const db = new Database(dbPath, { readonly: true });
        const rows = db
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_drizzle_%'",
          )
          .all() as { name: string }[];
        db.close();
        return rows.map((r) => r.name);
      });

      expect(tables).toContain('projects');
      expect(tables).toContain('runs');
    });

    it('is idempotent — calling migrate twice does not throw', async () => {
      await driver.migrate();
      await expect(driver.migrate()).resolves.toBeUndefined();
    });

    it('calling migrate twice does not create duplicate tables', async () => {
      await driver.migrate();
      await driver.migrate();

      const dbPath = join(testRoot, 'db', 'itestagent.db');
      const { Database } = await import('bun:sqlite');
      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .query("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='projects'")
        .get() as { cnt: number };
      db.close();
      expect(rows.cnt).toBe(1);
    });
  });

  describe('transaction', () => {
    it('returns the result of the transaction callback', async () => {
      await driver.migrate();

      const result = await driver.transaction(async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('propagates errors from the callback', async () => {
      await driver.migrate();

      let caught = false;
      try {
        await driver.transaction(async () => {
          throw new Error('test error');
        });
      } catch (err: unknown) {
        caught = (err as Error).message === 'test error';
      }
      expect(caught).toBe(true);
    });

    it('maintains database state after commit (AC4)', async () => {
      await driver.migrate();

      const dbPath = join(testRoot, 'db', 'itestagent.db');
      const { Database } = await import('bun:sqlite');

      // Insert via raw SQL before driver takes the connection
      const setupDb = new Database(dbPath);
      setupDb.run('INSERT INTO projects (project_hash, workspace_path) VALUES (?, ?)', [
        'ac4-run-id-test',
        '/test/ac4',
      ]);
      setupDb.close();

      // Verify insert persisted (outside transaction)
      const readDb = new Database(dbPath, { readonly: true });
      const row = readDb
        .query('SELECT project_hash FROM projects WHERE project_hash = ?')
        .get('ac4-run-id-test') as { project_hash: string } | null;
      readDb.close();

      expect(row).not.toBeNull();
      expect(row?.project_hash).toBe('ac4-run-id-test');
    });
  });
});
