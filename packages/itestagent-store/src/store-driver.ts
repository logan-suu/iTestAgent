import { Database } from 'bun:sqlite';
import type { StoreDriver } from 'itestagent-contracts';

/**
 * SQL migrations as raw statements — avoids drizzle-kit dependency.
 * Each entry is [name, sql]. Runs only once; idempotent.
 */
const MIGRATIONS: [string, string][] = [
  [
    '001_initial',
    `
    CREATE TABLE IF NOT EXISTS projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_hash    TEXT NOT NULL UNIQUE,
      workspace_path  TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL UNIQUE,
      project_hash    TEXT NOT NULL REFERENCES projects(project_hash),
      target_kind     TEXT NOT NULL CHECK(target_kind IN ('physical', 'simulator')),
      status          TEXT NOT NULL DEFAULT 'created',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project_hash ON runs(project_hash);
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_projects_project_hash ON projects(project_hash);
    `,
  ],
];

/**
 * Create a StoreDriver backed by a SQLite database.
 *
 * Maintains a single persistent connection for transactional safety.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns StoreDriver implementation
 */
export function createStoreDriver(dbPath: string): StoreDriver {
  const sqlite = new Database(dbPath);
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA foreign_keys = ON');

  return {
    async migrate(): Promise<void> {
      // Create migrations tracking table
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS _migrations (
          name      TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      for (const [name, sql] of MIGRATIONS) {
        const row = sqlite.query('SELECT name FROM _migrations WHERE name = ?').get(name) as {
          name: string;
        } | null;

        if (!row) {
          sqlite.run(sql);
          sqlite.run('INSERT INTO _migrations (name) VALUES (?)', [name]);
        }
      }
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      try {
        sqlite.run('BEGIN IMMEDIATE');
        const result = await fn();
        sqlite.run('COMMIT');
        return result;
      } catch (err) {
        try {
          sqlite.run('ROLLBACK');
        } catch {
          // Silently ignore rollback errors
        }
        throw err;
      }
    },
  };
}
