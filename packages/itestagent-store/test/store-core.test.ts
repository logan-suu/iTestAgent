import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreCore } from '../src/index.js';
import * as schema from '../src/schema.js';

describe('createStoreCore', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = join(
      tmpdir(),
      `itestagent-store-core-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testRoot, 'db'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('returns db, driver, and sqlite from a single shared connection', () => {
    const dbPath = join(testRoot, 'db', 'itestagent.db');
    const core = createStoreCore(dbPath);

    expect(core.db).toBeDefined();
    expect(core.driver).toBeDefined();
    expect(core.sqlite).toBeDefined();
  });

  it('driver.migrate() creates tables that db (Drizzle) can query', async () => {
    const dbPath = join(testRoot, 'db', 'itestagent.db');
    const { db, driver } = createStoreCore(dbPath);

    await driver.migrate();

    const projects = await db.select().from(schema.projects);
    expect(Array.isArray(projects)).toBe(true);
  });

  it('transaction() with db write does not cause SQLITE_BUSY', async () => {
    const dbPath = join(testRoot, 'db', 'itestagent.db');
    const { db, driver } = createStoreCore(dbPath);

    await driver.migrate();

    // Execute transaction that writes via db (Drizzle) inside driver.transaction()
    const result = await driver.transaction(async () => {
      await db.insert(schema.projects).values({
        projectHash: 'tx-test-001',
        workspacePath: '/tmp/tx-test',
      });
      return 'committed';
    });

    expect(result).toBe('committed');

    const rows = await db.select().from(schema.projects);
    expect(rows.some((r) => r.projectHash === 'tx-test-001')).toBe(true);
  });

  it('transaction rollback preserves pre-transaction state', async () => {
    const dbPath = join(testRoot, 'db', 'itestagent.db');
    const { db, driver } = createStoreCore(dbPath);

    await driver.migrate();

    // Insert outside transaction
    await db.insert(schema.projects).values({
      projectHash: 'rollback-test',
      workspacePath: '/tmp/rollback-test',
    });

    // Attempt a transaction that will fail
    let threw = false;
    try {
      await driver.transaction(async () => {
        await db.insert(schema.projects).values({
          projectHash: 'rollback-test-inner',
          workspacePath: '/tmp/should-not-exist',
        });
        throw new Error('forced rollback');
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Verify the rolled-back insert is NOT present
    const rows = await db.select().from(schema.projects);
    expect(rows.some((r) => r.projectHash === 'rollback-test-inner')).toBe(false);
    // Verify the pre-transaction insert IS still present
    expect(rows.some((r) => r.projectHash === 'rollback-test')).toBe(true);
  });

  it('idempotent migrate works through shared connection', async () => {
    const dbPath = join(testRoot, 'db', 'itestagent.db');
    const { driver } = createStoreCore(dbPath);

    await driver.migrate();
    await driver.migrate();

    const dbPathCheck = join(testRoot, 'db', 'itestagent.db');
    expect(existsSync(dbPathCheck)).toBe(true);
  });
});
